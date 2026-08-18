// 端對端測試（Task 18）：在真實瀏覽器（Chromium，桌機／手機兩種 project）裡驗證
// 前面 17 個任務只在 linkedom（沒有版面引擎、沒有 getScreenCTM、沒有 window.matchMedia
// 以外的瀏覽器 API）下驗證過的行為。
//
// 前 9 個 test（brief 原文，逐字照抄，未調整斷言）驗的是「元素存在、文字正確」；後面
// A–J 這幾個額外補的 test 才是真正驗證「這個網站能用」——圖示真的畫出來、縮放錨點跟手、
// 拖曳不誤觸選取、搜尋框不會被方向鍵誤觸平移，以及下面這段修正記錄的四個真實 bug。
//
// --- bug 修正記錄（第一輪 E2E 找到、第二輪修正並驗證，過程中歷經三次不同的圖示裁切技術）---
//
// 1.（Critical，已修正）節點的 bounding box 曾經是整張未裁切的 sprite：舊版 render.ts
//    用「巢狀 `<svg>` + `viewBox`」裁切圖示，視覺渲染正確，但 Chromium 對巢狀 svg 子元素的
//    `getBoundingClientRect()` 不會考慮外層 viewBox 的裁切，回傳整張未裁切 sprite 的幾何框
//    （實測桌機 148x88 px、手機 512x305 px，節點肉眼可見的圖示只有個位數到十幾 px）。
//    這讓 Playwright `.click()`／`.boundingBox()` 打空（brief test #2 逾時失敗的根因），
//    鍵盤 `:focus` 外框也放大到跟旁邊好幾個節點重疊（真實的無障礙缺陷）。
//    第一次嘗試改用 `<g clip-path>` 包住整張 sprite `<image>`，實測發現**同樣的問題**：
//    Chromium 算 `getBoundingClientRect()` 完全不考慮任何裁剪機制（viewBox／clip-path／
//    overflow 都一樣，裁剪只是繪製階段的效果，不影響幾何階段算出來的邊界框）。
//    最終修正：改用 `<rect fill="url(#pattern)">`（見 src/lib/render.ts）——`<rect>` 的
//    `getBoundingClientRect()` 只看自己的 x/y/width/height，完全不受 fill 裡貼的圖案影響，
//    這才是真的修好。下面的 G／H 兩個測試就是這項修正的證據。
// 2.（Important，已修正）初次載入沒有觸發高解析圖示升級：初始視角的縮放常常超過 1x 門檻
//    （手機走可讀性下限、桌機在下面 bug 4 修正後也一樣），但 upgradeIcons() 只掛在
//    wheel／pointerup 事件上，載入當下不會被觸發，使用者要先操作一次才看得到清晰圖示。
//    修正：src/scripts/tree-canvas.ts 在初始視角算完之後補一次呼叫（不分裝置）。見測試 I。
// 3.（Minor，已修正）手機版收起的篩選抽屜會露出一截：`top:3rem + translateY(-110%)`
//    在面板換行變高後位移量不夠，改成 `top:0 + translateY(-100%)`（不管面板多高都精確
//    貼齊視窗頂端正上方）。見下面測試 J。
// 4.（Important，已修正）桌機初始視角的圖示也小到看不清：`minReadableScale()` 原本只算
//    容器寬度／viewBox 寬度，手機直向容器（窄且高）剛好都是寬度限制縮放，掩蓋了「應該取
//    寬高兩者較小值」這件事沒做。桌機橫向容器（寬且扁，比 viewBox 更扁）改由高度限制縮放，
//    舊公式因此嚴重低估桌機需要的縮放下限，桌機初始視角的圖示只有約 9 CSS px。修正：
//    `minReadableScale()` 改吃容器寬高兩個維度、`applyReadabilityFloor()` 不分裝置、
//    初始視角／分支跳轉都套用（見 src/lib/viewport.ts、src/scripts/tree-canvas.ts）。
//    **副作用**：桌機初始視角現在會以「整棵樹的幾何中心」為錨點放大到約 2.34x，這代表
//    「整棵樹一次看完」跟「看得清圖示」不可能同時成立（跟手機分支視角同一套取捨邏輯），
//    某些特定節點（例如 brief test #2 用的 1002）預設可能被擠出可視範圍之外，需要使用者
//    自己平移或用分支導覽跳過去才看得到——這不是 bug 1 沒修好，是 bug 4 的必然結果。
//    下面 A/B/C/D/F/H 這幾個會操作特定節點的測試、以及 brief test #2 本身，都改成先點
//    分支導覽（跟真人使用者會做的操作一樣）確保節點在畫面內，不是碰運氣賭預設視角剛好
//    蓋到那個節點；斷言本身沒有任何調整。
import { test, expect, type Page, type Locator } from '@playwright/test';
import sharp from 'sharp';
import { readFileSync } from 'node:fs';

/**
 * locator 目前的中心點（CSS px）。
 *
 * bug 1 修正前，這裡不能直接用 `locator.boundingBox()`：節點在還沒升級成高解析圖示前，
 * `getBoundingClientRect()` 回傳的是整張未裁切 sprite 的幾何框，中心點會落在畫布空白處
 * 而不是圖示上（見上面的修正記錄）。修正後（`src/lib/render.ts` 改用
 * `<rect fill="url(#pattern)">`）`getBoundingClientRect()` 已經正確反映節點的真實顯示
 * 範圍，可以直接用標準 API，不需要再手動重建座標轉換鏈繞過它——這個簡化本身也是修正生效
 * 的證據之一。
 */
async function centerOf(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('locator 沒有 bounding box（不在畫面上或尚未渲染）');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** 以某個螢幕座標為錨點滾輪縮放 n 次（deltaY < 0 = 放大，見 tree-canvas.ts 的 wheel handler）。 */
async function zoomInAt(page: Page, point: { x: number; y: number }, notches: number): Promise<void> {
  await page.mouse.move(point.x, point.y);
  for (let i = 0; i < notches; i++) {
    await page.mouse.wheel(0, -100);
  }
}

/** 讀出 #viewport 目前的 scale。用瀏覽器原生 `SVGTransformList.consolidate().matrix`，
 *  不用正規表達式解析 transform 屬性字串（數值小到變成指數記法時解析會失敗）。 */
async function getViewportScale(page: Page): Promise<number> {
  return page.evaluate(() => {
    const vp = document.getElementById('viewport') as unknown as SVGGraphicsElement;
    return vp.transform.baseVal.consolidate()!.matrix.a;
  });
}

/**
 * 開啟 /tree 並點分支導覽跳到「自然」分支（桌機 #branch-nav／手機 #branch-chips，同一組
 * data-branch 按鈕）。
 *
 * bug 4 修正後，桌機初始視角改成以「整棵樹的幾何中心」為錨點放大到約 2.34x（見上面的修正
 * 記錄）——這代表哪些節點剛好落在預設視角內是「整棵樹的佈局長什麼樣」決定的，不是穩定、
 * 可預期的測試前提。真人使用者想操作某個特定節點，本來就會先用分支導覽跳過去，不會假設
 * 預設視角剛好蓋到；這裡讓測試比照真人的操作方式，用 `jumpToBranch('nature')` 這條已經在
 * 別處單獨測過的既有機制，確定把自然分支（1001/1002/1003... 都在這個分支）的節點带進
 * 可視範圍，不是自己another重新發明一套「怎樣才算在畫面內」的判斷。
 */
async function goToNatureBranch(page: Page, isMobile: boolean): Promise<void> {
  await page.goto('/tree');
  const sel = isMobile ? '#branch-chips' : '#branch-nav';
  await page.click(`${sel} button[data-branch="nature"]`);
}

// ---------------------------------------------------------------------------
// brief 原文的 9 個 test（tests/e2e/tree.spec.ts 需求規格逐字照抄，未調整斷言。
// test #2（task-18-report.md 記錄過的已知失敗）後來補上前置條件修正：桌機預設視角下
// 節點 1002 會被擠出可視範圍外（bug 4 的副作用，見檔頭修正記錄），真人使用者操作特定
// 節點前本來就會先用分支導覽把它帶進畫面，這裡改成比照 A/B/D/F/H 幾個測試呼叫既有的
// `goToNatureBranch()` 把節點帶進視野，斷言本身一個字都沒動。）
// ---------------------------------------------------------------------------

// 239（下面這個測試）與 100（「搜尋會淡出不相關節點」）都是從建置期產生的
// src/generated/tree.json（gitignored）反推出來的固定數字，源頭是 data/dice-tree.svg。
// 只改 data/dice-tree.svg 增減節點、不動這支測試檔，CI 會冒出看起來無關的
// `expected 239, received 240` ——這個註解是留給那時候的人一個能立刻對到根源的線索。
test('骰子樹渲染出所有節點', async ({ page }) => {
  await page.goto('/tree');
  await expect(page.locator('#tree g.node')).toHaveCount(239);
});

test('點選節點會高亮前置鏈並顯示成本', async ({ page, isMobile }) => {
  // 節點 1002（尖刺骰子，屬於「自然」分支）在桌機預設視角下（bug 4 修正後，整棵樹置中放大
  // 到約 2.34x）會被擠出可視範圍外，直接 `page.goto('/tree')` 後點擊會逾時——這不是實作
  // bug，是「整棵樹一次看完」跟「看得清圖示」的必然取捨（見檔頭修正記錄）。真人使用者要
  // 操作特定節點，本來就會先用分支導覽（桌機側欄／手機底部 chip）把它帶進畫面，這裡改用
  // 跟 A/B/D/F/H 幾個測試同一套、已經在別處單獨驗證過的 `goToNatureBranch()`，不是自己
  // 發明一套「怎樣才算在畫面內」的判斷。
  //
  // 刻意不用 `/tree?node=1002` 這種網址參數：那個途徑本身就會自動選取節點（見「網址狀態
  // 可還原」測試），會讓這裡真正要驗的「點擊」這個動作變成沒有意義的空動作——這個測試的
  // 標題就叫「點選節點會…」，前置條件不能把它要測的那個動作本身取消掉。
  await goToNatureBranch(page, isMobile);
  await page.locator('g.node[data-id="1002"]').click();
  await expect(page.locator('#detail')).toContainText('前置鏈');
  await expect(page.locator('#detail .cost')).toContainText(/核心|金幣/);
  expect(await page.locator('#tree g.node.in-chain').count()).toBeGreaterThan(1);
});

test('前置鏈高亮蓋過篩選淡出', async ({ page }) => {
  await page.goto('/tree?node=1002&type=dice');
  const hidden = page.locator('g.node.filtered-out.in-chain');
  await expect(hidden.first()).toBeVisible();
});

test('搜尋會淡出不相關節點', async ({ page }) => {
  await page.goto('/tree');
  await page.fill('#search', '冰凍');
  await expect(page.locator('#tree g.node:not(.filtered-out)').first()).toBeVisible();
  expect(await page.locator('#tree g.node.filtered-out').count()).toBeGreaterThan(100);
});

test('網址狀態可還原', async ({ page }) => {
  await page.goto('/tree?node=1001&branch=nature&q=火');
  await expect(page.locator('#detail h2')).toHaveText('火骰子');
  await expect(page.locator('#search')).toHaveValue('火');
});

test('Esc 取消選取', async ({ page }) => {
  await page.goto('/tree?node=1001');
  await page.locator('g.node[data-id="1001"]').press('Escape');
  await expect(page.locator('#detail')).toBeHidden();
});

test('鍵盤可聚焦並以 Enter 選取節點', async ({ page }) => {
  await page.goto('/tree');
  await page.locator('g.node[data-id="1001"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#detail h2')).toHaveText('火骰子');
});

test('手機版預設聚焦單一分支且有分支 chip', async ({ page, isMobile }) => {
  test.skip(!isMobile, '僅手機版');
  await page.goto('/tree');
  await expect(page.locator('#branch-chips button')).toHaveCount(5);

  // brief 原文只斷言分支 chip 數量，這件事光靠 tree.astro 的靜態 markup 就會恆成立，就算
  // jumpToBranch()／minReadableScale() 被整個刪掉、手機版退化成跟桌機版一樣顯示全部 5 個
  // 分支，這一行斷言依然會通過（code review 抓到的真實漏洞：測試名稱承諾了「聚焦單一分支」
  // 但完全沒驗證這件事）。額外補上：手機版初始縮放應該明顯大於桌機版的 0.9（fitTo 整棵樹的
  // 結果），這才是「真的聚焦到單一分支」而不是「看得到全部 5 分支」的直接證據。
  expect(await getViewportScale(page)).toBeGreaterThan(1.5);
});

test('首屏資產體積在預算內', async ({ page }) => {
  let bytes = 0;
  page.on('response', async r => {
    if (r.url().includes('/assets/') || r.url().endsWith('.js') || r.url().endsWith('.css')) {
      bytes += Number((await r.allHeaders())['content-length'] ?? 0);
    }
  });
  await page.goto('/tree', { waitUntil: 'networkidle' });
  expect(bytes).toBeLessThan(500 * 1024);
});

// ---------------------------------------------------------------------------
// A–J：yuki 追加的「這個網站真的能用」證據，以及四個 bug 的修正驗證
// ---------------------------------------------------------------------------

test('A. 圖示真的有畫出來：節點區域像素不是單一顏色', async ({ page, isMobile }) => {
  await goToNatureBranch(page, isMobile);
  const node = page.locator('g.node[data-id="1001"]');
  await expect(node).toBeVisible();

  // 先放大再截圖：分支視角下節點圖示已經有一定大小，放大到接近上限讓圖示佔的像素夠多，
  // 統計顏色數量才有意義（避免因為畫面太小、反鋸齒噪點不夠而誤判）。
  const point = await centerOf(node);
  await zoomInAt(page, point, 15);

  const icon = node.locator('> rect.icon'); // 貼了 sprite/hires pattern 的圖示本體（見 render.ts）
  const box = await icon.boundingBox();
  if (!box) throw new Error('放大後仍取不到圖示的 bounding box');
  expect(box.width).toBeGreaterThan(30); // 放大有效，不是量到一坨 0px

  const buf = await page.screenshot({
    clip: { x: box.x, y: box.y, width: box.width, height: box.height },
  });
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const colors = new Set<string>();
  for (let i = 0; i + 2 < data.length; i += info.channels) {
    colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
  }
  // sprite 裁切錯誤或圖沒載入時，這塊區域會是純色（1 種顏色）或全透明合成背景色（也是 1
  // 種顏色）；一張真正的骰子圖示至少會有明暗漸層、輪廓線，顏色數量遠不止個位數。
  expect(colors.size).toBeGreaterThan(3);
});

test('B. 縮放錨點跟手：滾輪縮放後，節點維持在同一螢幕座標', async ({ page, isMobile }) => {
  await goToNatureBranch(page, isMobile);
  const node = page.locator('g.node[data-id="1002"]');
  const before = await centerOf(node);

  await zoomInAt(page, before, 5);

  const after = await centerOf(node); // 縮放後重新即時算一次，不是快取舊值
  // 錨點不變性：zoomAt 應該讓游標下的內容縮放前後對到同一個螢幕座標，不會整個畫面
  // 往錨點的反方向飄走（viewport.ts 的 e/f 位移換算如果漏算就會在這裡露餡）。
  expect(Math.abs(after.x - before.x)).toBeLessThan(2);
  expect(Math.abs(after.y - before.y)).toBeLessThan(2);
});

test('C. 縮放 > 1x 後，可見節點圖示從 sprite pattern 換成高解析 pattern', async ({ page, isMobile }) => {
  // bug 2 修正後，兩種裝置的初始視角都常常已經超過 1x 門檻、載入時就直接是高解析圖示了
  // （見下面測試 I，那是這個修正的直接證據）；這裡驗的是「從 sprite 狀態開始、縮放跨過
  // 門檻後升級」這個轉換過程本身，所以要先確認起始狀態真的是 sprite（不是提前就已經
  // 升級過），不是的話代表這個測試的前提不成立，用 test.skip 誠實記錄，不是硬凹。
  await goToNatureBranch(page, isMobile);
  const icon = page.locator('g.node[data-id="1002"] > rect.icon');
  const startFill = await icon.getAttribute('fill');
  test.skip(!startFill?.includes('icon-pattern-'), '這個裝置/縮放組合下，分支導覽跳轉後已經是高解析圖示，沒有可觀察的轉換窗口');

  const point = await centerOf(page.locator('g.node[data-id="1002"]'));
  await zoomInAt(page, point, 8);
  expect(await getViewportScale(page)).toBeGreaterThan(1);

  // upgradeIcons 是用 wheel 事件節流的 requestAnimationFrame 觸發的（見 tree-canvas.ts），
  // 給瀏覽器一次繪圖機會讓它真的跑完。
  await page.waitForFunction(() => {
    const fill = document.querySelector('g.node[data-id="1002"] > rect.icon')?.getAttribute('fill');
    return fill?.includes('icon-hires-') ?? false;
  });
  const fill = await icon.getAttribute('fill');
  expect(fill).toMatch(/^url\(#icon-hires-[0-9a-f]+\)$/);

  // 再進一步確認：pattern 裡真的貼的是個別的高解析 webp，不是只把 id 換了個名字。
  const hash = /icon-hires-([0-9a-f]+)/.exec(fill ?? '')?.[1];
  expect(hash).toBeTruthy();
  const patternImgHref = await page.locator(`defs > pattern#icon-hires-${hash} image`).getAttribute('href');
  expect(patternImgHref).toBe(`/assets/icons/${hash}.webp`);
});

test('D. 拖曳畫布放開在空白處，選取不會被誤觸清除', async ({ page, isMobile }) => {
  await goToNatureBranch(page, isMobile);
  await page.locator('g.node[data-id="1001"]').click();
  await expect(page.locator('#detail h2')).toHaveText('火骰子');
  await expect(page.locator('g.node[data-id="1001"].in-chain')).toHaveCount(1);

  // 選一段畫布空白區域來拖曳，確保按下/放開都落在 svg 空白處而不是剛好又點到另一個節點上，
  // 也不能落在選取後才出現的 #detail 面板上（面板疊在畫布之上，事件根本不會傳到 svg）。
  // 桌機版 #detail 固定在右側（22rem≈352px 寬）：拖曳範圍限制在畫布左半部，同時避開左側
  // 分支導覽列（x<120）與頂部工具列（y<100）。手機版 #detail 選取後改成由下滑出的
  // bottom sheet（max-height:55vh，見 tree.astro 手機媒體查詢），蓋住畫布下半部：拖曳範圍
  // 限制在畫布「上半部」，同時避開頂部工具列／篩選抽屜。這裡直接讀 #detail 目前（選取後）
  // 真正的 bounding box 來決定安全區，不是憑印象猜死板的百分比——code review 抓到的真實
  // bug：先前用固定的「畫布下半部」百分比在手機版會直接把整段拖曳起訖點都放在 #detail
  // 面板裡，svg 全程收不到任何 pointer 事件，測試「通過」但其實什麼都沒測到。
  const host = page.locator('#canvas-host');
  const box = await host.boundingBox();
  if (!box) throw new Error('#canvas-host 沒有 bounding box');
  const detailBox = await page.locator('#detail').boundingBox();

  let startX: number, startY: number, endX: number, endY: number;
  if (isMobile) {
    // 安全區的上界避開頂部工具列/篩選抽屜，下界是 #detail 面板頂緣（面板不存在時退回畫布
    // 自己的下緣）；在這段區間裡取兩個點，保證起訖點都在面板之上、真的落在畫布空白處。
    const topLimit = box.y + box.height * 0.12;
    const bottomLimit = (detailBox ? detailBox.y : box.y + box.height) - 12;
    startX = box.x + box.width * 0.3;
    startY = topLimit + (bottomLimit - topLimit) * 0.3;
    endX = box.x + box.width * 0.7;
    endY = topLimit + (bottomLimit - topLimit) * 0.7;
  } else {
    // 桌機版以前寫死「畫布左半部」，前提是 #detail 固定在右側——2026-08-18 詳情卡片改成貼在
    // 被選節點旁邊（positionPanel()）之後那個前提就不成立了，卡片可能正好落在左半部，拖曳
    // 全程打在卡片上、svg 收不到任何事件，而這條測試只斷言「選取還在」，於是安靜地通過卻
    // 什麼都沒測到——跟手機版當初被抓到的是同一個假綠。改成跟手機版一樣讀卡片的實際位置：
    // 取卡片左右兩側較寬的那一邊當安全區。
    const leftRoom = detailBox ? detailBox.x - box.x : box.width;
    const rightRoom = detailBox ? box.x + box.width - (detailBox.x + detailBox.width) : 0;
    const useLeft = leftRoom >= rightRoom;
    const zoneX = useLeft ? box.x : detailBox!.x + detailBox!.width;
    const zoneW = (useLeft ? leftRoom : rightRoom) - 12;
    startX = zoneX + zoneW * 0.3;
    startY = box.y + box.height * 0.75;
    endX = zoneX + zoneW * 0.7;
    endY = box.y + box.height * 0.35;
  }

  // 前提斷言：拖曳必須真的讓畫布動了。少了這條，只要起訖點落在任何攔截事件的元素上，
  // 下面「選取沒被清掉」就會在「根本沒發生拖曳」的情況下自動成立（假綠）。
  const transformBefore = await page.locator('#viewport').getAttribute('transform');

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // 拖曳門檻是 5px（DRAG_THRESHOLD_PX），中間切成多步、確保 pointermove 有機會連續觸發，
  // 累積位移遠超過門檻。
  await page.mouse.move((startX + endX) / 2, (startY + endY) / 2, { steps: 10 });
  await page.mouse.move(endX, endY, { steps: 10 });
  await page.mouse.up();

  await expect
    .poll(async () => page.locator('#viewport').getAttribute('transform'))
    .not.toBe(transformBefore);

  // 拖曳放開後，選取（面板 + in-chain 高亮）應該原封不動地留著，不會被這次「其實是拖曳、
  // 不是點選」的 pointerup 誤判成點在空白處而清空選取。
  await expect(page.locator('#detail')).toBeVisible();
  await expect(page.locator('#detail h2')).toHaveText('火骰子');
  await expect(page.locator('g.node[data-id="1001"].in-chain')).toHaveCount(1);
});

test('E. 搜尋框 focus 時，方向鍵不會誤觸畫布平移', async ({ page }) => {
  await page.goto('/tree');
  const before = await page.locator('#viewport').getAttribute('transform');

  await page.click('#search');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowDown');

  const afterSearchFocused = await page.locator('#viewport').getAttribute('transform');
  expect(afterSearchFocused).toBe(before);

  // 正對照組（code review 建議補上）：只斷言「搜尋框 focus 時方向鍵不平移」沒辦法分辨
  // 「isTypingTarget() 正確放行」跟「方向鍵平移功能整個壞掉、不管焦點在哪都不會動」——
  // 兩種情況這個測試都會通過。這裡額外確認焦點回到畫布本身（不是任何表單元件）時，
  // 方向鍵確實還是會平移，證明上面的「不變」是 isTypingTarget() 真的生效、不是平移功能
  // 本身已經失效的假陽性。
  await page.locator('g.node').first().focus();
  await page.keyboard.press('ArrowLeft');
  const afterCanvasFocused = await page.locator('#viewport').getAttribute('transform');
  expect(afterCanvasFocused).not.toBe(afterSearchFocused);
});

test('F. 留存桌機／手機畫面截圖供人工檢視', async ({ page, isMobile }, testInfo) => {
  // 故意用固定的相對路徑（不是 testInfo.outputPath()）：這樣人才找得到檔案在哪
  // （task-18 brief 明確要求「在報告裡告訴我檔案路徑」，一個固定、好猜的路徑比 Playwright
  // 自動產生的每個測試各一個雜湊資料夾好用）。代價（code review 提醒）：`test-results/`
  // 是 Playwright 預設的 outputDir，每次執行都會整個清空重建，不分 project——如果分開
  // 用 `--project=desktop` 跟 `--project=mobile` 各跑一次，後跑的那次會把先跑那次留下的
  // 4 張截圖裡屬於另一個 project 的 2 張一起清掉。正常工作流程（`npm run e2e`，或本檔開頭
  // 的 Run 指令）兩個 project 是同一次呼叫裡一起跑完，不會踩到這個問題；只有刻意分開跑
  // `--project` 才會，此時 F 只會留下最後一次跑的那個 project 的截圖。
  const dir = 'test-results/screenshots';
  await page.goto('/tree');
  await page.waitForTimeout(200); // 讓字型/版面穩定，避免截到還沒排版完的一幀
  await page.screenshot({ path: `${dir}/${testInfo.project.name}-tree-blank.png` });

  // 選節點前先點分支導覽，確保 1002 真的在畫面內（bug 4 修正後桌機預設視角不保證涵蓋任意
  // 特定節點，見檔頭的修正記錄）——截圖是要給 yuki 肉眼確認畫面，選不到節點的截圖沒有意義。
  const sel = isMobile ? '#branch-chips' : '#branch-nav';
  await page.click(`${sel} button[data-branch="nature"]`);
  await page.locator('g.node[data-id="1002"]').click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${dir}/${testInfo.project.name}-tree-selected.png` });
});

test('G. bbox 修正驗證：四種節點類型的 bounding box 貼合顯示尺寸，不再是整張未裁切 sprite', async ({ page }) => {
  await page.goto('/tree');
  // 節點顯示尺寸（tools/build-data.ts 依類型分區保證同類型節點尺寸固定相同）：
  // 骰子 48x52、骰子符文 24x26、玩家被動 20x20、支援 30x34（使用者座標單位）。bbox 的
  // 寬高不受節點是否目前在可視範圍內影響（getBoundingClientRect() 對被 overflow:hidden
  // 裁掉、目前捲動到畫面外的元素一樣算得出正確的幾何尺寸，只有位置座標會落在可視範圍外），
  // 所以這裡不需要先跳到特定分支，直接用預設視角查就有意義。
  // 修正前（不管巢狀 svg + viewBox 還是 clip-path）任何節點、任何類型量到的都是同一個誇張
  // 的量級——整張未裁切 sprite 的幾何框（實測樣本節點桌機 148x88 CSS px、手機
  // 512x305 CSS px，clip-path 版本在桌機新的較大初始縮放下甚至量到 384x229 CSS px）。
  // 修正後應該分別貼合各自的顯示尺寸，遠小於舊 bug 的量級。
  const types: Array<{ type: string; label: string }> = [
    { type: 'dice', label: '骰子' },
    { type: 'rune', label: '骰子符文' },
    { type: 'passive', label: '玩家被動' },
    { type: 'support', label: '支援' },
  ];
  for (const { type, label } of types) {
    const node = page.locator(`g.node[data-type="${type}"]`).first();
    const box = await node.locator('> rect.icon').boundingBox();
    if (!box) throw new Error(`type=${type}（${label}）沒有 bounding box`);
    // 100px 這個上限遠低於舊 bug 量到的百多到數百 px 級數字，又留有餘裕不用卡死在某個精確
    // 像素數字上（精確數字會隨瀏覽器視窗尺寸/字型渲染微調，鎖死反而脆弱）；下限 1px 只是
    // 排除「量到一坨 0」這種退化情況。
    expect(box.width, `${label}(${type}) 寬度`).toBeGreaterThan(1);
    expect(box.width, `${label}(${type}) 寬度`).toBeLessThan(100);
    expect(box.height, `${label}(${type}) 高度`).toBeGreaterThan(1);
    expect(box.height, `${label}(${type}) 高度`).toBeLessThan(100);
  }
});

test('H. 鍵盤 focus 的金邊貼合圖示輪廓：圓形節點得到圓環，四個角不會冒出金色', async ({ page, isMobile }) => {
  await goToNatureBranch(page, isMobile);
  // 挑一個圓形節點（玩家被動）：矩形 outline 與貼合輪廓的金邊，差別最明顯的地方就在四個角。
  const node = page.locator('g.node[data-type="passive"]').first();
  const icon = node.locator('> rect.icon');
  await node.scrollIntoViewIfNeeded();
  const point = await centerOf(node);
  await zoomInAt(page, point, 12); // 放大讓金邊佔的像素夠多，取樣才有意義
  await node.focus();

  const box = await icon.boundingBox();
  if (!box) throw new Error('取不到圖示的 bounding box');
  expect(box.width).toBeGreaterThan(30);

  // 金邊由 #focus-ring 濾鏡畫（見 src/lib/render.ts）。先確認它真的套上去了，避免下面的
  // 像素判定在「根本沒有 focus 樣式」的情況下也剛好通過。
  const filter = await icon.evaluate(el => getComputedStyle(el).filter);
  expect(filter).toContain('focus-ring');

  const PAD = 6;
  const buf = await page.screenshot({
    clip: { x: box.x - PAD, y: box.y - PAD, width: box.width + PAD * 2, height: box.height + PAD * 2 },
  });
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => {
    const i = (y * info.width + x) * info.channels;
    return [data[i]!, data[i + 1]!, data[i + 2]!] as const;
  };
  // 金色是 #ffd66f：紅高、綠高、藍明顯低。用色彩關係判定而不是比對確切數值——反鋸齒與
  // 底下透出來的顏色會讓實際像素略有出入。
  const isGold = ([r, g, b]: readonly [number, number, number]) => r > 200 && g > 150 && b < 150;

  // 1) 金邊真的畫出來了：沿著圖示上緣中線往外掃，一定會碰到金色。
  const midX = Math.round(info.width / 2);
  let ringFound = false;
  for (let y = 0; y < PAD + 6; y++) if (isGold(at(midX, y))) ringFound = true;
  expect(ringFound).toBe(true);

  // 2) 四個角不能是金色：矩形 outline 會把角落塗滿，貼合圓形輪廓的金邊不會碰到那裡。
  const corners: Array<readonly [number, number]> = [
    [1, 1],
    [info.width - 2, 1],
    [1, info.height - 2],
    [info.width - 2, info.height - 2],
  ];
  for (const [x, y] of corners) expect(isGold(at(x, y))).toBe(false);
});

test('I. 初次載入未經任何互動，只要初始縮放超過 1x，可見節點就已經是高解析圖示', async ({ page }) => {
  await page.goto('/tree'); // 網址沒帶 ?node=，桌機整棵樹置中、手機預設對準 nature 分支
  const scale = await getViewportScale(page);
  // bug 4 修正後，兩種裝置的初始視角都可能超過 1x（手機幾乎必然；桌機則看可讀性下限
  // 是否高於 fitTo 整棵樹的 0.9x，容器夠扁時會超過，見上面的修正記錄）——只有真的超過
  // 1x 時，bug 2 的修正才有東西可驗，沒超過就 skip，不是硬凹一個不成立的前提。
  test.skip(scale <= 1, `初始縮放 ${scale} ≤ 1x，這個裝置/環境下沒有可觀察的「初次載入已經是高解析」窗口`);

  // 完全不做任何滑鼠/觸控互動（不 wheel、不拖曳）。如果 bug 2 還在，這裡會停在 sprite
  // pattern，要等使用者互動一次才會升級。waitForFunction 給 rAF 一次跑的機會（跟測試 C
  // 用同一套節流機制，非同步觸發，見 tree-canvas.ts 的 maybeUpgradeIcons）。
  //
  // 用節點 1001（火骰子，nature 分支），不用 `page.locator('g.node').first()`——雖然
  // 「一定有某個節點在可視範圍內」恆成立（不然整個頁面就是空的，別的測試早就抓到），但
  // DOM 順序（.first() 選到的節點）跟「哪個節點目前真的在可視範圍內」是兩件不相干的事，
  // 只是碰巧目前 DOM 第一個節點剛好也在畫面內（code review 抓到的潛在脆弱點：日後如果
  // 節點資料順序或分支佈局變了，.first() 選到的節點可能剛好落在可視範圍外，
  // waitForFunction 會一路等到 timeout 才失敗，且失敗原因跟真正要驗的東西無關）。
  // 1001 已經在桌機整棵樹置中、手機 nature 分支這兩種預設視角下都手動驗證過確實可見
  // （跟上面 A/B/D/H 幾個測試選用同一個節點是同樣的理由）。
  await page.waitForFunction(() => {
    const fill = document.querySelector('g.node[data-id="1001"] > rect.icon')?.getAttribute('fill');
    return fill?.includes('icon-hires-') ?? false;
  });
  const fill = await page.locator('g.node[data-id="1001"] > rect.icon').getAttribute('fill');
  expect(fill).toMatch(/^url\(#icon-hires-[0-9a-f]+\)$/);
});

test('J. 手機版收起的篩選抽屜完全滑出畫面，不再露出一截', async ({ page, isMobile }) => {
  test.skip(!isMobile, '僅手機版：篩選抽屜收合行為只在手機版存在');
  await page.goto('/tree');
  const box = await page.locator('#filters').boundingBox();
  if (!box) throw new Error('#filters 沒有 bounding box');
  // 收起狀態下，面板的「底緣」（y + height）應該落在視窗頂端（y=0）或更上面，完全看不到；
  // 舊 bug（top:3rem + translateY(-110%)）在面板換行變高後，底緣會落在 y≈30-40px，
  // 露出最後一排 checkbox。
  expect(box.y + box.height).toBeLessThanOrEqual(1); // 留 1px 容錯給次像素捨入
});

test('K. 手機版詳情面板的重置警告不被底部分支 chip 蓋住（spec §2.1 強制要求的災情警告）', async ({ page, isMobile }) => {
  test.skip(!isMobile, '僅手機版：#branch-chips 疊在 #detail 底部的重疊問題只在手機版存在（桌機沒有 #branch-chips）');
  await page.goto('/tree?node=1001');
  // renderDetail()（NodeDetail.ts）固定把「骰子樹重置需要初期化券…」這段警告放在 #detail
  // 內容的最後一段，用文字內容鎖定它，不是靠結構順序猜。
  const warn = page.locator('#detail .note', { hasText: '初期化券' });
  await warn.scrollIntoViewIfNeeded();
  const warnBox = await warn.boundingBox();
  const chipsBox = await page.locator('#branch-chips').boundingBox();
  if (!warnBox || !chipsBox) throw new Error('缺少 bounding box');
  // #branch-chips 是 position:fixed 疊在 #detail 之上的獨立圖層（DOM 順序在 #detail
  // 後面，兩者都沒有互相退讓的 z-index，後面的蓋掉前面的）。警告段落捲到底後，它的底緣
  // 不能落進 #branch-chips 的範圍——落進去代表視覺上被蓋住，即使 DOM／CSS 都判定它
  // "visible"（Playwright 的 toBeVisible() 不會檢查有沒有被別的元素蓋住）。
  expect(warnBox.y + warnBox.height).toBeLessThanOrEqual(chipsBox.y + 1); // 留 1px 容錯
});

test('L. 中央樞紐真的畫得出來：五條腿都在、圖不是 404，篩選時跟著淡出', async ({ page }) => {
  // 樞紐的圖是唯一一張不走 sprite 的資產，網址由正本的 href 換副檔名推導。整條鏈路（正本
  // href → tree.json 的 url → 建置期轉出的檔名）任何一段對不上，站台就是一張破圖——
  // 而單元測試只驗字串、不會真的去要那個檔，首屏體積測試也只加總 content-length，
  // 404 的回應照樣有 content-length。要抓到這種靜靜壞掉的情形，只能真的發一次請求。
  await page.goto('/tree');
  const hub = page.locator('#tree g.tree-center');
  await expect(hub).toHaveCount(1);
  await expect(hub.locator('line.tree-center-link')).toHaveCount(5);

  const href = await hub.locator('image').getAttribute('href');
  if (!href) throw new Error('樞紐的 <image> 沒有 href');
  const res = await page.request.get(new URL(href, page.url()).toString());
  expect(res.status()).toBe(200);
  expect(Number((await res.body()).length)).toBeGreaterThan(0);

  // 有篩選但沒選任何節點時，其餘節點／邊會掉到 opacity 0.1；樞紐拿不到逐節點掛的
  // .filtered-out，必須由 applyFilter() 另外掛上去，否則它會變成全畫面唯一還亮著的東西。
  await page.goto('/tree?branch=chaos');
  await expect(page.locator('#tree g.tree-center')).toHaveClass(/filtered-out/);
  await expect(page.locator('#tree')).not.toHaveClass(/has-selection/);
});

test('M. 標籤只在需要時出現：符文／被動預設不標字，選進前置鏈或滑過時才單獨顯示', async ({ page, isMobile }) => {
  await page.goto('/tree');
  // 骰子是導覽錨點，標籤恆常可見
  await expect(page.locator('g.node[data-id="1001"] .label')).toBeVisible();

  // 符文預設不標字——這正是擁擠的來源（123 個符文的標籤平均比節點間距還寬 1.5 倍）
  const rune = page.locator('g.node[data-id="1201"] .label');
  await expect(rune).toBeHidden();
  if (!isMobile) {
    await page.locator('g.node[data-id="1201"]').hover();
    await expect(rune).toBeVisible();
  }

  // 選取節點時，前置鏈上的符文／被動要把標籤帶出來（「點開後顯示個別」）。這裡不寫死是哪個
  // 節點——前置鏈的組成會隨資料改變，寫死只會在下次改資料時假紅。
  await page.goto('/tree?node=1002');
  const chainMinor = page.locator(
    'g.node.in-chain:not([data-type="dice"]):not([data-type="support"])',
  );
  const n = await chainMinor.count();
  expect(n).toBeGreaterThan(0); // 1002 的前置鏈本來就含符文／被動，是 0 代表選取根本沒生效
  await expect(chainMinor.first().locator('.label')).toBeVisible();

  // 不在鏈上的符文仍然不標字（否則上面那條會被「其實全部都顯示」蒙混過去）
  const offChain = page.locator(
    'g.node:not(.in-chain):not([data-type="dice"]):not([data-type="support"])',
  );
  await expect(offChain.first().locator('.label')).toBeHidden();
});

test('N. 詳情卡片貼在被選節點旁邊，不擋工具列，畫布平移時跟著走', async ({ page, isMobile }) => {
  test.skip(isMobile, '僅桌機：手機版 #detail 是從底部升起的抽屜，沒有「節點旁邊」這種空間');
  await page.goto('/tree?node=1002');
  const panel = page.locator('#detail');
  const icon = page.locator('g.node[data-id="1002"] .icon');
  await expect(panel).toBeVisible();

  const p1 = (await panel.boundingBox())!;
  const n1 = (await icon.boundingBox())!;
  const toolbar = (await page.locator('#toolbar').boundingBox())!;

  // 貼在節點旁：水平方向緊鄰（左右都可以，靠近邊緣時會翻面），垂直方向大致對齊節點中心。
  const gapRight = p1.x - (n1.x + n1.width);
  const gapLeft = n1.x - (p1.x + p1.width);
  expect(Math.max(gapRight, gapLeft)).toBeGreaterThanOrEqual(0);
  expect(Math.max(gapRight, gapLeft)).toBeLessThan(40);
  expect(Math.abs((p1.y + p1.height / 2) - (n1.y + n1.height / 2))).toBeLessThan(p1.height);
  // 不擋工具列
  expect(p1.y).toBeGreaterThanOrEqual(toolbar.y + toolbar.height - 1);

  // 平移畫布後要跟著節點跑——卡片留在原地的話，它就指著一個已經不在那裡的節點了
  // 起點挑畫布左下角的空白處：卡片本身佔了畫面右上一大塊，從那裡起手等於在拖卡片、
  // 畫布不會動，測試會變成「前提不成立」的假紅。
  await page.mouse.move(200, 600);
  await page.mouse.down();
  await page.mouse.move(80, 600, { steps: 8 });
  await page.mouse.up();
  const p2 = (await panel.boundingBox())!;
  const n2 = (await icon.boundingBox())!;
  expect(n2.x).toBeLessThan(n1.x - 40); // 前提：畫布真的移動了
  expect(p2.x).toBeLessThan(p1.x - 40);
  expect(Math.abs((p2.x - n2.x) - (p1.x - n1.x))).toBeLessThan(4); // 與節點的相對位置維持不變
});

test('O. 搜尋命中時鏡頭帶到結果、狀態列說明命中幾個、清除鈕能回到原狀；關鍵字目前不可點', async ({ page }) => {
  // 這條守的是 image9 回報的死路：搜尋只命中兩三個節點時，畫面上是 236 個淡掉的節點加 243
  // 條淡掉的邊，數量壓過那幾個命中的目標，看起來就像「什麼都沒發生」；而 ?q= 不會因為點
  // 空白處而清掉（那只清 ?node=），使用者會覺得畫面卡住了、也找不到回去的路。
  await page.goto('/tree?node=4008'); // 陰陽骰子，描述裡有 #陰陽 關鍵字
  await expect(page.locator('#filter-status')).toBeHidden(); // 沒有篩選時整條不出現

  // 關鍵字點擊搜尋目前由 src/lib/flags.ts 的 FEATURES.keywordSearch 停用：點下去不該有反應，
  // 也不該長得像可以點。開回來時這一段會紅，把它換成「點了就等同下面那段搜尋流程」即可。
  const kw = page.locator('#detail .kw').first();
  await expect(kw).toBeVisible();
  await expect(page.locator('#detail')).not.toHaveClass(/kw-clickable/);
  await kw.click();
  await expect(page.locator('#filter-status')).toBeHidden();
  expect(new URL(page.url()).searchParams.get('q')).toBeNull();

  // 同一套「帶我去看結果」的流程，改從搜尋框走：打字＋Enter。
  const before = await page.locator('#viewport').getAttribute('transform');
  await page.locator('#search').fill('陰陽');
  await page.locator('#search').press('Enter');

  // 1) 狀態列說得出命中幾個
  await expect(page.locator('#filter-status')).toBeVisible();
  await expect(page.locator('#filter-count')).toHaveText(/符合 \d+ 個節點/);

  // 2) 鏡頭真的動了（沒動的話就是「原地一片灰」那個症狀）
  await expect
    .poll(async () => page.locator('#viewport').getAttribute('transform'))
    .not.toBe(before);

  // 3) 命中的節點在畫面內、而且沒有被篩掉
  const hit = page.locator('g.node[data-id="4008"]');
  await expect(hit).not.toHaveClass(/filtered-out/);
  const box = (await hit.boundingBox())!;
  expect(box.x).toBeGreaterThan(0);
  expect(box.x).toBeLessThan(1280);

  // 4) 清除鈕把篩選收乾淨：狀態列收起、沒有節點被篩掉、網址不再帶 q
  await page.locator('#filter-clear').click();
  await expect(page.locator('#filter-status')).toBeHidden();
  await expect(page.locator('g.node.filtered-out')).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('q')).toBeNull();
});

test('Q. 導覽列的「貢獻」入口目前不曝光（FEATURES.contributeLink 暫時關閉），但頁面本身還在', async ({ page }) => {
  await page.goto('/tree');
  await expect(page.locator('#site-nav a[href="/about"]')).toHaveCount(0);
  // 其餘入口不能被一起關掉——反向守門，避免「整條導覽列壞了」也能讓上面那條通過。
  await expect(page.locator('#site-nav a[href="/tree"]')).toHaveCount(1);
  // 關的是入口不是頁面：直接開網址仍然要打得開（見 src/lib/flags.ts 的說明）。
  const res = await page.request.get('/about');
  expect(res.status()).toBe(200);
});

test('P. 工具列對齊：搜尋框與分支側欄切齊同一條左邊界，工具列每一項共用同一條中線', async ({ page, isMobile }) => {
  test.skip(isMobile, '僅桌機：手機版 #branch-nav 隱藏、篩選收進頂部抽屜，沒有這條左邊界');
  await page.goto('/tree?q=' + encodeURIComponent('僵硬')); // 帶搜尋才會出現 #filter-status

  const box = async (sel: string) => {
    const b = await page.locator(sel).first().boundingBox();
    if (!b) throw new Error(`${sel} 沒有 bounding box`);
    return b;
  };
  const search = await box('#search');
  const branchBtn = await box('#branch-nav button');
  const label = await box('#filters label');
  const legend = await box('#filters legend');
  const status = await box('#filter-status');

  // 左邊界：#toolbar 與 #branch-nav 上下相接、同屬畫布左上角那一疊，內距不同的話按鈕會比
  // 搜尋框凸出去。用幾何斷言而不是比對 CSS 值——這個 repo 的固定偏移量咬過三次（見 CLAUDE.md）。
  expect(Math.abs(search.x - branchBtn.x)).toBeLessThan(1);

  // 中線：搜尋框、狀態列、篩選群組的標題與 checkbox 全部落在同一條水平中線上。
  const midY = (b: { y: number; height: number }) => b.y + b.height / 2;
  for (const [name, b] of [['狀態列', status], ['legend', legend], ['checkbox', label]] as const) {
    expect(Math.abs(midY(b) - midY(search)), `${name} 與搜尋框的中線差距`).toBeLessThan(1);
  }

  // 全站導覽列的樣式不可以漏到分支側欄：兩者都是 <nav>，用裸元素選擇器寫的 border-bottom
  // 會被一起套上，而 #branch-nav 背景透明，那條線就變成最後一顆分支按鈕底下一條無主的橫線
  // 浮在畫布上（2026-08-18 人工檢視回報）。
  const borders = await page.evaluate(() => ({
    branchNav: getComputedStyle(document.getElementById('branch-nav')!).borderBottomWidth,
    siteNav: getComputedStyle(document.getElementById('site-nav')!).borderBottomWidth,
  }));
  expect(borders.branchNav).toBe('0px');
  // 反向守門：正確的修法是把規則收斂到 #site-nav，不是把那條線整個刪掉——全站導覽列跟底下
  // 內容之間本來就該有分隔線。
  expect(borders.siteNav).not.toBe('0px');
});

test('R. 分頁標題不帶破折號，分頁圖示指向實際存在的檔案', async ({ page }) => {
  await page.goto('/tree');
  const title = await page.title();
  expect(title).toBe('骰子樹 rd2-wiki');
  expect(title).not.toContain('—'); // 破折號拿掉了（2026-08-18 要求）

  // 圖示只寫在 <head> 是不夠的：路徑打錯時瀏覽器只會安靜地退回預設圖示，沒有任何錯誤。
  // 這裡實際發一次請求確認它真的存在、而且是圖片。
  const href = await page.locator('link[rel="icon"]').getAttribute('href');
  expect(href).toBe('/favicon.png');
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('image/png');
});

test('S. 連結預覽卡片：標題全站固定，網址與圖片都是絕對網址且圖片存在', async ({ page }) => {
  // 貼進聊天室展開的卡片。沒有這些標籤時各平台是拿 <title> 湊，顯示成「骰子樹 rd2-wiki」。
  await page.goto('/tree');
  const meta = (sel: string) => page.locator(sel).getAttribute('content');
  expect(await meta('meta[property="og:title"]')).toBe('Random Dice 2 wiki - Fan made');
  expect(await meta('meta[name="twitter:title"]')).toBe('Random Dice 2 wiki - Fan made');

  // 絕對網址是規格要求——相對路徑多數平台直接不顯示圖，而且不會有任何錯誤訊息。
  const url = await meta('meta[property="og:url"]');
  const image = await meta('meta[property="og:image"]');
  expect(url).toMatch(/^https:\/\//);
  expect(image).toMatch(/^https:\/\//);

  // 圖片真的存在：只檢查標籤有值的話，路徑打錯照樣通過，而卡片會是一張空白圖。
  const res = await page.request.get(new URL(image!).pathname);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('image');

  // 標題刻意不隨分頁變動：換一頁再驗一次，避免有人日後改成 `${title} - …` 而沒人發現。
  await page.goto('/about');
  expect(await meta('meta[property="og:title"]')).toBe('Random Dice 2 wiki - Fan made');
});

test('T. 首頁的版本資訊全部來自資料正本，不是寫死在頁面上', async ({ page }) => {
  // 三個數字是三件不同的事：遊戲版本（玩家看得到的號碼）、資料版本（抄自哪一版遊戲資源包）、
  // 更新日期。期望值從建置產物現讀，不寫死——寫死的話下次改資料版本又要回頭改測試，
  // 而真正該擋的（頁面沒跟著資料變）反而測不出來。
  const meta = JSON.parse(
    readFileSync(new URL('../../src/generated/tree.json', import.meta.url), 'utf8'),
  ).meta as { gameVersion: string; gameBundle: string; updated: string };

  await page.goto('/');
  const text = (await page.locator('section').innerText()).replace(/\s+/g, '');
  expect(text).toContain(`遊戲版本v${meta.gameVersion}`);
  expect(text).toContain(`資料版本${meta.gameBundle}`);
  expect(text).toContain(meta.updated);
});
