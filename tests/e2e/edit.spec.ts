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

  // task-12：欄位表單與即時驗證。

  test('改名字會即時反映在畫布與狀態列，且驗證維持通過', async ({ page }) => {
    await page.goto('/edit');
    await page.locator('#edit-canvas-host svg .node[data-id="1002"]').click();
    await page.locator('#edit-panel [data-field="name"]').fill('尖刺骰');
    await page.locator('#edit-panel [data-field="name"]').blur();
    await expect(page.locator('#edit-status')).toContainText('已修改 1 處');
    // 「驗證維持通過」量的是 errors（會擋 PR 的那些），不是「面板完全沒有『規則』兩個字」：
    // 真實資料本身就有 4 個跟這次編輯無關的規則 9 警告（2403／5302／5403／5307 的成長值
    // 含 {n} 佔位符，見 CLAUDE.md 已知待辦），validateWith 是對整份 svgText 跑的，這幾條
    // warnings 不管編輯哪個節點都會出現在面板裡——用「面板裡完全不能出現規則字樣」當斷言
    // 在真實資料上必然是假陰性。改成直接量「有沒有 errors 區塊」跟「送出按鈕有沒有被停用」
    // 這兩個真正代表「通過」的訊號（renderValidation()／runValidation() 的說明）。
    await expect(page.locator('#edit-validation .errors')).toHaveCount(0);
    await expect(page.locator('#edit-download')).toBeEnabled();
  });

  test('把成本改成不合法格式會即時顯示規則 4 錯誤', async ({ page }) => {
    await page.goto('/edit');
    await page.locator('#edit-canvas-host svg .node[data-id="1002"]').click();
    await page.locator('#edit-panel [data-field="cost"]').fill('八個核心');
    await page.locator('#edit-panel [data-field="cost"]').blur();
    await expect(page.locator('#edit-validation')).toContainText('規則 4');
    await expect(page.locator('#edit-download')).toBeDisabled();
  });

  // task-12 對 task-11 已知取捨的修正：task-11 的 rerender() 每次成功渲染都呼叫
  // fitTo()，玩家改一個欄位、畫面就跳回整棵樹視角。這裡用幾何斷言（讀 #viewport 的
  // transform 矩陣，不是截圖）證明編輯後 scale/translate 沒有被重置，見 rerender() 與
  // Viewport.rebind() 的說明。
  test('編輯欄位後 #viewport 的 scale/translate 不會被重置', async ({ page }) => {
    await page.goto('/edit');
    await expect(page.locator('#edit-canvas-host svg .node')).toHaveCount(239);

    // 先選取節點、開啟表單——特意在還沒平移縮放的初始視角下點，避免下面的平移縮放把
    // 節點移出可視範圍導致點不到。表單開了之後活在 #edit-panel，跟畫布 #edit-canvas-host
    // 是不同的 DOM 子樹，之後怎麼平移縮放畫布都不影響表單。
    await page.locator('#edit-canvas-host svg .node[data-id="1002"]').click();

    // 手動放大＋拖曳平移，離開初始 fitTo() 給的 0.9x 視角——這就是「玩家好不容易縮放到
    // 想改的節點」那個動作。
    const host = page.locator('#edit-canvas-host');
    const box = await host.boundingBox();
    if (!box) throw new Error('#edit-canvas-host 沒有 bounding box');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -300); // 放大
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.3, { steps: 10 });
    await page.mouse.up();

    const before = await getViewportMatrix(page);
    // 確認真的離開了初始視角（不是巧合停在 fitTo() 給的精確值 0.9/170/142.5）：如果平移
    // 縮放沒生效，就算 rerender() 真的把視角重置回 fitTo()，這條測試也會誤判通過。
    expect(before.scale).not.toBeCloseTo(0.9, 3);

    // 觸發一次欄位編輯 → applyEdit() → rerender()。task-11 的行為會讓這裡的 scale/x/y
    // 被打回 fitTo() 算出的 0.9/170/142.5（見上面「初始載入」那條測試的手算值）；
    // task-12 改成非初次渲染呼叫 Viewport.rebind()，這三個值應該完全不變。
    await page.locator('#edit-panel [data-field="name"]').fill('尖刺骰');
    await page.locator('#edit-panel [data-field="name"]').blur();
    await expect(page.locator('#edit-status')).toContainText('已修改 1 處');

    const after = await getViewportMatrix(page);
    expect(after.scale).toBeCloseTo(before.scale, 6);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });
});
