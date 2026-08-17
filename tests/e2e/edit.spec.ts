import { test, expect, type Page } from '@playwright/test';

// /edit 頁面骨架的端對端驗證（task-11）。這支測試同時是「parseTreeWith 真的能在瀏覽器跑」的
// 證明：/edit 的唯一重繪路徑是 svgText → buildTreeDataWith（內部呼叫 parseTreeWith）→
// renderTree，Task 3 把 parseTreeWith 改成可注入 DOM 時就是為了讓這條路徑能在真實 Chromium
// 執行，而不只是 Node/linkedom；下面兩個斷言直接驗證 239 個節點與 248 條邊真的被畫出來，
// 不是形式測試（見 CLAUDE.md 的資料不變量：節點 239、邊 248）。

/** 讀出 #viewport 目前的 transform 矩陣（scale＝a、translate＝e/f）。用瀏覽器原生
 *  `SVGTransformList.consolidate().matrix`，不用正規表達式解析 transform 屬性字串
 *  （數值小到變成指數記法時解析會失敗）——跟 tests/e2e/tree.spec.ts 的
 *  `getViewportScale()` 同一招，這裡多讀 e/f 兩個平移分量。 */
async function getViewportMatrix(page: Page): Promise<{ scale: number; x: number; y: number }> {
  return page.evaluate(() => {
    const vp = document.getElementById('viewport') as unknown as SVGGraphicsElement;
    const m = vp.transform.baseVal.consolidate()!.matrix;
    return { scale: m.a, x: m.e, y: m.f };
  });
}

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

  // 以下三支是審查回饋（2026-08-18）補的：Task 11 原版只建了 Viewport 就丟，玩家完全
  // 無法平移縮放。用幾何斷言驗證（讀 #viewport 的 transform 矩陣），不是看截圖
  // （CLAUDE.md「版面驗收要用幾何斷言」）。

  test('初始載入會 fitTo 整棵樹：#viewport 的 scale 精確等於 0.9', async ({ page }) => {
    await page.goto('/edit');
    await expect(page.locator('#edit-canvas-host svg .node')).toHaveCount(239);
    const { scale } = await getViewportMatrix(page);
    // viewport.ts 的 fitTo(bounds, pad=0.9)：bounds 傳的就是整個 viewBox 本身
    // （edit-canvas.ts 的 rerender()），所以 min(vbw/bw, vbh/bh) 恆為 1，
    // 縮放比＝1×0.9＝0.9，不是 Viewport 建構子預設的 1（那代表 fitTo 根本沒被呼叫）。
    expect(scale).toBeCloseTo(0.9, 5);
  });

  test('滾輪縮放會改變 #viewport 的 scale', async ({ page }) => {
    await page.goto('/edit');
    await expect(page.locator('#edit-canvas-host svg .node')).toHaveCount(239);
    const before = await getViewportMatrix(page);

    const host = page.locator('#edit-canvas-host');
    const box = await host.boundingBox();
    if (!box) throw new Error('#edit-canvas-host 沒有 bounding box');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -300); // deltaY < 0 = 放大，見 edit-canvas.ts 的 wheel handler

    const after = await getViewportMatrix(page);
    expect(after.scale).toBeGreaterThan(before.scale);
  });

  test('拖曳畫布會改變 #viewport 的 translate', async ({ page }) => {
    await page.goto('/edit');
    await expect(page.locator('#edit-canvas-host svg .node')).toHaveCount(239);
    const before = await getViewportMatrix(page);

    const host = page.locator('#edit-canvas-host');
    const box = await host.boundingBox();
    if (!box) throw new Error('#edit-canvas-host 沒有 bounding box');
    // 選畫布中央一段拖曳，避開右側 20rem 寬的 #edit-panel（拖曳起訖點都要落在
    // #edit-canvas-host 上才會觸發它的 pointer 事件委派，不是隨便挑兩個座標）。
    const startX = box.x + box.width * 0.3;
    const startY = box.y + box.height * 0.5;
    const endX = box.x + box.width * 0.5;
    const endY = box.y + box.height * 0.3;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move((startX + endX) / 2, (startY + endY) / 2, { steps: 10 });
    await page.mouse.move(endX, endY, { steps: 10 });
    await page.mouse.up();

    const after = await getViewportMatrix(page);
    expect(after.x).not.toBeCloseTo(before.x, 1);
    expect(after.y).not.toBeCloseTo(before.y, 1);
  });
});
