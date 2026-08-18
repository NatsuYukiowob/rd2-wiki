// 把 Task 17（session）／Task 18（OAuth 登入）／Task 19（GitHub API 封裝）串成單一端點：
// 玩家在 /edit 編輯完、按下送出，前端把編輯結果 POST 到這裡，這裡負責開 fork、開分支、
// 開 PR，回傳 PR 編號與網址讓前端顯示連結。
//
// 伺服器端刻意不重跑 `validateWith`：那需要把整份 239 節點的 SVG 完整解析一次，在 Function
// 裡跑會拖慢回應（每次送出都要多等好幾秒），而且真正的守門員本來就是 CI（見 CLAUDE.md
// 「資料正本」一段——CI 是唯一防線，維護者不可能逐行 review diff）。這裡只做三件事：
// 確認已登入、擋掉異常大的 payload、軟性節流（同一 session 兩次送出間隔至少 30 秒，
// 時間戳存在加密 cookie 裡）。硬性的濫用防護交給 Cloudflare 儀表板對 /api/github/submit
// 設的 Rate Limiting 規則，不為了計數這件事引入 KV 這個新相依。
import { openSession, sealSession, sessionCookie, readSessionCookie, type Env } from './_lib/session.js';
import { ensureFork, openPr, type FileChange } from './_lib/gh.js';
import { renderPrTitle, renderPrBody, type EditSummary } from '../../../src/lib/pr-summary.js';

export interface SubmitBody {
  svgText: string;
  /** 有新增關鍵字時才帶；只放「這次新增的」詞（前端 editorState.newKeywords 的內容），
   *  不是整份白名單——`insertKeywords` 只需要新增的部分做最小插入。 */
  keywords?: string[];
  icons?: { hash: string; base64: string }[];
  /** 前端算好的摘要，僅供 PR 標題／內文使用；伺服器不會拿它重算或驗證任何東西
   *  （見檔頭「伺服器端刻意不重跑驗證」）。 */
  summary: EditSummary;
}

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

/**
 * 讀上游 repo 目前的 `data/keywords.json` 內容，供 `insertKeywords` 做最小插入。
 *
 * 設計決定——原始內容從哪來，是後端自己抓，不是讓前端把它已經 fetch 過的內容
 * （Task 11，`/data/keywords.json`）一併送上來：
 *
 * 1. `SubmitBody` 是這個任務定案的介面，欄位只有 `keywords?: string[]`（新增的詞），沒有
 *    「原始字串」這個欄位。硬塞一個等於是在這個任務裡順便改 Task 11 的前端 fetch 邏輯
 *    （它目前直接 `.then(r => r.json())`，原始字串沒有被保留下來）——那是 src/scripts/
 *    edit-canvas.ts 的改動，超出這個任務「Code Organization」鎖定的檔案範圍
 *    （functions/api/github/submit.ts＋測試）。
 * 2. 就算加了欄位，前端送上來的內容也只會是玩家「開始編輯那一刻」的舊快照——玩家可能編輯
 *    了很久才送出。這段期間如果剛好有別的 PR 合併、`data/keywords.json` 內容變了，拿玩家
 *    手上的舊字串做最小插入，等於用舊版本覆蓋掉那個變動（其他人加的詞會憑空消失）。
 *    改成伺服器在真正要開 PR 之前才去讀上游「現在」的內容，這個競態視窗窄得多
 *    （只剩這次請求處理的幾百毫秒，而不是玩家整段編輯階段）。
 *
 * 不透過 `_lib/gh.ts` 既有的 `ghFetch`／`rawFetch`：兩者都是模組私有匯出，且都預設帶
 * GitHub API 認證標頭；`raw.githubusercontent.com` 是公開內容，不需要玩家的 token，用最
 * 單純的一次 GET 就好——也不需要為了這一個檔案去擴大 `_lib/gh.ts` 的匯出面（那個檔案
 * 這個任務的 Code Organization 沒有列進改動範圍）。
 *
 * 仍然殘留一個小競態視窗（這次讀取到 `openPr` 真正建 commit 之間，上游理論上還是可能再變），
 * 但那是 `openPr` 本身「分支建在上游 sha 上」這個既有設計的既有取捨（見 gh.ts 檔頭說明），
 * 不是這個函式新引入的問題；真正的正確性防線始終是 CI，不是這裡的視窗大小。
 */
async function fetchUpstreamKeywordsJson(upstream: string, f: typeof fetch): Promise<string> {
  const res = await f(`https://raw.githubusercontent.com/${upstream}/main/data/keywords.json`);
  if (!res.ok) throw new Error(`讀取上游 data/keywords.json 失敗（${res.status}）`);
  return res.text();
}

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

  try {
    const files: FileChange[] = [
      { path: 'data/dice-tree.svg', content: new TextEncoder().encode(body.svgText) },
    ];
    for (const icon of body.icons ?? []) {
      files.push({ path: `data/icons/${icon.hash}.png`, content: fromBase64(icon.base64) });
    }
    if (body.keywords && body.keywords.length > 0) {
      const original = await fetchUpstreamKeywordsJson(env.UPSTREAM_REPO, f);
      const updated = insertKeywords(original, body.keywords);
      files.push({ path: 'data/keywords.json', content: new TextEncoder().encode(updated) });
    }

    await ensureFork(session.token, env.UPSTREAM_REPO, session.login, f);

    // editor/{YYYYMMDD}-{login}-{8 碼隨機}：日期方便維護者辨識，隨機尾碼避免同一人同一天
    // 送兩次時撞名（撞名會讓第二次的建分支請求失敗）。
    const dateStr = new Date(now()).toISOString().slice(0, 10).replace(/-/g, '');
    const branch = `editor/${dateStr}-${session.login}-${crypto.randomUUID().slice(0, 8)}`;

    const pr = await openPr({
      token: session.token,
      login: session.login,
      upstream: env.UPSTREAM_REPO,
      branch,
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
