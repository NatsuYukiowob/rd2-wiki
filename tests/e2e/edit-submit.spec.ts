import { readFileSync } from 'node:fs';
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
    await expect(page.locator('#edit-permission-note')).toContainText('不會去碰你其他的 repo');
    // 反向守門：擋住有人把「沒有能力」這種不實陳述加回來（public_repo 技術上有那個能力，
    // 只是本站不用）。這條 not.toContainText 不會假陰性——上一行的正向斷言已經證明
    // #edit-permission-note 存在且有文字，元素不存在時上一行就先紅了。
    await expect(page.locator('#edit-permission-note')).not.toContainText('沒有能力');
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

  // D35（全分支審查抓到、22 輪任務審查都漏掉的必修 Minor）：上傳圖示 → 送出這條路徑，
  // base64 編解碼串了三次——`toBase64`（前端 edit-canvas.ts）→ `fromBase64`（後端
  // submit.ts）→ `toBase64`（gh.ts，建 blob 用）——各自有單元測試，但從來沒有一支測試
  // 完整跑過這整條路。`tests/e2e/edit.spec.ts` 的「下載時一併給那張 PNG」測試驗過
  // 前端 toBase64 → 下載的那一段，`tests/functions/submit.test.ts` 驗過後端
  // fromBase64 → 送進 tree 的那一段，但兩者中間「前端編出來的 base64，後端解碼後是否真的
  // 是原始檔案的位元組」這個交界，只有這支測試會實際攔截 `/api/github/submit` 的 request
  // body、解碼、拿去跟原始 fixture 逐位元組比對。這條路徑一旦錯，玩家上傳的圖示會靜默損壞，
  // 而 CI 的規則 7(b) 只會報一個雜湊不符的錯——玩家完全看不懂那跟他選的圖片有什麼關係。
  test('上傳圖示送出後，request body 裡的 base64 解碼後與原始檔案位元組完全相同（D35）', async ({ page }) => {
    await mockApi(page, { loggedIn: true });

    let capturedIconBase64: string | undefined;
    let capturedBaseSvgHash: string | undefined;
    // 蓋掉 mockApi() 已經註冊的 '**/api/github/submit' route：Playwright 對同一個 pattern
    // 多次呼叫 page.route() 時，後註冊的 handler 先執行（可以呼叫 route.fallback() 才會退回
    // 前一個），這裡不需要 fallback——直接接手處理並回傳跟 mockApi() 一樣的成功回應即可。
    await page.route('**/api/github/submit', async route => {
      const body = route.request().postDataJSON() as {
        icons?: { hash: string; base64: string }[];
        baseSvgHash?: string;
      };
      capturedIconBase64 = body.icons?.[0]?.base64;
      capturedBaseSvgHash = body.baseSvgHash;
      await route.fulfill({ json: { number: 42, url: 'https://github.com/NatsuYukiowob/rd2-wiki/pull/42' } });
    });

    await page.goto('/edit');
    await page.locator('#edit-canvas-host svg .node[data-id="1002"]').click();
    await page.locator('#edit-panel [data-field="icon"]').setInputFiles('tests/fixtures/icon-128.png');
    await expect(page.locator('#edit-panel [data-icon-hash]')).toBeVisible();

    await page.locator('#edit-submit').click();
    await expect(page.locator('#edit-submit-result')).toContainText('#42');

    expect(capturedIconBase64).toBeTruthy();
    const decoded = Buffer.from(capturedIconBase64!, 'base64');
    const original = readFileSync('tests/fixtures/icon-128.png');
    expect(decoded.equals(original)).toBe(true);

    // I4 順帶驗證：baseSvgHash 有確實算出來並送上去（12 碼小寫 hex，跟 sha256Hex12() 的
    // 輸出格式一致）——這是 buildSubmitPayload() 唯一一次在真實瀏覽器環境（不是 vitest 的
    // node 環境）跑過 sha256Hex12(new TextEncoder().encode(svgText))，順手在這支已經攔截
    // request body 的測試裡驗一下，不另開一支測試。
    expect(capturedBaseSvgHash).toMatch(/^[0-9a-f]{12}$/);
  });
});
