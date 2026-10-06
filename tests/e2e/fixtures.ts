// E2E 共用的 test：**每支 spec 一律從這裡 import `test`／`expect`，不要直接從 '@playwright/test'**
// （tests/helpers/e2e-imports.test.ts 守）。
//
// 多的只有一道全域防線：頁面腳本丟出未捕捉的例外（pageerror）時，那條測試就紅。
// 很多斷言讀的是伺服器輸出的 HTML 或 computed style，腳本初始化到一半丟 TypeError 時照樣成立——
// 沒有這道線，錯誤只會出現在使用者的 console。防線本身有測試：tests/e2e/fixtures.spec.ts。
//
// - 監聽掛在 context 上而不是 page：/sim、/board 的跨分頁同步測試會自己開第二個分頁。
// - 覆寫內建的 `context`，不另開 auto fixture：只打 `request` 的測試不會因此多建一個瀏覽器 context。
// - 測試自己 `browser.newContext()` 開、而且有開 JS 的 context，要自己呼叫 `watchPageErrors()`
//   並在關掉前斷言（navigation.spec.ts 就是這樣）；e2e-imports.test.ts 會擋漏掉的。
// - 本來就要讓頁面丟例外的測試：`test.use({ allowPageErrors: true })` 退出。
import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';

export { expect };
export type { Page };

/** 開始收集這個 context 裡每一頁（含之後才開的）的未捕捉例外。回傳的陣列會持續被填入。 */
export function watchPageErrors(context: BrowserContext): string[] {
  const errors: string[] = [];
  const watch = (p: Page) => p.on('pageerror', e => errors.push(`${p.url()}：${e.stack ?? e.message}`));
  context.pages().forEach(watch);
  context.on('page', watch);
  return errors;
}

export const test = base.extend<{ allowPageErrors: boolean }>({
  allowPageErrors: [false, { option: true }],
  context: async ({ context, allowPageErrors }, use) => {
    const errors = watchPageErrors(context);
    await use(context);
    if (!allowPageErrors) expect(errors, '頁面腳本丟出未捕捉的例外').toEqual([]);
  },
});
