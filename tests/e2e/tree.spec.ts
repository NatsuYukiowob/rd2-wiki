// 端對端測試：在真實瀏覽器（Chromium，桌機／手機兩種 project）裡驗證 /tree 的行為。
//
// ⚠️ **這一頁的畫布是 Canvas 2D，不是 SVG**（2026-09-06 起）。canvas 裡畫的節點與邊
// **不是 DOM 元素**——沒有 `g.node`、沒有 `line.edge`、沒有 `#viewport`、沒有 classList、
// 也沒有 `getBoundingClientRect()` 可以量。所以這支測試檔一律**不量節點的 DOM 幾何**，
// 改問渲染器主動暴露的查詢介面 `window.__tree`（src/lib/canvas/debug-api.ts）：
//
//   count()                 → { nodes, edges }           畫了幾顆節點、幾條邊
//   scale()                 → number                     目前縮放（1 ＝ 整棵樹全貌）
//   nodeScreenRect(id)      → { left, top, width, height }  節點在**視窗座標**的 CSS px 矩形
//   state()                 → { selected, chain, filteredOut, focus, bypassEdges, sim? }
//   hitAt(clientX, clientY) → string | null              那個座標點中了誰
//
// 對**不是畫布**的東西（工具列、詳情卡片、篩選抽屜、分支側欄、footer）仍然照舊量
// `getBoundingClientRect()`——那些真的是 DOM，而「卡片不蓋住節點」這種斷言需要兩邊的
// 矩形，節點那一半改由 `nodeScreenRect()` 供應。
//
// ⚠️ 鍵盤焦點也不在畫布上：每顆節點另外掛一份隱形的 `<button class="tree-a11y-node">`
// （src/lib/canvas/a11y.ts），焦點框由 painter 畫在 canvas 上。所以「聚焦某顆節點」是
// `page.locator('.tree-a11y-node[data-id="…"]').focus()`，驗收是 `state().focus === id`，
// 不是掃像素。
//
// 換成 canvas 時刪掉了 13 條綁 SVG 實作細節的測試（pattern 像素、bbox 修正、`.label`
// display 規則、`will-change`／drop-shadow 開關⋯⋯），改用四張 `#canvas-host` 的快照
// 守「畫面真的長對」（見下面的 F）——那正是 canvas 版唯一能表達「畫出來的東西對不對」的
// 方式。⚠️ 那四張基準圖只在 desktop project 維護，容差走 playwright.config.ts 的
// `toHaveScreenshot.maxDiffPixelRatio`（0.001＝約 767 px，量出來的，見該檔註解）；**只在 Playwright 官方容器內比對**
// （`npm run e2e:snapshots`，CI 同一個 image）；畫面真的改了要用 `npm run e2e:snapshots:update`
// 重錄，**重錄之後一定要肉眼看過那四張 PNG 再 commit**（CLAUDE.md：純視覺的改動測試綠
// 不等於做對）。
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolveColor } from './probe';

/** `window.__tree` 的形狀（見 src/lib/canvas/debug-api.ts 與 canvas-tree.ts 的 debugApi）。 */
interface TreeState {
  selected: string | null;
  chain: string[];
  filteredOut: string[];
  focus: string | null;
  bypassEdges: [string, string][];
  sim?: { owned: string[]; available: string[]; linked: [string, string][]; active: [string, string][] };
}
interface TreeDebug {
  count(): { nodes: number; edges: number };
  scale(): number;
  nodeScreenRect(id: string): { left: number; top: number; width: number; height: number } | null;
  state(): TreeState;
  hitAt(clientX: number, clientY: number): string | null;
}
declare global {
  interface Window { __tree: TreeDebug }
}

/**
 * 期望值一律從建置產物 `src/generated/tree.json`（gitignored）現讀，不寫死。
 *
 * 寫死的話，只改 `data/dice-tree.svg` 增減一顆節點就會冒出看起來無關的
 * `expected 241, received 242`；而真正該擋的（畫布少畫了節點）反而測不出來。
 */
const treeData = JSON.parse(
  readFileSync(new URL('../../src/generated/tree.json', import.meta.url), 'utf8'),
) as {
  nodes: { id: string; type: string; bypassPrereq?: true }[];
  edges: [string, string][];
  meta: { viewBox: [number, number, number, number]; gameVersion: string; gameBundle: string; updated: string };
};

type Rect = { left: number; top: number; width: number; height: number };

/** 等畫布掛載完成（`window.__tree` 出現）。取代舊版的 `waitForSelector('#tree g.node')`。 */
async function waitTree(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean(window.__tree));
}

/** 節點在視窗座標的矩形。這是這支測試檔取得節點位置的**唯一**途徑。 */
async function nodeRect(page: Page, id: string): Promise<Rect> {
  const r = await page.evaluate(nid => window.__tree.nodeScreenRect(nid), id);
  if (!r) throw new Error(`節點 ${id} 沒有螢幕矩形（畫布還沒掛好，或 id 不存在）`);
  return r;
}

/** 節點中心（視窗座標 CSS px）。 */
async function nodeCenter(page: Page, id: string): Promise<{ x: number; y: number }> {
  const r = await nodeRect(page, id);
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

const treeState = (page: Page): Promise<TreeState> => page.evaluate(() => window.__tree.state());
/** 目前縮放。語意跟舊版 `#viewport` 的 CSS transform scale 完全相同（1 ＝ 整棵樹全貌）。 */
const treeScale = (page: Page): Promise<number> => page.evaluate(() => window.__tree.scale());

/**
 * 畫布上「一定不會被浮動 chrome 蓋住」的矩形（視窗座標）。
 *
 * ⚠️ 四個方向都要算：工具列擋上面、桌機的分支側欄擋左邊、手機的分支 chip 列擋下面，
 * 而**詳情卡片會擋中間**——2026-08-23 起桌機的卡片是水平置中貼在節點上下方的，所以
 * 「畫布左半部」這種寫死的安全區在它身上完全不成立（舊版 D 就是這樣假綠過）。
 * 卡片可見時取它左右兩側較寬的那一邊；手機的卡片是貼底抽屜，取它上方。
 * 量的全都是**非畫布**的 DOM 元素，符合「不量節點幾何」那條線。
 */
async function safeZone(page: Page): Promise<{ left: number; top: number; right: number; bottom: number }> {
  return page.evaluate(() => {
    const box = (el: Element | null): DOMRect | null => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 ? r : null;   // display:none 的元素回 0 尺寸
    };
    const host = document.getElementById('canvas-host')!.getBoundingClientRect();
    const toolbar = box(document.getElementById('toolbar'));
    const nav = box(document.getElementById('branch-nav'));
    const chips = box(document.getElementById('branch-chips'));
    const detailEl = document.getElementById('detail') as HTMLElement;
    const d = detailEl.hidden ? null : box(detailEl);

    let left = host.left, right = host.right, top = host.top, bottom = host.bottom;
    if (toolbar) top = Math.max(top, toolbar.bottom + 4);
    if (nav) left = Math.max(left, nav.right + 4);
    if (chips) bottom = Math.min(bottom, chips.top - 4);
    if (d) {
      const full = d.left <= left + 1 && d.right >= right - 1;   // 全寬＝手機的底部抽屜
      if (full) bottom = Math.min(bottom, d.top - 4);
      else if (d.left - left >= right - d.right) right = Math.min(right, d.left - 4);
      else left = Math.max(left, d.right + 4);
    }
    return { left, top, right, bottom };
  });
}

/**
 * 把節點平移進安全區。
 *
 * 桌機初始視角是「整棵樹置中 ＋ 可讀性下限」，哪幾顆剛好落在畫面內是佈局決定的、不是穩定的
 * 測試前提（見 CLAUDE.md）。真人要操作某顆節點本來就會先把它拖進畫面，這裡照做——而且
 * **拖曳一定不會誤觸選取**（超過 5px 門檻就不算點選，那是 canvas-tree.ts 的 endPointer）。
 * 一次最多拖安全區的 35%，起訖點才都留在安全區內；重複幾次逼近目標。
 */
async function bringIntoView(page: Page, id: string): Promise<void> {
  for (let i = 0; i < 8; i++) {
    const z = await safeZone(page);
    const r = await nodeRect(page, id);
    if (r.left >= z.left && r.left + r.width <= z.right && r.top >= z.top && r.top + r.height <= z.bottom) return;
    const cx = (z.left + z.right) / 2, cy = (z.top + z.bottom) / 2;
    const maxX = (z.right - z.left) * 0.35, maxY = (z.bottom - z.top) * 0.35;
    const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));
    const dx = clamp(cx - (r.left + r.width / 2), maxX);
    const dy = clamp(cy - (r.top + r.height / 2), maxY);
    await page.mouse.move(cx - dx / 2, cy - dy / 2);
    await page.mouse.down();
    await page.mouse.move(cx, cy, { steps: 6 });
    await page.mouse.move(cx + dx / 2, cy + dy / 2, { steps: 6 });
    await page.mouse.up();
  }
  const z = await safeZone(page), r = await nodeRect(page, id);
  throw new Error(`節點 ${id} 搬不進可點擊範圍（節點 ${JSON.stringify(r)}／安全區 ${JSON.stringify(z)}）`);
}

/**
 * 點一顆節點：先把它平移進安全區，再對它的**中心**送一次真的滑鼠點擊。
 *
 * ⚠️ 一定要用 `page.mouse`，不能用 locator.click()——canvas 裡沒有可以 click 的元素，
 * 而 `.tree-a11y-node` 那顆隱形按鈕走的是鍵盤那條路（onActivate），驗不到 pointer 判定。
 */
async function clickNode(page: Page, id: string): Promise<void> {
  await bringIntoView(page, id);
  const c = await nodeCenter(page, id);
  await page.mouse.click(c.x, c.y);
}

/** 以某個螢幕座標為錨點滾輪縮放 n 次（deltaY < 0 = 放大，見 canvas-tree.ts 的 wheel handler）。 */
async function zoomInAt(page: Page, point: { x: number; y: number }, notches: number): Promise<void> {
  await page.mouse.move(point.x, point.y);
  for (let i = 0; i < notches; i++) {
    await page.mouse.wheel(0, -100);
  }
}

/**
 * 開啟 /tree 並點分支導覽跳到「自然」分支（桌機 #branch-nav／手機 #branch-chips，同一組
 * data-branch 按鈕）——`jumpToBranch()` 是已經在別處單獨測過的既有機制。
 */
async function goToNatureBranch(page: Page, isMobile: boolean): Promise<void> {
  await page.goto('/tree');
  await waitTree(page);
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

// 節點數／邊數一律從 `src/generated/tree.json` 現讀（見檔頭 treeData 的說明）。
// 這條守的是「渲染器真的把每一顆節點與每一條邊都放進場景」——canvas 裡沒有元素可以數，
// 所以問 `__tree.count()`；它數的是 scene.nodes／scene.edges，也就是 painter 每一幀在畫的
// 那份清單，不是另外維護的第二份計數。
test('骰子樹渲染出所有節點', async ({ page }) => {
  await page.goto('/tree');
  await waitTree(page);
  expect(await page.evaluate(() => window.__tree.count()))
    .toEqual({ nodes: treeData.nodes.length, edges: treeData.edges.length });
  // 無障礙那份 DOM 也要一顆不少：canvas 進不了無障礙樹，這 241 顆隱形按鈕是鍵盤與讀屏
  // 唯一的入口（src/lib/canvas/a11y.ts）。少掉它們畫面完全正常、鍵盤卻整頁不能用。
  await expect(page.locator('.tree-a11y-node')).toHaveCount(treeData.nodes.length);
});

test('點選節點會高亮前置鏈並顯示成本', async ({ page }) => {
  // 用真的滑鼠點畫布（clickNode 會先把節點平移進安全區），刻意不用 `/tree?node=` ——
  // 那條路本身就會自動選取節點，會讓這裡真正要驗的「點擊」變成沒有意義的空動作。
  await page.goto('/tree');
  await waitTree(page);
  await clickNode(page, '5201');

  await expect(page.locator('#detail')).toContainText('前置鏈');
  await expect(page.locator('#detail .cost')).toContainText(/核心|金幣/);

  // 高亮不再是 `.in-chain` class，而是 painter 依 `state().chain` 決定的 opacity。
  // 期望值當場從資料算：5201 的祖先聯集（去重、含自身），遇到 bypassPrereq 的節點就停止
  // 往上追（src/lib/selection.ts 的 prerequisiteChain 同一條規則）。
  const st = await treeState(page);
  expect(st.selected).toBe('5201');
  expect([...st.chain].sort()).toEqual(ancestorChain('5201'));
});

test('前置鏈高亮蓋過篩選淡出', async ({ page }) => {
  // 舊版驗的是 `g.node.filtered-out.in-chain` 這個 class 組合存在；canvas 版同一件事由
  // state.ts 的 `nodeAlpha()` 表達（chain 先判、回 1，篩選淡出的 0.1 判在後面）。測試能問的
  // 是那條規則的**輸入**：同一顆節點同時落在 chain 與 filteredOut 裡。
  await page.goto('/tree?node=1002&type=dice');
  await waitTree(page);
  const st = await treeState(page);
  const both = st.chain.filter(id => st.filteredOut.includes(id));
  expect(both.length, '應該有節點同時在前置鏈上、又被類型篩選淡出').toBeGreaterThan(0);
});

test('搜尋會淡出不相關節點', async ({ page }) => {
  await page.goto('/tree');
  await waitTree(page);
  await page.fill('#search', '冰凍');
  // 兩個方向都要問：淡出的夠多（不是「篩選根本沒生效」），而且**不是全部**
  // （不是「連命中的也一起淡掉」——那在畫面上是一片灰，跟篩選壞掉長得一樣）。
  await expect.poll(async () => (await treeState(page)).filteredOut.length).toBeGreaterThan(100);
  expect((await treeState(page)).filteredOut.length).toBeLessThan(treeData.nodes.length);
});

test('網址狀態可還原', async ({ page }) => {
  await page.goto('/tree?node=1001&branch=nature&q=火');
  await expect(page.locator('#detail h2')).toHaveText('火骰子');
  await expect(page.locator('#search')).toHaveValue('火');
  await waitTree(page);
  expect((await treeState(page)).selected).toBe('1001');
});

test('Esc 取消選取', async ({ page }) => {
  await page.goto('/tree?node=1001');
  await waitTree(page);
  // Esc 的監聽器掛在 #canvas-host 上（canvas-tree.ts），而隱形節點按鈕是 host 的子節點，
  // 所以從按鈕上按 Esc 會冒泡過去——這正是真人用鍵盤操作時的路徑。
  await page.locator('.tree-a11y-node[data-id="1001"]').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('#detail')).toBeHidden();
  expect((await treeState(page)).selected).toBeNull();
});

test('鍵盤可聚焦並以 Enter 選取節點', async ({ page }) => {
  await page.goto('/tree');
  await waitTree(page);
  // 焦點框畫在 canvas 上、不是按鈕上（見 a11y.ts），所以「聚焦成功」的證據是 state().focus，
  // 不是掃像素找金邊。
  await page.locator('.tree-a11y-node[data-id="1001"]').focus();
  await expect.poll(async () => (await treeState(page)).focus).toBe('1001');
  await page.keyboard.press('Enter');
  await expect(page.locator('#detail h2')).toHaveText('火骰子');
  expect((await treeState(page)).selected).toBe('1001');
});

test('手機版預設聚焦單一分支且有分支 chip', async ({ page, isMobile }) => {
  test.skip(!isMobile, '僅手機版');
  await page.goto('/tree');
  await waitTree(page);
  await expect(page.locator('#branch-chips button')).toHaveCount(5);

  // brief 原文只斷言分支 chip 數量，這件事光靠 tree.astro 的靜態 markup 就會恆成立，就算
  // jumpToBranch()／minReadableScale() 被整個刪掉、手機版退化成跟桌機版一樣顯示全部 5 個
  // 分支，這一行斷言依然會通過。額外補上：手機版初始縮放應該明顯大於「整棵樹全貌」的 1x，
  // 這才是「真的聚焦到單一分支」的直接證據。`__tree.scale()` 的語意跟舊版 #viewport 的
  // CSS transform scale 完全相同（1 ＝ 全貌，見 view.ts）。
  expect(await treeScale(page)).toBeGreaterThan(1.5);
});

/**
 * 一顆節點的祖先聯集（去重、含自身、多重前置視為 AND），排序後回傳。
 *
 * ⚠️ `bypassPrereq` 的節點（貪婪 5006／空虛 5008 可直接領）走到就停止往上追——這跟
 * `src/lib/selection.ts` 的 `prerequisiteChain()` 是同一條規則。這裡刻意在測試端**重算**
 * 而不是 import 產品程式：測試要問的是「畫布拿到的 chain 對不對」，拿同一份實作互相印證
 * 等於什麼都沒驗。
 */
function ancestorChain(id: string): string[] {
  const parents = new Map<string, string[]>();
  for (const [from, to] of treeData.edges) parents.set(to, [...(parents.get(to) ?? []), from]);
  const bypass = new Set(treeData.nodes.filter(n => n.bypassPrereq).map(n => n.id));
  const seen = new Set<string>();
  const walk = (cur: string): void => {
    if (seen.has(cur)) return;
    seen.add(cur);
    if (bypass.has(cur)) return;                    // 直接領：不必再往上追前置
    for (const p of parents.get(cur) ?? []) walk(p);
  };
  walk(id);
  return [...seen].sort();
}

/**
 * 目前一個使用者座標單位攤到幾個裝置像素——高解析升級的真正判準（見 src/lib/canvas/view.ts
 * 的 `effectiveDevicePx`）。
 *
 * canvas 版改成 `min(host寬/viewBox寬, host高/viewBox高) × scale() × dpr`：`#canvas-host`
 * 是真的 DOM（不是畫布內容），量它的盒子沒有問題，縮放則問 `__tree.scale()`。
 */
async function devicePxPerUnit(page: Page): Promise<number> {
  const vb = treeData.meta.viewBox;
  return page.evaluate(([vbw, vbh]) => {
    const r = document.getElementById('canvas-host')!.getBoundingClientRect();
    return Math.min(r.width / vbw!, r.height / vbh!) * window.__tree.scale() * window.devicePixelRatio;
  }, [vb[2], vb[3]]);
}

/**
 * 畫布目前位置的指紋——拿來斷言「畫布動了沒」。
 *
 * 舊版讀 `#viewport` 的 CSS transform 字串；canvas 版沒有那個元素，改用一顆固定節點的
 * 螢幕矩形（平移會動 left/top、縮放會動 width），語意完全相同而且更直接。
 */
async function canvasFingerprint(page: Page): Promise<string> {
  const r = await nodeRect(page, '1001');
  return `${r.left.toFixed(1)},${r.top.toFixed(1)},${r.width.toFixed(2)}`;
}

test('首屏資產體積在預算內', async ({ page }) => {
  // ⚠️ 舊版是假綠的（review 報告 C06）：`page.on('response', async r => …)` 的回呼是
  // async，Playwright 不會 await 它，`await r.allHeaders()` 還沒回來 goto 就結束了——
  // 同一頁重跑量到 196KB～646KB 不等。而且靠 content-length，壓縮回應根本沒有這個標頭。
  //
  // 改成在頁面端讀 Resource Timing：transferSize 是實際過網路的位元組（含標頭、已壓縮），
  // 快取命中時是 0，所以退回 encodedBodySize 當下限。這是瀏覽器自己記的帳，不會漏。
  await page.goto('/tree', { waitUntil: 'networkidle' });
  // ⚠️ 首屏的高解析升級排在 requestIdleCallback（timeout 1000ms）裡，networkidle 會在它
  // 開火之前就滿足。不等這一段的話，這個測試量到的永遠是「還沒開始抓圖示」的快照——
  // 把門檻改回舊版的 `vp.scale <= 1`（桌機會白抓 213 張）它一樣是綠的，等於什麼都沒守。
  await page.waitForTimeout(1500);
  await page.waitForLoadState('networkidle');
  const m = await page.evaluate(() => {
    const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    const counted = entries.filter(e =>
      e.name.includes('/assets/') || e.name.endsWith('.js') || e.name.endsWith('.css'));
    return {
      bytes: counted.reduce((a, e) => a + (e.transferSize || e.encodedBodySize || 0), 0),
      iconRequests: entries.filter(e => e.name.includes('/assets/icons/')).length,
      names: counted.map(e => e.name.split('/').pop()).slice(0, 5),
    };
  });
  // 請求數：這條守的是「不需要 2× 素材時，一張都不該抓」——修正前桌機（每單位 0.52 裝置
  // 像素）無條件抓 213 張高解析圖示約 500KB，純屬浪費。
  const devicePx = await devicePxPerUnit(page);
  if (devicePx <= 1.2) {
    expect(m.iconRequests, `每單位 ${devicePx.toFixed(2)} 裝置像素，sprite 已足夠，不該抓個別圖示`).toBe(0);
    expect(m.bytes, `首屏資產 ${(m.bytes / 1024).toFixed(1)}KB（前幾項：${m.names.join(', ')}）`)
      .toBeLessThan(500 * 1024);
    return;
  }

  // 高 DPI 這一半守的是「只抓看得見的那幾十張」。**張數與位元組要一起釘**：只釘位元組的話，
  // 「整棵樹 240 張都抓、但剛好還在預算內」也會是綠的，而那正是 Task 12 抓到、Task 12b 修掉的
  // 退步（painter 的 `drawNodeImage()` 走懶載入口 `assets.hires()`，畫一幀＝把 240 張 2× WebP
  // 全要下來，`updateLod()` 依 `visibleWorldRect()` 挑的預載完全被架空；Pixel 7 實測 240 張／
  // 779.5KB，SVG 版是 68 張／500KB 內）。修法是 painter 只查 `loadedHires()`、不觸發載入。
  //
  // 門檻的由來：Pixel 7（dpr 2.625、初始分支聚焦）修好後實測 70 張／358.4KB——70 就是首屏
  // 視錐內的節點數。上限取 110 張留餘裕（版面或初始縮放小幅變動不該紅），位元組收回 500KB。
  // ⚠️ 坑記（Ruling X，2026-09-06）：`updateLod()` 的視錐**刻意只用純視口、不含位圖那一圈
  // 邊距**。含進去看起來比較「一致」（位圖畫的就是含邊距那一塊），但實測會變成
  // 120 張／479.4KB，離這裡的 500KB 只剩 20KB 餘裕——首屏位元組是使用者可感的指標，而邊距
  // 那一圈的低解析會自癒（拖進視野、手勢結束補畫那一幀就升級）。不要「順手改成含邊距」。
  expect(m.iconRequests, `每單位 ${devicePx.toFixed(2)} 裝置像素，只該抓視錐內的那幾十張`)
    .toBeLessThan(110);
  expect(m.bytes, `首屏資產 ${(m.bytes / 1024).toFixed(1)}KB（前幾項：${m.names.join(', ')}）`)
    .toBeLessThan(500 * 1024);
});

// ---------------------------------------------------------------------------
// A–J：yuki 追加的「這個網站真的能用」證據，以及四個 bug 的修正驗證
// ---------------------------------------------------------------------------

test('B. 縮放錨點跟手：滾輪縮放後，節點維持在同一螢幕座標', async ({ page, isMobile }) => {
  await goToNatureBranch(page, isMobile);
  await bringIntoView(page, '1002');
  const r0 = await nodeRect(page, '1002');
  const before = { x: r0.left + r0.width / 2, y: r0.top + r0.height / 2 };

  await zoomInAt(page, before, 5);

  const after = await nodeCenter(page, '1002'); // 縮放後重新即時算一次，不是快取舊值
  // 錨點不變性：zoomAt 應該讓游標下的內容縮放前後對到同一個螢幕座標，不會整個畫面
  // 往錨點的反方向飄走（view.ts 的 tx/ty 位移換算如果漏算就會在這裡露餡）。
  expect(Math.abs(after.x - before.x)).toBeLessThan(2);
  expect(Math.abs(after.y - before.y)).toBeLessThan(2);
  // 前提：真的縮放了。少了這條，「錨點沒動」也可能只是因為滾輪整個沒生效。
  const r1 = await nodeRect(page, '1002');
  expect(r1.width, '滾輪應該真的把畫面放大了').toBeGreaterThan(r0.width * 1.2);
});

test('D. 拖曳畫布放開在空白處，選取不會被誤觸清除', async ({ page }) => {
  await page.goto('/tree');
  await waitTree(page);
  await clickNode(page, '1001');
  await expect(page.locator('#detail h2')).toHaveText('火骰子');
  expect((await treeState(page)).chain).toContain('1001');

  // 起訖點都要落在畫布的空白處：不能碰到工具列、分支導覽，也不能碰到選取後才出現的
  // #detail（面板疊在畫布之上，事件根本不會傳到 canvas）。桌機的卡片是水平置中的，
  // 所以安全區必須當場算——寫死「畫布左半部」是舊版踩過的假綠（拖曳全程打在卡片上，
  // 而測試只斷言「選取還在」，於是安靜地通過卻什麼都沒測到）。
  const z = await safeZone(page);
  const startX = z.left + (z.right - z.left) * 0.3;
  const endX = z.left + (z.right - z.left) * 0.7;
  const startY = z.top + (z.bottom - z.top) * 0.75;
  const endY = z.top + (z.bottom - z.top) * 0.35;

  // 前提斷言：拖曳必須真的讓畫布動了。少了這條，只要起訖點落在任何攔截事件的元素上，
  // 下面「選取沒被清掉」就會在「根本沒發生拖曳」的情況下自動成立（假綠）。
  const before = await canvasFingerprint(page);

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // 拖曳門檻是 5px（DRAG_PX），中間切成多步、確保 pointermove 有機會連續觸發，
  // 累積位移遠超過門檻。
  await page.mouse.move((startX + endX) / 2, (startY + endY) / 2, { steps: 10 });
  await page.mouse.move(endX, endY, { steps: 10 });
  await page.mouse.up();

  await expect.poll(() => canvasFingerprint(page)).not.toBe(before);

  // 拖曳放開後，選取（面板 ＋ 前置鏈高亮）應該原封不動地留著，不會被這次「其實是拖曳、
  // 不是點選」的 pointerup 誤判成點在空白處而清空選取。
  await expect(page.locator('#detail')).toBeVisible();
  await expect(page.locator('#detail h2')).toHaveText('火骰子');
  const st = await treeState(page);
  expect(st.selected).toBe('1001');
  expect(st.chain).toContain('1001');
});

test('E. 搜尋框 focus 時，方向鍵不會誤觸畫布平移', async ({ page }) => {
  await page.goto('/tree');
  await waitTree(page);
  const before = await canvasFingerprint(page);

  await page.click('#search');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowDown');

  const afterSearchFocused = await canvasFingerprint(page);
  expect(afterSearchFocused).toBe(before);

  // 正對照組（code review 建議補上）：只斷言「搜尋框 focus 時方向鍵不平移」沒辦法分辨
  // 「isTypingTarget() 正確放行」跟「方向鍵平移功能整個壞掉、不管焦點在哪都不會動」——
  // 兩種情況這個測試都會通過。這裡額外確認焦點回到節點按鈕（不是任何表單元件）時，
  // 方向鍵確實還是會平移，證明上面的「不變」是 isTypingTarget() 真的生效。
  await page.locator('.tree-a11y-node').first().focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => canvasFingerprint(page)).not.toBe(afterSearchFocused);
});

/**
 * 等畫面真的定下來再拍：字型載完、置中平移跑完、卡片不再動。
 *
 * ⚠️ 字型一定要等——`document.fonts.status` 還是 `loading` 時標籤是用退路字型排的，
 * 那一版跟載完之後的版面差好幾個像素，快照會在「字型剛好載完了沒」上擲骰子。
 *
 * ⚠️ `#detail` 的矩形也要等它停——它是快照的 mask 之一，而 mask 是**把那塊塗掉**：
 * 卡片位置差 1px，被塗掉的邊界就跟著移 1px，露出來的畫布多一條或少一條。實測
 * （2026-09-06，maxDiffPixelRatio 設 0 逐次量）`tree-selected-5201` 因此在
 * 66～171 個像素之間跳動，而 `tree-default`（沒有卡片）逐位元組穩定。
 * 卡片是選取後由 `centerOnSelected()` 的緩動平移帶過去的，`schedulePositionPanel()`
 * 又排在 rAF 上，所以固定睡幾百毫秒不保險——改成盯住它的矩形連續 5 格都沒變。
 *
 * 最後的 400ms 是留給高解析圖示：`toHaveScreenshot` 本身會等到連續兩張一模一樣才比對，
 * 所以這裡不必也不該寫成「等到某個確切張數」，只要別在第一張就開拍即可。
 */
async function settleCanvas(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean(window.__tree) && document.fonts.status === 'loaded');
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const panel = document.getElementById('detail') as HTMLElement;
    let prev = '';
    let same = 0;
    // 3 秒上限用 setTimeout 而不是在 rAF 裡數：分頁被切到背景時 rAF 不派發，
    // 寫在迴圈裡的上限永遠不會被檢查，測試會卡到 Playwright 的逾時。
    // ⚠️ 逾時要 **reject**，不可以靜靜 resolve（2026-09-06 最終審查 m13）：卡片永遠不穩時
    // 靜默放棄等於帶著一張抖動中的畫面去比快照，症狀是「偶發的快照紅」而看不出成因——
    // 那是最貴的一種紅。丟出去 Playwright 會直接指名是這裡等不到穩定。
    let stopped = false;
    const cap = setTimeout(() => {
      stopped = true;
      reject(new Error(`settleCanvas：3 秒內 #detail 的矩形仍未連續 5 格不變（最後一格 ${prev || 'n/a'}），畫面還在動，不比快照`));
    }, 3000);
    const tick = (): void => {
      if (stopped) return;
      const r = panel.hidden ? null : panel.getBoundingClientRect();
      const key = r ? `${r.top.toFixed(1)},${r.left.toFixed(1)},${r.height.toFixed(1)}` : 'hidden';
      same = key === prev ? same + 1 : 0;
      prev = key;
      if (same >= 5) { clearTimeout(cap); return resolve(); }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
  await page.waitForTimeout(400);
}

test('F. 畫布快照：預設／選取／篩選／縮放四種狀態都畫得對', async ({ page }, testInfo) => {
  // ⚠️ 只在 desktop project 跑。手機版 project 是 Pixel 7（dpr 2.625），同一張快照在兩個
  // project 之間本來就不可能一致，而 Playwright 會各存一份——等於同一件事維護兩份會漂的
  // 基準圖，第二份沒有人在看。畫面對不對這件事一個視窗尺寸驗得完。
  test.skip(testInfo.project.name !== 'desktop', '快照只在 desktop project 維護一份基準圖');
  // ⚠️ 只在 Playwright 官方容器裡比（CI 的 e2e-shard 就是那個容器；本機用 `npm run e2e:snapshots`）。
  // 點陣圖比對吃字型：同一份 dist 在這台開發機（33 套 CJK 字型）與 ubuntu-latest 裸 runner 上，
  // 241 顆節點的標籤全部不一樣（2026-09-06 PR #65 第一次 CI：10,973 px 紅）。基準圖只有在跟
  // 產生它的環境一模一樣時才有意義，所以裸機上一律跳過，而不是放寬容差。
  test.skip(!process.env.CI && !process.env.E2E_SNAPSHOTS, '快照只在 Playwright 官方容器內比對（npm run e2e:snapshots）');

  // 這四張是 canvas 版**唯一**能表達「畫出來的東西對不對」的方式：節點的位置、圖示、
  // 標籤、邊、前置鏈金光、篩選淡出全部畫在同一張點陣圖上，沒有任何 DOM 可以問。
  //
  // 拍的是 `#canvas-host`（真的 DOM 容器）而不是整頁。⚠️ 工具列、分支側欄與詳情卡片是
  // `fixed`／`absolute` 疊在畫布上的，元素截圖會**連同它們一起拍進來**，所以要 mask 掉：
  // 那三塊各自有專屬測試（O／O2／P／N 系列），而 `#detail` 上印著節點描述與成本——
  // 社群改一句文案就會讓四張基準圖全紅，而畫布上一個像素都沒變。mask 會把那幾塊塗成
  // 純色，代價是那幾塊底下的畫布也看不到；那是划算的交換（左上角本來就被 chrome 蓋著）。
  const host = page.locator('#canvas-host');
  const chrome = { mask: [page.locator('#toolbar'), page.locator('#branch-nav'), page.locator('#detail')] };

  // (1) 預設視角：整棵樹全貌，沒有選取、沒有篩選。
  await page.goto('/tree');
  await settleCanvas(page);
  await expect(host).toHaveScreenshot('tree-default.png', chrome);

  // (2) 選取 5201：前置鏈上的節點與邊染成金色，鏈外的壓暗。
  await page.goto('/tree?node=5201');
  await settleCanvas(page);
  await expect(host).toHaveScreenshot('tree-selected-5201.png', chrome);

  // (3) 分支篩選：只留自然系，其餘 200 多顆淡出（不是隱藏——淡出在傳達「它還在那裡」）。
  await page.goto('/tree?branch=nature');
  await settleCanvas(page);
  expect((await treeState(page)).filteredOut.length, '前提：篩選真的生效了').toBeGreaterThan(100);
  await expect(host).toHaveScreenshot('tree-filtered-nature.png', chrome);

  // (4) 放大：拉到會觸發高解析圖示與 drop-shadow 的倍率，守 LOD 那一段的畫面。
  await page.goto('/tree');
  await settleCanvas(page);
  await bringIntoView(page, '1001');
  await zoomInAt(page, await nodeCenter(page, '1001'), 5);
  expect(await treeScale(page), '前提：真的放大了').toBeGreaterThan(2);
  await settleCanvas(page);
  await expect(host).toHaveScreenshot('tree-zoomed-1001.png', chrome);
});

test('J. 手機版篩選抽屜：展開後不蓋住工具列，而且關得掉', async ({ page, isMobile }) => {
  test.skip(!isMobile, '僅手機版：篩選抽屜只在手機版存在');
  await page.goto('/tree');

  const filters = page.locator('#filters');
  const toggle = page.locator('#filters-toggle');
  const search = page.locator('#search');

  // 收起狀態：整個不存在於版面上（display:none）。這同時解掉「看不見卻仍可 Tab 聚焦、
  // 螢幕閱讀器仍唸得到」的問題——舊版是 transform 移出畫面，元素還在。
  await expect(filters).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#filters input[type=checkbox]').first()).toBeHidden();

  await toggle.click();
  await expect(filters).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  // 核心斷言：抽屜與工具列上的兩個東西都不相交。
  // 舊 bug 是 `#filters.open { transform: translateY(var(--nav-h)) }` 跟
  // `#tree-controls { top: var(--nav-h) }` 用同一個基準，抽屜從工具列**頭上**開始蓋，
  // 把搜尋框和切換鈕自己都蓋住（實測 Pixel 7：抽屜 50.59–119.66、切換鈕 58.59–97.38）。
  const [f, t, se] = await Promise.all([filters.boundingBox(), toggle.boundingBox(), search.boundingBox()]);
  if (!f || !t || !se) throw new Error('取不到 bounding box');
  const disjoint = (a: typeof f, b: typeof f) =>
    a.x + a.width <= b.x + 0.5 || b.x + b.width <= a.x + 0.5 ||
    a.y + a.height <= b.y + 0.5 || b.y + b.height <= a.y + 0.5;
  expect(disjoint(f, t), '抽屜不可與切換鈕相交').toBe(true);
  expect(disjoint(f, se), '抽屜不可與搜尋框相交').toBe(true);

  // 切換鈕真的點得到（矩形不相交還不夠——中間可能隔著別的透明疊層）。
  const hit = await page.evaluate(() => {
    const r = document.querySelector('#filters-toggle')!.getBoundingClientRect();
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.id ?? null;
  });
  expect(hit).toBe('filters-toggle');

  // 關得掉：再點一次（Playwright 的 actionability 檢查本身就會抓到「被蓋住」）。
  await toggle.click();
  await expect(filters).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  // Esc 也是出路。
  await toggle.click();
  await expect(filters).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(filters).toBeHidden();
});

test('U. 畫布頁不該捲動：畫布剛好填滿 nav 與 footer 之間', async ({ page }) => {
  // 舊 bug：`#canvas-host { height: calc(100vh - 110px) }`，而 nav ＋ footer 實測是
  // 124.53（桌機）／165.47（手機），每個尺寸多出 15–55px 的捲動；捲到底時 fixed 的
  // #tree-controls 會跟 nav 之間裂開一條縫。這是「寫死版面偏移量」在這個 repo 的第四次。
  for (const [w, h] of [[390, 844], [768, 1024], [1280, 720]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto('/tree');
    await waitTree(page);

    const m = await page.evaluate(() => {
      const nav = document.querySelector('#site-nav')!.getBoundingClientRect();
      const ctl = document.querySelector('#tree-controls')!.getBoundingClientRect();
      const host = document.querySelector('#canvas-host')!.getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollHeight - window.innerHeight,
        gap: ctl.top - nav.bottom,
        hostWidth: host.width,
        hostHeight: host.height,
      };
    });
    expect(m.overflow, `${w}x${h} 不該捲得動`).toBeLessThanOrEqual(0);
    expect(Math.abs(m.gap), `${w}x${h} 工具列要貼齊 nav 下緣`).toBeLessThan(0.5);
    // 順帶釘住「畫布真的有填滿」：SVG 有內建長寬比，用百分比高度會縮成 300px 寬（實測）。
    expect(m.hostWidth, `${w}x${h} 畫布寬度`).toBeCloseTo(w, 0);
    expect(m.hostHeight, `${w}x${h} 畫布高度`).toBeGreaterThan(h * 0.5);
  }
});

test('V. 窄桌機視窗下詳情卡片不壓在分支側欄上，也不被推出畫面', async ({ page, isMobile }) => {
  test.skip(isMobile, '僅桌機版：#branch-nav 側欄在手機版是 display:none');
  // 舊 bug：positionPanel() 只避 #toolbar 不避 #branch-nav，760px 寬時卡片被夾到 left=12，
  // 正好壓在側欄按鈕上並攔截點擊（實測 #detail 12–364、#branch-nav 0–79.19，垂直也相交）。
  // 修法量的是 #branch-nav 本身，不是它的父層 #tree-controls——後者的盒子會撐到最寬子元素
  // 的寬度，右邊一大片是 pointer-events:none 的透明空白，拿它當障礙物會把卡片推出畫面
  // （實測 1280 寬下 left 被推到 1001、右緣 1353）。
  for (const [w, h] of [[760, 800], [1280, 720]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto('/tree?node=1001');
    await waitTree(page);
    await expect(page.locator('#detail')).toBeVisible();

    const m = await page.evaluate(() => {
      const d = document.querySelector('#detail')!.getBoundingClientRect();
      const b = document.querySelector('#branch-nav')!.getBoundingClientRect();
      return {
        intersects: d.left < b.right && d.right > b.left && d.top < b.bottom && d.bottom > b.top,
        left: d.left, right: d.right,
      };
    });
    expect(m.intersects, `${w}x${h} 詳情卡片不可與分支側欄相交`).toBe(false);
    expect(m.left, `${w}x${h} 卡片左緣不可跑出畫面`).toBeGreaterThanOrEqual(0);
    expect(m.right, `${w}x${h} 卡片右緣不可跑出畫面`).toBeLessThanOrEqual(w);
  }
});

test('W. 手機版 footer 的著作權聲明不被底部分支 chip 蓋住', async ({ page, isMobile }) => {
  test.skip(!isMobile, '僅手機版：#branch-chips 只在手機版存在');
  // 頁面改成不捲動之後，fixed 的 chip 列會永遠疊在 footer 上緣，而 footer 第二行是
  // 「遊戲圖示與文字著作權屬 111 Percent Inc.」——手機上會完全讀不到，而且沒有捲動可以
  // 把它露出來。修法是讓 footer 留一段等於 chip 列實際高度（--chips-h，量出來的）的下內距。
  await page.goto('/tree');
  await waitTree(page);

  const m = await page.evaluate(() => {
    const footer = document.querySelector('footer')!;
    // 量的是「文字實際佔的範圍」不是 footer 的盒子——盒子本來就會延伸到 chip 列底下，
    // 那正是讓位用的內距。
    const range = document.createRange();
    range.selectNodeContents(footer);
    const text = range.getBoundingClientRect();
    const chips = document.querySelector('#branch-chips')!.getBoundingClientRect();
    return {
      textBottom: text.bottom,
      chipsTop: chips.top,
      overflow: document.documentElement.scrollHeight - window.innerHeight,
      hasCopyright: /111 Percent/.test(footer.textContent ?? ''),
    };
  });

  expect(m.hasCopyright, 'footer 應該有著作權聲明').toBe(true);
  expect(m.textBottom, 'footer 文字底緣不可落到 chip 列裡').toBeLessThanOrEqual(m.chipsTop);
  // 讓位不可以把捲軸叫回來（main 是 flex: 1，footer 變高應該是畫布縮，不是頁面變長）。
  expect(m.overflow, '讓位之後仍不該捲得動').toBeLessThanOrEqual(0);
});

test('K. 手機版詳情面板的重置警告不被底部分支 chip 蓋住（spec §2.1 強制要求的災情警告）', async ({ page, isMobile }) => {
  test.skip(!isMobile, '僅手機版：#branch-chips 疊在 #detail 底部的重疊問題只在手機版存在（桌機沒有 #branch-chips）');
  await page.goto('/tree?node=1001');
  // renderDetail()（NodeDetail.ts）固定把「骰子樹重置需要初期化券…」這段警告放在 #detail
  // 內容的最後一段，用文字內容鎖定它，不是靠結構順序猜。
  // 先驗「面板方框」本身：不管內容多長、使用者捲到哪裡，#detail 的可視範圍都不該伸進
  // chip 列。2026-08-19 面板變長（關鍵字解釋／骰子覺醒／練滿花費）時就是先在這裡破的——
  // 舊做法靠 padding-bottom 把最後一段推上來，只有「已經捲到底」才成立，而預設 scrollTop=0。
  const panelBox = await page.locator('#detail').boundingBox();
  const chipsTop = (await page.locator('#branch-chips').boundingBox())!.y;
  if (!panelBox) throw new Error('缺少 bounding box');
  expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(chipsTop + 1);

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

test('N. 選節點時鏡頭置中、卡片貼在節點上方或下方，不擋工具列，畫布平移時跟著走', async ({ page, isMobile }) => {
  test.skip(isMobile, '僅桌機：手機版 #detail 是從底部升起的抽屜，沒有「節點旁邊」這種空間');
  // 2026-08-23 改版：卡片從「貼在節點左右兩側」改成「節點平移置中 ＋ 卡片貼在節點上方或
  // 下方」。左右兩側正是前置鏈延伸出去的方向，卡片開在那裡會把剛剛高亮起來的鏈整條蓋掉
  // （見 N2）。這條守的是新版面的三個形狀：置中、垂直緊鄰、水平中心對齊。
  await page.goto('/tree?node=1002');
  await waitTree(page);
  const panel = page.locator('#detail');
  await expect(panel).toBeVisible();

  // ⚠️ 一定要 poll：置中是一段約 200ms 的緩動平移，goto 回來的當下它多半還在跑，
  // 直接量會量到半路的位置（實測會落在目標左邊一兩百 px）。
  // ⚠️ 節點的位置一律問 `__tree.nodeScreenRect()`——canvas 裡沒有元素可以量 bounding box。
  await expect.poll(() => centerOffset(page, '1002'),
    { message: '節點應該被平移到畫面水平中央' }).toBeLessThanOrEqual(2);

  const p1 = (await panel.boundingBox())!;
  const n1 = await nodeRect(page, '1002');
  const toolbar = (await page.locator('#toolbar').boundingBox())!;

  // 垂直緊鄰：卡片下緣貼節點上緣，或卡片上緣貼節點下緣（哪一邊由前置鏈決定，見 N2）。
  const gapAbove = n1.top - (p1.y + p1.height);
  const gapBelow = p1.y - (n1.top + n1.height);
  expect(Math.max(gapAbove, gapBelow)).toBeGreaterThanOrEqual(0);
  expect(Math.max(gapAbove, gapBelow)).toBeLessThan(20);
  // 水平中心對齊節點中心
  expect(Math.abs((p1.x + p1.width / 2) - (n1.left + n1.width / 2))).toBeLessThan(2);
  // 不擋工具列
  expect(p1.y).toBeGreaterThanOrEqual(toolbar.y + toolbar.height - 1);

  // 平移畫布後要跟著節點跑——卡片留在原地的話，它就指著一個已經不在那裡的節點了。
  // ⚠️ 起點挑畫布左半邊的空白處：卡片現在置中（1280 寬時大約佔 x 464–816），從它身上起手
  // 等於在拖卡片、畫布不會動，測試會變成「前提不成立」的假紅。
  // 這一下拖曳同時也驗了「使用者一碰畫布就中止置中平移」——沒中止的話兩股力量會互相拉扯，
  // 下面「與節點的相對位置維持不變」那條會抖出誤差。
  await page.mouse.move(200, 600);
  await page.mouse.down();
  await page.mouse.move(80, 600, { steps: 8 });
  await page.mouse.up();
  const p2 = (await panel.boundingBox())!;
  const n2 = await nodeRect(page, '1002');
  expect(n2.left).toBeLessThan(n1.left - 40); // 前提：畫布真的移動了
  expect(p2.x).toBeLessThan(p1.x - 40);
  expect(Math.abs((p2.x - n2.left) - (p1.x - n1.left))).toBeLessThan(4); // 與節點的相對位置維持不變

  // 從畫布上直接點一顆節點也要置中。
  // ⚠️ 這一段不是重複：`?node=` 進站與畫布點擊是**兩條不同的程式路徑**（前者由模組初始化
  // 尾端補一次 centerOnSelected()，後者走 openNode()）。上面那組只驗得到前者——實測把
  // openNode() 裡的 centerOnSelected() 整行刪掉，這條測試在補上這一段之前仍然全綠。
  await page.goto('/tree');
  await waitTree(page);
  // ⚠️ 挑 4112（x=100，整棵樹最左邊那一顆）不挑 1001：1001 在 viewBox 正中央（x=1000），
  // 桌機預設視角本來就把它擺在畫面中線上，拿它當受測對象的話「有沒有置中」根本量不出差別
  // ——實測把 centerOnSelected() 刪掉，用 1001 的版本仍然全綠。
  await clickNode(page, '4112');
  await expect(page.locator('#detail')).toBeVisible();
  await expect.poll(() => centerOffset(page, '4112'),
    { message: '在畫布上點節點，鏡頭也要把它帶到畫面水平中央' }).toBeLessThanOrEqual(2);
});

/**
 * N2. 這一整輪改動存在的理由：卡片不可以蓋住剛剛高亮起來的前置鏈。
 *
 * Yuki 2026-08-23 回報：桌機點開骰子資訊時，卡片跟前置鏈都跑到節點右邊，卡片把鏈整條蓋掉。
 * 全站掃過 239 顆節點的實測數字（1440×900）：
 *   舊版（卡片貼節點左右）        152 顆節點的前置鏈被蓋，被蓋節點共 749 個，單顆最慘 14/15
 *   只固定放上方                  155 顆                                     單顆最慘 13/14
 *   置中 ＋ 上下擇一（現在這版）   44 顆                       共 69 個      單顆最慘  5/14
 * 「只固定放上方」沒有比較好，因為 2／3 系是**往下長**的，深層節點的前置鏈整條在節點上方。
 * 所以擺法必須是算出來的（tree-canvas.ts 的 sideLeastCovered()），不是寫死一邊。
 *
 * 這裡挑四顆舊版最慘的節點釘死在 0，四個生長方向各一顆：4 系往左、2 系往下、5 系往右、
 * 以及往左長但深度中等的 4112。
 * ⚠️ 剩下那 44 顆不是漏掉：分支是扇形展開的，5401／5301／4113 這些節點的前置鏈上下都有，
 * 沒有任何一側能全避開。這條測試守的是「該歸零的有歸零」，不是「全站零遮擋」。
 */
test('N2. 詳情卡片不蓋住前置鏈（這一輪改動的驗收）', async ({ page, isMobile }) => {
  test.skip(isMobile, '僅桌機：手機版卡片是底部抽屜，本來就不疊在節點上');
  for (const [id, wasCovered] of [['2304', 14], ['2113', 13], ['5113', 12], ['4112', 7]] as const) {
    await page.goto(`/tree?node=${id}`);
    await waitTree(page);
    await expect(page.locator('#detail')).toBeVisible();
    // poll 的理由同 N：置中平移還在跑的時候量到的是半路的位置。
    // 鏈上有哪些節點問 `state().chain`、它們在哪問 `nodeScreenRect()`；卡片仍然是真的
    // DOM，照舊量 getBoundingClientRect()。整段在頁面內做，才不會被 Playwright 往返的
    // 10–20ms 拆成兩個不同時間點的畫面。
    await expect.poll(async () => page.evaluate((nid) => {
      const t = window.__tree;
      const p = document.getElementById('detail')!.getBoundingClientRect();
      const self = t.nodeScreenRect(nid);
      if (!self) return -1;
      const centered = Math.abs((self.left + self.width / 2) - window.innerWidth / 2) < 2;
      // 還沒平移到定位就回一個不可能通過的值，讓 poll 繼續等而不是量到半路的畫面。
      if (!centered) return -1;
      const covered = t.state().chain
        .map(cid => t.nodeScreenRect(cid))
        .filter((c): c is NonNullable<typeof c> => c !== null)
        .filter(c => Math.max(0, Math.min(p.right, c.left + c.width) - Math.max(p.left, c.left))
          * Math.max(0, Math.min(p.bottom, c.top + c.height) - Math.max(p.top, c.top)) > 0);
      return covered.length;
    }, id), { message: `節點 ${id}（舊版被蓋 ${wasCovered} 個）的前置鏈不該被卡片蓋到` })
      .toBe(0);
    // 前提斷言：前置鏈真的有東西可以被蓋。少了它，資料改動讓 chain 變成 1 個（只有自己）時
    // 上面會自動成立——這個 repo 已經因為「防線其實沒在防」踩過好幾次（見 CLAUDE.md 規則 4）。
    expect((await treeState(page)).chain.length).toBeGreaterThan(1);
  }
});

/**
 * N3. 置中平移期間卡片不可以動（Yuki 2026-08-23 回報「移動的動畫會閃爍」）。
 *
 * 兩個成因疊在一起，各修一半：
 * 1. `schedulePositionPanel()` 原本是 `cancelAnimationFrame()` ＋ 重排。平移每一幀都寫
 *    `#viewport` 的 style，於是排好的重新定位回呼**永遠在執行前就被取消**——卡片整段動畫
 *    完全不動，最後一幀才瞬移到位（實測水平錯位一路拉到 450px）。改成「已經排了就不再排」。
 * 2. 就算跟得上，動畫途中節點還在畫面上緣附近，卡片會被 top 的夾制壓在工具列下方、
 *    跟節點重疊，等節點降下來才彈回貼齊（實測垂直間距 −50px → +12px）。
 *    所以現在改成**卡片一開始就定在終點**、整段動畫只有畫布在走。
 *
 * 這條測試量的是「卡片自己在動畫全程出現過幾個位置」——1 個才對。
 * ⚠️ 取樣必須在頁面內用 rAF 做（同 Z4）：Playwright 往返一趟 10–20ms，量不到中間格。
 */
test('N3. 置中平移期間，卡片一次到位不跟著滑（閃爍修正）', async ({ page, isMobile }) => {
  test.skip(isMobile, '僅桌機：手機版不做置中平移，卡片是底部抽屜');
  await page.goto('/tree');
  await waitTree(page);

  await page.evaluate(() => {
    const w = window as unknown as { __p: string[]; __n: number[] };
    w.__p = [];
    w.__n = [];
    const tick = () => {
      const d = document.getElementById('detail')!;
      const n = window.__tree.nodeScreenRect('4112');
      if (!d.hidden && n) {
        const r = d.getBoundingClientRect();
        w.__p.push(`${r.left.toFixed(0)},${r.top.toFixed(0)},${r.height.toFixed(0)}`);
        w.__n.push(+(n.left + n.width / 2).toFixed(1));
      }
      if (w.__p.length < 60) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  // 挑最左邊那一顆，平移量才夠大（實測要走 468px）。挑靠中間的節點量不出差別。
  await clickNode(page, '4112');
  await page.waitForTimeout(1200);

  const { positions, nodeXs } = await page.evaluate(() => {
    const w = window as unknown as { __p: string[]; __n: number[] };
    return { positions: w.__p, nodeXs: w.__n };
  });
  // 前提斷言：畫布真的走了一大段，而且取樣有涵蓋到動畫期間。少了這兩條，卡片「沒動」
  // 也可能只是因為根本沒有動畫發生（這個 repo 的假綠已經踩過好幾次，見 CLAUDE.md 規則 4）。
  expect(positions.length).toBeGreaterThan(20);
  expect(Math.max(...nodeXs) - Math.min(...nodeXs)).toBeGreaterThan(200);

  expect([...new Set(positions)], '卡片在整段置中平移中只能有一個位置').toHaveLength(1);

  // 第二半：**每幀都改變視角**的來源不可以把卡片的重新定位餓死。
  // ⚠️ 這一段是獨立的斷言，不是重複：釘住（上面那條）之後，置中平移期間根本不會叫
  // positionPanel()，所以把 schedulePositionPanel() 改回 cancelAnimationFrame() ＋ 重排，
  // 上面那條仍然全綠（實測過）。這裡直接裝一個每幀變動的來源來打那條路徑。
  //
  // ⚠️ canvas 版沒有 `#viewport` 可以每幀重寫 style，改成**在頁面內每幀送一次
  // pointermove**（位移 8px，跟舊版每幀寫一次 transform 的量相同）：controller 收到之後
  // `view.pan()` ＋ requestRedraw，`onViewChange` 於是每幀開火，那正是 schedulePositionPanel()
  // 現在唯一的觸發來源（tree-canvas.ts 的 `tree.onViewChange`）。
  // ⚠️ 一定要在頁面內用 rAF 送：`page.mouse.move()` 一趟往返 10–20ms，pointermove 不會
  // 每幀都來（實測那樣錯位最多 12px，卡片跟得上），打不到這條路徑。
  await page.goto('/tree?node=1002');
  await waitTree(page);
  await expect(page.locator('#detail')).toBeVisible();
  await page.waitForTimeout(600);   // 等開場的置中平移跑完、卡片解除釘住
  const probe = await page.evaluate(async () => {
    const overlay = document.querySelector<HTMLElement>('#canvas-host canvas.tree-overlay')!;
    const box = overlay.getBoundingClientRect();
    // 起手點挑畫布右下角的空白處，往左拖：節點會朝畫面中線的左邊走一大段，全程留在畫面內
    // （卡片被夾在視窗邊緣時它本來就跟不動，那不是餓死）。
    const sx = box.left + box.width * 0.8, sy = box.top + box.height * 0.85;
    const send = (type: string, x: number): void => {
      overlay.dispatchEvent(new PointerEvent(type, {
        pointerId: 1, pointerType: 'mouse', isPrimary: true,
        clientX: x, clientY: sy, buttons: type === 'pointerup' ? 0 : 1,
        bubbles: true, cancelable: true,
      }));
    };
    send('pointerdown', sx);
    const xs: number[] = [];
    const out: number[] = [];
    await new Promise<void>(resolve => {
      let i = 0;
      const tick = () => {
        send('pointermove', sx - (i + 1) * 8);
        const n = window.__tree.nodeScreenRect('1002')!;
        const p = document.getElementById('detail')!.getBoundingClientRect();
        xs.push(+(n.left + n.width / 2).toFixed(1));
        out.push(+((p.left + p.width / 2) - (n.left + n.width / 2)).toFixed(1));
        if (++i < 30) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    send('pointerup', sx - 30 * 8);
    return { xs, out };
  });
  // 前提：畫布真的被推走了一大段（不然「卡片跟得上」是廢話）。
  expect(probe.out.length).toBeGreaterThan(20);
  expect(Math.max(...probe.xs) - Math.min(...probe.xs),
    '前提：每幀 pointermove 應該真的把節點推走一大段').toBeGreaterThan(200);
  // 卡片最多落後一幀（一幀 8px）。餓死的話它整段不動，錯位會一路累積到 200px 以上。
  expect(Math.max(...probe.out.map(Math.abs)),
    '每幀都改變視角時，卡片的重新定位不可以被餓死').toBeLessThan(20);
});

test('N4. 節點卡片：桌機橫式兩欄、手機單欄，重置警告跨兩欄', async ({ page, isMobile }) => {
  await page.goto('/tree?node=1001');
  await expect(page.locator('#detail')).toBeVisible();
  await page.waitForTimeout(400); // 置中平移跑完再量

  const m = await page.evaluate(() => {
    const r = (el: Element) => el.getBoundingClientRect();
    const d = r(document.getElementById('detail')!);
    const cols = [...document.querySelectorAll('#detail .node-body > .col')].map(r);
    const warn = r(document.querySelector('#detail .reset-warn')!);
    return {
      w: d.width, h: d.height,
      tops: cols.map(c => Math.round(c.top)),
      widths: cols.map(c => c.width),
      count: cols.length,
      warnW: warn.width,
    };
  });

  // 前提：兩個欄位都在（版面之外，這也守著 NodeDetail.ts 沒有把 .col 拆掉）。
  expect(m.count).toBe(2);

  if (isMobile) {
    // 手機是全寬抽屜，分兩欄每欄只剩約 180px：維持上下排。
    expect(m.tops[0]!, '手機版兩段應該上下排').toBeLessThan(m.tops[1]!);
  } else {
    expect(m.tops[0], '桌機版兩欄應該從同一條基線開始').toEqual(m.tops[1]);
    expect(m.w, '卡片應該是橫的（寬 > 高）').toBeGreaterThan(m.h);
    // 重置警告跨兩欄：它比單獨一欄寬得多。
    expect(m.warnW).toBeGreaterThan(m.widths[1]! * 1.5);
  }
});

/** 節點中心離視窗水平中線差幾 px（四捨五入）。置中平移是動畫，量之前一律用 expect.poll。 */
async function centerOffset(page: Page, id: string): Promise<number> {
  const n = await nodeRect(page, id);
  return Math.round(Math.abs((n.left + n.width / 2) - page.viewportSize()!.width / 2));
}

/** 卡片與節點的重疊面積（px²）。0 才對——卡片不可以蓋住它正在描述的那顆節點。 */
function nodeOverlap(page: Page, id: string) {
  return page.evaluate((nid) => {
    const p = document.getElementById('detail')!.getBoundingClientRect();
    const n = window.__tree.nodeScreenRect(nid)!;   // 節點在 canvas 裡，只有查詢介面問得到
    const ox = Math.max(0, Math.min(p.right, n.left + n.width) - Math.max(p.left, n.left));
    const oy = Math.max(0, Math.min(p.bottom, n.top + n.height) - Math.max(p.top, n.top));
    return {
      overlap: +(ox * oy).toFixed(1),
      height: +p.height.toFixed(1),
      side: p.bottom <= n.top + 1 ? 'above' : 'below',
    };
  }, id);
}

/**
 * N5. 鍵盤開節點也要置中，而且置中途中按鍵不可以把平移掐掉。
 *
 * 2026-08-23 code review 抓到：`window` 的 keydown handler 在**檢查按了什麼鍵之前**就無條件
 * 呼叫 `cancelCenterPan()`。節點上按 Enter 時，svg 的 keydown 先跑 `openNode()` →
 * `animatePan()` 排好 rAF，同一個事件冒泡到 window 就把它取消——實測節點停在 x=172 而不是
 * 畫面中央 640，等於 Enter 這條路完全沒有置中。`isTypingTarget()` 只認 INPUT/TEXTAREA/SELECT，
 * 焦點在 `<g class="node">` 上不會被擋掉。同一行也會讓「點完之後 200ms 內按任何鍵」把平移
 * 掐在半路。修法是把 `cancelCenterPan()` 移進「真的是平移／縮放按鍵」那個分支。
 */
test('N5. 鍵盤 Enter 開節點也會置中，途中按其他鍵不會把平移掐掉', async ({ page, isMobile }) => {
  test.skip(isMobile, '僅桌機：手機版不做置中平移');
  await page.goto('/tree');
  await waitTree(page);

  // 焦點掛在隱形節點按鈕上（a11y.ts），Enter 走的是 onActivate → openNode 那條路。
  await page.locator('.tree-a11y-node[data-id="4112"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#detail')).toBeVisible();
  await expect.poll(() => centerOffset(page, '4112'),
    { message: 'Enter 開節點也要把鏡頭帶到畫面中央' }).toBeLessThanOrEqual(2);

  // 第二半：點開之後立刻按一個不管平移的鍵（'a' 兩邊的 handler 都不處理），平移要照樣走完。
  await page.goto('/tree');
  await waitTree(page);
  await clickNode(page, '5113');
  await page.keyboard.press('a');
  await expect.poll(() => centerOffset(page, '5113'),
    { message: '平移途中按無關的鍵不該把它掐掉' }).toBeLessThanOrEqual(2);
});

/**
 * N6. 選好節點之後在搜尋框打字，卡片會多一行——但不可以因此壓到它正在描述的那顆節點。
 *
 * 2026-08-23 code review 抓到：篩選一變，`applyFilter()` → `select()` 重畫卡片，多出
 * 「含 N 個被篩選隱藏的前置」一行（實測 279.7 → 312.2）。這條路徑**刻意不重新置中**
 * （不然每打一個字鏡頭就飛一次），而當時的高度上限是用整個視窗算的，於是卡片一長高就被
 * 下面的夾制推到節點身上——四顆抽樣節點有三顆被完全蓋住（重疊 467.6 px²）。
 * 修法有兩半：高度上限改用「卡片那一側到畫面邊緣還剩多少」算，以及置中時多留一行的餘裕
 * （CENTER_SLACK），讓這種長高吸收得掉、不必冒出捲軸。
 */
test('N6. 打字改篩選之後，卡片不壓到節點、也不跳到另一邊', async ({ page, isMobile }) => {
  test.skip(isMobile, '僅桌機：手機版卡片是底部抽屜，本來就不疊在節點上');
  for (const id of ['2113', '4112', '2304', '5113']) {
    await page.goto(`/tree?node=${id}`);
    await waitTree(page);
    await expect(page.locator('#detail')).toBeVisible();
    await expect.poll(() => centerOffset(page, id)).toBeLessThanOrEqual(2);

    const before = await nodeOverlap(page, id);
    expect(before.overlap, `${id} 打字前就不該重疊`).toBe(0);

    await page.locator('#search').fill('骰');
    await expect.poll(async () => (await nodeOverlap(page, id)).overlap,
      { message: `${id} 打字之後卡片不可以壓到節點` }).toBe(0);

    const after = await nodeOverlap(page, id);
    // 前提斷言：卡片**真的**長高了。少了它，「沒重疊」也可能是因為根本沒發生重排。
    expect(after.height, `${id} 篩選那一行應該讓卡片變高`).toBeGreaterThan(before.height);
    // 擺法不准跟著打字跳邊：sideLeastCovered() 模擬的是「置中之後」的版面，而這條路徑
    // 不會置中，重算只會算出一個不存在的版面。
    expect(after.side, `${id} 擺法不該因為打字而換邊`).toBe(before.side);
  }

  // 第二半：使用者把節點往上拖，卡片那一側的空間縮到「比整張卡片矮、但還不到換邊門檻」時，
  // 卡片必須自己變矮（內部捲動），不可以被夾制推到節點身上。
  // ⚠️ 這一段是獨立的：上面那組打字的成長量（+32.5px）已經被 CENTER_SLACK 吸收掉，
  // 所以把高度上限改回「整個視窗」算，上面那組仍然全綠（實測過）。這裡才真的打到那條路。
  await page.goto('/tree?node=4112');
  await waitTree(page);
  await expect(page.locator('#detail')).toBeVisible();
  await expect.poll(() => centerOffset(page, '4112')).toBeLessThanOrEqual(2);

  const natural = (await nodeOverlap(page, '4112')).height;
  const room = () => page.evaluate(() => {
    const n = window.__tree.nodeScreenRect('4112')!;
    const tb = document.getElementById('toolbar')!.getBoundingClientRect();
    return n.top - tb.bottom - 24; // 24 = 上下各一個 GAP
  });
  // 目標留白 240：介於 MIN_PANEL_H（200，低於它就換邊）與卡片自然高度（約 280）之間，
  // 正好是「不換邊但整張放不下」那條縫。
  const dy = Math.round(await room() - 240);
  expect(dy, '前提：一開始那一側的空間要比目標大，才有得拖').toBeGreaterThan(20);
  await page.mouse.move(200, 600);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(200, 600 - (dy * i) / 10);
  await page.mouse.up();
  await expect.poll(async () => Math.round(await room()),
    { message: '前提：畫布真的被拖上去了' }).toBeLessThanOrEqual(245);

  const dragged = await nodeOverlap(page, '4112');
  expect(dragged.overlap, '空間變小時卡片要自己變矮，不可以壓到節點').toBe(0);
  expect(dragged.height, '卡片應該被那一側的空間裁短').toBeLessThan(natural);
});

/**
 * 目前這一層視圖的標題。
 *
 * 一定要 `.last()`：換頁動畫進行中兩張視圖都還在 DOM 裡、都還沒 hidden（舊的那張要等
 * 動畫結束才收起來），不取最後一個就會撞上 strict mode violation 或讀到上一頁的標題。
 * DOM 順序就是堆疊順序，最後一個永遠是最上層——跟 tree-canvas.ts 的 topViewEl() 同一套判定。
 */
function topView(page: Page) {
  return page.locator('#detail .view:not([hidden])').last();
}
function topViewTitle(page: Page) {
  return topView(page).locator('h2');
}

test('O. 搜尋命中時鏡頭帶到結果、狀態列說明命中幾個、清除鈕能回到原狀', async ({ page }) => {
  // 這條守的是 image9 回報的死路：搜尋只命中兩三個節點時，畫面上是 236 個淡掉的節點加 243
  // 條淡掉的邊，數量壓過那幾個命中的目標，看起來就像「什麼都沒發生」；而 ?q= 不會因為點
  // 空白處而清掉（那只清 ?node=），使用者會覺得畫面卡住了、也找不到回去的路。
  await page.goto('/tree?node=4008'); // 陰陽骰子，描述裡有 #陰陽 關鍵字
  await waitTree(page);
  // 「符合 N 個節點」那句 2026-08-22 拿掉了（它夾在搜尋框與篩選鈕中間，工具列寬度會跟著
  // 篩選狀態伸縮）。現在「有沒有篩選在生效」由切換鈕上的金點講，出路是面板裡的清除鈕。
  const toggle = page.locator('#filters-toggle');
  const filters = page.locator('#filters');
  const clear = page.locator('#filter-clear');
  // 清除鈕住在面板裡，面板收起時（手機預設）看不到它——那是刻意的取捨：工具列不因篩選狀態
  // 伸縮，代價是收起時只剩切換鈕上的金點在提示。所以「看不看得到清除鈕」只在面板展開時驗。
  const idle = async () => {
    await expect(toggle).not.toHaveClass(/active/);
    if (await filters.isVisible()) await expect(clear).toBeHidden();
  };
  const filtered = async () => {
    await expect(toggle).toHaveClass(/active/);
    if (await filters.isVisible()) await expect(clear).toBeVisible();
  };
  await idle();

  // 點關鍵字是「這個詞是什麼意思」，不是「幫我搜尋」——它推出詞彙頁，網址不該多出 ?q=。
  // 搜尋是詞彙頁上另外一顆按鈕（測試 Z 驗那條路）。
  const kw = topView(page).locator('.kw').first();
  await expect(kw).toBeVisible();
  await kw.click();
  await expect(topViewTitle(page)).toHaveText('#陰陽');
  await idle();
  expect(new URL(page.url()).searchParams.get('q')).toBeNull();
  await topView(page).locator('[data-detail-back]').click();
  await expect(topViewTitle(page)).toHaveText('陰陽骰子');

  // 同一套「帶我去看結果」的流程，改從搜尋框走：打字＋Enter。
  const before = await canvasFingerprint(page);
  await page.locator('#search').fill('陰陽');
  await page.locator('#search').press('Enter');

  // 1) 篩選正在生效這件事看得出來，而且有清得掉的按鈕
  await filtered();
  // 「符合 N 個」那句畫面上拿掉了，但螢幕閱讀器不該跟著什麼都收不到——留一個 .sr-only 的
  // live region（2026-08-22 review 指出刪掉狀態列時把唯一的 live region 一起刪了）。
  await expect(page.locator('#filter-live')).toHaveText(/符合 \d+ 個節點/);

  // 2) 鏡頭真的動了（沒動的話就是「原地一片灰」那個症狀）
  await expect.poll(() => canvasFingerprint(page)).not.toBe(before);

  // 3) 命中的節點在畫面內、而且沒有被篩掉
  expect((await treeState(page)).filteredOut).not.toContain('4008');
  const box = await nodeRect(page, '4008');
  expect(box.left).toBeGreaterThan(0);
  expect(box.left).toBeLessThan(page.viewportSize()!.width);

  // 4) 清除鈕把篩選收乾淨：金點熄掉、清除鈕收起、沒有節點被篩掉、網址不再帶 q
  if (!(await filters.isVisible())) await toggle.click();
  await clear.click();
  await idle();
  await expect(page.locator('#filter-live')).toHaveText(/^顯示全部 \d+ 個節點$/);
  expect((await treeState(page)).filteredOut).toEqual([]);
  expect(new URL(page.url()).searchParams.get('q')).toBeNull();

  // 清除鈕是 `visibility: hidden`，不是 opacity: 0——看不見就不該聚焦得到。
  const focusable = await page.evaluate(() => {
    const el = document.getElementById('filter-clear')!;
    el.focus();
    return document.activeElement === el;
  });
  expect(focusable, '看不見的清除鈕仍然可以被 Tab 聚焦').toBe(false);
});

test('O2. 工具列的大小與篩選鈕的位置不隨篩選狀態改變', async ({ page, isMobile }) => {
  // Yuki 2026-08-22 回報：「符合 xx 個節點」一彈出來就把工具列撐大。實測桌機 1280 下
  // 工具列從 1037 撐到 1209px，而且狀態列夾在搜尋框與篩選鈕之間，整排篩選鈕會往右跳 171px；
  // 手機版直接多長一列（61 → 103px）。邊打字邊跳，最難用的正是這種。
  await page.goto('/tree');
  await waitTree(page);
  const toolbar = page.locator('#toolbar');
  // 手機版 #filters 收在抽屜裡、預設不顯示，沒有 bounding box 可量——那邊要守的是工具列
  // 本身不多長一列。桌機才驗「篩選鈕沒被推走」。
  const firstChip = page.locator('#filters .chip').first();
  const chipBox = async () => (isMobile ? null : (await firstChip.boundingBox())!);
  const before = { tb: (await toolbar.boundingBox())!, chip: await chipBox() };

  await page.locator('#search').fill('僵硬');
  await expect(page.locator('#filters-toggle')).toHaveClass(/active/);
  const after = { tb: (await toolbar.boundingBox())!, chip: await chipBox() };

  expect(after.tb.width, '工具列寬度被撐開了').toBeCloseTo(before.tb.width, 0);
  expect(after.tb.height, '工具列高度被撐開了').toBeCloseTo(before.tb.height, 0);
  if (before.chip && after.chip) {
    expect(after.chip.x, '篩選鈕被推走了').toBeCloseTo(before.chip.x, 0);
    expect(after.chip.y, '篩選鈕被推到下一列了').toBeCloseTo(before.chip.y, 0);
  }

  // 一個都沒命中時也一樣（這是最容易被「多長一句話」撐開的狀態）。
  await page.locator('#search').fill('這個字串不會命中任何節點');
  // 零命中＝每一顆都被淡出（畫布沒有 class 可以數，問 state().filteredOut）。
  await expect.poll(async () => (await treeState(page)).filteredOut.length).toBe(treeData.nodes.length);
  const none = { tb: (await toolbar.boundingBox())!, chip: await chipBox() };
  expect(none.tb.width, '零命中把工具列撐開了').toBeCloseTo(before.tb.width, 0);
  expect(none.tb.height, '零命中把工具列撐高了').toBeCloseTo(before.tb.height, 0);
  if (before.chip && none.chip) {
    expect(none.chip.x, '零命中把篩選鈕推走了').toBeCloseTo(before.chip.x, 0);
  }
});

test('O3. 篩選面板收得起來也展得開，桌機平移畫布不會把它關掉', async ({ page, isMobile }) => {
  // Yuki 2026-08-22：桌機以前沒有收合，篩選鈕永遠攤在工具列上佔掉畫布上方一整條。
  await page.goto('/tree');
  const toggle = page.locator('#filters-toggle');
  const filters = page.locator('#filters');
  const toolbar = page.locator('#toolbar');

  // 預設狀態：桌機展開、手機收起。
  await expect(toggle).toHaveAttribute('aria-expanded', String(!isMobile));
  if (isMobile) await expect(filters).toBeHidden();
  else await expect(filters).toBeVisible();

  const first = (await toolbar.boundingBox())!;
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', String(isMobile));

  // 收合真的有改變工具列佔的空間——否則這顆按鈕等於沒作用。
  // ⚠️ 不可以在 aria-expanded 翻轉的當下就量幾何。`setFiltersOpen()`（tree-canvas.ts）先寫
  // aria-expanded，接著把面板寬度**鎖成當前值**，真正的收縮要到兩層 rAF 之後才開始——那段
  // 窗裡量到的差值正好是 0。平常 Playwright 的一次往返已經吃掉大半個過場（實測 diff 486
  // /825）所以看不出來，但 2026-08-23 全套平行跑時那兩層 rAF 被推遲，這條就紅了
  // （`Received: 0`，而且只紅 desktop）。用 poll 等幾何真的動起來，不要假設「aria 翻了＝
  // 幾何已經開始變」。
  await expect
    .poll(
      async () => {
        const box = (await toolbar.boundingBox())!;
        return Math.abs(box.width - first.width) + Math.abs(box.height - first.height);
      },
      { message: '按了切換鈕，工具列佔的空間卻沒變' },
    )
    .toBeGreaterThan(40);

  // ⚠️ 這條真正要守的是「收合過場還沒收尾就再按一次」：狀態若是從 `.open` class 讀的，這時
  // class 還在，算出來的下一個狀態會是「再關一次」，面板就卡住、aria-expanded 停在 false
  // （2026-08-22 抓到）。
  // 舊版是「按一下、await 一輪、再按一下」，只是**希望**第二下落在 200ms 的窗內；落在窗外
  // 就安靜地失去這條守門，而且測試照樣綠。改成在瀏覽器的同一個 task 裡連按兩下（比真的
  // 過場中更嚴苛：第二下發生在第一下的 rAF 都還沒跑之前），並且把「第二下當下 `.open`
  // 還掛著」一起回報出來當斷言——守門條件本身變成可驗證的，不再是假設。
  // poll 是「幾何一動就回來」，回來時收合過場（200ms）通常還沒收尾——先等它收乾淨，
  // 重新展開的這一下才不會自己就落在過場裡，讓底下那組連按兩下失去唯一性。
  await expect(filters).not.toHaveClass(/animating/);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', String(!isMobile));
  await expect(filters).not.toHaveClass(/animating/);

  const openStillSetBetweenClicks = await page.evaluate(() => {
    const btn = document.querySelector<HTMLElement>('#filters-toggle')!;
    const panel = document.querySelector<HTMLElement>('#filters')!;
    btn.click();
    const still = panel.classList.contains('open');
    btn.click();
    return still;
  });
  // 抽屜版面（手機）沒有橫向過場，`setFiltersOpen()` 走瞬間切換那條路、`.open` 當場就拿掉，
  // 所以這個窗只存在於桌機。手機只驗連按兩下不會卡住。
  if (!isMobile) {
    expect(openStillSetBetweenClicks,
      '第二次點擊沒有落在「.open 還掛著」的窗裡，這條守門等於沒作用').toBe(true);
  }
  await expect(toggle).toHaveAttribute('aria-expanded', String(!isMobile));

  // 跨過 720px 斷點時要重設回該版面的預設值。少了這條：桌機開著面板把視窗縮到手機寬度，
  // `.open` 會被手機的媒體查詢變成一個使用者從沒打開過的全寬抽屜，直接吃掉畫布上緣
  // （2026-08-22 review 抓到，實測工具列高 196px）。
  const before = page.viewportSize()!;
  await page.setViewportSize({ width: isMobile ? 1280 : 500, height: before.height });
  await page.waitForTimeout(300);
  await expect(toggle, '跨過斷點後面板沒有重設回該版面的預設值')
    .toHaveAttribute('aria-expanded', String(isMobile));
  await page.setViewportSize(before);
  await page.waitForTimeout(300);
  await expect(toggle).toHaveAttribute('aria-expanded', String(!isMobile));

  // 桌機的面板是工具列的一部分，不是蓋在畫布上的抽屜：平移畫布不該把它關掉。
  // 手機版是抽屜，點外面本來就該關起來（那條由 J 守），所以只在桌機驗——用 if 而不是
  // test.skip：後者會把整條測試標成 skipped，連上面已經跑過的斷言都不算數。
  if (!isMobile) {
    await page.mouse.move(400, 600);
    await page.mouse.down();
    await page.mouse.move(300, 600, { steps: 5 });
    await page.mouse.up();
    await expect(filters, '平移畫布把桌機的篩選面板關掉了').toBeVisible();
  }
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

test('O4. 篩選面板是左右伸縮的過場：箭頭朝左右、寬度逐格變化、工具列高度不跳', async ({ page, isMobile }) => {
  await page.goto('/tree');
  const toggle = page.locator('#filters-toggle');

  // 箭頭方向要跟面板長出來的方向一致：桌機往右長（▸／展開後轉成 ◂），手機往下掉（▾／▴）。
  const arrow = await toggle.evaluate(el => ({
    content: getComputedStyle(el, '::after').content,
    transform: getComputedStyle(el, '::after').transform,
  }));
  expect(arrow.content).toBe(isMobile ? '"▾"' : '"▸"');
  // 預設狀態下桌機是展開的（箭頭轉 180 度），手機是收起的（不轉）。
  expect(arrow.transform === 'none', '箭頭沒有跟著展開狀態轉向').toBe(isMobile);

  // 逐格取樣收合過程：桌機要看到中間值（不是 0 與滿寬兩格跳完），而且工具列高度全程不變。
  const probe = await page.evaluate(() => new Promise<{ widths: number[]; heights: number[] }>(resolve => {
    const filters = document.getElementById('filters')!;
    const toolbar = document.getElementById('toolbar')!;
    const widths: number[] = [];
    const heights: number[] = [];
    const t0 = performance.now();
    const tick = () => {
      widths.push(Math.round(filters.getBoundingClientRect().width));
      heights.push(Math.round(toolbar.getBoundingClientRect().height));
      if (performance.now() - t0 < 400) requestAnimationFrame(tick);
      else resolve({ widths, heights });
    };
    document.getElementById('filters-toggle')!.click();
    requestAnimationFrame(tick);
  }));

  // 工具列高度全程只有一個值——面板收窄時裡面的東西若被壓縮換行，它會先長高一倍再收掉
  // （實測「清除篩選」四個字折成四行，面板 35 → 90，2026-08-22）。
  expect(new Set(probe.heights).size, `工具列高度在過場中變動過：${[...new Set(probe.heights)].join(',')}`).toBe(1);

  const distinct = [...new Set(probe.widths)];
  if (isMobile) {
    // 抽屜是上下掉出來的，橫向過場在那裡是錯的，直接瞬間切換。
    expect(distinct.length, '手機版不該有橫向伸縮過場').toBeLessThanOrEqual(2);
  } else {
    expect(distinct.length, '寬度是一格跳完的，沒有過場').toBeGreaterThan(4);
    expect(distinct[0]).toBeGreaterThan(0);
    expect(distinct.at(-1)).toBe(0);
  }

  // 收尾要把 inline width 拿掉，否則面板會卡在當初量到的寬度、視窗一縮就不會再換行。
  await expect
    .poll(() => page.locator('#filters').evaluate(el => (el as HTMLElement).style.width))
    .toBe('');
});

test('P. 工具列對齊：搜尋框與分支側欄切齊同一條左邊界，工具列每一項共用同一條中線', async ({ page, isMobile }) => {
  test.skip(isMobile, '僅桌機：手機版 #branch-nav 隱藏、篩選收進頂部抽屜，沒有這條左邊界');
  await page.goto('/tree?q=' + encodeURIComponent('僵硬'));

  const box = async (sel: string) => {
    const b = await page.locator(sel).first().boundingBox();
    if (!b) throw new Error(`${sel} 沒有 bounding box`);
    return b;
  };
  const search = await box('#search');
  const branchBtn = await box('#branch-nav button');
  const chip = await box('#filters .chip');
  const groupLabel = await box('#filters .filter-group-label');

  // 左邊界：#toolbar 與 #branch-nav 上下相接、同屬畫布左上角那一疊，內距不同的話按鈕會比
  // 工具列凸出去。用幾何斷言而不是比對 CSS 值——這個 repo 的固定偏移量咬過三次（見 CLAUDE.md）。
  // 比的是工具列**最左邊那一項**：2026-08-22 之前那是搜尋框，現在是篩選切換鈕（桌機也能收合了）。
  const toggle = await box('#filters-toggle');
  expect(Math.abs(toggle.x - branchBtn.x)).toBeLessThan(1);

  // 中線：工具列每一項（切換鈕、搜尋框、篩選群組的標題與切換鈕）都落在同一條水平中線上。
  const midY = (b: { y: number; height: number }) => b.y + b.height / 2;
  for (const [name, b] of [['篩選鈕', toggle], ['分組標題', groupLabel], ['切換鈕', chip]] as const) {
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

// 分支色的唯一守門本來只在 /dice（codex.spec.ts 的 C6），/tree 的 P 對 `#filters .chip`
// 只量座標不量顏色（design doc 第 3 節記過這個缺口，CSS 拆檔 PR 要補一條）。
// 這條守的是 `:is(.dice-card, .chip)[data-branch=…]`（--branch 的供應者）必須留在
// Base 級的檔（components.css）——它一旦被搬進頁面級的 dice.css，/tree 的五顆分支切換鈕
// 會全部掉回 fallback `var(--gold)`，而顏色不對這件事沒有任何幾何斷言看得出來。
test('P2. /tree 篩選面板的分支切換鈕勾選後邊框走該分支的顏色', async ({ page }) => {
  await page.goto('/tree');
  // 手機版 #filters 收在抽屜裡、預設不顯示（同上面 O2/O3 那組測試），要先展開才點得到。
  const filters = page.locator('#filters');
  if (!(await filters.isVisible())) await page.locator('#filters-toggle').click();
  const chip = page.locator('#filters .chip[data-branch="nature"]');
  const checkbox = chip.locator('input[data-branch="nature"]');
  await checkbox.check();
  await expect(checkbox).toBeChecked();

  const nature = await resolveColor(page, '--nature');
  // ⚠️ 一定要 poll：border-color 有 var(--t-fast) 的過場，勾選當下讀會讀到過場中途的混色
  // （同 codex.spec.ts C6 那條的理由），一次性斷言會偶爾紅。
  await expect
    .poll(() => chip.evaluate(el => getComputedStyle(el).borderTopColor), {
      message: '#filters 的分支切換鈕勾選後沒有走分支色（--branch 供應者可能被搬出 Base 級的檔）',
    })
    .toBe(nature);
});

test('R. 分頁標題不帶破折號，分頁圖示指向實際存在的檔案', async ({ page }) => {
  await page.goto('/tree');
  const title = await page.title();
  expect(title).toBe('Random Dice 2 wiki | 骰子樹');
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
  // 貼進聊天室展開的卡片。沒有這些標籤時各平台是拿 <title> 湊，顯示成「Random Dice 2 wiki | 骰子樹」。
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
  // 期望值從建置產物現讀，不寫死——寫死的話下次改版本又要回頭改測試，而真正該擋的
  // （頁面沒跟著資料變）反而測不出來。
  const meta = JSON.parse(
    readFileSync(new URL('../../src/generated/tree.json', import.meta.url), 'utf8'),
  ).meta as { gameVersion: string; gameBundle: string; updated: string };

  await page.goto('/');
  // 綁 id 不綁 `section`：首頁在 2026-08-22 多了更新日誌區塊，`locator('section')` 會
  // 命中兩個而觸發 Playwright 的 strict mode。選擇器綁版面結構撐不住任何版面改動。
  const text = (await page.locator('#version-info').innerText()).replace(/\s+/g, '');
  expect(text).toContain(`遊戲版本v${meta.gameVersion}`);
  expect(text).toContain(meta.updated);
  // 資源包版本 2026-08-22 起不上頁面（Yuki 指定）。它仍在資料正本與 data/changelog.json 裡
  // 給規則 20 用——這條反向守著「別又把它印回去」。
  // ⚠️ 2026-09-06 起資源包欄位直接寫遊戲版本（兩者相同），字串比對分不出是誰印的，
  // 所以只在兩者不同時用字串守，另外守「資源包」這個詞不出現。
  if (meta.gameBundle !== meta.gameVersion) expect(text, '資源包版本又出現在首頁了').not.toContain(meta.gameBundle);
  expect(text, '資源包版本又出現在首頁了').not.toContain('資源包');
});

test('Z. 詳情面板的視圖堆疊：關鍵字／覺醒換頁、返回鍵、系統上一頁、Esc、✕', async ({ page }) => {
  // 這一條守的是「同一張卡片換頁」整套互動（2026-08-20 改版）。單元測試跑在 linkedom 下，
  // 沒有 Pointer Capture、沒有真的 history、也沒有 CSS——「換頁之後焦點在哪」「按上一頁會
  // 不會真的退一層」這幾件事只有真瀏覽器驗得到，而它們正是這個設計最容易壞的地方
  // （實作時第一版就是焦點掉回 <body>、Esc 完全收不到）。
  const top = topViewTitle(page);
  await page.goto('/tree?node=5004'); // 破滅骰子：描述有 #破滅，#破滅 的解釋裡又有兩個詞
  await expect(top).toHaveText('破滅骰子');
  await expect(topView(page).locator('[data-detail-back]')).toHaveCount(0); // 根視圖沒有返回鍵
  await expect(topView(page).locator('[data-detail-close]')).toBeVisible();
  // 根視圖沒有返回鍵時，標題不該被一條空的欄軌道往右推——固定寬度的欄會留下 36px 的縮排，
  // 標題跟底下的內文對不齊，看起來就是憑空多一格空白（人工回報，2026-08-20）。
  const alignedLeft = () => page.evaluate(() => {
    const view = document.querySelector('#detail .view:not([hidden])')!;
    const h2 = view.querySelector('h2')!.getBoundingClientRect().left;
    const body = view.querySelector('.meta')!.getBoundingClientRect().left;
    return +(h2 - body).toFixed(1);
  });
  expect(await alignedLeft()).toBe(0);

  // 1) 點關鍵字 → 推出詞彙頁
  await topView(page).locator('.kw').first().click();
  await expect(top).toHaveText('#破滅');
  // 焦點要落進新的一頁。剛按下的那顆按鈕會跟著舊視圖一起 display:none，焦點於是掉回
  // <body>——Tab 從頭開始、螢幕閱讀器不知道換了一頁。實作第一版就是這樣壞的。
  // 比對的是「焦點所在的那張視圖的標題」，不是「焦點有沒有在某張視圖裡」——後者在動畫
  // 進行中會被剛按下的那顆按鈕（還在舊視圖裡、還沒 hidden）矇混過去，永遠是綠的。
  await expect
    .poll(() => page.evaluate(() =>
      document.activeElement?.closest('#detail .view')?.querySelector('h2')?.textContent ?? null))
    .toBe('#破滅');

  // 2) 詞彙頁裡的巢狀關鍵字再推一層（取代舊的常駐解釋清單）
  await topView(page).locator('.kw', { hasText: '#菁英怪物' }).click();
  await expect(top).toHaveText('#菁英怪物');

  // 3) 系統／瀏覽器上一頁＝卡片的返回鍵（A1）
  await page.goBack();
  await expect(top).toHaveText('#破滅');

  // 4) 返回鍵退回根視圖
  await topView(page).locator('[data-detail-back]').click();
  await expect(top).toHaveText('破滅骰子');
  await expect(topView(page).locator('[data-detail-back]')).toHaveCount(0);

  // 5) 覺醒入口推出覺醒頁；Esc 退一層（C1）
  await topView(page).locator('.awakening-link').click();
  await expect(top).toHaveText('骰子覺醒');
  await page.keyboard.press('Escape');
  await expect(top).toHaveText('破滅骰子');

  // 6) 換一顆節點：堆疊重設，不會留著上一顆的詞彙頁
  await topView(page).locator('.kw').first().click();
  await expect(top).toHaveText('#破滅');
  // canvas 版沒有可以 click 的節點元素，改用 clickNode()：它會先把 5002 平移進安全區
  // （手機版一開始的鏡頭只框住 5004 附近，目標節點在畫面外）再對它的中心送真的滑鼠點擊。
  await clickNode(page, '5002');
  await expect(top).toHaveText('恐懼骰子');
  await expect(page.locator('#detail .view')).toHaveCount(1);

  // 7) ✕ 關掉整個面板；關掉之後按上一頁不該把卡片叫回來
  await topView(page).locator('.kw').first().click();
  await expect(top).toHaveText('#僵硬');
  await topView(page).locator('[data-detail-close]').click();
  await expect(page.locator('#detail')).toBeHidden();
  await page.goBack();
  await expect(page.locator('#detail')).toBeHidden();
});

test('Z3. 在詞彙頁改篩選會收回節點頁，而且歷史紀錄也跟著退——上一頁不會被吃掉', async ({ page }) => {
  const depth = () => page.evaluate(() => (history.state as { rd2DetailDepth?: number } | null)?.rd2DetailDepth ?? 0);
  await page.goto('/tree?node=5004');
  await topView(page).locator('.kw').first().click();
  await expect(topViewTitle(page)).toHaveText('#破滅');
  expect(await depth()).toBe(1);

  // 改搜尋條件 → 面板整段重畫回節點頁。堆疊回到根視圖，歷史紀錄也要跟著退，
  // 否則接下來按上一頁會什麼事都沒發生（瀏覽器確實退了一步，但那一步已經沒有對應的視圖）。
  await page.locator('#search').fill('骰子');
  await expect(topViewTitle(page)).toHaveText('破滅骰子');
  await expect.poll(depth).toBe(0);
  // ⚠️ 網址也要驗，不能只驗 depth。`history.go()` 是非同步的，而每筆紀錄記著推入時的網址：
  // 退歷史之後沒有重寫一次網址的話，剛打的 `?q=` 會被還原掉——而 depth 照樣是 0，全綠。
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('骰子');
});

test('Z5. 在詞彙頁換一顆節點：面板、網址、動畫狀態三者都要跟上', async ({ page }) => {
  await page.goto('/tree?node=5004');
  await waitTree(page);

  // ⚠️ 平移要排在點 `.kw` **之前**：clickNode() 內建的 bringIntoView 會拖好幾次畫布，
  // 拖完早就超過換頁動畫的 280ms，下面那句「panel-sliding 不該還在」就會在動畫自己結束
  // 之後才問，變成一條恆真的斷言。所以先把 5002 搬進安全區、記下中心，再推詞彙頁，
  // 然後**立刻**對那個座標點下去。
  await bringIntoView(page, '5002');
  const target = await nodeCenter(page, '5002');

  await topView(page).locator('.kw').first().click();
  await expect(topViewTitle(page)).toHaveText('#破滅');

  // 刻意不等動畫跑完就換節點，同時驗兩件事
  await page.mouse.click(target.x, target.y);
  // (1) `panel-sliding` 只該存在於換頁動畫期間。整個 .stack 已經被 renderDetail() 換掉了，
  //     還留著的話接下來那 280ms 內，卡片跟著畫布平移的每一幀重寫 top 都會變成拖尾。
  //     ⚠️ 這裡要**當下讀一次**、不能用會自動重試的 `expect(locator).not.toHaveClass()`：
  //     殘留的 class 會在動畫計時器到期（約 300ms）時自己消失，重試型斷言等一下就變綠了。
  expect(await page.locator('#detail').getAttribute('class') ?? '').not.toContain('panel-sliding');
  await expect(topViewTitle(page)).toHaveText('恐懼骰子');
  await expect(page.locator('#detail .view')).toHaveCount(1);
  // (2) 網址要跟著換。不跟的話面板顯示新節點、重整卻回到舊節點。
  await expect.poll(() => new URL(page.url()).searchParams.get('node')).toBe('5002');
});

test('Z6. 篩選抽屜開著時，一次 Esc 只關抽屜，不會順便退出詞彙頁', async ({ page }) => {
  // 兩個 Esc 監聽器都掛在 document 上，抽屜那個先跑並移除 .open——後面那個用 class 判斷
  // 已經來不及，於是一次按鍵做了兩件事（實測 500×800 必現）。抽屜要 stopImmediatePropagation。
  await page.setViewportSize({ width: 500, height: 800 });
  await page.goto('/tree?node=5004');
  await topView(page).locator('.kw').first().click();
  await expect(topViewTitle(page)).toHaveText('#破滅');
  // ⚠️ 一定要等換頁動畫收尾（`panel-sliding` 消失）再去按切換鈕。
  // `pushView()` 的 slide() 回呼在約 280ms 後才跑，而它會 `focusView(toEl)` 把焦點拉進
  // `#detail`；焦點一旦落在面板裡，`panel` 上那個 Esc 監聽器會 `stopPropagation()`，
  // document 上「Esc 關抽屜」那條就永遠收不到——抽屜留著開、詞彙頁反而退掉，正好是這條
  // 測試要擋的相反行為。平行負載下實測會偶發（2026-09-06 一次全套跑咬到一次）。
  await expect.poll(() => page.locator('#detail').getAttribute('class'))
    .not.toContain('panel-sliding');

  await page.locator('#filters-toggle').click();
  await expect(page.locator('#filters')).toHaveClass(/open/);

  await page.keyboard.press('Escape');
  await expect(page.locator('#filters')).not.toHaveClass(/open/);
  await expect(topViewTitle(page)).toHaveText('#破滅');   // 詞彙頁不該被一起關掉

  // 抽屜關了之後，Esc 才輪到詳情面板
  await page.keyboard.press('Escape');
  await expect(topViewTitle(page)).toHaveText('破滅骰子');
});

test('Z2. 詞彙頁的「搜尋 #X」才會真的搜尋，而且會退回節點頁（D1）', async ({ page }) => {
  await page.goto('/tree?node=5004');
  await topView(page).locator('.kw').first().click();
  await expect(topViewTitle(page)).toHaveText('#破滅');

  await topView(page).locator('[data-detail-search]').click();
  await expect(page.locator('#search')).toHaveValue('破滅');
  await expect(page.locator('#filters-toggle')).toHaveClass(/active/);
  await expect(topViewTitle(page)).toHaveText('破滅骰子');
  expect(new URL(page.url()).searchParams.get('q')).toBe('破滅');
});

test('X3. 太陽骰子的前置鏈把「1201 練到 Lv.50」的費用算進去，而且分三段講清楚', async ({ page }) => {
  // 1.1.0 的太陽骰子（1501）除了 1301／1401 兩條入邊，還要求 1201 子彈傷害%增加練滿
  // Lv.50（客戶端 DiceTreeNodeTable 的 NeedNodeRank）。圖結構完全沒動——1201 本來就是那兩顆
  // 的前置——所以這件事**只在面板上看得見**，畫布上沒有任何痕跡。
  //
  // 算式（tests/lib/selection.test.ts 逐項寫著）：
  //   解鎖 核心 30 ／金幣 132,000 ／太陽核心 2,000
  //   ＋ 1201 Lv.1→50 追加 核心 99 ／金幣 463,700
  //   ＝ 核心 129 ／金幣 595,700 ／太陽核心 2,000
  await page.goto('/tree?node=1501');
  await waitTree(page);

  const chain = page.locator('#detail .col.chain');
  await expect(chain.locator('.cost')).toHaveText('總計 核心 129 ＋ 金幣 595,700 ＋ 太陽核心 2,000');
  // 三段各自成立：只印總計的話，玩家看不出 595,700 裡有 463,700 是拿去練 1201 的。
  await expect(chain).toContainText('解鎖前置 核心 30 ＋ 金幣 132,000 ＋ 太陽核心 2,000');
  await expect(chain).toContainText('前置練等 子彈傷害%增加 Lv.50：核心 99 ＋ 金幣 463,700');
  // 這條鏈**含**一段必要練等，所以那句「不含強化費用」不可以原封不動留著。
  await expect(chain).not.toContainText('不含強化費用');

  // 反向控制：條件掛在 1501 身上，選 1201 自己時面板跟改動前逐字相同。
  await page.goto('/tree?node=1201');
  await waitTree(page);
  await expect(page.locator('#detail .col.chain')).not.toContainText('前置練等');
  await expect(page.locator('#detail .col.chain')).toContainText('不含強化費用');
});

test('X2. 可跳過的前置邊標成虛線，而且只有那兩條', async ({ page }) => {
  // 官方資料表 v1.0.3 v2 寫明貪婪（5006）與空虛（5008）「無視骰子樹前置」。圖結構沒有變
  // ——241／251 照舊、邊還在——差別只在那條路可以不走，所以用虛線而不是刪線表達。
  //
  // ⚠️ canvas 版沒有 `line.edge` 可以讀 `strokeDasharray`：虛線是 painter 依
  // `SceneEdge.bypassable` 分兩批畫的（實線一批、`setLineDash([9,7])` 一批，見 painter.ts），
  // 而「那一批真的畫成虛線」已經由 tests/lib/canvas/painter.test.ts 用假的 2D context 數
  // `setLineDash` 過的 stroke 次數守住了。E2E 能問、也該問的是**輸入**：場景裡被標成
  // bypassable 的到底是哪幾條——那正是舊版最容易寫壞的地方（`render.ts` 依**終點**節點的
  // bypassPrereq 掛旗標，掛成看起點的話整棵樹都會變虛線）。
  await page.goto('/tree');
  await waitTree(page);

  // 期望值從資料現算，不寫死 id：終點節點帶 bypassPrereq 的邊，一條不多一條不少。
  const bypass = new Set(treeData.nodes.filter(n => n.bypassPrereq).map(n => n.id));
  const expected = treeData.edges.filter(([, to]) => bypass.has(to)).map(([f, t]) => `${f}→${t}`).sort();
  expect(expected, '資料裡應該正好有兩條可跳過的前置邊（5006 貪婪／5008 空虛）')
    .toEqual(['5007→5006', '5009→5008']);

  const st0 = await treeState(page);
  expect(st0.bypassEdges.map(([f, t]) => `${f}→${t}`).sort()).toEqual(expected);
  // 前提：邊本身沒有被刪掉。虛線表達的是「這條路可以不走」，不是「沒有這條路」。
  expect((await page.evaluate(() => window.__tree.count())).edges).toBe(treeData.edges.length);

  // 虛線邊的兩種狀態各驗一次——舊版是量 CSS 的 opacity／stroke，canvas 版問的是同一件事的
  // 輸入：`state.ts` 的 `edgeColor()`／`edgeAlpha()` 判的是「**兩端**都在 chain 裡」，
  // 所以測試問的也是兩端，不是那條邊自己有沒有被標記。
  //
  // (1) 鏈外：選 5101。它的前置鏈是 5101 → 5006 就停了（5006 可直接領，不再往上追），
  // 所以 5006 在鏈上而 5007 不在 → 那條虛線邊**不是**金色、而且被壓暗（0.12）。
  // ⚠️ 這正是「一端在鏈上」這個中間狀態，只問其中一端的話會判反。
  await page.goto('/tree?node=5101');
  await waitTree(page);
  const outside = await treeState(page);
  expect(outside.chain).toContain('5006');
  expect(outside.chain, '5006 可直接領，前置鏈走到它就該停止往上追').not.toContain('5007');

  // (2) 鏈內：這個狀態**構得出來**——5005 變異骰子的前置是 5006 與 5103，而 5103 的祖先鏈
  // 是 5002 → 5007 → 5103，所以 5007 與 5006 同時在鏈上，那條虛線邊被高亮成金色。
  // 全站有 18 個選取會踩到，其中 11 個連一個前置都沒省到。
  await page.goto('/tree?node=5005');
  await waitTree(page);
  const inside = await treeState(page);
  expect(inside.chain).toContain('5006');
  expect(inside.chain).toContain('5007');

  // (3) 而且那個狀態下畫面上要有東西解釋這條虛線——5005 一個前置都沒省到（bypassed = 0），
  // 說明若綁在「省了幾個」上，這裡會是一條金色虛線配上零說明。
  await expect(page.locator('#detail')).toContainText('鏈上有 1 顆可直接領的骰子');
  await expect(page.locator('#detail')).not.toContainText('已跳過');
});

test('T2. 詳情面板的成本帶遊戲貨幣圖：三種貨幣各一張、每張都載得到、文字不受影響', async ({ page, request }) => {
  // 太陽骰子的前置鏈總計同時有核心／金幣／太陽核心，是全站唯一能一次看到三張圖的節點。
  await page.goto('/tree?node=1501');
  const chain = page.locator('#detail .chain');
  const icons = chain.locator('.cost .currency-icon');
  await expect(icons).toHaveCount(3);
  // 圖是裝飾（alt 空），所以文字斷言跟沒有圖的時候一模一樣。
  await expect(chain.locator('.cost')).toHaveText('總計 核心 129 ＋ 金幣 595,700 ＋ 太陽核心 2,000');
  const srcs = await icons.evaluateAll(els => els.map(el => (el as HTMLImageElement).getAttribute('src') ?? ''));
  expect(srcs).toEqual(['/currency/core.png', '/currency/gold.png', '/currency/solar.png']);
  for (const src of srcs) expect((await request.get(src)).status(), src).toBe(200);
  // 圖跟著字級走：高度等於該行的 font-size（1em），不是寫死的 px。
  const { h, fs } = await icons.first().evaluate(el => ({ h: el.getBoundingClientRect().height, fs: parseFloat(getComputedStyle(el.parentElement!).fontSize) }));
  expect(Math.abs(h - fs)).toBeLessThan(1);
});
