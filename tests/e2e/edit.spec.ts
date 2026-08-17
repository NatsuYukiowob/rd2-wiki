import { test, expect } from '@playwright/test';

// /edit 頁面骨架的端對端驗證（task-11）。這支測試同時是「parseTreeWith 真的能在瀏覽器跑」的
// 證明：/edit 的唯一重繪路徑是 svgText → buildTreeDataWith（內部呼叫 parseTreeWith）→
// renderTree，Task 3 把 parseTreeWith 改成可注入 DOM 時就是為了讓這條路徑能在真實 Chromium
// 執行，而不只是 Node/linkedom；下面兩個斷言直接驗證 239 個節點與 248 條邊真的被畫出來，
// 不是形式測試（見 CLAUDE.md 的資料不變量：節點 239、邊 248）。
test.describe('線上編輯器', () => {
  test('載入後畫出 239 個節點與 248 條邊，狀態列顯示尚未修改', async ({ page }) => {
    await page.goto('/edit');
    await expect(page.locator('#edit-canvas-host svg .node')).toHaveCount(239, { timeout: 30_000 });
    await expect(page.locator('#edit-canvas-host svg .edge')).toHaveCount(248);
    await expect(page.locator('#edit-status')).toContainText('尚未修改');
  });

  test('點一個節點會在右側面板顯示它的欄位', async ({ page }) => {
    await page.goto('/edit');
    await page.locator('#edit-canvas-host svg .node[data-id="1002"]').click();
    await expect(page.locator('#edit-panel')).toContainText('尖刺骰子');
  });
});
