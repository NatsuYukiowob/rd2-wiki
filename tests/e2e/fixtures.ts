// E2E 共用的 test：**每支 spec 一律從這裡 import `test`／`expect`，不要直接從 '@playwright/test'**。
//
// 多的只有一道全域防線：頁面腳本丟出未捕捉的例外（pageerror）時，那條測試就紅。
// 很多斷言讀的是伺服器輸出的 HTML 或 computed style，腳本初始化到一半丟 TypeError 時照樣成立——
// 沒有這道線，錯誤只會出現在使用者的 console。
//
// 監聽掛在 context 上而不是 page：/sim、/board 的跨分頁同步測試會自己開第二個分頁，
// 只聽 `page` 的話那一頁丟的例外沒人接。測試自己 `browser.newContext()` 開的 context 不在範圍內。
//
// 本來就要讓頁面丟例外的測試（目前沒有）：`test.use({ allowPageErrors: true })` 退出。
import { test as base, expect, type Page } from '@playwright/test';

export { expect };
export type { Page };

export const test = base.extend<{ allowPageErrors: boolean; pageErrorGuard: void }>({
  allowPageErrors: [false, { option: true }],
  pageErrorGuard: [async ({ context, allowPageErrors }, use) => {
    const errors: string[] = [];
    const watch = (p: Page) => p.on('pageerror', e => errors.push(`${p.url()}：${e.stack ?? e.message}`));
    context.pages().forEach(watch);
    context.on('page', watch);
    await use();
    if (!allowPageErrors) expect(errors, '頁面腳本丟出未捕捉的例外').toEqual([]);
  }, { auto: true }],
});
