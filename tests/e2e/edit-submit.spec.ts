import { test, expect } from '@playwright/test';

/** 攔下所有 GitHub 相關端點，E2E 不真的打 GitHub。 */
async function mockApi(page: import('@playwright/test').Page, opts: { loggedIn: boolean }) {
  await page.route('**/api/github/me', route =>
    opts.loggedIn
      ? route.fulfill({ json: { login: 'someplayer' } })
      : route.fulfill({ status: 401, json: { error: 'not logged in' } }));
  await page.route('**/api/github/submit', route =>
    route.fulfill({ json: { number: 42, url: 'https://github.com/NatsuYukiowob/rd2-wiki/pull/42' } }));
}

test.describe('送出 PR', () => {
  test('未登入也能編輯，送出鍵顯示為「用 GitHub 登入後送出」並附權限說明', async ({ page }) => {
    await mockApi(page, { loggedIn: false });
    await page.goto('/edit');
    await page.locator('#edit-canvas-host svg .node[data-id="1002"]').click();
    await page.locator('#edit-panel [data-field="name"]').fill('尖刺骰');
    await page.locator('#edit-panel [data-field="name"]').blur();
    await expect(page.locator('#edit-status')).toContainText('已修改 1 處');
    await expect(page.locator('#edit-login')).toContainText('用 GitHub 登入');
    await expect(page.locator('#edit-permission-note')).toContainText('不會也沒有能力動你其他的 repo');
  });

  test('已登入且有改動時，送出後顯示 PR 連結', async ({ page }) => {
    await mockApi(page, { loggedIn: true });
    await page.goto('/edit');
    await page.locator('#edit-canvas-host svg .node[data-id="1002"]').click();
    await page.locator('#edit-panel [data-field="name"]').fill('尖刺骰');
    await page.locator('#edit-panel [data-field="name"]').blur();
    await page.locator('#edit-submit').click();
    await expect(page.locator('#edit-submit-result')).toContainText('#42');
    await expect(page.locator('#edit-submit-result a')).toHaveAttribute(
      'href', 'https://github.com/NatsuYukiowob/rd2-wiki/pull/42');
  });

  test('有驗證錯誤時送出鍵停用', async ({ page }) => {
    await mockApi(page, { loggedIn: true });
    await page.goto('/edit');
    await page.locator('#edit-canvas-host svg .node[data-id="1002"]').click();
    await page.locator('#edit-panel [data-field="cost"]').fill('八個核心');
    await page.locator('#edit-panel [data-field="cost"]').blur();
    await expect(page.locator('#edit-submit')).toBeDisabled();
  });

  test('送出失敗時顯示可讀訊息，不丟原始錯誤給玩家', async ({ page }) => {
    await mockApi(page, { loggedIn: true });
    // ⚠️ 跟任務簡報 Step 1 原文的差異：這裡用 `{ message: ... }`，簡報原文寫的是
    // `{ error: ... }`。真正的後端 functions/api/github/submit.ts 所有錯誤分支
    // （413/429/400/502）一律回 `{ message }`（tests/functions/submit.test.ts 也是這樣
    // 斷言的），從來沒有 `error` 這個欄位。若這裡照抄簡報用 `error`，前端只要也照抄簡報去
    // 讀 `error` 欄位，這支 E2E 依然會綠燈（因為 mock 跟實作用的是同一個錯的欄位名，
    // 互相印證出一個假象）——但接上真正的 Cloudflare Pages Function 時，`data.error`
    // 永遠是 undefined，玩家送出失敗只會看到「送出失敗：undefined」。改用 `message`
    // 讓這支測試真正驗證到前端讀對了跟後端一致的欄位，而不是驗證「前端跟一份寫錯的 mock
    // 兩相一致」。詳見任務報告的「簡報與現實不符」章節。
    await page.route('**/api/github/submit', route =>
      route.fulfill({ status: 429, json: { message: '送出太頻繁，請等 30 秒後再試' } }));
    await page.goto('/edit');
    await page.locator('#edit-canvas-host svg .node[data-id="1002"]').click();
    await page.locator('#edit-panel [data-field="name"]').fill('尖刺骰');
    await page.locator('#edit-panel [data-field="name"]').blur();
    await page.locator('#edit-submit').click();
    await expect(page.locator('#edit-submit-result')).toContainText('送出太頻繁');
  });

  // 這支測試不在任務簡報的 Step 1 原始清單裡——是自我審查時對照 Task 18 的設計文件才發現
  // 的落地缺口：functions/api/github/callback.ts 在 OAuth 流程任何一步失敗時會導回
  // `/edit?login=failed`，task-18-brief.md 明講「讓前端顯示可讀的錯誤」，但 Task 18-20
  // 都只做後端，從來沒有前端程式碼真的讀過這個查詢參數。Task 21 是「編輯器接上用 GitHub
  // 登入」的任務、也是這個功能的最後一塊，若這裡不接，Task 18 立下的承諾永遠不會被兌現
  // ——玩家在 GitHub 授權頁按取消，會被導回 /edit 卻完全看不出剛剛發生了什麼事。
  test('OAuth 登入失敗（callback 導回 /edit?login=failed）會顯示可讀訊息，且網址列的參數會被清掉', async ({ page }) => {
    await mockApi(page, { loggedIn: false });
    await page.goto('/edit?login=failed');
    await expect(page.locator('#edit-login-failed')).toContainText('請再試一次');
    await expect(page.locator('#edit-login')).toContainText('用 GitHub 登入');
    // 失敗訊息只在「這次載入」有意義，不該留在網址列讓玩家重新整理後還卡著，見
    // SubmitPanel.ts init() 的說明。
    await expect.poll(() => new URL(page.url()).searchParams.get('login')).toBeNull();
  });
});
