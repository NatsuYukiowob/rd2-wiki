// GitHub API 的最小封裝：fork 一份倉庫、把多檔改動包成單一 commit、開 PR。
//
// 為什麼用 Git Data API（blob → tree → commit → ref）而不是看起來簡單很多的 Contents API
// （PUT /repos/{owner}/{repo}/contents/{path}）：Contents API 一次呼叫只能寫一個檔案，
// 一次送出（同時改 data/dice-tree.svg、data/keywords.json、data/icons/<hash>.png）會變成
// 三個各自獨立的 commit。這個專案的整個 PR 審查模型建立在「diff 小到維護者看得懂」上
// （見 src/lib/pr-summary.ts 檔頭），三個 commit 會讓同一次編輯的改動被拆散、難以一眼看懂，
// 所以即使 Git Data API 步驟多、要手動組 tree，也要用它把多檔改動壓成一個 commit。
//
// 為什麼分支從「上游 main 的 commit sha」建立，不是玩家 fork 的預設分支：玩家的 fork 可能是
// 幾個月前建的、早就落後上游。fork 與上游共用同一個物件庫（Git 的 fork 網路特性），所以直接
// 拿上游的 sha 當作新分支與新 commit 的 parent 是合法操作，也順帶省掉「先同步 fork 再建分支」
// 這一步——省掉的不只是一次額外呼叫，是省掉「玩家的 PR 因為 fork 落後而夾帶一堆不相干的
// 回退改動」這個真的會發生、且會讓維護者完全看不懂 diff 的問題。

/** 送出的其中一個檔案；`content` 用 bytes 而不是 string，SVG（文字）與 PNG 圖示（二進位）
 *  才能用同一個型別表示，由 `openPr` 內部依副檔名決定用 utf-8 還是 base64 編碼送出。 */
export interface FileChange { path: string; content: Uint8Array }

export interface OpenPrInput {
  token: string; login: string;
  /** 形如 `NatsuYukiowob/rd2-wiki`，跟 `_lib/session.ts` 的 `Env.UPSTREAM_REPO` 同一種格式。 */
  upstream: string;
  /** 形如 `editor/<timestamp>-<login>`，由呼叫端（Task 20 的 submit 端點）產生。 */
  branch: string;
  /** 建分支／建 commit 的基底 sha；沒傳的話 `openPr` 自己呼叫 `getBaseSha` 抓一次上游 main
   *  目前的 sha。呼叫端如果在呼叫 `openPr` 之前還需要用同一個基底讀其他檔案內容（例如
   *  Task 20 的 submit 端點要用它讀 `data/keywords.json` 做最小插入），務必自己先呼叫
   *  `getBaseSha` 拿到 sha、把讀檔跟這裡都餵同一個值——分別各自呼叫 `getBaseSha` 兩次，
   *  中間有機率（`raw.githubusercontent.com` 這類 CDN 甚至有數分鐘等級的快取延遲）上游
   *  剛好又推進一個 commit，讀到的檔案內容就會跟這次 commit 實際採用的 base_tree 對不上
   *  ——輕則這個 PR 靜默還原了別人剛加的內容，重則 diff 會顯示玩家改了他沒改過的東西
   *  （見 `getFileAtRef` 的說明）。 */
  baseSha?: string;
  title: string; body: string;
  files: FileChange[];
}

const GITHUB_API = 'https://api.github.com';

/** 逾時前最多輪詢幾次、每次間隔多久——GitHub 建 fork 的延遲實測是數秒等級，10 次 × 1 秒
 *  的預算留有餘裕，又不會讓第一次投稿失敗的玩家等到誤以為頁面卡死。 */
const FORK_POLL_ATTEMPTS = 10;
const FORK_POLL_INTERVAL_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 附加 GitHub API 要求的標準標頭，回傳原始 `Response`、不檢查狀態碼。
 *
 * 不在這裡檢查 `res.ok`：`ensureFork` 的輪詢需要把「404（fork 還沒建好）」當成正常的
 * 中間狀態處理，不是錯誤——如果這裡就對非 2xx 拋例外，輪詢邏輯得整圈包一層 try/catch
 * 才能分辨「還沒好」跟「真的壞了」，比讓呼叫端自己看 `res.ok` 更繞。`ghFetch`（下面）
 * 才是「非 2xx 一律當錯誤拋出」的那一層，給不需要輪詢的呼叫端用。
 */
async function rawFetch(token: string, url: string, init: RequestInit = {}, f: typeof fetch = fetch): Promise<Response> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'user-agent': 'rd2-wiki-editor',
    'x-github-api-version': '2022-11-28',
  };
  // 只有真的帶 body 的請求（POST /git/blobs 等）才需要宣告 content-type；GET 請求沒有
  // body，帶上這個標頭沒有意義。
  if (init.body) headers['content-type'] = 'application/json';
  return f(url, { ...init, headers });
}

/** 非 2xx 時把 GitHub 回應裡的 `message` 併進錯誤訊息再拋——GitHub 的錯誤 body 通常是
 *  `{ message, documentation_url }`，只回一個狀態碼在 log 裡完全看不出是權限不夠、
 *  分支已存在、還是別的問題。body 不是 JSON（少數錯誤是純文字）就退回用 statusText。 */
async function ghFetch<T = unknown>(token: string, url: string, init: RequestInit = {}, f: typeof fetch = fetch): Promise<T> {
  const res = await rawFetch(token, url, init, f);
  if (!res.ok) {
    let message = res.statusText;
    try {
      const errBody = (await res.json()) as { message?: string };
      if (errBody.message) message = errBody.message;
    } catch {
      // 沒有 JSON body 可讀就用 statusText 頂著，不讓解析失敗蓋掉真正的錯誤。
    }
    throw new Error(`GitHub API 失敗（${res.status} ${url}）：${message}`);
  }
  return (await res.json()) as T;
}

/**
 * 確保 `login` 名下有一份 `upstream` 的 fork，處理 GitHub 建 fork 的非同步延遲。
 *
 * `POST /forks` 對「已經 fork 過」跟「這次才新建」都回 202/200（GitHub 端是 idempotent
 * 的），差別只在新建時 fork 的 repo 物件不會馬上查得到——所以呼叫完一律接著輪詢
 * `GET /repos/{login}/{repo}` 直到拿到 200，逾時才視為真的失敗。多數玩家的 fork 早就
 * 存在，第一次輪詢就會成功，不會真的等到 10 次。
 */
export async function ensureFork(token: string, upstream: string, login: string, f: typeof fetch = fetch): Promise<void> {
  const repo = upstream.split('/')[1];
  await ghFetch(token, `${GITHUB_API}/repos/${upstream}/forks`, { method: 'POST' }, f);

  for (let attempt = 1; attempt <= FORK_POLL_ATTEMPTS; attempt++) {
    const res = await rawFetch(token, `${GITHUB_API}/repos/${login}/${repo}`, {}, f);
    if (res.ok) return;
    if (attempt < FORK_POLL_ATTEMPTS) await sleep(FORK_POLL_INTERVAL_MS);
  }
  throw new Error(`fork 尚未就緒：等了 ${FORK_POLL_ATTEMPTS} 次仍查不到 ${login}/${repo}，請稍後重試`);
}

/** 目前唯一的二進位檔案類型是 `data/icons/*.png`，用副檔名判斷就夠，不需要嗅探內容。 */
function isBinaryPath(path: string): boolean {
  return path.endsWith('.png');
}

/** `btoa` 只吃字串，先把每個 byte 轉成對應的 Latin-1 字元組成二進位字串再編碼——
 *  Workers 環境沒有 `Buffer.from(...).toString('base64')` 這條路可走。 */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

interface GitRef { object: { sha: string } }
interface GitBlob { sha: string }
interface GitTree { sha: string }
interface GitCommit { sha: string }
interface PullRequest { number: number; html_url: string }
interface GitContentFile { content: string; encoding: string }

/** 讀上游倉庫 `main` 分支目前指到的 commit sha。從 `openPr` 內部抽出來獨立匯出，是因為
 *  呼叫端（Task 20 的 submit 端點）在需要「用同一個基底讀某個檔案內容、再拿同一個基底
 *  建 commit」時，必須自己先抓一次這個 sha、把它同時餵給 `getFileAtRef` 跟 `openPr` 的
 *  `baseSha`——分別各自呼叫兩次會有漂移風險（見 `OpenPrInput.baseSha` 的說明）。 */
export async function getBaseSha(token: string, upstream: string, f: typeof fetch = fetch): Promise<string> {
  const baseRef = await ghFetch<GitRef>(token, `${GITHUB_API}/repos/${upstream}/git/ref/heads/main`, {}, f);
  return baseRef.object.sha;
}

/**
 * 讀某個 ref（commit sha、分支名皆可）上單一檔案的內容，解碼成文字字串。
 *
 * 用 GitHub 的 Contents API（`GET /repos/{upstream}/contents/{path}?ref={ref}`）而不是
 * `raw.githubusercontent.com`：後者是 CDN，文件記載有數分鐘等級的快取延遲，讀到的內容
 * 可能跟呼叫端指定的 `ref` 對不上——比 `ref` 舊，會讓插入的內容遺漏掉 `ref` 那個 commit
 * 之後才合併的變動；比 `ref` 新，則會讓最後產生的 PR diff 顯示出「玩家改了他根本沒碰過
 * 的東西」（因為 commit 的 base_tree 是 `ref`，但這裡讀到的是 `ref` 之後的內容）。
 * Contents API 是直接查 Git 物件庫，給定 `ref` 就精準讀那個 sha 上的內容，沒有這個問題。
 *
 * 這不是要推翻檔頭「為什麼用 Git Data API 而不是 Contents API」那段的結論——那段講的是
 * *寫入* 多檔案時 Contents API 一次只能改一個檔案、會拆成多個 commit；這裡是*讀取*單一
 * 檔案在特定 sha 上的內容，兩者是不同操作、不同關注點，Contents API 用在讀取上沒有那個
 * 問題。
 *
 * Contents API 預設回傳 base64（`encoding: 'base64'`），GitHub 還會把 base64 字串每 60
 * 字元插一個換行方便閱讀（純排版，不影響解碼語意，但 `atob` 前得先濾掉）。解出來的是
 * 原始位元組，逐字元對應 char code 只會得到 Latin-1 語意（中文字元會變亂碼）——這裡跟
 * `openPr` 建文字 blob 時 `new TextDecoder().decode()` 那步一樣，用 `TextDecoder` 把
 * 位元組轉回正確的 UTF-8 字串。
 */
export async function getFileAtRef(token: string, upstream: string, path: string, ref: string, f: typeof fetch = fetch): Promise<string> {
  const file = await ghFetch<GitContentFile>(token, `${GITHUB_API}/repos/${upstream}/contents/${path}?ref=${ref}`, {}, f);
  if (file.encoding !== 'base64') throw new Error(`讀取 ${path} 失敗：未預期的編碼 ${file.encoding}`);
  const binary = atob(file.content.replace(/\n/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * 把 `input.files` 的所有改動包成單一 commit，在玩家 fork 上開新分支，對上游開 PR。
 *
 * 固定六步（見檔頭「為什麼用 Git Data API」的說明）：
 * 1. 取得上游 main 目前的 commit sha（`input.baseSha` 有給就用，沒給就自己呼叫
 *    `getBaseSha` 抓一次），後面的分支與 commit 都接在這個 sha 上。
 * 2. 每個檔案各自建一個 blob（文字 utf-8、二進位 base64）。
 * 3. 用所有 blob 建一個 tree，`base_tree` 接上游 sha——沒被改到的檔案不用重新列出。
 * 4. 用這個 tree 建一個 commit，`parents` 只有上游 sha，不是玩家 fork 舊有的 commit。
 * 5. 在玩家 fork 上把新分支指到這個 commit。
 * 6. 對上游開 PR，`head` 用 `<login>:<branch>` 語法指到玩家 fork 的分支，`base` 固定 main。
 *
 * 呼叫前必須先 `ensureFork`：這裡不重複做 fork 存在性檢查，兩件事分屬不同關注點
 * （fork 是否就緒 vs. 這次要送出什麼改動），交給呼叫端（Task 20 的 submit 端點）決定順序。
 */
export async function openPr(input: OpenPrInput, f: typeof fetch = fetch): Promise<{ number: number; url: string }> {
  const { token, login, upstream, branch, baseSha: suppliedBaseSha, title, body, files } = input;
  const repo = upstream.split('/')[1];
  const forkRepo = `${GITHUB_API}/repos/${login}/${repo}`;

  const baseSha = suppliedBaseSha ?? await getBaseSha(token, upstream, f);

  // 個別 blob 之間沒有依賴，平行送出縮短總延遲；`Promise.all` 保留呼叫端傳入的 `files`
  // 順序（結果陣列順序對應輸入順序，跟哪個請求先落地無關），tree 才能對得上每個檔案的路徑。
  const blobs = await Promise.all(files.map(async file => {
    const binary = isBinaryPath(file.path);
    const blob = await ghFetch<GitBlob>(token, `${forkRepo}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify(binary
        ? { content: toBase64(file.content), encoding: 'base64' }
        : { content: new TextDecoder().decode(file.content), encoding: 'utf-8' }),
    }, f);
    return { path: file.path, sha: blob.sha };
  }));

  const tree = await ghFetch<GitTree>(token, `${forkRepo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({
      base_tree: baseSha,
      tree: blobs.map(b => ({ path: b.path, mode: '100644', type: 'blob', sha: b.sha })),
    }),
  }, f);

  const commit = await ghFetch<GitCommit>(token, `${forkRepo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message: title, tree: tree.sha, parents: [baseSha] }),
  }, f);

  await ghFetch(token, `${forkRepo}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }),
  }, f);

  const pr = await ghFetch<PullRequest>(token, `${GITHUB_API}/repos/${upstream}/pulls`, {
    method: 'POST',
    body: JSON.stringify({ title, body, head: `${login}:${branch}`, base: 'main' }),
  }, f);

  return { number: pr.number, url: pr.html_url };
}
