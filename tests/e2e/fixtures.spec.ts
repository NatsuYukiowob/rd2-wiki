import { test, expect, type Page } from './fixtures';

// 全域 pageerror 防線（fixtures.ts）自己的測試。防線失效時其他 spec 只會照樣綠，
// 所以這裡用 `test.fail()` 反過來斷言：頁面丟例外時那條測試「必須」失敗——
// 監聽沒掛上的話，這兩條會意外通過，`test.fail()` 就把它們判成紅。

/** 讓頁面丟一個未捕捉的例外，等到瀏覽器真的回報 pageerror 才返回。 */
async function throwInPage(page: Page): Promise<void> {
  await Promise.all([
    page.waitForEvent('pageerror'),
    page.evaluate(() => { setTimeout(() => { throw new Error('fixtures.spec 刻意丟出的例外'); }, 0); }),
  ]);
}

test('FX1. 頁面丟出未捕捉的例外時，測試會紅', async ({ page }) => {
  test.fail();
  await page.goto('/about');
  await throwInPage(page);
});

test('FX2. 測試自己開的第二個分頁丟例外，也會紅', async ({ page, context }) => {
  test.fail();
  await page.goto('/about');
  const other = await context.newPage();
  await other.goto('/about');
  await throwInPage(other);
});

test.describe('allowPageErrors', () => {
  test.use({ allowPageErrors: true });
  test('FX3. 用 allowPageErrors 退出時，同樣的例外不會讓測試紅', async ({ page }) => {
    await page.goto('/about');
    await throwInPage(page);
    await expect(page.locator('h1')).toBeVisible();
  });
});
