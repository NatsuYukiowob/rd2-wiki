// 假的 GitHub API，讓走 `_lib/gh.ts`（`gh.test.ts`）與走 `submit.ts`（`submit.test.ts`）的測試
// 共用同一份路由邏輯——兩邊對「GitHub 回什麼」的假設不會因為各自維護一份而漂移。原本只有
// gh.test.ts 一個消費者時這份定義就地寫在那支測試檔裡（只有一個消費者時抽共用檔是過早抽象）；
// Task 20 的 submit.test.ts 成為第二個消費者後才抽出來。
export interface FakeGitHubCall { method: string; url: string; body?: any }

/** 把含中文的字串編成 GitHub Contents API 會回的那種 base64——先用 TextEncoder 轉成 UTF-8
 *  位元組再逐 byte 組 Latin-1 字串餵給 btoa（`btoa` 直接吃多位元組字元會丟
 *  `character out of range`），跟 `_lib/gh.ts` 的 `getFileAtRef` 解碼方向相反、驗證那個
 *  函式的解碼邏輯正確。 */
export function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/**
 * `overrides` 用「URL 子字串 → 產生 Response 的函式」表示，比對順序在內建預設路由之前，
 * 讓個別測試可以蓋掉單一路由（例如模擬 fork 尚未就緒的 404、或指定
 * `data/keywords.json` 的既有內容）而不用重寫整組路由。
 */
export function fakeGitHub(overrides: Record<string, () => Response> = {}) {
  const calls: FakeGitHubCall[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    for (const [pattern, make] of Object.entries(overrides)) {
      if (url.includes(pattern)) return make();
    }
    // I5：`POST /forks` 真實回應帶 `full_name`，`ensureFork()` 現在用它輪詢／回傳給呼叫端
    // （不再假設恆等於 `${login}/${upstream 的 repo 名}`）。預設值跟既有測試假設的
    // `someplayer/rd2-wiki` 一致，個別測試要驗證「fork 名稱跟上游不同」這個情境
    // （I5 的真正 bug 場景）時，用 overrides 蓋掉這條、換一個不同的 full_name。
    if (url.endsWith('/forks') && method === 'POST') {
      return new Response(JSON.stringify({ full_name: 'someplayer/rd2-wiki' }), { status: 202 });
    }
    if (/\/repos\/someplayer\/rd2-wiki$/.test(url)) return new Response('{}', { status: 200 });
    if (url.includes('/git/ref/heads/main')) return new Response(JSON.stringify({ object: { sha: 'base-sha' } }));
    if (url.includes('/git/blobs')) return new Response(JSON.stringify({ sha: `blob-${calls.length}` }), { status: 201 });
    if (url.includes('/git/trees')) return new Response(JSON.stringify({ sha: 'tree-sha' }), { status: 201 });
    if (url.includes('/git/commits')) return new Response(JSON.stringify({ sha: 'commit-sha' }), { status: 201 });
    if (url.includes('/git/refs')) return new Response('{}', { status: 201 });
    if (url.includes('/pulls')) return new Response(JSON.stringify({ number: 42, html_url: 'https://github.com/x/y/pull/42' }), { status: 201 });
    // submit.ts 讀上游 data/dice-tree.svg 目前內容用的路由（I4，`_lib/gh.ts` 的
    // `getFileAtRef`，Contents API）。內容故意跟 submit.test.ts 的 `validBody.svgText`
    // （'<svg/>'）一致，讓「雜湊比對通過」是預設情境；個別測試需要驗證 409（雜湊不符）時，
    // 用 overrides 蓋掉這條、換一個不同的內容。
    if (url.includes('/contents/data/dice-tree.svg')) {
      return new Response(JSON.stringify({ content: utf8ToBase64('<svg/>'), encoding: 'base64' }));
    }
    // submit.ts 讀上游 data/keywords.json 目前內容用的路由（`_lib/gh.ts` 的 `getFileAtRef`，
    // Contents API）；gh.test.ts 不會打到這條路由，純粹是給 submit.test.ts 用的預設值，
    // 個別測試需要驗證最小插入的精確結果時，用 overrides 蓋掉這條拿到可控的既有內容。
    // 內容故意用 60 字元換行（模擬 GitHub 真實回應的排版），驗證 getFileAtRef 有濾掉換行。
    if (url.includes('/contents/data/keywords.json')) {
      const b64 = utf8ToBase64('["既有詞"]\n');
      const wrapped = b64.replace(/(.{60})/g, '$1\n');
      return new Response(JSON.stringify({ content: wrapped, encoding: 'base64' }));
    }
    throw new Error(`未預期的請求: ${method} ${url}`);
  }) as typeof fetch;
  return { f, calls };
}
