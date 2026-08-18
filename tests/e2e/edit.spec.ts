import { readFileSync } from 'node:fs';
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

/**
 * 點擊一個節點的 `.icon`（實際畫出圖形的 `<rect>`），用 `page.mouse.click()` 而不是
 * `locator.click()`（task-13 新增，見任務報告的「小節點點擊」踩坑說明）：
 *
 * `locator.click()` 送出前會做一連串 actionability 檢查（可見、穩定、沒被其他元素攔截），
 * 這些檢查在符文（24x26）／被動（20x20）這類小圖示節點上，於這個測試套件的 mobile
 * 專案（Pixel 7 裝置模擬）下會失敗：`#edit-panel` 固定佔 20rem 寬、edit.astro 沒有針對
 * 窄螢幕收窄它，`#edit-canvas-host` 因此被壓成只剩 92px 寬，要塞下整個 3400 使用者單位寬
 * 的 viewBox，縮放比例只剩約 0.027——一個 24 單位寬的符文圖示換算成 CSS px 只剩約 0.65px，
 * 是名副其實的次像素元素。這是既有 /edit 版面沒有做手機適配的既有落差（不是 Task 13 的
 * 範圍），但 Playwright 對這種次像素元素的 actionability 檢查會判定「不穩定／點不到」，
 * 一路重試到逾時。
 *
 * `page.mouse.click(x, y)` 繞過這層檢查，直接在指定的螢幕座標送出真實滑鼠事件，讓瀏覽器
 * 自己的畫面命中測試（跟真人滑鼠點在同一個像素是同一件事）決定點到什麼——實測過即使目標
 * 只有次像素大小，瀏覽器仍然會正確命中畫在那裡的形狀（見任務報告）。座標算的是 `.icon`
 * 這個實際有畫出東西的 `<rect>` 的幾何中心，不是整個 `.node` `<g>` 的 bounding box 中心
 * ——後者涵蓋圖示＋標籤文字兩者，對小圖示節點來說，這個組合 bbox 的幾何中心常常落在兩者
 * 之間的空白，不管用哪種點擊方式都點不到任何東西（這是這個踩坑故事的第一層，見任務報告）。
 */
async function clickIconCenter(page: Page, nodeLocator: ReturnType<Page['locator']>): Promise<void> {
  const box = await nodeLocator.locator('.icon').boundingBox();
  if (!box) throw new Error('節點的 .icon 沒有 bounding box，無法點擊');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
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

  // 審查回饋（2026-08-18 第 1 輪）：#edit-form 原本完全沒有樣式，<label> 預設是 inline
  // 元素，六個欄位（名稱／畫面標籤／類型／解鎖成本／效果說明／等級上限）在 20rem 寬的
  // #edit-panel 裡會橫向擠成一團，配上瀏覽器預設寬度的 <input>——不是「不夠精緻」，是
  // 「不能用」。修正後在 src/pages/edit.astro 補了版面 CSS，這裡用幾何斷言驗證「可用」
  // 這件事本身，不是看截圖（CLAUDE.md「版面驗收要用幾何斷言」）。
  test('表單六個欄位縱向堆疊，控制項不會溢出面板', async ({ page }) => {
    await page.goto('/edit');
    await page.locator('#edit-canvas-host svg .node[data-id="1002"]').click();

    // 六個欄位列＝五個 <label>（名稱／畫面標籤／解鎖成本／效果說明／等級上限）＋一個
    // <p class="meta">（類型，唯讀顯示，不是 <label>，見 EditForm.ts 的說明）。用
    // #edit-form 的直接子元素、依 DOM 順序取，這個順序就是 renderEditForm() 產生的順序。
    const rows = page.locator('#edit-form > label, #edit-form > p.meta');
    await expect(rows).toHaveCount(6);

    // 1. 縱向堆疊：依序比較每一列的 bounding box，後一列的 top 不能小於前一列的
    // bottom（允許 0.5px 的浮點誤差）。若六個欄位橫向擠成一團（修正前的 bug），
    // 後一列的 y 會跟前一列的 y 幾乎相同（同一行），這裡會直接抓到而不是「看起來擠」。
    let prevBox: { y: number; height: number } | null = null;
    for (const row of await rows.all()) {
      const box = await row.boundingBox();
      if (!box) throw new Error('表單欄位列沒有 bounding box');
      if (prevBox) {
        expect(box.y).toBeGreaterThanOrEqual(prevBox.y + prevBox.height - 0.5);
      }
      prevBox = box;
    }

    // 2. 控制項沒有溢出面板：每個 input/textarea 的右緣（x + width）不能超出
    // #edit-panel 的右緣。
    const panelBox = await page.locator('#edit-panel').boundingBox();
    if (!panelBox) throw new Error('#edit-panel 沒有 bounding box');
    for (const control of await page.locator('#edit-form [data-field]').all()) {
      const box = await control.boundingBox();
      if (!box) throw new Error('欄位控制項沒有 bounding box');
      expect(box.x + box.width).toBeLessThanOrEqual(panelBox.x + panelBox.width + 0.5);
    }
  });

  // task-13：加節點與拉連線。

  test('新增一個節點並連線後，節點數變 240、邊數變 249，驗證仍通過', async ({ page }) => {
    await page.goto('/edit');
    await expect(page.locator('#edit-canvas-host svg .node')).toHaveCount(239);

    // ⚠️ 先縮放過再點擊，這是這支測試存在的理由：新增模式的座標轉換陷阱
    // （edit-canvas.ts 的 screenToViewportXY()）是「用 svg.getScreenCTM() 而不是
    // #viewport 的 CTM」。實測過（見任務報告）：即使完全不縮放，這兩種寫法在這個實作下
    // 就已經不一樣——因為初始 fitTo() 本來就把 #viewport 的 transform 設成
    // `translate(170,142.5) scale(0.9)`，不是單位矩陣，所以 svg 自己的 CTM 從第一次
    // 渲染起就跟 #viewport 的 CTM有落差。但簡報明確要求「必須先平移或縮放，再點畫布」，
    // 這裡照做（縮放，見下面的理由）——多一層保險：確保鑑別力不是僥倖建立在 fitTo() 這個
    // 實作細節上，未來如果 fitTo() 改成套單位矩陣，這支測試仍然對這個 bug 有鑑別力。
    //
    // 只用「縮放」不用「平移」：`Viewport.zoomAt(factor, cx, cy)` 是以「螢幕座標
    // (cx,cy) 對應的使用者座標維持不變」為錨點縮放（見 viewport.ts 的說明），錨點選在
    // 畫布正中央時，不管容器長寬比例怎樣，縮放前後畫面中心對應的資料點都不變。反過來
    // `pan(dx,dy)` 是直接把「螢幕像素位移」除以 CTM 的縮放分量換算成使用者座標位移，
    // 這個換算完全不設界——實測過：Playwright 的 mobile 專案（Pixel 7）套用這個版面後，
    // #edit-canvas-host 只剩 92px 寬、757px 高（20rem 的 #edit-panel 沒有隨小螢幕收窄，
    // 這是既有版面本來就有的落差，不是 Task 13 要處理的範圍），螢幕的 CTM 縮放分量因此
    // 被压得極小，一個 15px 的拖曳换算成使用者座標會偏移超過 500 單位；这在有些方向上
    // 会把新节点推到当前可视窗口之外，导致后面 `.node.last().click()` 因为「元素不在
    // 視窗內」逾時。只縮放、不平移，縮放錨點固定在畫布中心，不會有這個問題。
    const host = page.locator('#edit-canvas-host');
    const box = await host.boundingBox();
    if (!box) throw new Error('#edit-canvas-host 沒有 bounding box');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -100); // 放大一格（單次 wheel 事件，固定 1.1 倍，見 edit-canvas.ts 的 wheel handler）
    await page.mouse.wheel(0, -100); // 再放大一格，讓 scale 跟初始值的差距更明確

    const before = await getViewportMatrix(page);
    expect(before.scale).not.toBeCloseTo(0.9, 3); // 確認真的離開了初始視角，見上面同款斷言的說明

    await page.locator('#edit-mode-add').click();
    // 點擊位置用畫布「中心」——縮放錨點也是畫布中心，這裡點在同一個點上，確保新節點
    // 建在畫面中央附近（不管容器長寬比例如何都是離可視範圍邊界最遠的位置），後面連線
    // 模式要點它、以及要點原本就接近 viewBox 中心的 1001（見下面的說明），才能穩定命中。
    const clickPos = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    // 用跟 edit-canvas.ts 完全相同的公式（screenToViewportXY() 的 DOMPoint.matrixTransform）
    // 手動算一次「正確答案」：讀 #viewport 目前的 CTM，反推點擊位置對應的使用者座標。
    // 如果實作誤用了 svg.getScreenCTM()（任務簡報點名的那個 bug），這裡算出來的「正確答案」
    // 跟實作實際寫入 SVG 的座標會對不上，下面的斷言就會抓到。
    const expected = await page.evaluate(({ x, y }) => {
      const svg = document.querySelector('#edit-canvas-host svg') as SVGSVGElement;
      const vp = svg.querySelector('#viewport') as SVGGElement;
      const ctm = vp.getScreenCTM()!;
      const pt = new DOMPoint(x, y).matrixTransform(ctm.inverse());
      return { x: Math.round(pt.x * 100) / 100, y: Math.round(pt.y * 100) / 100 };
    }, clickPos);

    await page.mouse.click(clickPos.x, clickPos.y);
    await page.locator('#new-node [data-field="branch"]').selectOption('nature');
    await page.locator('#new-node [data-field="type"]').selectOption('passive');
    await page.locator('#new-node [data-field="name"]').fill('測試被動');
    await page.locator('#new-node [data-field="label"]').fill('測試');
    await page.locator('#new-node [data-field="cost"]').fill('金幣 8,000');
    await page.locator('#new-node [data-field="description"]').fill('自然骰子子彈傷害增加20%(+5%)');
    await page.locator('#new-node [data-action="create"]').click();
    await expect(page.locator('#edit-canvas-host svg .node')).toHaveCount(240);

    // 新節點的實際 transform 座標必須精準等於上面手算的「正確答案」——這就是本測試
    // 真正的鑑別力來源：若實作誤用 svg.getScreenCTM()，這兩個值在「已縮放」的前提下
    // 會不一致，測試會在這裡失敗（已用故意注入的錯誤實作實測驗證過，見任務報告）。
    const actual = await page.evaluate(() => {
      const nodes = document.querySelectorAll('#edit-canvas-host svg .node');
      const last = nodes[nodes.length - 1]!;
      const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(last.getAttribute('transform') ?? '');
      return { x: Number(m![1]), y: Number(m![2]) };
    });
    expect(actual.x).toBeCloseTo(expected.x, 2);
    expect(actual.y).toBeCloseTo(expected.y, 2);

    await page.locator('#edit-mode-link').click();
    await page.locator('#edit-canvas-host svg .node[data-id="1001"]').click();
    // 新節點是 passive 類型，圖示只有 20x20 使用者單位——用 clickIconCenter()，見該函式
    // 開頭的說明（小圖示節點在這個測試套件的 mobile 專案下會是次像素大小）。
    await clickIconCenter(page, page.locator('#edit-canvas-host svg .node').last());
    await expect(page.locator('#edit-canvas-host svg .edge')).toHaveCount(249);
    // 「驗證仍通過」量的是 errors（會擋 PR 的那些），不是「面板完全沒有『規則』兩個字」
    // ——任務簡報原本給的斷言是 `not.toContainText('規則')`，但真實資料本身就有 4 個
    // 跟這次新增無關的規則 9 警告（2403／5302／5403／5307 的成長值含 {n} 佔位符，見
    // CLAUDE.md 已知待辦，跟上面「改名字會即時反映...」測試踩過的同一個坑），用「面板裡
    // 完全不能出現規則字樣」當斷言在真實資料上必然是假陰性，不管新增/連線做得對不對都會
    // 紅。改成跟同檔案既有測試一致的量法：有沒有 errors 區塊、送出按鈕有沒有被停用。
    await expect(page.locator('#edit-validation .errors')).toHaveCount(0);
    await expect(page.locator('#edit-download')).toBeEnabled();
  });

  test('連線模式下兩次點同一個節點會取消並提示，不會產生自迴圈邊', async ({ page }) => {
    await page.goto('/edit');
    await expect(page.locator('#edit-canvas-host svg .node')).toHaveCount(239);

    await page.locator('#edit-mode-link').click();
    await page.locator('#edit-canvas-host svg .node[data-id="1001"]').click();
    await page.locator('#edit-canvas-host svg .node[data-id="1001"]').click();

    await expect(page.locator('#edit-validation')).toContainText('已取消');
    await expect(page.locator('#edit-canvas-host svg .edge')).toHaveCount(248);
  });

  test('選取模式下按 Delete 鍵刪除節點，需二次確認；取消確認則不刪除', async ({ page }) => {
    await page.goto('/edit');
    await expect(page.locator('#edit-canvas-host svg .node')).toHaveCount(239);

    // 1301（火焰射程增加）是葉節點：只有唯一一條前置邊、沒有子節點，刪除它不會連帶讓其他
    // 節點斷線失去可達性——挑一個結構單純的節點，這支測試才能把斷言收斂成單純的「節點數
    // -1、邊數 -1」，不用另外處理「刪掉一個有兩個前置的中繼節點，會一次少 4 條邊、還可能讓
    // 它的子節點變成從根不可達」這種複雜度（那不是這支測試要驗的東西）。
    //
    // 用 clickIconCenter()（見該函式開頭的說明）而不是 locator.click()：1301 是符文
    // 類型，圖示只有 24x26 使用者單位，在這個測試套件的 mobile 專案（Pixel 7 模擬、
    // #edit-canvas-host 只有 92px 寬）下換算成不到 1 個 CSS px，Playwright 的
    // actionability 檢查會判定這個目標「不穩定／點不到」而重試到逾時——即使改成點
    // `.icon` 而不是整個 `.node`（後者的 bounding box 還涵蓋標籤文字，幾何中心常落在
    // 圖示與文字之間的空白，同樣點不到任何東西）也一樣，因為問題是元素本身small到次像素，
    // 不是點的位置選錯。這是既有 /edit 版面沒有做手機適配的既有落差（CLAUDE.md 已知待辦：
    // 「節點標籤字太小」），不是 Task 13 的範圍；`page.mouse.click()` 直接送出真實座標的
    // 滑鼠事件、不做 actionability 前置檢查，讓瀏覽器自己的畫面命中測試決定點到什麼，
    // 實測過即使目標只有次像素大小依然能正確命中。
    await clickIconCenter(page, page.locator('#edit-canvas-host svg .node[data-id="1301"]'));
    await expect(page.locator('#edit-panel')).toContainText('火焰射程增加');

    // 先確認「取消確認」不會刪除：dismiss() 對應玩家在對話框按下「取消」。
    page.once('dialog', dialog => dialog.dismiss());
    await page.keyboard.press('Delete');
    await expect(page.locator('#edit-canvas-host svg .node')).toHaveCount(239);

    // 再確認「接受確認」真的會刪除，且它唯一的前置邊一併消失。
    page.once('dialog', dialog => dialog.accept());
    await page.keyboard.press('Delete');
    await expect(page.locator('#edit-canvas-host svg .node')).toHaveCount(238);
    await expect(page.locator('#edit-canvas-host svg .node[data-id="1301"]')).toHaveCount(0);
    await expect(page.locator('#edit-canvas-host svg .edge')).toHaveCount(247);
  });

  // task-14：換圖示與新增關鍵字。

  test('換圖示：選一張合法 PNG 後節點的 href 更新且驗證通過', async ({ page }) => {
    await page.goto('/edit');
    await page.locator('#edit-canvas-host svg .node[data-id="1002"]').click();
    await page.locator('#edit-panel [data-field="icon"]').setInputFiles('tests/fixtures/icon-128.png');
    // `data-icon-hash` 是內部實作細節（sha256 前 12 碼）給自動化測試掛鉤用的屬性，不是玩家
    // 會在畫面上讀到的文字——設計上玩家從頭到尾不需要知道「雜湊」是什麼（見任務簡報）。
    await expect(page.locator('#edit-panel [data-icon-hash]')).toBeVisible();
    // 「驗證通過」量的是 errors（會擋 PR 的那些），不是「面板完全沒有『規則 7』字樣」——
    // 這支測試原本（任務簡報 Step 1 原始版本）用 `not.toContainText('規則 7')`，實測發現
    // 是假陰性：1002 原本的圖示雜湊 193187e4e921 只有它自己引用（`grep -c` 驗證過），換掉
    // 之後這個雜湊變成沒有任何節點引用，會觸發規則 7(d)「圖示未被任何節點引用」的 warning
    // ——這是正確、預期的行為（不擋 PR，只是提醒），不是這次實作的 bug。跟同檔案「改名字」
    // 「新增節點」兩支既有測試踩過的坑同一類（那邊是規則 9 的 warning），改成跟它們一致的
    // 量法：有沒有 errors 區塊、送出按鈕有沒有被停用，才是真正代表「通過」的訊號。
    await expect(page.locator('#edit-validation .errors')).toHaveCount(0);
    await expect(page.locator('#edit-download')).toBeEnabled();
    await expect(page.locator('#edit-status')).toContainText('已修改 1 處');
  });

  test('換圖示：太小的圖會被當場擋下並說明原因', async ({ page }) => {
    await page.goto('/edit');
    await page.locator('#edit-canvas-host svg .node[data-id="1002"]').click();
    await page.locator('#edit-panel [data-field="icon"]').setInputFiles('tests/fixtures/icon-32.png');
    // 這句話是 checkIcon() 的 reason，跟 CI 規則 7(c) 用語逐字一致（見 icon-hash.ts 與
    // tests/lib/icon-hash.test.ts 的回歸測試），這裡原樣顯示，不是這支測試自己重寫的字串。
    await expect(page.locator('#edit-panel')).toContainText('最長邊 32px，小於最低要求 96px');
    // 太小的圖被擋下時不可以進 dirty：玩家沒有成功做出任何改動，狀態列應該維持「尚未修改」，
    // 不能因為選過一次檔案就誤判成「已修改」（見任務簡報 Step 4：驗證失敗「不進 dirty，不改
    // svgText」）。
    await expect(page.locator('#edit-status')).toContainText('尚未修改');
  });

  test('用了白名單外的關鍵字會報規則 8，按下加入白名單後轉綠', async ({ page }) => {
    await page.goto('/edit');
    await page.locator('#edit-canvas-host svg .node[data-id="1002"]').click();
    await page.locator('#edit-panel [data-field="description"]').fill('造成#超新星傷害');
    await page.locator('#edit-panel [data-field="description"]').blur();
    await expect(page.locator('#edit-validation')).toContainText('規則 8');
    await page.locator('#edit-validation [data-action="add-keyword"]').click();
    await expect(page.locator('#edit-validation')).not.toContainText('規則 8');
  });

  // task-15：下載 SVG（P1 驗收點）。這是玩家在 /edit 完成編輯後拿到最終產物的唯一路徑，
  // 也是 P2 OAuth 一鍵送出萬一出意外時的安全網——下面四支測試涵蓋三類：「內容正確」
  // 「啟用條件正確（errors.length > 0 || dirty.size === 0 時停用，各佔一支）」
  // 「新增圖示一併下載」。

  test('改完後可下載 SVG，內容就是編輯器算出來的那份', async ({ page }) => {
    await page.goto('/edit');
    await page.locator('#edit-canvas-host svg .node[data-id="1002"]').click();
    await page.locator('#edit-panel [data-field="name"]').fill('尖刺骰');
    await page.locator('#edit-panel [data-field="name"]').blur();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#edit-download').click(),
    ]);
    expect(download.suggestedFilename()).toBe('dice-tree.svg');
    const text = await (await download.createReadStream()).toArray().then(cs => Buffer.concat(cs).toString('utf8'));
    expect(text).toContain('data-name="尖刺骰"');
    expect(text.match(/<g class="node"/g)!.length).toBe(239);
  });

  // 啟用條件是 `errors.length > 0 || dirty.size === 0` 時停用（任務簡報 Step 3）：沒有改動
  // 沒東西可下載，有 error 不該讓玩家下載一份會被 CI 擋下的檔案。分別驗這兩個獨立條件，
  // 不合併成一支測試——各自對應不同的程式路徑（runValidation() 的 disabled 判斷式是 ||），
  // 只測其中一半沒辦法證明另一半也接對了。
  test('剛載入、還沒有任何改動時下載按鈕停用（dirty.size === 0）', async ({ page }) => {
    await page.goto('/edit');
    await expect(page.locator('#edit-canvas-host svg .node')).toHaveCount(239);
    await expect(page.locator('#edit-status')).toContainText('尚未修改');
    await expect(page.locator('#edit-download')).toBeDisabled();
  });

  test('有 error 時下載按鈕停用（errors.length > 0），即使已經改過東西', async ({ page }) => {
    await page.goto('/edit');
    await page.locator('#edit-canvas-host svg .node[data-id="1002"]').click();
    await page.locator('#edit-panel [data-field="cost"]').fill('八個核心');
    await page.locator('#edit-panel [data-field="cost"]').blur();
    await expect(page.locator('#edit-validation')).toContainText('規則 4'); // 已經改過（dirty≠0），但有 error
    await expect(page.locator('#edit-download')).toBeDisabled();
  });

  test('有新增圖示時，下載會一併給那張 PNG，檔名是雜湊、內容跟上傳的一致', async ({ page }) => {
    await page.goto('/edit');
    await page.locator('#edit-canvas-host svg .node[data-id="1002"]').click();
    await page.locator('#edit-panel [data-field="icon"]').setInputFiles('tests/fixtures/icon-128.png');
    const hash = await page.locator('#edit-panel [data-icon-hash]').getAttribute('data-icon-hash');
    if (!hash) throw new Error('沒有讀到 data-icon-hash，換圖示流程可能失敗了');

    // 兩個 `a.click()`（svg、圖示）在頁面裡是同步緊接著觸發的：實測過用兩個
    // `page.waitForEvent('download')` 疊 `Promise.all`（等同兩個 `.once('download', ...)`
    // 監聽器）會讓兩者都接到同一個第一次事件（Node EventEmitter 的 `emit()` 是廣播給「當下
    // 已註冊」的所有監聽器，不是照註冊順序把後續事件逐一分派給後面的監聽器），第二個下載事件
    // 因此沒有監聽器接住而遺漏。改用 `page.on('download', ...)` 常駐監聽＋收集陣列，不受
    // 「兩個下載幾乎同時觸發」這件事影響。
    const downloads: import('@playwright/test').Download[] = [];
    page.on('download', d => downloads.push(d));
    await page.locator('#edit-download').click();
    await expect.poll(() => downloads.length).toBe(2);
    const [svgDownload, iconDownload] = downloads;
    expect(svgDownload!.suggestedFilename()).toBe('dice-tree.svg');
    expect(iconDownload!.suggestedFilename()).toBe(`${hash}.png`);

    const iconBytes = await (await iconDownload!.createReadStream()).toArray().then(cs => Buffer.concat(cs));
    const original = readFileSync('tests/fixtures/icon-128.png');
    expect(iconBytes.equals(original)).toBe(true);
  });
});
