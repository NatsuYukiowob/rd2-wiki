// 把 Task 17（session）／Task 18（OAuth 登入）／Task 19（GitHub API 封裝）串成單一端點：
// 玩家在 /edit 編輯完、按下送出，前端把編輯結果 POST 到這裡，這裡負責開 fork、開分支、
// 開 PR，回傳 PR 編號與網址讓前端顯示連結。
//
// 伺服器端刻意不重跑 `validateWith`：那需要把整份 239 節點的 SVG 完整解析一次，在 Function
// 裡跑會拖慢回應（每次送出都要多等好幾秒），而且真正的守門員本來就是 CI（見 CLAUDE.md
// 「資料正本」一段——CI 是唯一防線，維護者不可能逐行 review diff）。這裡做的事：確認已登入、
// 擋掉異常大的 payload、軟性節流（同一 session 兩次送出間隔至少 30 秒，時間戳存在加密 cookie
// 裡）、輸入的基本形狀檢查（I3：`svgText`／`icon.hash` 的格式）、`data/dice-tree.svg` 有沒有
// 在玩家編輯期間被別的 PR 改過（I4，見 handleSubmit 主流程對 `baseSvgHash` 的比對）。
// 硬性的濫用防護交給 Cloudflare 儀表板對 /api/github/submit 設的 Rate Limiting 規則，不為了
// 計數這件事引入 KV 這個新相依——**這條規則必須另外在 Cloudflare 儀表板手動設定**，這個檔案
// 的節流只防得住「不小心連點兩次」，防不住任何願意帶 curl 重放 cookie 的人（I6，見 CLAUDE.md
// 「信任邊界」一節）。
//
// ⚠️ 另一個信任邊界（I2）：`body.summary` 是玩家瀏覽器算好的，這裡只拿來組 PR 標題／內文，
// 完全不會拿它重算或驗證——一個惡意投稿者可以送一份「整份改寫的 svgText ＋ 宣稱只改了 1 個
// 節點的 summary」。`renderPrBody` 已經在內文加了一行說明「這份摘要未經伺服器驗證」，維護者
// 該信任的是 CI 自動貼的差異摘要留言（`tools/diff-summary.ts`），不是這裡組出來的內文。
import { openSession, sealSession, sessionCookie, readSessionCookie, type Env } from './_lib/session.js';
import { ensureFork, getBaseSha, getFileAtRef, openPr, type FileChange } from './_lib/gh.js';
import { renderPrTitle, renderPrBody, type EditSummary } from '../../../src/lib/pr-summary.js';
import { sha256Hex12 } from '../../../src/lib/icon-hash.js';

export interface SubmitBody {
  svgText: string;
  /** `editorState.original`（玩家開始編輯前那份骰子樹）的 sha256 前 12 碼，I4 的資料漂移
   *  檢查用（見 handleSubmit 主流程對它的比對邏輯，與 src/scripts/edit-canvas.ts 的
   *  `baseSvgHash` 說明）。 */
  baseSvgHash: string;
  /** 有新增關鍵字時才帶；只放「這次新增的」詞（前端 editorState.newKeywords 的內容），
   *  不是整份白名單——`insertKeywords` 只需要新增的部分做最小插入。 */
  keywords?: string[];
  icons?: { hash: string; base64: string }[];
  /** 前端算好的摘要，僅供 PR 標題／內文使用；伺服器不會拿它重算或驗證任何東西
   *  （見檔頭「伺服器端刻意不重跑驗證」與 I2：這份摘要完全由玩家瀏覽器產生，任何人可用
   *  curl 送一份「整份改寫的 svgText＋宣稱只改了 1 個節點的 summary」，`renderPrBody` 因此
   *  在內文加了一行說明這個信任邊界，見該函式）。 */
  summary: EditSummary;
}

/** I3（全分支審查抓到、22 輪任務審查都漏掉的 Important）：`icon.hash` 完全由客戶端控制，
 *  沒有格式檢查就直接拼進 commit 路徑（`data/icons/${icon.hash}.png`）。雖然這裡不會執行
 *  任意檔案系統操作（GitHub Contents/Git Data API 本身就會擋掉路徑穿越之類的異常字元組合，
 *  頂多是建出一個檔名很怪的檔案，不是本地檔案系統風險），但沒有格式檢查就等於把「這串字會
 *  被拼進公開 repo 的哪個路徑」完全交給匿名輸入決定，值得在進 GitHub API 之前就擋下、給一句
 *  可讀錯誤，而不是讓 GitHub API 用一個不透明的 4xx 擋（或者更糟：真的建出一個檔名詭異的
 *  檔案）。跟資料正本的雜湊格式（12 碼小寫 hex）用同一個規則，見 `src/lib/icon-hash.ts`。 */
const ICON_HASH_RE = /^[0-9a-f]{12}$/;

/** 跟 `_lib/session.ts` 的 `PagesGetHandler` 同一種「結構相容最小簽章」手法（見該檔案開頭
 *  的說明：根 tsconfig 沒載入 workers-types，`PagesFunction<Env>` 在那個程式下會找不到）。
 *  不直接 import `PagesGetHandler` 拿來用在 POST 端點上：那個型別名字是「Get」，用在這裡
 *  名不符實、容易誤導讀者，型別本身雖然結構相容但另外宣告一份意圖更清楚。 */
type PagesPostHandler = (context: { request: Request; env: Env }) => Response | Promise<Response>;

/** 異常大的 payload 直接擋掉，不進一步處理。1 MiB 對「一份 SVG 文字＋幾張圖示的 base64」
 *  綽綽有餘（正本 SVG 與單張圖示都是幾十 KB 等級），超過這個數字更可能是異常請求，
 *  不像是正常的一次編輯。 */
const MAX_PAYLOAD_BYTES = 1024 * 1024;

/** 同一 session 兩次送出間隔至少這麼多秒，時間戳存在加密 cookie 的 `lastSubmitAt` 裡。 */
const THROTTLE_SECONDS = 30;

/** `atob` 只吃字串、吐出 Latin-1 字串，逐字元轉回 byte——跟 `_lib/gh.ts` 的 `toBase64`
 *  同一個理由反過來做（Workers 環境沒有 `Buffer.from(x, 'base64')`），把前端傳上來的
 *  圖示 base64 還原成位元組。 */
function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * 對 `data/keywords.json` 的原始字串做最小插入：在收尾的 `]` 之前塞進新關鍵字，其餘位元組
 * 完全不動（2026-08-18 派工前實測補上的裁決：`JSON.stringify(keywords, null, 2) + '\n'`
 * 整檔重新序列化，會把現行 39 個詞的緊湊格式炸成每詞一行，玩家加一個詞就製造出「全部 39 個
 * 詞都變了」的假 diff——維護者完全看不出真正改了什麼，直接違反 Task 7 行區塊外科手術
 * 立下的「diff 小到能 review」承諾）。`validate` 是用 `JSON.parse` 讀這個檔的，任何合法
 * JSON 都可以，沒有格式化上的限制。
 *
 * `hasExisting` 判斷陣列原本是否為空：真的空陣列（`[]`）插入時不能加前導逗號，否則會產生
 * `[, "詞"]` 這種非法 JSON。目前的 data/keywords.json 恆非空（39 個詞），這裡只是防禦性
 * 處理，不依賴這個前提才能正確運作。
 */
function insertKeywords(original: string, newWords: string[]): string {
  const closeIdx = original.lastIndexOf(']');
  if (closeIdx === -1) throw new Error('data/keywords.json 格式異常：找不到收尾的 ]');
  const before = original.slice(0, closeIdx);
  const hasExisting = /"/.test(before);
  const insertion = newWords.map(w => JSON.stringify(w)).join(', ');
  return `${before}${hasExisting ? ', ' : ''}${insertion}${original.slice(closeIdx)}`;
}

// 設計決定——`data/keywords.json` 的原始內容從哪來，是後端自己抓，不是讓前端把它已經
// fetch 過的內容（Task 11，`/data/keywords.json`）一併送上來：
//
// 1. `SubmitBody` 是這個任務定案的介面，欄位只有 `keywords?: string[]`（新增的詞），沒有
//    「原始字串」這個欄位。硬塞一個等於是在這個任務裡順便改 Task 11 的前端 fetch 邏輯
//    （它目前直接 `.then(r => r.json())`，原始字串沒有被保留下來）——那是 src/scripts/
//    edit-canvas.ts 的改動，超出這個任務「Code Organization」鎖定的檔案範圍。
// 2. 就算加了欄位，前端送上來的內容也只會是玩家「開始編輯那一刻」的舊快照——玩家可能編輯
//    了很久才送出，這段期間如果剛好有別的 PR 合併、`data/keywords.json` 內容變了，拿玩家
//    手上的舊字串做最小插入等於用舊版本覆蓋掉那個變動（其他人加的詞會憑空消失）。
//
// （2026-08-18 review 後修正）第一版曾經用 `raw.githubusercontent.com` 讀這份內容，理由是
// 那裡不需要 token、也不用擴大 `_lib/gh.ts` 的匯出面。但 review 指出一個更根本的問題：
// `openPr` 建 commit 用的 `base_tree`／`parents` 是 `git/ref/heads/main` 當下讀到的 sha
// （見 `_lib/gh.ts`），跟 CDN 讀到的內容完全是兩個獨立來源，沒有任何機制保證兩者一致。
// CDN 讀到「比 sha 舊」的內容，PR 會靜默還原掉 sha 之後才合併的變動；讀到「比 sha 新」的
// 內容，PR 的 diff 會顯示玩家改了他根本沒碰過的東西——兩種都是真實的資料正確性問題，
// 不是「縮小競態視窗」能解決的，而是「跟建 commit 用同一個 sha 讀檔」直接消掉整類問題。
// 現在改成：`getBaseSha` 抓一次 sha，同時餵給 `getFileAtRef`（讀檔）與 `openPr`（建 commit
// 的 `baseSha`），確保兩者永遠是同一個基底——見 handleSubmit 主流程與 `_lib/gh.ts` 裡
// `OpenPrInput.baseSha`／`getFileAtRef` 的說明。

export async function handleSubmit(
  request: Request,
  env: Env,
  deps: { fetch?: typeof fetch; now?: () => number } = {},
): Promise<Response> {
  const f = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;

  const sealed = readSessionCookie(request);
  const session = sealed ? await openSession(sealed, env.SESSION_SECRET) : null;
  if (!session) return new Response(null, { status: 401 });

  // 先量 body 大小再解析：異常大的 payload 不值得花 CPU 去 JSON.parse。
  const bodyText = await request.text();
  if (new TextEncoder().encode(bodyText).length > MAX_PAYLOAD_BYTES) {
    return new Response(JSON.stringify({ message: '送出內容過大' }), {
      status: 413,
      headers: { 'content-type': 'application/json' },
    });
  }

  const nowSeconds = Math.floor(now() / 1000);
  if (session.lastSubmitAt !== undefined && nowSeconds - session.lastSubmitAt < THROTTLE_SECONDS) {
    return new Response(JSON.stringify({ message: '送出太頻繁，請稍候片刻再試一次' }), {
      status: 429,
      headers: { 'content-type': 'application/json' },
    });
  }

  let body: SubmitBody;
  try {
    body = JSON.parse(bodyText) as SubmitBody;
  } catch {
    return new Response(JSON.stringify({ message: '送出的內容不是合法的 JSON' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  // I3：基本形狀檢查，早於任何 GitHub API 呼叫。`body.svgText` 不是非空字串時（例如整個
  // 欄位漏帶、送成 `undefined`），沒有這道檢查會讓後面的 `new TextEncoder().encode(...)`
  // 寫出一份內容異常的 `data/dice-tree.svg`（視執行環境而定，可能是空字串或字面
  // `"undefined"`），玩家或維護者要等 CI 報一堆看不懂的解析錯誤才會發現。`icon.hash` 沒有
  // 格式檢查就直接拼進 commit 路徑，見 `ICON_HASH_RE` 的說明。
  if (typeof body.svgText !== 'string' || body.svgText.length === 0) {
    return new Response(JSON.stringify({ message: 'svgText 缺漏或格式不正確' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (typeof body.baseSvgHash !== 'string' || body.baseSvgHash.length === 0) {
    return new Response(JSON.stringify({ message: 'baseSvgHash 缺漏或格式不正確' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }
  for (const icon of body.icons ?? []) {
    if (!ICON_HASH_RE.test(icon.hash)) {
      return new Response(JSON.stringify({ message: `圖示雜湊格式不正確：${icon.hash}` }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
  }

  try {
    const files: FileChange[] = [
      { path: 'data/dice-tree.svg', content: new TextEncoder().encode(body.svgText) },
    ];
    for (const icon of body.icons ?? []) {
      files.push({ path: `data/icons/${icon.hash}.png`, content: fromBase64(icon.base64) });
    }

    const fork = await ensureFork(session.token, env.UPSTREAM_REPO, session.login, f);

    // 抓一次 baseSha，同時餵給下面讀 keywords.json（如果有）／比對 dice-tree.svg 雜湊
    // 跟稍後的 openPr——三者用同一個基底，才能保證「這裡看到的既有內容」跟「這次 commit
    // 實際採用的 base_tree」一致（見上面「設計決定」段落與 _lib/gh.ts 的
    // OpenPrInput.baseSha／getFileAtRef 說明）。
    const baseSha = await getBaseSha(session.token, env.UPSTREAM_REPO, f);

    // I4（全分支審查抓到、跟 keywords.json 早就修過的漂移問題是同一類 bug）：
    // `data/dice-tree.svg` 走的是「整份拿玩家頁面載入時的舊快照覆蓋」這條路——玩家開著
    // `/edit` 編輯期間，若維護者剛好合併了另一個 PR，直接覆蓋會靜默還原掉那個 PR 的全部
    // 改動，diff 上看起來卻只是一般改動，規則 10 的 id 警告也不會亮。這裡用跟 openPr 建
    // commit 同一個 `baseSha` 重讀一次上游現在的 `data/dice-tree.svg`，跟玩家送來的
    // `baseSvgHash`（他開始編輯那一刻的雜湊）比對，不同就代表上游在這段期間已經變了，
    // 拒絕這次送出並回 409，前端顯示可讀訊息、請玩家重新整理頁面。
    const currentSvg = await getFileAtRef(session.token, env.UPSTREAM_REPO, 'data/dice-tree.svg', baseSha, f);
    const currentSvgHash = await sha256Hex12(new TextEncoder().encode(currentSvg));
    if (currentSvgHash !== body.baseSvgHash) {
      return new Response(JSON.stringify({ message: '骰子樹資料已更新，請重新整理頁面後再改一次' }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (body.keywords && body.keywords.length > 0) {
      const original = await getFileAtRef(session.token, env.UPSTREAM_REPO, 'data/keywords.json', baseSha, f);
      const updated = insertKeywords(original, body.keywords);
      files.push({ path: 'data/keywords.json', content: new TextEncoder().encode(updated) });
    }

    // editor/{YYYYMMDD}-{login}-{8 碼隨機}：日期方便維護者辨識，隨機尾碼避免同一人同一天
    // 送兩次時撞名（撞名會讓第二次的建分支請求失敗）。
    const dateStr = new Date(now()).toISOString().slice(0, 10).replace(/-/g, '');
    const branch = `editor/${dateStr}-${session.login}-${crypto.randomUUID().slice(0, 8)}`;

    const pr = await openPr({
      token: session.token,
      upstream: env.UPSTREAM_REPO,
      forkFullName: fork.fullName,
      branch,
      baseSha,
      title: renderPrTitle(body.summary),
      body: renderPrBody(body.summary, new URL('/edit', request.url).toString()),
      files,
    }, f);

    // 節流時間戳存回 session：只保留 lastSubmitAt 更新，iat 原封不動——送出不該順便延長
    // session 的絕對有效期（openSession 靠 iat 做伺服器端過期檢查，見 _lib/session.ts）。
    const updatedSealed = await sealSession({ ...session, lastSubmitAt: nowSeconds }, env.SESSION_SECRET);
    return new Response(JSON.stringify(pr), {
      status: 200,
      headers: { 'content-type': 'application/json', 'set-cookie': sessionCookie(updatedSealed) },
    });
  } catch (err) {
    // ensureFork／openPr／讀上游 keywords.json 任何一步失敗（GitHub API 錯誤、逾時…）都在
    // 這裡收斂成一個可讀的錯誤訊息，不讓例外冒到請求層變成不透明的平台錯誤頁——跟
    // callback.ts 對外部呼叫的處理原則一致。502（Bad Gateway）：失敗成因是這條呼叫鏈打的
    // 上游（GitHub API），不是這個端點自己的邏輯錯誤。
    const message = err instanceof Error ? err.message : '送出失敗';
    return new Response(JSON.stringify({ message }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }
}

export const onRequestPost: PagesPostHandler = ({ request, env }) => handleSubmit(request, env);
