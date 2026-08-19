// /api/hits 的 Pages Function。刻意保持薄——邏輯在 functions/lib/counter.ts。
// 薄殼有自己的測試（tests/functions/hits.test.ts），因為方法分派與 binding 名字
// 只存在這個檔案裡，counter.ts 的測試碰不到它們。
//
// ⚠️ 檔名決定路由：functions/api/hits.ts → /api/hits。
// 同目錄下沒有匯出 onRequest* 的檔案不會變成路由（實測確認，官方文件對此沉默）。
import { bumpCounter, readCounter, COUNTER_KEY, type D1Like } from '../lib/counter';

interface HitsContext {
  request: Request;
  env: { DB: D1Like };
}

// _headers 不會套用到 Pages Functions 產生的回應（官方文件明載），所以標頭只能在這裡放。
// no-store 目前其實是多餘的（Cloudflare CDN 預設不快取 JSON、也不快取非 GET），
// 純粹是日後有人加 Cache Rule 或掛自訂網域時的保險。
const HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

function ok(n: number): Response {
  return new Response(JSON.stringify({ n }), { status: 200, headers: HEADERS });
}

/**
 * 錯誤一律回固定字串。錯誤訊息含 SQL 與 key 名，這是公開端點，不能吐出去。
 *
 * code 只有兩個值、都不洩漏任何東西，但要分開：403 是「你被擋了」、500 是「我壞了」。
 * 全部回 internal 的話，線上除錯時分不出「Sec-Fetch-Site 判斷把真實訪客誤擋」
 * 和「資料庫真的掛了」——兩者的處理方式完全不同。
 */
function fail(status: number, code: 'forbidden' | 'internal', err?: unknown): Response {
  if (err !== undefined) console.error('[hits]', err);
  return new Response(JSON.stringify({ error: code }), { status, headers: HEADERS });
}

/**
 * 擋跨站 drive-by。
 *
 * 這個 endpoint 同源、不需要 CORS，所以任何第三方網頁都能用
 * fetch(..., { mode: 'no-cors' }) 在它自己每一位訪客的瀏覽器裡替我們 +1——
 * 那是分散在真實 IP 上的流量，IP 節流完全無效。
 *
 * 標頭不存在時放行：舊瀏覽器不送 Sec-Fetch-Site，擋掉它們等於擋掉真實訪客，
 * 而這道防線本來就只是提高門檻，不是安全邊界。
 */
function isCrossSite(request: Request): boolean {
  const site = request.headers.get('Sec-Fetch-Site');
  return site !== null && site !== 'same-origin' && site !== 'none';
}

export async function onRequestPost(ctx: HitsContext): Promise<Response> {
  if (isCrossSite(ctx.request)) return fail(403, 'forbidden');
  try {
    return ok(await bumpCounter(ctx.env.DB, COUNTER_KEY));
  } catch (err) {
    return fail(500, 'internal', err);
  }
}

export async function onRequestGet(ctx: HitsContext): Promise<Response> {
  try {
    return ok(await readCounter(ctx.env.DB, COUNTER_KEY));
  } catch (err) {
    return fail(500, 'internal', err);
  }
}
