// SEO 基礎欄位的端對端驗證（issues #24／#25／#26）。
//
// 為什麼這幾條非得走真實 HTTP 不可：這三項全部壞掉的時候，站台用瀏覽器逛起來完全正常。
// 2026-08-20 的實測就是這樣被騙的——`/robots.txt` 與 `/sitemap.xml` 都回 HTTP **200**，
// 看起來像存在，其實回的是首頁的 HTML（未知路徑回退造成的假象）。只有去讀
// **狀態碼與 content-type** 才會說話，讀 DOM 是讀不出來的。
//
// 三個檔案在這裡合成一個 spec，是因為它們互相依賴：robots.txt 指向 sitemap，
// sitemap 列出的網址要跟 canonical 對得起來，而「未知路徑回什麼」同時決定前兩者
// 是不是假象。
import { test, expect } from '@playwright/test';

/** 正式站網址。canonical 與 sitemap 裡的絕對網址都應該長這樣，跟本機測試埠無關。 */
const SITE = 'https://rd2-wiki.pages.dev';

/**
 * 全站現有的頁面：請求路徑 → 建置後的正規路徑（含尾斜線）與分頁名。
 * Astro 產出的是 `dist/tree/index.html`，所以自我指涉的絕對網址帶尾斜線。
 */
const PAGES = [
  { request: '/', canonical: `${SITE}/`, name: '首頁' },
  { request: '/tree', canonical: `${SITE}/tree/`, name: '骰子樹' },
  { request: '/dice', canonical: `${SITE}/dice/`, name: '骰子圖鑑' },
  { request: '/guide', canonical: `${SITE}/guide/`, name: '遊戲介紹' },
  { request: '/guide/mechanics', canonical: `${SITE}/guide/mechanics/`, name: '骰子機制與觸發' },
  { request: '/guide/summons', canonical: `${SITE}/guide/summons/`, name: '召喚物與投射物' },
  { request: '/guide/status', canonical: `${SITE}/guide/status/`, name: '狀態效果與增減益' },
  { request: '/guide/monsters', canonical: `${SITE}/guide/monsters/`, name: '怪物與基本名詞' },
  { request: '/about', canonical: `${SITE}/about/`, name: '貢獻' },
] as const;

test('SEO-1. robots.txt 是真的純文字檔，不是首頁的回退', async ({ request }) => {
  const res = await request.get('/robots.txt');
  expect(res.status()).toBe(200);
  // ⚠️ 這一行是整個 #24 的核心：回退回來的首頁也是 200，靠 content-type 才分得出來。
  expect(res.headers()['content-type']).toContain('text/plain');

  const body = await res.text();
  expect(body).not.toContain('<html'); // 再保險一次：內容不能是 HTML
  expect(body).toContain('User-agent: *');
  expect(body).toContain(`Sitemap: ${SITE}/sitemap-index.xml`);
});

test('SEO-2. sitemap 存在、是 XML，且剛好列出所有現有頁面', async ({ request }) => {
  const index = await request.get('/sitemap-index.xml');
  expect(index.status()).toBe(200);
  expect(index.headers()['content-type']).toContain('xml');
  expect(await index.text()).toContain(`${SITE}/sitemap-0.xml`);

  const res = await request.get('/sitemap-0.xml');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('xml');

  // 捕獲組必然有值（正則本身就要求 <loc> 內至少一個字元），但 tsc 看不出來——
  // 用 flatMap 過濾比 `!` 斷言誠實：真的抓不到東西時 urls 會是空陣列，下一行的相等比對
  // 就會紅，而不是拿一堆 undefined 去比。
  const urls = [...(await res.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].flatMap(m =>
    m[1] ? [m[1]] : []
  );
  // 用相等而不是包含：漏一頁跟多一頁都要說話。
  expect(urls.sort()).toEqual(PAGES.map(p => p.canonical).sort());
  // 404 頁是靜態產出的一頁，預設會被 sitemap 收進去——提交一個「保證是 404」的網址給
  // 搜尋引擎正好是 #26 想解掉的問題的反面，所以要明確排除。
  expect(urls).not.toContain(`${SITE}/404/`);
  expect(urls.some(u => u.includes('404'))).toBe(false);
});

for (const page_ of PAGES) {
  test(`SEO-3. ${page_.request} 的 canonical 指向自己的絕對網址`, async ({ page }) => {
    await page.goto(page_.request);
    const href = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(href).toBe(page_.canonical);
  });

  test(`SEO-4. ${page_.request} 的 <title> 帶站名與分頁名`, async ({ page }) => {
    await page.goto(page_.request);
    // 站名在前、分頁名在後（2026-08-22 Yuki 指定的格式），分隔符是半形直立線。
    expect(await page.title()).toBe(`Random Dice 2 wiki | ${page_.name}`);
  });
}

test('SEO-5. 未知路徑回 404 而不是首頁', async ({ page, request }) => {
  const res = await request.get('/no-such-page-abc123');
  // soft 404 的樣子就是這裡回 200 ＋ 首頁的 HTML；那會讓無限多個不存在的網址
  // 全部被判成首頁的重複內容。
  //
  // ⚠️ 這一行在本機是**假綠**：E2E 的 webServer 是 `serve dist`，它對找不到的檔案本來就
  // 回 404，`dist/404.html` 存不存在都一樣。soft 404 是 **Cloudflare Pages** 那端的行為
  // （2026-08-20 實測正式站回 200 ＋ 首頁）。所以這條守的是「本機沒退步」，
  // 真正的驗收是部署後對正式站 `curl -o /dev/null -w '%{http_code}'`。
  expect(res.status()).toBe(404);

  const body = await res.text();
  expect(body).toContain('找不到這一頁');
  // 首頁的特徵：訪客計數器只有首頁有。回退到首頁時這裡會命中。
  expect(body).not.toContain('id="hit-counter"');

  await page.goto('/no-such-page-abc123');
  expect(await page.title()).toBe('Random Dice 2 wiki | 找不到頁面');
  // 404 頁要能自己走回去，不然使用者只能按上一頁。
  await expect(page.locator('main a[href="/tree"]')).toBeVisible();
});

test('SEO-6. 404 頁不宣稱自己是任何網址', async ({ page }) => {
  // 這一份 HTML 會被 Cloudflare Pages 拿來回**每一個**未知路徑，所以任何「我的網址是 X」
  // 的宣告都是錯的：canonical 會邀請搜尋引擎去索引 /404/，og:url 會讓聊天室的預覽卡片
  // 宣稱一個失效連結代表 /404/。兩者都必須不存在，改由 noindex 明講。
  await page.goto('/no-such-page-abc123');
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  await expect(page.locator('meta[property="og:url"]')).toHaveCount(0);
  expect(await page.locator('meta[name="robots"]').getAttribute('content')).toBe('noindex');

  // 反面：正常頁面三者都要在，免得哪天 noIndex 的預設值寫反、整站一起消音。
  await page.goto('/tree');
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
  await expect(page.locator('meta[property="og:url"]')).toHaveCount(1);
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
});
