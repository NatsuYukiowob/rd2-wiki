import { describe, it, expect, vi } from 'vitest';
import { fetchHitNumber, HIT_ENDPOINT, HIT_STORAGE_KEY } from '../../src/lib/hit-counter';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** 每次都是全新的假 storage，測試之間不互相污染。 */
function memStorage(initial?: string) {
  const map = new Map<string, string>();
  if (initial !== undefined) map.set(HIT_STORAGE_KEY, initial);
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    _map: map,
  };
}

describe('fetchHitNumber 的成功路徑', () => {
  it('用 POST 打相對路徑 /api/hits', async () => {
    // method 與 URL 都要斷言：把 POST 改成 GET 的話線上症狀是「數字從此凍結」，
    // 看起來完全正常，沒有這條斷言不會有任何地方紅。
    // 相對路徑同樣要守——寫成絕對網址會在自訂網域下變成跨源請求。
    // 參數要明寫：vi.fn 的實作沒宣告參數的話，TypeScript 會把 mock.calls 推斷成空 tuple，
    // 下面取 calls[0][1] 就會是 TS2493／TS2352。
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ n: 1234 }));
    const storage = memStorage();
    expect(await fetchHitNumber({ fetch: fetchMock as never, storage })).toBe(1234);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/hits');
    expect(HIT_ENDPOINT).toBe('/api/hits');
    expect(init?.method).toBe('POST');
  });

  it('把拿到的號碼寫進 storage', async () => {
    // 不驗寫入的話，刪掉 setItem 這行也不會紅，而線上症狀是同一個分頁每次進首頁都 +1。
    const storage = memStorage();
    await fetchHitNumber({ fetch: (async () => jsonResponse({ n: 88 })) as never, storage });
    expect(storage._map.get(HIT_STORAGE_KEY)).toBe('88');
  });

  it('storage 已經有號碼時直接用它，完全不打 API', async () => {
    const fetchMock = vi.fn();
    expect(await fetchHitNumber({ fetch: fetchMock as never, storage: memStorage('55') })).toBe(55);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('fetchHitNumber 的失敗路徑（一律回 null）', () => {
  it('200 但 body 是 HTML → null', async () => {
    // 這是實際會發生的情況，不是假想：dist/ 沒有 404.html 時，Cloudflare Pages
    // 把未知路徑當 SPA，回 200 + 整份首頁 HTML。靠 status code 判斷會把它當成功。
    const html = new Response('<!doctype html><title>首頁</title>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    });
    expect(
      await fetchHitNumber({ fetch: (async () => html) as never, storage: memStorage() }),
    ).toBeNull();
  });

  it('200 但 JSON 沒有 n（或 n 不是數字）→ null', async () => {
    const bad = async () => jsonResponse({ count: 5 });
    expect(await fetchHitNumber({ fetch: bad as never, storage: memStorage() })).toBeNull();
    const bad2 = async () => jsonResponse({ n: '5' });
    expect(await fetchHitNumber({ fetch: bad2 as never, storage: memStorage() })).toBeNull();
  });

  it('405（functions 沒被部署時線上的真實回應）→ null', async () => {
    const res = async () => new Response('', { status: 405 });
    expect(await fetchHitNumber({ fetch: res as never, storage: memStorage() })).toBeNull();
  });

  it('fetch 直接拋錯 → null', async () => {
    const boom = async () => {
      throw new TypeError('Failed to fetch');
    };
    expect(await fetchHitNumber({ fetch: boom as never, storage: memStorage() })).toBeNull();
  });

  it('storage 讀取本身丟例外時不會炸掉整個函式，仍然打 API 取號', async () => {
    // Safari 無痕、Firefox 封鎖所有 cookie、iframe 的第三方儲存限制都會讓
    // getItem 直接丟 SecurityError。若這一行沒被包住，整段 script 當場爆掉，
    // 連隱藏都跑不到，畫面留下一個空的佔位框。
    const hostile = {
      getItem: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
      setItem: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
    };
    const n = await fetchHitNumber({
      fetch: (async () => jsonResponse({ n: 3 })) as never,
      storage: hostile,
    });
    expect(n).toBe(3);
  });

  it('storage 是 null（環境完全沒有 sessionStorage）時仍然可用', async () => {
    expect(
      await fetchHitNumber({ fetch: (async () => jsonResponse({ n: 9 })) as never, storage: null }),
    ).toBe(9);
  });

  it('傳給 fetch 的 init 帶 signal 與 cache: no-store', async () => {
    // 沒有 timeout 的話，弱網下 Promise 永遠不 settle，隱藏那條路徑不會執行。
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ n: 1 }));
    await fetchHitNumber({ fetch: fetchMock as never, storage: memStorage() });
    const init = fetchMock.mock.calls[0]![1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.cache).toBe('no-store');
  });
});
