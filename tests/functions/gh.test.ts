import { describe, it, expect } from 'vitest';
import { ensureFork, openPr } from '../../functions/api/github/_lib/gh';

function fakeGitHub(overrides: Record<string, () => Response> = {}) {
  const calls: { method: string; url: string; body?: any }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    for (const [pattern, make] of Object.entries(overrides)) {
      if (url.includes(pattern)) return make();
    }
    if (url.endsWith('/forks') && method === 'POST') return new Response('{}', { status: 202 });
    if (/\/repos\/someplayer\/rd2-wiki$/.test(url)) return new Response('{}', { status: 200 });
    if (url.includes('/git/ref/heads/main')) return new Response(JSON.stringify({ object: { sha: 'base-sha' } }));
    if (url.includes('/git/blobs')) return new Response(JSON.stringify({ sha: `blob-${calls.length}` }), { status: 201 });
    if (url.includes('/git/trees')) return new Response(JSON.stringify({ sha: 'tree-sha' }), { status: 201 });
    if (url.includes('/git/commits')) return new Response(JSON.stringify({ sha: 'commit-sha' }), { status: 201 });
    if (url.includes('/git/refs')) return new Response('{}', { status: 201 });
    if (url.includes('/pulls')) return new Response(JSON.stringify({ number: 42, html_url: 'https://github.com/x/y/pull/42' }), { status: 201 });
    throw new Error(`未預期的請求: ${method} ${url}`);
  }) as typeof fetch;
  return { f, calls };
}

const input = {
  token: 'gho_fake', login: 'someplayer', upstream: 'NatsuYukiowob/rd2-wiki',
  branch: 'editor/20260818-someplayer', title: 'data: 修改 1 個節點', body: '摘要內文',
  files: [
    { path: 'data/dice-tree.svg', content: new TextEncoder().encode('<svg/>') },
    { path: 'data/icons/abc123abc123.png', content: new Uint8Array([0x89, 0x50]) },
  ],
};

describe('gh', () => {
  it('openPr 走 Git Data API，兩個檔案只產生一個 commit', async () => {
    const { f, calls } = fakeGitHub();
    const r = await openPr(input, f);
    expect(r).toEqual({ number: 42, url: 'https://github.com/x/y/pull/42' });
    expect(calls.filter(c => c.url.includes('/git/blobs')).length).toBe(2);
    expect(calls.filter(c => c.url.includes('/git/commits')).length).toBe(1);
  });

  it('分支建在上游 main 的 sha 上，不是 fork 的預設分支', async () => {
    const { f, calls } = fakeGitHub();
    await openPr(input, f);
    expect(calls.some(c => c.url.includes('/repos/NatsuYukiowob/rd2-wiki/git/ref/heads/main'))).toBe(true);
    const createRef = calls.find(c => c.url.includes('/git/refs') && c.method === 'POST')!;
    expect(createRef.body).toMatchObject({ ref: 'refs/heads/editor/20260818-someplayer', sha: 'commit-sha' });
    const commit = calls.find(c => c.url.includes('/git/commits'))!;
    expect(commit.body.parents).toEqual(['base-sha']);
  });

  it('PR 的 head 用 <login>:<branch>，base 是上游 main', async () => {
    const { f, calls } = fakeGitHub();
    await openPr(input, f);
    const pr = calls.find(c => c.url.includes('/pulls'))!;
    expect(pr.url).toContain('/repos/NatsuYukiowob/rd2-wiki/pulls');
    expect(pr.body).toMatchObject({ head: 'someplayer:editor/20260818-someplayer', base: 'main' });
  });

  it('二進位檔案以 base64 編碼送出', async () => {
    const { f, calls } = fakeGitHub();
    await openPr(input, f);
    const blobs = calls.filter(c => c.url.includes('/git/blobs'));
    expect(blobs[1]!.body).toMatchObject({ encoding: 'base64' });
    expect(blobs[1]!.body.content).toBe(btoa('\x89P'));
  });

  it('fork 尚未就緒時會輪詢，逾時拋出可讀錯誤', async () => {
    const { f } = fakeGitHub({ '/repos/someplayer/rd2-wiki': () => new Response('{}', { status: 404 }) });
    await expect(ensureFork('gho_fake', 'NatsuYukiowob/rd2-wiki', 'someplayer', f))
      .rejects.toThrow(/fork 尚未就緒/);
  }, 30_000);
});
