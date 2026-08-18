import { describe, it, expect } from 'vitest';
import { ensureFork, openPr, getBaseSha, getFileAtRef } from '../../functions/api/github/_lib/gh';
import { fakeGitHub, utf8ToBase64 } from './helpers';

const input = {
  token: 'gho_fake', upstream: 'NatsuYukiowob/rd2-wiki', forkFullName: 'someplayer/rd2-wiki',
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

  it('PR 的 head 用 <fork owner>:<branch>，base 是上游 main', async () => {
    const { f, calls } = fakeGitHub();
    await openPr(input, f);
    const pr = calls.find(c => c.url.includes('/pulls'))!;
    expect(pr.url).toContain('/repos/NatsuYukiowob/rd2-wiki/pulls');
    // 'someplayer' 取自 input.forkFullName（'someplayer/rd2-wiki'）的 owner 段，不是另外
    // 傳一個 login 欄位——見 OpenPrInput 的說明（I5 修正後這個型別已經沒有 login 欄位）。
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

  it('ensureFork 回傳 POST /forks 實際回應的 full_name', async () => {
    const { f } = fakeGitHub();
    const result = await ensureFork('gho_fake', 'NatsuYukiowob/rd2-wiki', 'someplayer', f);
    expect(result).toEqual({ fullName: 'someplayer/rd2-wiki' });
  });

  // I5（全分支審查抓到、22 輪任務審查都漏掉的 Important）：玩家帳號下若已有同名但無關的
  // repo，GitHub 會把這次 fork 建成 `<repo>-1` 這類別名。修法前的 `ensureFork` 假設
  // fork 名稱恆等於 `${login}/${上游 repo 名}`，輪詢時會查到那個無關的 repo、拿到 200、
  // 誤判成「fork 就緒」。這支測試模擬這個情境：`POST /forks` 回應的 full_name 是
  // `someplayer/rd2-wiki-1`（跟上游 repo 名不同），驗證 ensureFork 用這個實際名稱輪詢，
  // 不會去查、也查不到會誤判成功的 `someplayer/rd2-wiki`（那個「同名但無關」的 repo）。
  it('ensureFork 用 POST /forks 回應的 full_name 輪詢，不假設等於上游 repo 名稱（I5）', async () => {
    const { f, calls } = fakeGitHub({
      '/forks': () => new Response(JSON.stringify({ full_name: 'someplayer/rd2-wiki-1' }), { status: 202 }),
      '/repos/someplayer/rd2-wiki-1': () => new Response('{}', { status: 200 }),
      // 「同名但無關」的既有 repo：若程式碼還假設 fork 名稱恆等於上游名稱，輪詢會打到這條、
      // 得到 200，誤判成 fork 就緒——這條理論上完全不該被打到。
      '/repos/someplayer/rd2-wiki': () => new Response(JSON.stringify({ unrelated: true }), { status: 200 }),
    });
    const result = await ensureFork('gho_fake', 'NatsuYukiowob/rd2-wiki', 'someplayer', f);
    expect(result).toEqual({ fullName: 'someplayer/rd2-wiki-1' });
    expect(calls.some(c => /\/repos\/someplayer\/rd2-wiki$/.test(c.url))).toBe(false);
  });

  it('ensureFork 對 owner 跟 login 不符的 full_name 拒絕繼續（防禦性檢查）', async () => {
    const { f } = fakeGitHub({
      '/forks': () => new Response(JSON.stringify({ full_name: 'someone-else/rd2-wiki' }), { status: 202 }),
    });
    await expect(ensureFork('gho_fake', 'NatsuYukiowob/rd2-wiki', 'someplayer', f))
      .rejects.toThrow(/owner.*不符/);
  });

  // I5 的另一半：openPr 本身也不能自己用 `${login}/${上游 repo 名}` 現組 URL，必須用呼叫端
  // 給的 forkFullName——即使 ensureFork 已經修正，若 openPr 這裡還在猜，一樣會在錯的 repo
  // 上建 blob／tree／commit、推分支。
  it('openPr 用 forkFullName 組 blob／tree／commit／refs 的 URL，不假設等於上游 repo 名稱（I5）', async () => {
    const { f, calls } = fakeGitHub();
    await openPr({ ...input, forkFullName: 'someplayer/rd2-wiki-1' }, f);
    expect(calls.every(c => !c.url.includes('/repos/someplayer/rd2-wiki/git'))).toBe(true);
    expect(calls.some(c => c.url.includes('/repos/someplayer/rd2-wiki-1/git/blobs'))).toBe(true);
    expect(calls.some(c => c.url.includes('/repos/someplayer/rd2-wiki-1/git/trees'))).toBe(true);
    expect(calls.some(c => c.url.includes('/repos/someplayer/rd2-wiki-1/git/commits'))).toBe(true);
    expect(calls.some(c => c.url.includes('/repos/someplayer/rd2-wiki-1/git/refs'))).toBe(true);
  });

  it('openPr 有給 baseSha 時直接用，不會自己再打一次 git/ref/heads/main', async () => {
    const { f, calls } = fakeGitHub();
    await openPr({ ...input, baseSha: 'caller-supplied-sha' }, f);
    expect(calls.some(c => c.url.includes('/git/ref/heads/main'))).toBe(false);
    const tree = calls.find(c => c.url.includes('/git/trees'))!;
    expect(tree.body.base_tree).toBe('caller-supplied-sha');
    const commit = calls.find(c => c.url.includes('/git/commits'))!;
    expect(commit.body.parents).toEqual(['caller-supplied-sha']);
  });

  it('getBaseSha 讀上游 main 目前的 commit sha', async () => {
    const { f, calls } = fakeGitHub();
    const sha = await getBaseSha('gho_fake', 'NatsuYukiowob/rd2-wiki', f);
    expect(sha).toBe('base-sha');
    expect(calls.some(c => c.url.includes('/repos/NatsuYukiowob/rd2-wiki/git/ref/heads/main'))).toBe(true);
  });

  it('getFileAtRef 讀指定 ref 上的檔案內容，正確解碼 base64（含換行）與 UTF-8 中文', async () => {
    // 手動組一個帶換行的 base64 回應，模擬 GitHub Contents API 真實回應的排版
    // （每 60 字元插一個換行），驗證 getFileAtRef 有把換行濾掉才 atob。
    const raw = '["巨型尖刺", "尖刺"]\n';
    const wrapped = utf8ToBase64(raw).replace(/(.{60})/g, '$1\n');
    const { f, calls } = fakeGitHub({
      '/contents/data/keywords.json': () => new Response(JSON.stringify({ content: wrapped, encoding: 'base64' })),
    });
    const text = await getFileAtRef('gho_fake', 'NatsuYukiowob/rd2-wiki', 'data/keywords.json', 'some-sha', f);
    expect(text).toBe(raw);
    const call = calls.find(c => c.url.includes('/contents/data/keywords.json'))!;
    expect(call.url).toContain('ref=some-sha');
  });
});
