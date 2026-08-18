import { describe, it, expect } from 'vitest';
import { handleSubmit } from '../../functions/api/github/submit';
import { openSession, sealSession, type Session } from '../../functions/api/github/_lib/session';
import { fakeGitHub, utf8ToBase64 } from './helpers';

const env = {
  GITHUB_CLIENT_ID: 'test-client-id',
  GITHUB_CLIENT_SECRET: 'test-client-secret',
  SESSION_SECRET: 'test-session-secret',
  UPSTREAM_REPO: 'NatsuYukiowob/rd2-wiki',
};

// 摘要的實際數字不影響 submit 端點的行為（伺服器不重跑驗證、不重算摘要，只是原樣塞進
// PR 標題／內文），這裡隨便給一組形狀正確的值就好。
const summary = {
  added: [] as string[], removed: [] as string[], modified: ['1001'],
  edgesBefore: 248, edgesAfter: 248,
  costBefore: { core: 1772, gold: 6662000 },
  costAfter: { core: 1772, gold: 6662000 },
  newIcons: [] as string[], newKeywords: [] as string[],
};

const validBody = { svgText: '<svg/>', summary };

/** 帶有效 session cookie 的送出請求；`sessionOverrides` 讓個別測試調整 `lastSubmitAt`
 *  之類的欄位（節流測試需要模擬「不久前才送過」）。login 固定用 'someplayer'——
 *  跟 helpers.ts 的 fakeGitHub 預設路由（`/repos/someplayer/rd2-wiki$`）對得上。 */
async function loggedInRequest(bodyObj: unknown, sessionOverrides: Partial<Session> = {}): Promise<Request> {
  const session: Session = { token: 'gho_fake', login: 'someplayer', iat: Math.floor(Date.now() / 1000), ...sessionOverrides };
  const sealed = await sealSession(session, env.SESSION_SECRET);
  return new Request('https://rd2-wiki.pages.dev/api/github/submit', {
    method: 'POST',
    headers: { cookie: `rd2_session=${sealed}` },
    body: JSON.stringify(bodyObj),
  });
}

describe('submit', () => {
  it('未登入回 401', async () => {
    // 特意不給 cookie。fetch 用會拋錯的假 fetch：401 應該在碰任何 GitHub API 之前就短路回傳。
    const req = new Request('https://rd2-wiki.pages.dev/api/github/submit', {
      method: 'POST',
      body: JSON.stringify(validBody),
    });
    const res = await handleSubmit(req, env, { fetch: (async () => { throw new Error('不該打出任何請求'); }) as typeof fetch });
    expect(res.status).toBe(401);
  });

  it('payload 超過 1 MB 回 413', async () => {
    const huge = { svgText: 'a'.repeat(1024 * 1024 + 1), summary };
    const req = await loggedInRequest(huge);
    const res = await handleSubmit(req, env, { fetch: (async () => { throw new Error('不該打出任何請求'); }) as typeof fetch });
    expect(res.status).toBe(413);
  });

  it('30 秒內重複送出回 429，訊息可讀', async () => {
    const nowMs = Date.parse('2026-08-18T00:01:00Z');
    // lastSubmitAt 是 10 秒前——在 30 秒節流窗口內。
    const req = await loggedInRequest(validBody, { lastSubmitAt: Math.floor(nowMs / 1000) - 10 });
    const res = await handleSubmit(req, env, {
      fetch: (async () => { throw new Error('節流應該在打任何 GitHub API 之前就擋下'); }) as typeof fetch,
      now: () => nowMs,
    });
    expect(res.status).toBe(429);
    const body = await res.json() as { message: string };
    expect(typeof body.message).toBe('string');
    expect(body.message.length).toBeGreaterThan(0);
  });

  it('30 秒外送出不受節流影響', async () => {
    const { f } = fakeGitHub();
    const nowMs = Date.parse('2026-08-18T00:01:00Z');
    const req = await loggedInRequest(validBody, { lastSubmitAt: Math.floor(nowMs / 1000) - 31 });
    const res = await handleSubmit(req, env, { fetch: f, now: () => nowMs });
    expect(res.status).toBe(200);
  });

  it('正常送出會呼叫 ensureFork／openPr，回傳 PR 資訊並更新節流時間戳', async () => {
    const { f, calls } = fakeGitHub();
    const nowMs = Date.parse('2026-08-18T00:10:00Z');
    const req = await loggedInRequest(validBody); // 沒有 lastSubmitAt，不會被節流
    const res = await handleSubmit(req, env, { fetch: f, now: () => nowMs });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ number: 42, url: 'https://github.com/x/y/pull/42' });
    expect(calls.some(c => c.url.endsWith('/forks') && c.method === 'POST')).toBe(true);
    expect(calls.some(c => c.url.includes('/pulls'))).toBe(true);

    const setCookie = res.headers.get('set-cookie')!;
    expect(setCookie).toBeTruthy();
    const sealed = /rd2_session=([^;]+)/.exec(setCookie)![1]!;
    const opened = await openSession(sealed, env.SESSION_SECRET);
    expect(opened?.lastSubmitAt).toBe(Math.floor(nowMs / 1000));
    // login／token 要保留下來，不能因為更新 lastSubmitAt 就把 session 其他欄位弄丟。
    expect(opened?.login).toBe('someplayer');
    expect(opened?.token).toBe('gho_fake');
  });

  it('分支名格式為 editor/{YYYYMMDD}-{login}-{8碼隨機}', async () => {
    const { f, calls } = fakeGitHub();
    const nowMs = Date.parse('2026-08-18T00:10:00Z');
    const req = await loggedInRequest(validBody);
    await handleSubmit(req, env, { fetch: f, now: () => nowMs });

    const createRef = calls.find(c => c.url.includes('/git/refs') && c.method === 'POST')!;
    expect(createRef.body.ref).toMatch(/^refs\/heads\/editor\/20260818-someplayer-[0-9a-f]{8}$/);
  });

  it('data/icons/<hash>.png 依 icons 欄位加進送出的檔案清單', async () => {
    const { f, calls } = fakeGitHub();
    const req = await loggedInRequest({ ...validBody, icons: [{ hash: 'abc123abc123', base64: btoa('\x89PNG') }] });
    await handleSubmit(req, env, { fetch: f });

    const tree = calls.find(c => c.url.includes('/git/trees'))!;
    expect(tree.body.tree.map((t: { path: string }) => t.path)).toEqual(
      expect.arrayContaining(['data/dice-tree.svg', 'data/icons/abc123abc123.png']),
    );
    const blobs = calls.filter(c => c.url.includes('/git/blobs'));
    const iconBlob = blobs[1]!;
    expect(iconBlob.body).toMatchObject({ encoding: 'base64', content: btoa('\x89PNG') });
  });

  it('data/keywords.json 走最小插入：只在收尾 ] 前塞新詞，其餘位元組不變', async () => {
    const rawExisting = '["巨型尖刺", "尖刺"]\n';
    const { f, calls } = fakeGitHub({
      '/contents/data/keywords.json': () => new Response(JSON.stringify({
        content: utf8ToBase64(rawExisting), encoding: 'base64',
      })),
    });
    const req = await loggedInRequest({ ...validBody, keywords: ['新詞'] });
    const res = await handleSubmit(req, env, { fetch: f });
    expect(res.status).toBe(200);

    const blobs = calls.filter(c => c.url.includes('/git/blobs'));
    // svg 是 blobs[0]，這個案例沒有 icons，keywords.json 緊接在後。
    const keywordsBlob = blobs[1]!;
    expect(keywordsBlob.body).toMatchObject({ encoding: 'utf-8' });
    expect(keywordsBlob.body.content).toBe('["巨型尖刺", "尖刺", "新詞"]\n');
    // 除了插入的那段之外，其餘位元組原樣保留（不是整檔重新序列化）。
    expect(keywordsBlob.body.content.startsWith('["巨型尖刺", "尖刺"')).toBe(true);
  });

  it('讀 data/keywords.json 用的 ref 跟 openPr 建 commit 的 baseSha 是同一個值（不會各自抓一次而漂移）', async () => {
    // 這是 2026-08-18 review 修正的重點：第一版分別用 raw.githubusercontent.com（讀檔）跟
    // git/ref/heads/main（openPr 內部建 commit）兩個獨立來源，兩者理論上可能看到不同版本
    // 的上游狀態。修正後兩者該共用同一個 getBaseSha() 結果——這支測試不驗證任何寫死的
    // sha 字面值，而是動態比對「讀檔那次請求帶的 ref 參數」跟「建 commit 那次請求帶的
    // parent sha」是否相等，這樣即使實作細節（例如假 fetch 回的 sha 字串）改變，測試仍然
    // 直接驗到「兩者一致」這個不變量本身。
    const { f, calls } = fakeGitHub();
    const req = await loggedInRequest({ ...validBody, keywords: ['新詞'] });
    const res = await handleSubmit(req, env, { fetch: f });
    expect(res.status).toBe(200);

    // baseSha 只該抓一次：submit.ts 自己抓一次給 getFileAtRef 用、同一個值又傳給
    // openPr，不會讓 openPr 自己內部再重新呼叫一次 git/ref/heads/main。
    const baseShaCalls = calls.filter(c => c.url.includes('/git/ref/heads/main'));
    expect(baseShaCalls.length).toBe(1);

    const contentsCall = calls.find(c => c.url.includes('/contents/data/keywords.json'))!;
    const refUsedForRead = new URL(contentsCall.url).searchParams.get('ref');

    const commitCall = calls.find(c => c.url.includes('/git/commits'))!;
    const parentUsedForCommit = commitCall.body.parents[0];

    const treeCall = calls.find(c => c.url.includes('/git/trees'))!;
    const baseTreeUsedForCommit = treeCall.body.base_tree;

    expect(refUsedForRead).toBeTruthy();
    expect(refUsedForRead).toBe(parentUsedForCommit);
    expect(refUsedForRead).toBe(baseTreeUsedForCommit);
  });

  it('沒有 keywords 欄位時不會去讀或送出 data/keywords.json', async () => {
    const { f, calls } = fakeGitHub();
    const req = await loggedInRequest(validBody);
    await handleSubmit(req, env, { fetch: f });
    expect(calls.some(c => c.url.includes('keywords.json'))).toBe(false);
    const tree = calls.find(c => c.url.includes('/git/trees'))!;
    expect(tree.body.tree.map((t: { path: string }) => t.path)).toEqual(['data/dice-tree.svg']);
  });

  it('openPr 失敗時回傳可讀錯誤，不是不透明的 500', async () => {
    const { f } = fakeGitHub({ '/pulls': () => new Response(JSON.stringify({ message: '權限不足' }), { status: 403 }) });
    const req = await loggedInRequest(validBody);
    const res = await handleSubmit(req, env, { fetch: f });
    expect(res.status).toBe(502);
    const body = await res.json() as { message: string };
    expect(body.message).toContain('權限不足');
  });
});
