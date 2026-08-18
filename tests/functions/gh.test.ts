import { describe, it, expect } from 'vitest';
import { ensureFork, openPr } from '../../functions/api/github/_lib/gh';
import { fakeGitHub } from './helpers';

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
