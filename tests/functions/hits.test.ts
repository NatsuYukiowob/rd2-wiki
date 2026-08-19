import { describe, it, expect } from 'vitest';
import { onRequestGet, onRequestPost } from '../../functions/api/hits';
import type { D1Like } from '../../functions/lib/counter';

/**
 * 假的 D1：記錄收到的 SQL，讓測試能斷言「GET 沒有寫、POST 有寫」。
 *
 * 這裡用假物件是對的——薄殼的責任是分派與組回應，不是 SQL 正確性
 * （那個由 counter.test.ts 用真的 SQLite 守）。但它必須記下 SQL，
 * 否則「把 onRequestGet 接到 bumpCounter」這種錯誤不會紅。
 */
function fakeDb(n = 42): { db: D1Like; sqls: string[] } {
  const sqls: string[] = [];
  return {
    sqls,
    db: {
      prepare: (sql: string) => {
        sqls.push(sql);
        return { bind: () => ({ first: async <T>() => n as T }) };
      },
    },
  };
}

function ctx(method: string, db: D1Like, headers: Record<string, string> = {}) {
  return {
    request: new Request('https://rd2-wiki.pages.dev/api/hits', { method, headers }),
    env: { DB: db },
  };
}

describe('onRequestPost', () => {
  it('回 {"n": 數字}，而且真的走遞增那條 SQL', async () => {
    const { db, sqls } = fakeDb(1234);
    const res = await onRequestPost(ctx('POST', db, { 'Sec-Fetch-Site': 'same-origin' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ n: 1234 });
    expect(sqls.join()).toContain('UPDATE');
  });

  it('帶 Cache-Control: no-store', async () => {
    // _headers 對 Pages Functions 的回應無效，標頭只能由 Function 自己放。
    const { db } = fakeDb();
    const res = await onRequestPost(ctx('POST', db, { 'Sec-Fetch-Site': 'same-origin' }));
    // 要一併斷言 200：錯誤回應也帶這個標頭，少了這行的話「binding 名字打錯 → 一律 500」
    // 這種壞法在這條測試底下仍然是綠的。
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('跨站來的 POST 一律拒絕，而且不會寫進資料庫', async () => {
    // 這個 endpoint 不需要 CORS 就能被別的網站用 mode:'no-cors' 驅動——
    // 那是分散在真實 IP 上的流量，IP 節流完全擋不住。
    const { db, sqls } = fakeDb();
    const res = await onRequestPost(ctx('POST', db, { 'Sec-Fetch-Site': 'cross-site' }));
    expect(res.status).toBe(403);
    expect(sqls).toHaveLength(0);
    // 403 要說 forbidden 不能說 internal：線上除錯時得分得出「訪客被誤擋」和「資料庫掛了」。
    expect(await res.text()).toBe('{"error":"forbidden"}');
  });

  it('沒有 Sec-Fetch-Site 標頭時放行（舊瀏覽器不送這個標頭）', async () => {
    const { db } = fakeDb(7);
    const res = await onRequestPost(ctx('POST', db));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ n: 7 });
  });

  it('資料庫拋錯時回 500，而且不把錯誤內容吐給客戶端', async () => {
    // 錯誤訊息含 SQL 與 key 名，是公開端點，不能直接回出去。
    const db: D1Like = {
      prepare: () => ({
        bind: () => ({
          first: async () => {
            throw new Error('UPDATE hits SET n = n + 1 WHERE k = ?1 秘密細節');
          },
        }),
      }),
    };
    const res = await onRequestPost(ctx('POST', db, { 'Sec-Fetch-Site': 'same-origin' }));
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).toBe('{"error":"internal"}');
    expect(body).not.toContain('UPDATE');
  });
});

describe('onRequestGet', () => {
  it('回目前的值，而且走的是唯讀那條 SQL（不可以是 UPDATE）', async () => {
    // 把 onRequestGet 接到 bumpCounter 是很容易犯的錯，而且線上完全看不出來——
    // 只會讓數字被爬蟲的 GET 灌大。
    const { db, sqls } = fakeDb(99);
    const res = await onRequestGet(ctx('GET', db));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ n: 99 });
    expect(sqls.join()).toContain('SELECT');
    expect(sqls.join()).not.toContain('UPDATE');
  });
});
