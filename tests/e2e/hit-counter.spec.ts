// 首頁訪客計數器的端對端測試。
//
// 代號用 HC 前綴而不是延續 tree.spec.ts 的單字母序列：那邊 A–Y 已經用完，
// 而且這是獨立的功能檔，用自己的前綴在 CI 紅燈時更容易一眼指認。
//
// ⚠️ 這三條都靠 page.route 攔截 /api/hits。E2E 環境（npx serve dist）本來就沒有
// Pages Functions，所以「沒攔到」的後果是走真實的 404 → 三條都會以「數字出不來」
// 的形式紅掉，而不是靜靜通過。HC1 另外明確斷言 route 真的被呼叫過。
import { test, expect } from '@playwright/test';

test('HC1. 取到號碼時顯示「你是第 N 位訪客」', async ({ page }) => {
  let called = 0;
  await page.route('**/api/hits', async route => {
    called += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ n: 1234 }),
    });
  });

  await page.goto('/');
  await expect(page.locator('#hit-counter')).toBeVisible();
  // 千分位由 toLocaleString('en-US') 產生，不是自己拼的字串。
  await expect(page.locator('#hit-number')).toHaveText('1,234');
  expect(called).toBe(1);
});

test('HC2. 端點掛掉時不顯示數字，而且版面高度不變', async ({ page }) => {
  // 失敗是 astro dev、E2E、以及 deploy job 補上 checkout 之前的線上環境的預設狀態，
  // 所以這條路徑的版面穩定性比成功路徑更重要——display:none 會讓下面的內容往上跳。
  await page.route('**/api/hits', route => route.fulfill({ status: 405, body: '' }));

  await page.goto('/');
  const block = page.locator('#hit-counter');
  await expect(block).toBeHidden();
  // 保留高度、只是看不見。boundingBox 為 null 或高度 0 就代表被 display:none 收掉了。
  const box = await block.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThan(0);
  await expect(page.locator('#hit-number')).toHaveText('');
});

test('HC3. 回 200 但內容是 HTML 時也不顯示', async ({ page }) => {
  // dist/ 沒有 404.html 時 Cloudflare Pages 把未知路徑當 SPA，回 200 加一份首頁。
  // 靠 status code 判斷的話這會被當成功，畫面上會出現 NaN 或 undefined。
  //
  // ⚠️ 這條守的是「res.json() 解析失敗」那條路徑，不是 payload 形狀檢查——
  // HTML 餵給 json() 會直接拋錯走 catch。抽查證實：把形狀檢查整段拿掉，這條仍然綠。
  // 守形狀檢查的是 HC4。
  await page.route('**/api/hits', route =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>x</title>',
    }),
  );

  await page.goto('/');
  await expect(page.locator('#hit-counter')).toBeHidden();
});

test('HC4. 回合法 JSON 但 n 是字串時也不顯示', async ({ page }) => {
  // 跟 HC3 走的是不同路徑：這裡 res.json() 會成功，擋下來的是 payload 的**型別**檢查。
  //
  // ⚠️ 情境刻意選「n 是字串」而不是「沒有 n 欄位」。缺欄位的話，即使把檢查退化成
  // `n === undefined` 也還是攔得住，這條測試就守不到東西——實測過，那樣改壞它仍然是綠的。
  // 型別錯才會穿過退化後的檢查：字串 "1234" 有 toLocaleString()，會被當成數字顯示出來。
  await page.route('**/api/hits', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ n: '1234' }),
    }),
  );

  await page.goto('/');
  await expect(page.locator('#hit-counter')).toBeHidden();
});
