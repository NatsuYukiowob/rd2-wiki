// 前端唯一知道「訪客號碼從哪來」的檔案。index.astro 只負責顯示，不知道後端是誰——
// 之後要換後端、加「今日／總計」，都只動這一支。
//
// 回傳 null = 顯示不出來，呼叫端據此隱藏整塊。刻意不區分失敗原因：
// 對訪客來說「數字出不來」就是同一件事，而區分原因會讓呼叫端跟著長出分支。

/** ⚠️ 必須是相對路徑。寫成絕對網址會在自訂網域下變成跨源請求，就得處理 CORS 與 preflight。 */
export const HIT_ENDPOINT = '/api/hits';

export const HIT_STORAGE_KEY = 'rd2-wiki:hit';

/** 弱網下 Promise 可能永遠不 settle，隱藏那條路徑就永遠不會執行。 */
const TIMEOUT_MS = 3000;

export interface HitCounterDeps {
  fetch?: typeof globalThis.fetch;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

/**
 * sessionStorage 的存取**本身**會丟例外（Safari 無痕、Firefox 封鎖所有 cookie、
 * iframe 的第三方儲存限制會丟 SecurityError），所以每次存取都要各自包起來。
 * 取不到就當「沒有快取」，不是「失敗」——快取只是省一次請求，不是必要條件。
 */
function readCached(storage: HitCounterDeps['storage']): number | null {
  try {
    const raw = storage?.getItem(HIT_STORAGE_KEY);
    if (raw === null || raw === undefined) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function writeCached(storage: HitCounterDeps['storage'], n: number): void {
  try {
    storage?.setItem(HIT_STORAGE_KEY, String(n));
  } catch {
    // 寫不進去只是下次會重新取號，不影響這次顯示。
  }
}

/** 連 sessionStorage 這個屬性本身的存取都可能丟例外，不只是它的方法。 */
function safeSessionStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * 取得這位訪客的號碼。
 *
 * ⚠️ 成功與否**不能靠 status code 判斷**。實測線上站：dist/ 裡沒有 404.html 時，
 * Cloudflare Pages 把未知路徑當 SPA，GET 未知路徑會回 200 加一份完整的首頁 HTML；
 * 而 functions 沒被部署時 POST 回的是 405 不是 404。唯一可靠的判準是 payload 形狀。
 */
export async function fetchHitNumber(deps: HitCounterDeps = {}): Promise<number | null> {
  const doFetch = deps.fetch ?? globalThis.fetch;
  const storage = deps.storage === undefined ? safeSessionStorage() : deps.storage;

  const cached = readCached(storage);
  if (cached !== null) return cached;

  try {
    const res = await doFetch(HIT_ENDPOINT, {
      method: 'POST',
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    const n = (body as { n?: unknown } | null)?.n;
    if (typeof n !== 'number' || !Number.isInteger(n)) return null;
    writeCached(storage, n);
    return n;
  } catch {
    // 網路錯誤、AbortError（逾時）、CSP 擋下、回應不是合法 JSON，全部走這裡。
    return null;
  }
}
