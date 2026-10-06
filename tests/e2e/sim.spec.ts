// 骰子樹模擬器的端對端驗證。
//
// 這一頁跟 /dice 不同，內容不是給搜尋引擎索引的——價值全在「算得對不對」與「點得到」。
// 算術本身已經被 tests/lib/sim.test.ts 蓋掉了（純函式），所以這裡的重心是三件單元測試
// 碰不到的事：**點得到嗎**（setPointerCapture 會把 click 的 target 改標，第一版就是這樣
// 讓整頁點下去沒反應）、**畫面有沒有跟著狀態走**、**重整之後還在不在**。
//
// ⚠️ **這一頁的畫布是 Canvas 2D，不是 SVG**（2026-09-06 起，跟 /tree 同一次改版）。
// 節點、邊、等級牌、狀態色全部畫在兩張 `<canvas>` 上——沒有 `g.node`、沒有
// `line.edge.sim-linked`、沒有 `.sim-badge`、沒有 class 可以問。所以這支檔案一律：
//
//   * 節點位置 → `window.__tree.nodeScreenRect(id)`（視窗座標 CSS px）
//   * 某個座標點中了誰 → `window.__tree.hitAt(x, y)`
//   * 模擬器狀態 → `window.__tree.state().sim`（`owned` / `available` / `linked` / `active`）
//   * 鍵盤焦點 → `.tree-a11y-node[data-id]` 那顆隱形按鈕 ＋ `state().focus`
//
// 側欄、工具列、抽屜、footer 仍然是真的 DOM，照舊量 `getBoundingClientRect()`。
//
// ⚠️ **`state().sim` 沒有 `selected`／`levels`／`maxLevels`**（見 canvas-tree.ts 的
// debugApi）。等級牌畫得對不對由 tests/lib/canvas/painter.test.ts 用假的 2D context 守
// （「只有 owned 且 maxLevel>1 才畫牌、牌上文字是當前/上限」），畫面上的等級則改讀側欄的
// `.sim-level-value`——那是玩家真正看數字的地方。
import { readFileSync } from 'node:fs';
import { test, expect, type Page } from './fixtures';
import { readTree } from '../helpers/read-tree';

/** `window.__tree` 的形狀（見 src/lib/canvas/debug-api.ts）。 */
interface SimPaintState {
  owned: string[]; available: string[];
  linked: [string, string][]; active: [string, string][];
}
interface TreeState {
  selected: string | null; chain: string[]; filteredOut: string[]; focus: string | null;
  bypassEdges: [string, string][];
  sim?: SimPaintState;
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

const tree = readTree() as {
  meta: { viewBox: [number, number, number, number] };
  nodes: { id: string; name: string; type: string; maxLevel: number; unlockVia: string; unlockCost: { core: number; gold: number }; unlockPaid?: true }[];
};

const NODE_COUNT = tree.nodes.length;
const FREE_IDS = tree.nodes.filter(n => n.unlockVia === 'default').map(n => n.id);
const OPTIONAL_IDS = tree.nodes
  .filter(n => n.unlockVia !== 'cost' && n.unlockVia !== 'default' && !n.unlockPaid)
  .map(n => n.id);

/**
 * 測試用的三顆節點，全部**初始狀態就可以直接解鎖**（前置只有起始骰子）——挑不對的話
 * 每條測試都得先「一鍵點亮」，測到的就不是自己要測的那件事了。
 *
 * - `READY`：1201 子彈傷害%增加（rune，金幣 2,000，前置 1001）
 * - `TIER_F`：1109 所有骰子傷害（passive，tier F ＝ maxLevel 100／解鎖 3,000，前置 1001）
 * - `WITH_KIDS`：2003 齒輪骰子（dice，核心 5，前置 2001；下游有 2002／2109／2203）
 */
const READY = '1201';
const TIER_F = '1109';
const WITH_KIDS = '2003';

const simState = async (page: Page): Promise<SimPaintState> => {
  const s = await page.evaluate(() => window.__tree.state());
  if (!s.sim) throw new Error('state().sim 不存在——/sim 沒有把模擬器狀態送進畫布');
  return s.sim;
};
/** 已取得的節點集合。取代舊版的 `g.node.sim-owned` class 查詢。 */
const owned = async (page: Page): Promise<string[]> => (await simState(page)).owned;

async function openSim(page: Page): Promise<void> {
  await page.goto('/sim');
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__tree));
  // 畫布真的把每一顆節點都放進場景了（canvas 裡沒有元素可以數，問 scene 的清單）。
  expect((await page.evaluate(() => window.__tree.count())).nodes).toBe(NODE_COUNT);
}

/**
 * 畫布上可以安全點擊的矩形。
 *
 * ⚠️ **兩個方向都要算**：工具列與（手機版的）底部抽屜擋的是上下，而桌機的側欄擋的是右邊
 * ——第一版只算了上下，5201 剛好落在側欄底下，Playwright 點到的是 `<aside>`，症狀是
 * 「側欄一直停在空狀態」，看起來完全像程式沒接上點選。
 * 量的都是**真的 DOM**（`#sim-toolbar`／`#sim-panel`／`#sim-scrim`），不是畫布內容。
 *
 * ⚠️ **只扣「現在真的看得見」的遮蔽物**（2026-09-22）：手機版的工具列是收起來的 sheet，
 * `visibility: hidden` ＋ `translateY(101%)`，它的 `getBoundingClientRect().bottom` 會落在
 * 視窗**底下**——照舊拿它當安全區上緣的話整個安全區會變成空的，而症狀是「每顆節點都搬不
 * 進可點擊範圍」，看起來完全像畫布壞了。
 */
async function safeBox(page: Page): Promise<{ left: number; top: number; right: number; bottom: number }> {
  return page.evaluate(() => {
    const visible = (id: string): DOMRect | null => {
      const el = document.getElementById(id);
      if (!el) return null;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return null;
      return el.getBoundingClientRect();
    };
    const host = document.getElementById('canvas-host')!.getBoundingClientRect();
    let left = Math.max(0, host.left);
    let top = Math.max(0, host.top);
    let right = Math.min(innerWidth, host.right);
    let bottom = Math.min(innerHeight, host.bottom);
    for (const id of ['sim-toolbar', 'sim-panel', 'sim-scrim']) {
      const r = visible(id);
      if (!r || r.bottom <= top || r.top >= bottom || r.right <= left || r.left >= right) continue;
      if (r.left <= left + 1 && r.right >= right - 1) {
        // 橫跨整個寬度：從上緣或下緣侵入（手機版的工具列 sheet 與抽屜都是這一種）。
        if (r.top <= top + 1) top = Math.max(top, r.bottom);
        else bottom = Math.min(bottom, r.top);
      } else if (r.right >= right - 1) right = Math.min(right, r.left);   // 桌機側欄貼右
      else if (r.top <= top + 1) top = Math.max(top, r.bottom);           // 桌機工具列貼左上
    }
    return { left, top, right, bottom };
  });
}

/**
 * 工具列在手機版是收起來的底部 sheet，桌機版一直在畫面上。
 * 要碰工具列裡任何一顆控制項的測試都得先走這裡，否則手機 project 會在
 * 「element is not visible」上紅一片。
 */
async function openTools(page: Page): Promise<void> {
  const fab = page.locator('#sim-fab-more');
  if (!(await fab.isVisible())) return;                       // 桌機
  if (await page.locator('#sim-toolbar.is-open').count()) return;
  await fab.click();
  await expect(page.locator('#sim-toolbar')).toBeVisible();
}

/** 收起工具列 sheet（桌機是 no-op）。點畫布之前一定要收，遮罩會把點擊整片吃掉。 */
async function closeTools(page: Page): Promise<void> {
  const scrim = page.locator('#sim-scrim');
  if (await scrim.isVisible()) await scrim.click();
}

type Rect = { left: number; top: number; width: number; height: number };

/** 節點在視窗座標的矩形。這是這支測試檔取得節點位置的**唯一**途徑。 */
async function nodeRect(page: Page, id: string): Promise<Rect> {
  const r = await page.evaluate(nid => window.__tree.nodeScreenRect(nid), id);
  if (!r) throw new Error(`節點 ${id} 沒有螢幕矩形（畫布還沒掛好，或 id 不存在）`);
  return r;
}
const outsideSafe = (r: Rect, s: { left: number; top: number; right: number; bottom: number }): boolean =>
  r.left < s.left || r.left + r.width > s.right || r.top < s.top || r.top + r.height > s.bottom;

/**
 * 點一顆節點。節點若落在工具列或抽屜底下，先把畫布拖到讓它進安全區——**用真的滑鼠事件**，
 * 因為這一頁的點選判定綁在 pointerdown／pointerup 上（見 sim.ts 的說明），
 * `dispatchEvent` 合成的 PointerEvent 會讓 `setPointerCapture()` 丟 NotFoundError。
 *
 * ⚠️ 位置一律問 `nodeScreenRect()`：canvas 裡沒有元素可以量，而舊版量整個 `<g>` 的
 * bounding box 會拿到「圖示 ∪ 標籤」的聯集，中心常常落在隔壁那顆節點上（實測點 1201
 * 打到 1001）。`nodeScreenRect()` 回的就是圖示那一格，沒有這個問題。
 */
async function tapNode(page: Page, id: string): Promise<void> {
  await closeTools(page);   // sheet 的遮罩會把畫布上的點擊整片吃掉
  const safe = await safeBox(page);
  const cx = (safe.left + safe.right) / 2;
  const cy = (safe.top + safe.bottom) / 2;
  let box = await nodeRect(page, id);
  if (outsideSafe(box, safe)) {
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + (cx - (box.left + box.width / 2)), cy + (cy - (box.top + box.height / 2)), { steps: 8 });
    await page.mouse.up();
    box = await nodeRect(page, id);
  }
  // 搬完還在安全區外就是這條測試自己有問題，直接失敗比點到別的東西好。
  expect(outsideSafe(box, safe), `節點 ${id} 搬不進可點擊範圍`).toBe(false);
  await page.mouse.move(box.left + box.width / 2, box.top + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
}

/**
 * 互動層畫出來的東西的指紋。
 *
 * 已選取的白色光暈與鍵盤焦點框都畫在 `canvas.tree-overlay` 上（可取得的節點 2026-09-23 起不再有金光），畫布同源、
 * 讀得回來，所以「畫面真的變了」可以直接問那張點陣圖，不必掃特定像素的顏色（CLAUDE.md
 * 記過：掃金色像素找光暈這條路走不通，角色圖自己就有大量金／橙色像素）。
 */
const overlayInk = (page: Page): Promise<string> => page.evaluate(() =>
  (document.querySelector('#canvas-host canvas.tree-overlay') as HTMLCanvasElement).toDataURL());

const totals = (page: Page) => ({
  total: page.locator('#sim-total'),
  unlock: page.locator('#sim-total-unlock'),
  upgrade: page.locator('#sim-total-upgrade'),
  owned: page.locator('#sim-owned-count'),
});

test('S0. 骨架：初始只有起始骰子、資源 0，工具列每一項都在', { tag: '@mobile' }, async ({ page }) => {
  await openSim(page);
  const t = totals(page);
  await expect(t.owned).toHaveText(`${FREE_IDS.length} / ${NODE_COUNT}`);
  await expect(t.total).toHaveText('核心 0 ／金幣 0');

  // 起始骰子是已取得、其餘一律不是。canvas 版沒有 `.sim-owned` 這個 class，同一件事由
  // painter 依 `state().sim.owned` 決定畫成什麼樣子，所以測試問的是那份清單本身。
  expect((await owned(page)).sort()).toEqual([...FREE_IDS].sort());

  // 工具列每一項都要在，而且**摸得到**（不是被裁在視窗外）。手機版第一版把它做成一條
  // 橫捲的列，「重置」之後的按鈕整批看不到，而畫面上沒有任何東西說可以往右滑；
  // 現在手機版是底部 sheet（桌機仍是頂端那一條），所以先按 ⋯ 升起來再驗。
  await openTools(page);
  for (const id of ['sim-initial-toggle', 'sim-limit-toggle', 'sim-undo', 'sim-redo', 'sim-abilities', 'sim-export', 'sim-image-toggle', 'sim-reset']) {
    await expect(page.locator(`#${id}`)).toBeVisible();
    const inView = await page.locator(`#${id}`).evaluate(el => {
      const r = el.getBoundingClientRect();
      return r.right <= innerWidth + 0.5 && r.left >= -0.5 && r.bottom <= innerHeight + 0.5;
    });
    expect(inView, `${id} 落在視窗外`).toBe(true);
  }

  // 可選初始骰子的勾選框從資料推導，不是硬編碼清單。
  await expect(page.locator('[data-initial]')).toHaveCount(OPTIONAL_IDS.length);
});

test('S0b. 導覽列有「模擬器」入口且在本頁標成目前分頁', async ({ page }) => {
  await page.goto('/sim');
  const link = page.locator('#site-nav a[href="/sim/"]');
  await expect(link).toHaveText('骰子樹-模擬器(beta)');
  await expect(link).toHaveAttribute('aria-current', 'page');
});

test('S1. 點一顆前置齊了的節點就取得，成本加進總資源', async ({ page }) => {
  await openSim(page);
  // 火骰子（起始）的後續之一：前置只有起始骰子，一點就取得。
  const target = tree.nodes.find(n => n.id === READY)!;
  await tapNode(page, target.id);
  await expect.poll(() => owned(page)).toContain(target.id);
  await expect(totals(page).owned).toHaveText(`${FREE_IDS.length + 1} / ${NODE_COUNT}`);
  await expect(totals(page).unlock).toContainText(String(target.unlockCost.core));
});

test('S2. 取消一顆會連帶取消依賴它的節點，成本一起扣回去', async ({ page }) => {
  await openSim(page);
  await tapNode(page, WITH_KIDS);
  const after1 = await totals(page).total.textContent();
  // 2003 的下游（2203 齒輪子彈傷害增加）：2003 到手之後它的前置就齊了，點一下直接取得。
  await tapNode(page, '2203');
  await expect.poll(() => owned(page)).toContain('2203');
  await expect(totals(page).total).not.toHaveText(after1!);
  const deep = await totals(page).owned.textContent();

  await tapNode(page, WITH_KIDS);
  await page.locator('#sim-detail [data-remove]').click();
  await expect.poll(() => owned(page)).not.toContain(WITH_KIDS);
  // 連帶取消：已取得數必須少掉不只 2003 自己那一顆
  const now = Number((await totals(page).owned.textContent())!.split('/')[0]!.trim());
  expect(now).toBeLessThan(Number(deep!.split('/')[0]!.trim()) - 1);
});

test('S3. 等級照 tier 累加，核心只在區間第一級收一次', async ({ page }) => {
  await openSim(page);
  await tapNode(page, TIER_F);
  await expect(page.locator('#sim-level-range')).toHaveCount(1);

  // tier F：Lv.2-5 每級 1,000；Lv.6 是 2,000 ＋ 1 核心。
  // 練到 Lv.5 ＝ 4,000 金幣、0 核心；Lv.6 ＝ 6,000 金幣、1 核心（核心只在區間第一級收）。
  await page.locator('#sim-level-range').fill('5');
  await page.locator('#sim-level-range').dispatchEvent('input');
  await expect(totals(page).upgrade).toHaveText('核心 0 ／金幣 4,000');
  await page.locator('#sim-level-range').fill('6');
  await page.locator('#sim-level-range').dispatchEvent('input');
  await expect(totals(page).upgrade).toHaveText('核心 1 ／金幣 6,000');

  // 側欄的等級讀數跟著走——canvas 版的等級牌是 painter 畫上去的，DOM 裡沒有
  // `.sim-badge` 可以問（`state().sim` 也沒有帶 levels／maxLevels 出來）。
  // 「只有 owned 且 maxLevel>1 的節點才有牌子、牌上是當前/上限」那條由
  // tests/lib/canvas/painter.test.ts 直接數 `roundRect`／`fillText` 守住；舊版那個
  // 「SVG 元素不吃 HTML 的 hidden 屬性、239 個牌子全部留在畫面上」的坑，在 canvas 版
  // 結構上不可能發生（沒有元素可以掛 hidden，牌子畫不畫是 painter 的 if）。
  await expect(page.locator('.sim-level-value')).toHaveText('Lv.6 / 100');
});

test('S4. 一鍵點亮：鏈上有沒勾的初始骰子時一顆都不解，並指名要勾哪一顆', async ({ page }) => {
  await openSim(page);
  // 5201 的前置鏈同時經過 5006 與 5008（兩顆都是「可直接領、無視骰子樹前置」的骰子）。
  await tapNode(page, '5201');
  const before = await totals(page).owned.textContent();
  await page.locator('#sim-detail [data-path]').click();
  await expect(page.locator('#sim-toast')).toContainText('請先在「初始骰子」勾選');
  await expect(totals(page).owned).toHaveText(before!);   // 不做半套
});

test('S5. 勾選初始骰子不花錢；勾掉會連帶取消依賴它的節點', async ({ page }) => {
  await openSim(page);
  const id = OPTIONAL_IDS[0]!;
  await openTools(page);
  await page.locator('#sim-initial-toggle').click();
  await page.locator(`[data-initial="${id}"]`).check();
  await expect(totals(page).owned).toHaveText(`${FREE_IDS.length + 1} / ${NODE_COUNT}`);
  await expect(totals(page).total).toHaveText('核心 0 ／金幣 0');
  await expect(page.locator('#sim-initial-count')).toHaveText('1');

  await page.locator(`[data-initial="${id}"]`).uncheck();
  await expect(totals(page).owned).toHaveText(`${FREE_IDS.length} / ${NODE_COUNT}`);
});

test('S6. 持有資源不夠也照樣取得，側欄列出還差多少', async ({ page }) => {
  await openSim(page);
  await openTools(page);
  await page.locator('#sim-limit-toggle').click();
  await page.locator('#sim-limit-core').fill('1');
  await page.locator('#sim-limit-toggle').click();   // 收起選單，免得蓋住畫布

  // 還沒規劃任何東西：總額 0 ≤ 持有 1，列的是剩餘。
  const coreGap = page.locator('#sim-gap [data-gap="core"]');
  await expect(page.locator('#sim-gap')).toBeVisible();
  await expect(coreGap).toHaveText('核心剩餘 1');

  await tapNode(page, WITH_KIDS);   // 齒輪骰子要 5 核心，超過持有的 1——2026-09-23 起不擋
  expect(await owned(page)).toContain(WITH_KIDS);
  await expect(page.locator('#sim-toast')).toHaveText('');
  await expect(coreGap).toHaveText('核心還差 4');
  await expect(coreGap).toHaveClass(/is-short/);
  await openTools(page);
  await expect(page.locator('#sim-limit-core')).toHaveClass(/over-limit/);
});

test('S7. undo／redo 回到操作前的完整狀態', async ({ page }) => {
  await openSim(page);
  await expect(page.locator('#sim-undo')).toBeDisabled();
  await tapNode(page, READY);
  const after = await totals(page).total.textContent();
  await expect(page.locator('#sim-undo')).toBeEnabled();

  await openTools(page);
  await page.locator('#sim-undo').click();
  await expect(totals(page).total).toHaveText('核心 0 ／金幣 0');
  await expect.poll(() => owned(page)).not.toContain(READY);

  await openTools(page);
  await page.locator('#sim-redo').click();
  await expect(totals(page).total).toHaveText(after!);
});

test('S8. 重新整理之後接續上次的規劃', async ({ page }) => {
  await openSim(page);
  await tapNode(page, READY);
  await openTools(page);
  await page.locator('#sim-initial-toggle').click();
  await page.locator(`[data-initial="${OPTIONAL_IDS[0]}"]`).check();
  const before = { total: await totals(page).total.textContent(), owned: await totals(page).owned.textContent() };

  await page.reload({ waitUntil: 'networkidle' });
  await expect(totals(page).total).toHaveText(before.total!);
  await expect(totals(page).owned).toHaveText(before.owned!);
  await expect(page.locator(`[data-initial="${OPTIONAL_IDS[0]}"]`)).toBeChecked();
});

test('S9. 重置回到初始狀態並清掉存檔', async ({ page }) => {
  await openSim(page);
  await tapNode(page, READY);
  await openTools(page);
  await page.locator('#sim-reset').click();
  await expect(totals(page).owned).toHaveText(`${FREE_IDS.length} / ${NODE_COUNT}`);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(totals(page).owned).toHaveText(`${FREE_IDS.length} / ${NODE_COUNT}`);
});

test('S10. 能力彙總把同名效果合起來，Esc 關得掉', async ({ page }) => {
  await openSim(page);
  await tapNode(page, TIER_F);
  await openTools(page);
  await page.locator('#sim-abilities').click();
  await expect(page.locator('#sim-ability-modal')).toBeVisible();
  // 1109 是「所有骰子傷害」——五個系都有同名節點，所以歸在「全部骰子」而不是「自然」。
  await expect(page.locator('.sim-ability-group h3').first()).toHaveText('全部骰子');
  await expect(page.locator('.sim-ability-row').first()).toContainText('所有骰子傷害');
  await page.keyboard.press('Escape');
  await expect(page.locator('#sim-ability-modal')).toBeHidden();
});

test('S11. 拖曳畫布不算點選', { tag: '@mobile' }, async ({ page }) => {
  await openSim(page);
  const box = await nodeRect(page, READY);
  const safe = await safeBox(page);
  // 只在節點本來就落在安全區時才驗——否則這條測的是 tapNode 的搬運而不是拖曳判定。
  test.skip(outsideSafe(box, safe), '節點不在可點擊範圍內');
  const c = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 60, c.y + 20, { steps: 6 });
  await page.mouse.up();
  // 前提：拖曳真的讓畫布動了。少了這條，只要起點落在任何攔截事件的元素上，
  // 「沒有被取得」就會在「根本沒發生拖曳」的情況下自動成立（假綠）。
  expect((await nodeRect(page, READY)).left, '拖曳應該真的平移了畫布')
    .toBeGreaterThan(box.left + 30);
  expect(await owned(page)).not.toContain(READY);
  await expect(totals(page).total).toHaveText('核心 0 ／金幣 0');
});

/**
 * 這一條是 2026-08-23 那個真 bug 的守門：`/sim` 一開始沒有 `.node .label` 的樣式（那段
 * 還留在 tree.astro），標籤用瀏覽器預設的 16px、全部顯示、而且照收指標事件，於是**別的
 * 節點的標籤**蓋在某些節點的圖示上，點下去打到的是那個標籤所屬的節點。症狀是「點某幾顆
 * 完全沒反應」，看起來完全像程式沒接上點選。
 *
 * ⚠️ 為什麼不是靠 S1：S1 只點一顆，而那一顆恰好沒被蓋到就永遠是綠的——把 `pointer-events`
 * 與「符文標籤預設隱藏」兩條防線同時拿掉，S1 照樣過。**逐顆掃**才守得住。
 */
test('S13. 每顆節點的圖示中心命中的是它自己，不是隔壁那顆', { tag: '@mobile' }, async ({ page }) => {
  await openSim(page);
  // canvas 版的命中判定是 `hit.ts` 的純幾何（scene 的節點矩形，由後往前找），不再牽涉
  // 標籤的 pointer-events——但「哪一顆蓋住哪一顆」這件事仍然只有把全部節點掃一遍才看得見：
  // 只點一顆的話，那一顆恰好沒被蓋到就永遠是綠的。
  //
  // ⚠️ 問的是 `__tree.hitAt()`（畫布自己的命中判定），不是 `elementFromPoint()`——
  // 畫布上只有一張 canvas，`elementFromPoint` 對每一顆節點都會回同一個元素。
  const wrong = await page.evaluate(() => {
    const bad: string[] = [];
    for (const btn of document.querySelectorAll<HTMLElement>('.tree-a11y-node')) {
      const id = btn.dataset.id!;
      const r = window.__tree.nodeScreenRect(id);
      if (!r) { bad.push(`${id} → 沒有螢幕矩形`); continue; }
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      // 只驗看得見的那一段畫布（工具列與側欄底下的節點本來就點不到，那是版面不是這條的事）
      if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) continue;
      const owner = window.__tree.hitAt(cx, cy);
      if (owner !== null && owner !== id) bad.push(`${id} → ${owner}`);
    }
    return bad;
  });
  expect(wrong, `這些節點的圖示中心命中了別人：${wrong.join('、')}`).toEqual([]);

  // 反向前提：畫布外的座標要回 null，不是「最近的那一顆」。少了這條，`hitAt` 退化成
  // 「永遠回某顆節點」時上面整段仍然全綠（每一顆都命中自己是它的特例）。
  expect(await page.evaluate(() => window.__tree.hitAt(-50, -50))).toBeNull();
});

// EARS 10 的驗收：報告的**內容**已經被 tests/lib/sim-io.test.ts 蓋掉（純函式），
// 這裡驗的是「真的進了剪貼簿」——那條路徑（權限、navigator.clipboard、退回 textarea）
// 只有真瀏覽器跑得到。
test('S14. 匯出把規劃寫進剪貼簿', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openSim(page);
  await tapNode(page, READY);
  await openTools(page);
  await page.locator('#sim-export').click();
  await expect(page.locator('#sim-toast')).toContainText('已複製到剪貼簿');
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain('Random Dice 2 骰子樹模擬結果');
  expect(text).toMatch(/總資源：核心 [\d,]+ ／金幣 [\d,]+/);
  expect(text).toContain(READY);
});

/** 讀 PNG 的 IHDR 寬高（位元組 16–23，big-endian）。 */
function pngSize(buf: Buffer): [number, number] {
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

// 手機也跑：對話框要疊在升起的工具列 sheet 上面，下載與關閉在觸控版面下也要走得通。
test('S32. 匯出圖片：精簡版下載 1080 寬的 PNG，並在對話框顯示', { tag: '@mobile' }, async ({ page }) => {
  await openSim(page);
  await tapNode(page, READY);
  await openTools(page);
  await page.locator('#sim-image-toggle').click();
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#sim-export-compact').click(),
  ]);
  expect(dl.suggestedFilename()).toBe('rd2-sim-compact.png');
  expect(pngSize(readFileSync((await dl.path())!))[0]).toBe(1080);
  await expect(page.locator('#sim-image-dialog')).toBeVisible();
  await expect(page.locator('#sim-image-out')).toHaveJSProperty('complete', true);
  await expect(page.locator('#sim-toast')).toContainText('圖片已產生');
  await page.locator('#sim-image-close').click();
  await expect(page.locator('#sim-image-dialog')).toBeHidden();
  // 焦點要回到入口：按下的選項在產生前就被停用、選單收起，對話框記住的「原焦點」是 <body>，
  // 不接回來的話鍵盤使用者一關掉對話框就被丟回頁首（2026-09-24 final review 抓到）。
  await expect(page.locator('#sim-image-toggle')).toBeFocused();
});

test('S33. 匯出圖片：完整版是 2× 整棵樹，產生中入口停用', async ({ page }) => {
  await openSim(page);
  await openTools(page);
  await page.locator('#sim-image-toggle').click();
  const dlP = page.waitForEvent('download', { timeout: 30_000 });
  await page.locator('#sim-export-full').click();
  // 連按防護：產生中入口是停用的。
  await expect(page.locator('#sim-image-toggle')).toBeDisabled();
  const dl = await dlP;
  expect(dl.suggestedFilename()).toBe('rd2-sim-full.png');
  // 2× 整棵樹 ＋ 標題列 140（src/lib/sim-image.ts 的 FULL.headerH）× 2。
  const [, , vw, vh] = tree.meta.viewBox;
  expect(pngSize(readFileSync((await dl.path())!))).toEqual([vw * 2, (vh + 140) * 2]);
  await expect(page.locator('#sim-image-toggle')).toBeEnabled();
});

// 手機寬度才是這條要守的：選單掛在工具列上，窄螢幕最容易被推出視口（S25 同一族）。
test('S34. 匯出圖片的選單不超出視口、兩個選項點得到', { tag: '@mobile' }, async ({ page }) => {
  await openSim(page);
  await openTools(page);
  await page.locator('#sim-image-toggle').click();
  const box = (await page.locator('#sim-image-menu').boundingBox())!;
  const vw = page.viewportSize()!.width;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vw);
  for (const id of ['sim-export-compact', 'sim-export-full']) {
    const b = (await page.locator(`#${id}`).boundingBox())!;
    const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.id ?? null, [b.x + b.width / 2, b.y + b.height / 2]);
    expect(hit).toBe(id);
  }
});


/**
 * 以下六條全部來自 2026-08-23 的 `/code-review high` 與 Yuki 的實機回報——**每一條都是
 * S0–S14 全綠時仍然存在的缺陷**，各自守一個當時沒有測試看得見的地方。
 */

test('S15. 鍵盤焦點在「可取得」「已選取」的節點上也看得見', async ({ page }) => {
  await openSim(page);
  // 舊版的坑是 CSS 具體度：狀態色掛在 `.icon` 的 filter 上 (1,4,0)，壓過
  // `.node:focus .icon { filter: url(#focus-ring) }` (0,3,0)，而 `.node:focus` 已經
  // outline:none——Tab 到「可取得」或「已選取」的節點時畫面完全沒有變化。
  //
  // canvas 版沒有 CSS 具體度可言：焦點框是 painter 在**互動層**上畫的一圈金線
  // （drawOverlay 的 focusRingPath），跟狀態光暈畫在同一張 canvas 上、有明確的先後順序。
  // 所以這條改問兩件事：焦點狀態真的到了畫布（`state().focus`），而且互動層**真的重畫過**
  // （點陣圖變了）。⚠️ 只驗前者不夠——`state.focus` 設對了但 painter 忘了畫，畫面上一樣
  // 什麼都沒有，那正是舊版那個 bug 的形狀。
  for (const id of [READY, WITH_KIDS, '5201']) {
    await tapNode(page, id);          // 讓它進安全區，順便把 5201 變成「已選取」
    const before = await overlayInk(page);
    await page.locator(`.tree-a11y-node[data-id="${id}"]`).focus();
    await expect.poll(async () => (await page.evaluate(() => window.__tree.state())).focus).toBe(id);
    await expect.poll(() => overlayInk(page), { message: `${id} 聚焦後互動層沒有任何變化` })
      .not.toBe(before);
    await page.locator(`.tree-a11y-node[data-id="${id}"]`).blur();
  }
});

test('S16. 差額只列有填的貨幣，全部清空時整塊收起來', async ({ page }) => {
  await openSim(page);
  await tapNode(page, READY);
  await tapNode(page, '1205');   // 另一顆初始就可解鎖的 50 級符文
  await expect(page.locator('#sim-gap')).toBeHidden();   // 一格都沒填

  await openTools(page);
  await page.locator('#sim-limit-toggle').click();
  await page.locator('#sim-limit-gold').fill('1000000');
  await expect(page.locator('#sim-gap [data-gap]')).toHaveCount(1);
  await expect(page.locator('#sim-gap [data-gap="gold"]')).toHaveClass(/is-enough/);
  await expect(page.locator('#sim-gap [data-gap="gold"]')).toContainText('金幣剩餘');

  // 超越核心走同一條路徑：填了就列，規劃沒用到＝全部剩餘。
  await page.locator('#sim-limit-solar').fill('20');
  await expect(page.locator('#sim-gap [data-gap="solar"]')).toHaveText('太陽核心剩餘 20');

  await page.locator('#sim-limit-gold').fill('');
  await page.locator('#sim-limit-solar').fill('');
  await expect(page.locator('#sim-gap')).toBeHidden();
});

test('S17. 等級滑桿一次拖得完，而且整段拖曳只算一步復原', async ({ page, isMobile }) => {
  // ⚠️ 只在桌機跑：`page.mouse` 驅動不了行動模擬下的原生 `<input type="range">`（實測拖完
  // 停在 Lv.1）——那是 Playwright 對觸控裝置的限制，不是產品的問題。**手機上的觸控拖曳
  // 只能真機驗**。根因（元素被 innerHTML 換掉）由下面的 S17b 守（標了 @mobile，兩個 project 都跑）。
  test.skip(isMobile, 'page.mouse 驅動不了行動模擬下的原生 range，手機要真機驗');
  await openSim(page);
  await tapNode(page, TIER_F);   // maxLevel 100

  // ⚠️ 一定要用**真的滑鼠拖曳**。`fill()` ＋ `dispatchEvent('input')` 只送一次事件，
  // 完全繞過「拖曳中途元素被 innerHTML 換掉」這個缺陷——S3 就是這樣一直綠著的。
  const r = (await page.locator('#sim-level-range').boundingBox())!;
  await page.mouse.move(r.x + 4, r.y + r.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(r.x + (r.width * i) / 10, r.y + r.height / 2);
  }
  await page.mouse.up();
  await expect(page.locator('.sim-level-value')).toHaveText('Lv.100 / 100');

  // 每動一級推一步的話，這裡要按 99 次才回得去。
  await openTools(page);
  await page.locator('#sim-undo').click();
  await expect(page.locator('.sim-level-value')).toHaveText('Lv.1 / 100');
});

test('S17b. 連續調整等級不會把滑桿元素換掉（拖曳斷掉的根因）', { tag: '@mobile' }, async ({ page }) => {
  await openSim(page);
  await tapNode(page, TIER_F);
  const r = await page.evaluate(() => {
    const el = document.getElementById('sim-level-range') as HTMLInputElement;
    for (const v of ['10', '30', '60']) {
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    // 同一個 DOM 元素還在不在，就是「拖曳會不會斷」的分界：innerHTML 一重寫，
    // 玩家正按著的那個元素就被移出 DOM，指標捕捉隨之失效。
    return {
      sameElement: document.getElementById('sim-level-range') === el,
      value: el.value,
      readout: document.querySelector('.sim-level-value')?.textContent,
    };
  });
  expect(r.sameElement, '滑桿元素在連續 input 之後被換掉了').toBe(true);
  expect(r.value).toBe('60');
  expect(r.readout).toBe('Lv.60 / 100');
});

test('S20. 點到還不能取得的節點時，面板與高亮仍然跟著切到新選的節點', async ({ page }) => {
  await openSim(page);
  // 1301 的唯一前置是 1201，一開始一定取不到——`activate()` 走的是「沒取得」那條分支，
  // 得自己補一次 render。2026-09-23 以前靠「上限填 0」逼 commit 失敗走到同一個分支，
  // 持有資源不再擋之後改用還不能取得的節點。
  // ⚠️ 要挑離 1001 夠近的：手機版選了節點會升起抽屜，離太遠的（例如 5201）會掉到抽屜底下，
  // tapNode 只好平移畫布，下面「互動層點陣圖變了」這個證據就不成立了。
  const LOCKED = '1301';

  // 先把兩顆都搬進安全區，接下來兩次點擊 tapNode 就不會再拖畫布——下面用「互動層的點陣圖
  // 變了」當證據，畫布一平移那個證據就不成立了。
  await tapNode(page, LOCKED);
  await tapNode(page, FREE_IDS[0]!);
  await expect(page.locator('#sim-detail h3')).toHaveText(tree.nodes.find(n => n.id === FREE_IDS[0])!.name);
  const inkBefore = await overlayInk(page);
  const rectBefore = await nodeRect(page, LOCKED);

  // `selected` 已經換人，但沒有取得——不重畫的話面板與畫布上的白色光暈會停在上一顆，
  // 而面板上那些按鈕讀的是 selected，按下去作用在畫面上看不到的那顆。
  await tapNode(page, LOCKED);
  await expect(page.locator('#sim-detail h3')).toHaveText(tree.nodes.find(n => n.id === LOCKED)!.name);
  expect(await owned(page)).not.toContain(LOCKED);

  // ⚠️ 畫布那一半只能問到這裡為止：`state().sim` **沒有**帶 `selected` 出來（見檔頭），
  // 所以「白色光暈跟著換人」改用互動層的點陣圖有沒有變來證明。前提是畫布沒有平移——
  // 平移的話整張互動層本來就會不一樣，這個證據就退化成恆真。
  expect(await nodeRect(page, LOCKED), '這兩次點擊之間畫布不該平移').toEqual(rectBefore);
  expect(await overlayInk(page), '選取換人之後互動層完全沒有重畫').not.toBe(inkBefore);
  // 光暈畫在哪一顆由 painter 依 `state.sim.selected` 決定，那條由
  // tests/lib/canvas/painter.test.ts 的 `/sim：被搜尋淡出的 selected 節點` 一組守著。
});

test('S18. 邊有三階：沒到手＝暗、兩端都在手上＝正常亮、真的走過＝金色', async ({ page }) => {
  await openSim(page);
  // 1001 火骰子連著 1005 風與 1007 冰，三顆都是遊戲一開始就送的。這條路是通的（該正常亮），
  // 但玩家沒有走過它（不該金色）——Yuki 先後回報了這條界線的兩邊，所以三階都要驗。
  // canvas 版沒有 `.sim-linked`／`.sim-active` 這兩個 class 可以數：三階是 state.ts 的
  // `edgeAlpha()`（linked 1 ／ ready .7 ／ 其餘 .25）與 `edgeColor()`（active 才金色）
  // 兩個純函式，painter 每一幀照著畫。E2E 問的是它們的**輸入**——哪幾條邊落在哪一組。
  const s0 = await simState(page);
  expect(s0.active, '一顆都還沒解，不該有任何金線').toEqual([]);
  expect(s0.linked, '火骰子連著風與冰，三顆都是送的——那兩條該是通的').toHaveLength(2);

  await tapNode(page, READY);
  const s1 = await simState(page);
  expect(s1.active, '解一顆才出現一條金線').toEqual([['1001', READY]]);
  // ⚠️ `active` 必須是 `linked` 的**子集**——CSS 時代靠這個包含關係把 opacity 與 stroke
  // 拆成互不搶屬性的兩條規則，canvas 版則是 `edgeAlpha` 與 `edgeColor` 各自判斷，
  // 包含關係一破，金線就會是暗的（畫成金色卻只有 .25 透明度）。
  const linkedKeys = new Set(s1.linked.map(([f, t]) => `${f}>${t}`));
  for (const [f, t] of s1.active) {
    expect(linkedKeys.has(`${f}>${t}`), `金線 ${f}→${t} 不在 linked 裡，它會被畫成暗的`).toBe(true);
  }
});

test('S21. 一鍵點亮太陽骰子時，1201 真的被練到 Lv.50，而且降不回去', async ({ page }) => {
  // 1501 要求 1201 練滿 Lv.50。那段升級佔了整條路徑 78% 的金幣——沒把它納入計畫的話，
  // 玩家會花掉 13 萬金幣、目標卻仍然點不開，而畫面上只會說「還缺前置」。
  await openSim(page);
  await tapNode(page, '1501');

  // 面板要說得出「差在等級」，不是只說「缺少前置」。
  await expect(page.locator('#sim-detail')).toContainText('子彈傷害%增加需達 Lv.50');

  await page.locator('#sim-detail [data-path]').click();
  await expect(page.locator('#sim-toast')).toContainText('練到 Lv.50');
  await expect.poll(() => owned(page)).toContain('1501');
  // 解鎖 132,000 ＋ 練等 463,700 ＝ 595,700 金幣
  await expect(totals(page).total).toHaveText('核心 129 ／金幣 595,700 ／太陽核心 2,000');

  // 遊戲裡做不到「把 1201 降回 49 級但保留太陽骰子」，滑桿也不該做得到。
  await tapNode(page, '1201');
  // 1201 真的被練到 Lv.50 了——canvas 版的等級牌沒有 DOM，側欄的讀數是玩家看數字的地方。
  await expect(page.locator('.sim-level-value')).toHaveText('Lv.50 / 50');
  const range = page.locator('#sim-level-range');
  await expect(range).toHaveAttribute('min', '50');
  await expect(page.locator('#sim-detail [data-step="-1"]')).toBeDisabled();
  await expect(page.locator('#sim-detail .sim-level')).toContainText('要求它達到 Lv.50，不能再往下調');
});

test('S19. toast 是常駐的 live region，不靠 hidden 收放', async ({ page }) => {
  await openSim(page);
  const el = page.locator('#sim-toast');
  await expect(el).toHaveAttribute('role', 'status');
  // `hidden`／`display:none`／`visibility:hidden` 三種收法都會讓它從無障礙樹消失，
  // 而它是這一頁唯一的失敗回饋管道（超出上限、初始骰子沒勾）。
  const style = await el.evaluate(e => {
    const cs = getComputedStyle(e);
    return { hidden: e.hasAttribute('hidden'), display: cs.display, visibility: cs.visibility };
  });
  expect(style).toEqual({ hidden: false, display: 'block', visibility: 'visible' });

  await tapNode(page, '5201');
  await page.locator('#sim-detail [data-path]').click();
  await expect(el).toContainText('請先在「初始骰子」勾選');
});

/**
 * ⚠️ 2026-09-22 改寫。舊版驗的是「footer 有一截露在抽屜上方」（`footTop < panelTop`）——
 * 那條在著作權還留在頁面上時成立，而它光那兩行就在 390×844 上吃掉 73px 的畫布。
 * 現在 sim.ts 在 ≤720px 把 `<footer>` 搬進抽屜最底，所以要驗的改成「它在抽屜裡、而且
 * 捲到底讀得到」。**這是刻意推翻一條既有不變量，不是回歸。**
 */
test('S12. 手機版：著作權在抽屜裡讀得到，而且整頁仍然不捲動', { tag: '@mobile' }, async ({ page, isMobile }) => {
  test.skip(!isMobile, '桌機的著作權留在頁面底部，不搬進側欄');
  await openSim(page);
  await expect(page.locator('#sim-panel footer')).toContainText('111 Percent Inc.');
  expect(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight + 1)).toBe(false);

  // 把抽屜拉到最大再捲到底：著作權要真的落進可視範圍，不是只存在於 DOM。
  const seen = await page.evaluate(async () => {
    const panel = document.getElementById('sim-panel')!;
    document.documentElement.style.setProperty('--sim-panel-user-h', `${innerHeight * 0.8}px`);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    panel.scrollTop = panel.scrollHeight;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const f = panel.querySelector('footer')!.getBoundingClientRect();
    const p = panel.getBoundingClientRect();
    return f.top < p.bottom && f.bottom > p.top;
  });
  expect(seen, '著作權捲到底仍不在抽屜的可視範圍內').toBe(true);
});

/**
 * 2026-09-22 手機版重排的四條驗收，全部是**幾何斷言**（CLAUDE.md：動版面不看截圖）。
 * 改之前在 390×844 量到的基準：畫布可見高度 368px ／ 844 ＝ 44%。
 */
test('S24. 手機版：畫布拿到視窗八成以上的高度', { tag: '@mobile' }, async ({ page, isMobile }) => {
  test.skip(!isMobile, '桌機的工具列與側欄本來就常駐，這條講的是手機版面');
  await openSim(page);
  const geo = await page.evaluate(() => {
    const host = document.getElementById('canvas-host')!.getBoundingClientRect();
    const panel = document.getElementById('sim-panel')!.getBoundingClientRect();
    const bar = document.getElementById('sim-toolbar')!.getBoundingClientRect();
    return {
      visible: Math.min(host.bottom, panel.top) - Math.max(host.top, 0),
      vh: innerHeight,
      // 工具列收起時整個在視窗底下，一個像素都不准蓋到畫布。
      barTop: bar.top,
    };
  });
  expect(geo.visible / geo.vh, `畫布只拿到 ${Math.round(geo.visible)}px / ${geo.vh}px`)
    .toBeGreaterThanOrEqual(0.8);
  expect(geo.barTop).toBeGreaterThanOrEqual(geo.vh);
});

test('S25. 手機版：兩個下拉都夾在視口內，持有資源輸入框都摸得到', { tag: '@mobile' }, async ({ page, isMobile }) => {
  test.skip(!isMobile, '桌機的工具列貼左上，下拉不會撞到右邊界');
  await openSim(page);
  await openTools(page);
  for (const id of ['sim-initial', 'sim-limit']) {
    await page.locator(`#${id}-toggle`).click();
    const box = await page.locator(`#${id}-menu`).evaluate(el => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, vw: innerWidth };
    });
    expect(box.left, `#${id}-menu 左緣溢出`).toBeGreaterThanOrEqual(-0.5);
    expect(box.right, `#${id}-menu 右緣溢出（視窗寬 ${box.vw}）`).toBeLessThanOrEqual(box.vw + 0.5);
    await page.locator(`#${id}-toggle`).click();
  }

  // 「摸得到」＝那一點上最上層的元素就是它自己。⚠️ 只驗 `.click()` 不 timeout 是不夠的：
  // Playwright 在被完全蓋住時仍可能點得成功（2026-09-20 在 /sim 桌機版實測過）。
  await page.locator('#sim-limit-toggle').click();
  const reachable = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLInputElement>('#sim-limit-menu input')].map(el => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { id: el.id, ok: top === el };
    }));
  expect(reachable.length).toBeGreaterThanOrEqual(3);
  expect(reachable.filter(x => !x.ok)).toEqual([]);
});

test('S26. 手機版：選了節點之後詳情的主按鈕看得到而且點得到', { tag: '@mobile' }, async ({ page, isMobile }) => {
  test.skip(!isMobile, '桌機的側欄是整條，詳情不會被抽屜高度夾到');
  await openSim(page);
  await tapNode(page, WITH_KIDS);
  const cta = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('#sim-detail .cta');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const p = document.getElementById('sim-panel')!.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { inside: r.top >= p.top - 0.5 && r.bottom <= p.bottom + 0.5, hit: el.contains(top) };
  });
  expect(cta, '詳情裡沒有主按鈕').not.toBeNull();
  expect(cta!.inside, '主按鈕被抽屜的高度切在框外').toBe(true);
  expect(cta!.hit, '主按鈕被別的元素蓋住').toBe(true);

  // ⚠️ **矮螢幕要掃全部節點**：抽屜有 80dvh 的上限，而「缺少前置／需達 Lv.N」那幾行 warn
  // 會把主按鈕推得很低——只驗一顆是驗不到的（2026-09-22 /code-review 在 iPhone SE 上
  // 抓到 2503 的主按鈕落在框外）。節點**不寫死 id**：改版多一顆長描述的節點要自己會紅。
  await page.setViewportSize({ width: 375, height: 568 });
  await page.waitForTimeout(300);
  const outside = await page.evaluate(async () => {
    const panel = document.getElementById('sim-panel')!;
    const bad: { id: string; over: number }[] = [];
    for (const btn of document.querySelectorAll<HTMLElement>('.tree-a11y-node[data-id]')) {
      document.documentElement.style.setProperty('--sim-panel-user-h', '56px');   // 每顆都從收起開始
      btn.click();
      await new Promise(r => requestAnimationFrame(r));
      const cta = panel.querySelector('#sim-detail .cta');
      if (!cta) continue;
      const r = cta.getBoundingClientRect();
      const p = panel.getBoundingClientRect();
      if (r.bottom > p.bottom + 0.5 || r.top < p.top - 0.5) {
        bad.push({ id: btn.dataset['id']!, over: Math.round(r.bottom - p.bottom) });
      }
    }
    return bad;
  });
  expect(outside, '375×568 下有節點的主按鈕落在抽屜可視範圍外').toEqual([]);
});

test('S27. 手機版：浮動鍵永遠浮在抽屜上緣之上，而且拖曳過的高度會留著', { tag: '@mobile' }, async ({ page, isMobile }) => {
  test.skip(!isMobile, '桌機沒有浮動鍵');
  await openSim(page);

  // 三種高度都要成立：收起、拖到一半、拖到上限。
  for (const ratio of [null, 0.45, 0.8]) {
    if (ratio !== null) {
      await page.evaluate(r => document.documentElement.style.setProperty('--sim-panel-user-h', `${innerHeight * r}px`), ratio);
      await page.waitForTimeout(120);   // 等 ResizeObserver 把 --sim-panel-h 寫回去
    }
    const fabs = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('#sim-fabs button')].map(el => {
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { id: el.id, hit: el.contains(top), above: r.bottom <= document.getElementById('sim-panel')!.getBoundingClientRect().top + 0.5 };
      }));
    expect(fabs).toHaveLength(2);
    expect(fabs.filter(f => !f.hit), `抽屜 ${ratio ?? '收起'} 時浮動鍵被蓋住`).toEqual([]);
    expect(fabs.filter(f => !f.above), `抽屜 ${ratio ?? '收起'} 時浮動鍵沒有浮在抽屜上方`).toEqual([]);
  }

  // 拖把手改高度 → 重整之後沿用。用真的滑鼠事件（同 tapNode 的理由）。
  const handle = (await page.locator('#sim-panel-handle').boundingBox())!;
  const cx = handle.x + handle.width / 2;
  const cy = handle.y + handle.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy - 200, { steps: 10 });
  await page.mouse.up();
  const dragged = await page.locator('#sim-panel').evaluate(el => el.getBoundingClientRect().height);
  expect(dragged).toBeGreaterThan(200);

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__tree));
  const restored = await page.locator('#sim-panel').evaluate(el => el.getBoundingClientRect().height);
  expect(Math.abs(restored - dragged), `重整後高度 ${restored} 沒有沿用 ${dragged}`).toBeLessThan(2);

  // ⚠️ 收合一次不准把拖出來的高度洗掉（2026-09-22 /code-review 抓到：偏好只存一個「目前
  // 高度」時，收合會把它覆寫成把手的 56，再展開只會回到 50% 的預設值）。
  const panelH = () => page.locator('#sim-panel').evaluate(el => el.getBoundingClientRect().height);
  await page.locator('#sim-panel-handle').click();
  expect(await panelH(), '點一下沒有收合').toBeLessThan(80);
  await page.locator('#sim-panel-handle').click();
  const reopened = await panelH();
  expect(Math.abs(reopened - dragged), `收合再展開變成 ${reopened}，沒有回到拖出來的 ${dragged}`).toBeLessThan(2);

  // ⚠️ 上面那一段只走記憶體裡的 `openPanelH`，**存進去的那一份要另外驗**：反例實測把
  // `writePanelPref` 寫壞、記憶體那條留著時，上面三行仍然全綠。收合之後重整要 (a) 回到
  // 收合狀態、(b) 再展開仍然回得到拖出來的高度。
  await page.locator('#sim-panel-handle').click();          // 收合
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__tree));
  expect(await panelH(), '收合狀態沒有被記住').toBeLessThan(80);
  await page.locator('#sim-panel-handle').click();
  const afterReload = await panelH();
  expect(Math.abs(afterReload - dragged), `重整後展開變成 ${afterReload}，沒有回到 ${dragged}`).toBeLessThan(2);
});

/**
 * ⚠️ `pointercancel` 之後**不會**再有 `pointerup`（Android 的邊緣返回手勢、長按選單、
 * 旋轉螢幕都會派發它）。拖曳狀態沒清掉的話，`pointermove` 掛在 window 上——之後使用者
 * 在畫布上平移都會變成在改抽屜高度（2026-09-22 /code-review 實測：56 → 673）。
 * 這裡刻意用合成事件：要測的就是「非正常結束」這條路，真滑鼠派不出 pointercancel。
 */
test('S28. 手機版：拖曳被 pointercancel 中斷之後，畫布上的滑動不會再改抽屜高度', { tag: '@mobile' }, async ({ page, isMobile }) => {
  test.skip(!isMobile, '桌機沒有可拖曳的抽屜把手');
  await openSim(page);
  const moved = await page.evaluate(() => {
    const handle = document.getElementById('sim-panel-handle')!;
    const panel = document.getElementById('sim-panel')!;
    const b = handle.getBoundingClientRect();
    const opt = { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', clientX: b.x + b.width / 2, clientY: b.y + b.height / 2 };
    const before = panel.getBoundingClientRect().height;
    handle.dispatchEvent(new PointerEvent('pointerdown', opt));
    handle.dispatchEvent(new PointerEvent('pointercancel', opt));
    dispatchEvent(new PointerEvent('pointermove', { ...opt, clientY: 120 }));   // 畫布上隨便滑一下
    return { before, after: panel.getBoundingClientRect().height };
  });
  expect(moved.after, `被 pointercancel 中斷後抽屜仍然跟著滑動走（${moved.before} → ${moved.after}）`)
    .toBeCloseTo(moved.before, 0);
});

test('S29. 手機版：搜尋 sheet 升起時兩顆浮動鍵仍然點得到', { tag: '@mobile' }, async ({ page, isMobile }) => {
  test.skip(!isMobile, '桌機沒有浮動鍵');
  await openSim(page);
  await page.locator('#sim-fab-search').click();
  await expect(page.locator('#sim-toolbar')).toBeVisible();
  // ⚠️ 搜尋模式的 sheet 只有一列高，兩顆鍵明明露在它上方——但遮罩與浮動鍵同為 z-index 6
  // 時由 DOM 順序決勝，遮罩排在後面就把它們整片吃掉，「按 ⋯ 換模式」那條路用指標永遠
  // 走不到（2026-09-22 /code-review 抓到）。這條守遮罩必須低一階。
  const fabs = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('#sim-fabs button')].map(el => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { id: el.id, hit: el.contains(top), blocker: top?.id || top?.tagName };
    }));
  expect(fabs).toHaveLength(2);
  expect(fabs.filter(f => !f.hit)).toEqual([]);

  // 真的切得過去：⋯ 按下去要換成完整 sheet，不是只把搜尋收掉。
  await page.locator('#sim-fab-more').click();
  await expect(page.locator('#sim-toolbar')).toHaveClass(/is-open/);
  await expect(page.locator('#sim-toolbar')).not.toHaveClass(/is-search/);
  await expect(page.locator('#sim-reset')).toBeVisible();
});

test('S22. 側欄三列合計帶貨幣圖，核心與金幣永遠各一張；文字仍是舊格式', async ({ page }) => {
  await page.goto('/sim');
  const t = totals(page);
  await expect(t.total).toHaveText('核心 0 ／金幣 0');
  await expect(t.total.locator('.currency-icon')).toHaveCount(2);
  await expect(t.total.locator('.currency-icon').first()).toHaveAttribute('src', '/currency/core.png');
  await expect(t.total.locator('.currency-icon').nth(1)).toHaveAttribute('src', '/currency/gold.png');
});

test('S30. 側欄是 .panel 的面但仍貼邊；工具列的面是 --face-float', { tag: '@mobile' }, async ({ page, isMobile }) => {
  await openSim(page);
  const panel = page.locator('#sim-panel');
  const s = await panel.evaluate(el => {
    const c = getComputedStyle(el);
    return {
      cls: el.className, shadow: c.boxShadow,
      tl: c.borderTopLeftRadius, bl: c.borderBottomLeftRadius, top: c.borderTopWidth, left: c.borderLeftWidth,
    };
  });
  expect(s.cls).toContain('panel');
  expect(s.shadow, '側欄沒有 --face-float 的上緣高光').toContain('inset');
  if (isMobile) {
    // 抽屜：上兩角圓、只有上框。
    expect(s.tl).toBe('12px');
    expect(s.bl).toBe('0px');
    expect(s.top).toBe('1px');
    expect(s.left).toBe('0px');
  } else {
    // 桌機：貼右邊的全高側欄，只有左框、沒有圓角（spec §1 不改版面結構）。
    expect(s.tl).toBe('0px');
    expect(s.left).toBe('1px');
    expect(s.top).toBe('0px');
  }
  await openTools(page);
  expect(await page.locator('#sim-toolbar').evaluate(el => getComputedStyle(el).boxShadow), '#sim-toolbar 沒有 --face-float')
    .toContain('inset');
});

test('S31. 工具列是 .btn、復原重做是圖示且停用看得出來；詳情的行動鈕是金色主按鈕；手機 sheet 的把手不是 .btn', { tag: '@mobile' }, async ({ page, isMobile }) => {
  await openSim(page);
  await openTools(page);
  const btns = page.locator('#sim-toolbar button:not(#sim-sheet-close)');
  const n = await btns.count();
  expect(n).toBeGreaterThanOrEqual(7);
  expect(await page.locator('#sim-toolbar button.btn.btn-alt:not(#sim-sheet-close)').count(), '工具列按鈕沒有全部是 .btn-alt').toBe(n);
  expect(await page.locator('#sim-toolbar').innerText(), '還有 ↶ ↷ 文字').not.toMatch(/[↶↷]/);
  for (const id of ['#sim-undo', '#sim-redo']) {
    await expect(page.locator(`${id} > svg.icon`)).toHaveCount(1);
    await expect(page.locator(id)).toHaveAttribute('aria-label', /.+/);
  }
  // 長相：可按的工具列鈕是 .btn-alt 的紫色鍵帽（漸層、--r-btn、下緣厚度）。只驗 class 的話，
  // 有人寫回 `#sim-toolbar button { background…; border-radius… }` 會安靜地蓋掉 .btn 而照樣綠。
  const key = await page.locator('#sim-reset').evaluate(el => {
    const c = getComputedStyle(el);
    return { img: c.backgroundImage, radius: c.borderTopLeftRadius, shadow: c.boxShadow };
  });
  expect(key.img, '工具列鈕沒有次按鈕的紫色漸層').toContain('linear-gradient');
  expect(key.radius, '工具列鈕不是 --r-btn').toBe('10px');
  expect(key.shadow, '工具列鈕沒有實體厚度').toMatch(/0px 3px 0px 0px/);
  // 停用：開頁時沒有歷史可以復原。看得出來（opacity < 1）、按不動（transform 維持 none）。
  const undo = page.locator('#sim-undo');
  await expect(undo).toBeDisabled();
  expect(Number(await undo.evaluate(el => getComputedStyle(el).opacity)), '停用的復原鈕看不出停用').toBeLessThan(1);
  if (!isMobile) {
    await undo.scrollIntoViewIfNeeded();
    const b = (await undo.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(150);
    const t = await undo.evaluate(el => getComputedStyle(el).transform);
    await page.mouse.move(0, 0);
    await page.mouse.up();
    expect(t, '停用的鈕按下去仍然縮了').toBe('none');
  } else {
    // sheet 的把手：不是 .btn，而且真人點得到（中心點命中它自己，不是被別的東西蓋住）。
    const grip = page.locator('#sim-sheet-close');
    await expect(grip).toBeVisible();
    expect(await grip.evaluate(el => el.classList.contains('btn')), '把手不該是 .btn').toBe(false);
    // 刪掉 `#sim-toolbar button` 之後把手的 cursor／color 要由它自己的規則補回（Review Focus 3）。
    expect(await grip.evaluate(el => getComputedStyle(el).cursor), '把手不是 pointer').toBe('pointer');
    expect(await grip.evaluate(el => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return el === top || el.contains(top);
    }), '把手被蓋住了').toBe(true);
  }

  // 詳情的行動鈕：點一顆可取得的節點會直接取得，所以主按鈕要用「還不能取得」的 1301 看——
  // 它的行動鈕是金色的「一鍵點亮到這裡」（S20 用同一顆：離 1001 夠近，手機抽屜升起也點得到）。
  await closeTools(page);
  await tapNode(page, '1301');
  const cta = page.locator('#sim-detail .cta');
  await expect(cta).toHaveCount(1);
  const c = await cta.evaluate(el => ({ cls: el.className, img: getComputedStyle(el).backgroundImage, w: el.getBoundingClientRect().width, pw: el.parentElement!.getBoundingClientRect().width }));
  expect(c.cls).toContain('btn-pri');
  expect(c.img, '行動鈕沒有金色漸層').toContain('linear-gradient');
  expect(c.w, '行動鈕沒有撐滿側欄寬度').toBeGreaterThan(c.pw * 0.9);
  // 已取得的節點（READY 點一下就取得）＝破壞性的「取消此節點」：次按鈕，不是金色。
  await tapNode(page, READY);
  await expect(page.locator('#sim-detail .cta.danger')).toHaveCount(1);
  expect(await page.locator('#sim-detail .cta.danger').evaluate(el => el.className)).toContain('btn-alt');
  expect(await page.locator('.btn-pri').count(), '一頁最多一顆 .btn-pri').toBeLessThanOrEqual(1);
});

// ── 2026-09-24 review P3 ──────────────────────────────────────────────────────

/** 頁面內一顆一顆 focus（同 tree.spec 的 A1），回傳聚焦後中心沒命中畫布的節點。 */
const unreachableFocus = (page: Page): Promise<string[]> => page.evaluate(async () => {
  const frames = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const out: string[] = [];
  for (const btn of document.querySelectorAll<HTMLButtonElement>('.tree-a11y-node')) {
    btn.focus();
    await frames();
    const r = window.__tree.nodeScreenRect(btn.dataset['id']!)!;
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (el?.tagName !== 'CANVAS') out.push(`${btn.dataset['id']}→${el ? `${el.tagName}#${el.id}` : 'offscreen'}`);
  }
  return out;
});

// tree-canvas-5 的 /sim 那一半：controller 的 ensureVisible 要避開工具列、側欄、抽屜與浮動鍵。
test('S35. Tab 走過每一顆節點：鍵盤帶進畫面的節點不被工具列、側欄、抽屜蓋住', { tag: '@mobile' }, async ({ page, isMobile }) => {
  test.setTimeout(120_000);
  await openSim(page);
  expect(await unreachableFocus(page), '這些節點聚焦後中心被蓋住').toEqual([]);
  if (isMobile) return;
  // 721–1200 寬：工具列在側欄左邊換成好幾列（gap-canvas-mobile-1），遮蔽物形狀跟 1280 不一樣。
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.waitForTimeout(200);
  expect(await unreachableFocus(page), '1024×768 下這些節點聚焦後中心被蓋住').toEqual([]);
});

test('S36. 721–1200px 寬：工具列不壓到側欄的「資源合計」與總計列', async ({ page, isMobile }) => {
  test.skip(isMobile, '手機版工具列是底部 sheet');
  for (const [w, h] of [[768, 1024], [820, 1180], [1024, 768], [844, 390], [1200, 800]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await openSim(page);
    const hits = await page.evaluate(() => ['#sim-totals h2', '#sim-total'].map(sel => {
      const r = document.querySelector(sel)!.getBoundingClientRect();
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { sel, inPanel: Boolean(el?.closest('#sim-panel')) };
    }));
    // h2 在 ≤720 才被視覺隱藏；這裡全是桌機版面，兩個都要看得到。
    expect(hits.filter(x => !x.inPanel), `${w}×${h} 被蓋住`).toEqual([]);
    const gap = await page.evaluate(() =>
      document.getElementById('sim-panel')!.getBoundingClientRect().left
      - document.getElementById('sim-toolbar')!.getBoundingClientRect().right);
    expect(gap, `${w}×${h} 工具列伸進側欄`).toBeGreaterThanOrEqual(-0.5);
  }
});

test('S37. 桌機的初始視角以「扣掉側欄的可視區」置中；夠寬時沒有節點藏在側欄底下', async ({ page, isMobile }) => {
  test.skip(isMobile, '手機沒有常駐側欄');
  // 1280 以下可讀性下限（minReadableScale）讓樹比可視區還寬，左右各超出一截是必然的；
  // 要守的是「以可視區置中」，不是以含側欄的全寬置中（review 前 1280 寬 24 顆、1440 寬 12 顆在側欄底下）。
  for (const [w, h] of [[1024, 768], [1280, 800], [1440, 900], [1920, 1080]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await openSim(page);
    const r = await page.evaluate(ids => {
      const p = document.getElementById('sim-panel')!.getBoundingClientRect();
      const host = document.getElementById('canvas-host')!.getBoundingClientRect();
      let minX = Infinity, maxX = -Infinity, under = 0;
      for (const id of ids) {
        const n = window.__tree.nodeScreenRect(id)!;
        minX = Math.min(minX, n.left); maxX = Math.max(maxX, n.left + n.width);
        if (n.left + n.width / 2 >= p.left) under++;
      }
      return { off: (minX + maxX) / 2 - (host.left + p.left) / 2, under };
    }, tree.nodes.map(n => n.id));
    expect(Math.abs(r.off), `${w}×${h} 樹的中心偏離可視區中心 ${r.off}px`).toBeLessThan(20);
    if (w >= 1440) expect(r.under, `${w}×${h} 開頁就在側欄底下的節點`).toBe(0);
  }
});

// tree-canvas-6 的 /sim 那一半 ＋ sim-4：鍵盤 Enter 取得要聽得到、焦點進詳情、Esc 回得去。
test('S38. 鍵盤：按鈕帶狀態，Enter 取得有播報、焦點進詳情，Esc 回到那顆節點', { tag: '@mobile' }, async ({ page }) => {
  await openSim(page);
  const btn = page.locator(`.tree-a11y-node[data-id="${READY}"]`);
  await expect(btn).toHaveAttribute('aria-description', /可取得/);
  await expect(page.locator(`.tree-a11y-node[data-id="${FREE_IDS[0]}"]`)).toHaveAttribute('aria-description', '已取得');
  await btn.focus();
  await page.keyboard.press('Enter');
  const name = tree.nodes.find(n => n.id === READY)!.name;
  await expect(page.locator('#sim-toast')).toHaveText(`已取得 ${name}`);
  expect(await page.evaluate(() => {
    const t = document.getElementById('sim-toast')!.getBoundingClientRect();
    return document.elementFromPoint(t.left + t.width / 2, t.top + t.height / 2)?.id ?? null;
  }), 'toast 接走了底下的點擊（要 pointer-events: none）').not.toBe('sim-toast');
  await expect(btn).toHaveAttribute('aria-description', /^已取得，Lv\.1 \/ 50/);
  await expect(btn).toHaveAttribute('aria-current', 'true');
  expect(await page.evaluate(() => document.activeElement?.matches('#sim-detail h3') ? document.activeElement.textContent : null),
    'Enter 之後焦點要在詳情的標題').toBe(name);
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest('#sim-panel'))), '往後 Tab 是詳情裡的控制項').toBe(true);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset['id'] ?? null), 'Esc 回到原節點').toBe(READY);
  await expect(btn).toHaveAttribute('aria-current', 'true');   // 只回焦點，選取不動
  await page.keyboard.press('Escape');                         // 節點上再按一次才取消選取
  await expect(btn).not.toHaveAttribute('aria-current', /.*/);
  // 搜尋淡出也要讀得到
  await openTools(page);
  await page.locator('#sim-search').fill('完全不存在的名字');
  await expect(btn).toHaveAttribute('aria-description', /不符合搜尋$/);
  // 淡出的節點按 Enter 是取消選取、不是取得：不能說「按下即取得」（PR #90 review）
  await expect(page.locator(`.tree-a11y-node[data-id="${TIER_F}"]`)).toHaveAttribute('aria-description', '可取得，不符合搜尋');
});

// gap-canvas-mobile-3：抽屜為了露出主按鈕長高之後，被選的節點不能留在它底下。
test('S39. 手機版：選了畫面下半部的節點，抽屜長高後節點仍然看得到', { tag: '@mobile' }, async ({ page, isMobile }) => {
  test.skip(!isMobile, '桌機的側欄在右邊，不會蓋住剛點的節點');
  await openSim(page);
  // 收起狀態下看得見、而且最靠下的那顆（抽屜一長高它最先被蓋住）。
  const id = await page.evaluate(ids => {
    const panelTop = document.getElementById('sim-panel')!.getBoundingClientRect().top;
    let best: string | null = null, bestY = -1;
    for (const nid of ids) {
      const r = window.__tree.nodeScreenRect(nid)!;
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      if (cy > panelTop - 40 || cy < 80 || cx < 20 || cx > innerWidth - 80) continue;
      if (document.elementFromPoint(cx, cy)?.tagName !== 'CANVAS') continue;
      if (cy > bestY) { bestY = cy; best = nid; }
    }
    return best;
  }, tree.nodes.map(n => n.id));
  expect(id).not.toBeNull();
  const r0 = await nodeRect(page, id!);
  await page.mouse.click(r0.left + r0.width / 2, r0.top + r0.height / 2);
  await expect(page.locator('#sim-detail h3')).toBeVisible();
  await page.waitForTimeout(600);   // 緩動平移（--t-med）落地
  const hit = await page.evaluate(nid => {
    const r = window.__tree.nodeScreenRect(nid)!;
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.tagName ?? null;
  }, id!);
  expect(hit, `${id} 選了之後中心被抽屜（或浮動鍵）蓋住`).toBe('CANVAS');

  // 右側那一欄（浮動鍵的位置）：浮動鍵跟著抽屜滑上來，平移時要用它的終點算（PR #90 review：3405）。
  await openSim(page);
  const right = await page.evaluate(ids => {
    const pt = document.getElementById('sim-panel')!.getBoundingClientRect().top;
    return ids.filter(nid => {
      const r = window.__tree.nodeScreenRect(nid)!;
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      return cx > innerWidth - 90 && cx < innerWidth - 10 && cy > innerHeight * 0.45 && cy < pt - 30
        && document.elementFromPoint(cx, cy)?.tagName === 'CANVAS';
    });
  }, tree.nodes.map(n => n.id));
  expect(right.length, '右側下半部沒有候選節點（前提不成立）').toBeGreaterThan(0);
  const covered: string[] = [];
  for (const nid of right) {
    await openSim(page);
    const r = await nodeRect(page, nid);
    await page.mouse.click(r.left + r.width / 2, r.top + r.height / 2);
    await page.waitForTimeout(600);
    const h = await page.evaluate(x => {
      const q = window.__tree.nodeScreenRect(x)!;
      const el = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
      return el ? `${el.tagName}#${el.id}` : 'offscreen';
    }, nid);
    if (h !== 'CANVAS#') covered.push(`${nid}→${h}`);
  }
  expect(covered, '右側節點選了之後被浮動鍵蓋住').toEqual([]);
});

// gap-canvas-mobile-2：矮螢幕（手機橫放 ≤720 寬）抽屜撐高時浮動鍵不能被推出畫面。
test('S40. 手機橫放：選了節點之後兩顆浮動鍵仍在畫面裡、點得到', { tag: '@mobile' }, async ({ page, isMobile }) => {
  test.skip(!isMobile, '桌機沒有浮動鍵');
  for (const [w, h] of [[667, 375], [640, 360]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await openSim(page);
    await page.locator(`.tree-a11y-node[data-id="${WITH_KIDS}"]`).evaluate(el => (el as HTMLElement).click());
    await page.waitForTimeout(300);
    const fabs = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#sim-fabs button')].map(el => {
      const r = el.getBoundingClientRect();
      return { id: el.id, hit: el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)) };
    }));
    expect(fabs.filter(f => !f.hit), `${w}×${h} 浮動鍵被蓋住或出了畫面`).toEqual([]);
    // 主按鈕仍然在抽屜可視範圍內（抽屜矮了，差的部分由捲動補）
    const inside = await page.evaluate(() => {
      const c = document.querySelector('#sim-detail .cta')!.getBoundingClientRect();
      const p = document.getElementById('sim-panel')!.getBoundingClientRect();
      return c.top >= p.top - 0.5 && c.bottom <= p.bottom + 0.5;
    });
    expect(inside, `${w}×${h} 主按鈕在抽屜外`).toBe(true);
  }
  // 直立拖到頂再轉橫放：抽屜要重新夾（PR #90 review：CSS 只有 80dvh，浮動鍵被推到 −36）。
  await page.setViewportSize({ width: 360, height: 640 });
  await openSim(page);
  const b = (await page.locator('#sim-panel-handle').boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + 20);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, 60, { steps: 10 });
  await page.mouse.up();
  await page.setViewportSize({ width: 640, height: 360 });
  await page.waitForTimeout(300);
  const rotated = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#sim-fabs button')].map(el => {
    const r = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
  }));
  expect(rotated, '轉橫放之後浮動鍵被推出畫面').toEqual([true, true]);
});

// gap-canvas-mobile-8：在把手外放開之後，鍵盤 Enter 一次就要收合。
test('S41. 手機版：拖抽屜在把手外放開之後，鍵盤按一次 Enter 就收合', { tag: '@mobile' }, async ({ page, isMobile }) => {
  test.skip(!isMobile, '桌機沒有可拖曳的抽屜把手');
  await openSim(page);
  const b = (await page.locator('#sim-panel-handle').boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, 5, { steps: 12 });   // 拉過上限，手指早就不在把手上
  await page.mouse.up();
  await expect(page.locator('#sim-panel-handle')).toHaveAttribute('aria-expanded', 'true');
  await page.locator('#sim-panel-handle').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#sim-panel-handle')).toHaveAttribute('aria-expanded', 'false');
});

// gap-canvas-mobile-9：revealDetail 撐出來的高度不准變成使用者的偏好。
test('S42. 手機版：選節點撐開的抽屜收合後，下次展開回到使用者自己的高度', { tag: '@mobile' }, async ({ page, isMobile }) => {
  test.skip(!isMobile, '桌機沒有抽屜');
  await openSim(page);
  await page.evaluate(() => localStorage.setItem('rd2-wiki:sim-panel-h', JSON.stringify({ h: 256, open: false })));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__tree));
  const panelH = () => page.locator('#sim-panel').evaluate(el => el.getBoundingClientRect().height);
  await page.locator(`.tree-a11y-node[data-id="${WITH_KIDS}"]`).evaluate(el => (el as HTMLElement).click());
  expect(await panelH(), '選節點沒有撐開抽屜（前提不成立）').toBeGreaterThan(300);
  await page.locator('#sim-panel-handle').click();                 // 收合
  expect(await panelH()).toBeLessThan(80);
  await page.locator('#sim-panel-handle').click();                 // 記憶體那份
  expect(Math.abs((await panelH()) - 256)).toBeLessThan(2);
  await page.locator('#sim-panel-handle').click();
  await page.reload({ waitUntil: 'networkidle' });                 // 存進去那份
  await page.waitForFunction(() => Boolean(window.__tree));
  await page.locator('#sim-panel-handle').click();
  expect(Math.abs((await panelH()) - 256), '重整後展開沒有回到 256').toBeLessThan(2);
});

// sim-3：原生 <dialog>，焦點困在裡面、關掉回到入口。
test('S43. 能力彙總：Tab 不會跑出對話框，✕／Esc 關掉後焦點回到「能力彙總」', { tag: '@mobile' }, async ({ page }) => {
  await openSim(page);
  await openTools(page);
  for (const close of ['button', 'escape'] as const) {
    await page.locator('#sim-abilities').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#sim-ability-modal')).toBeVisible();
    // 背景是 inert：Tab 只會在對話框裡，或離開文件到瀏覽器 UI（activeElement＝body，規範允許），
    // 不會落到對話框後面的頁面元素上（舊版 <div role="dialog"> 一 Tab 就到畫布的節點按鈕）。
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => {
        const a = document.activeElement;
        return !a || a === document.body || Boolean(a.closest('#sim-ability-modal'));
      }), 'Tab 跑到對話框後面的頁面元素').toBe(true);
    }
    if (close === 'button') await page.locator('#sim-ability-close').click();
    else await page.keyboard.press('Escape');
    await expect(page.locator('#sim-ability-modal')).toBeHidden();
    await expect(page.locator('#sim-abilities'), `${close} 關掉後焦點沒回到入口`).toBeFocused();
  }
  // Safari 點按鈕不給焦點：開啟前焦點在 <body>，瀏覽器「還給開啟前的元素」會還到 <body>。
  // 模擬這條路（開之前 blur），關掉後仍要回到入口。
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); document.getElementById('sim-abilities')!.click(); });
  await expect(page.locator('#sim-ability-modal')).toBeVisible();
  await page.locator('#sim-ability-close').click();
  await expect(page.locator('#sim-abilities'), '開啟前焦點在 body 時，關掉後沒回到入口').toBeFocused();
  // 點盒子外面（dialog 自己）也關得掉
  await page.locator('#sim-abilities').click();
  await page.mouse.click(5, (page.viewportSize()!.height) - 5);
  await expect(page.locator('#sim-ability-modal')).toBeHidden();
});

// sim-2：兩個分頁不互相覆寫。
test('S44. 另一個分頁改了規劃，這一頁跟上，再操作也不會蓋掉它', async ({ page, context }) => {
  await openSim(page);
  const other = await context.newPage();
  await other.goto('/sim', { waitUntil: 'networkidle' });
  await other.waitForFunction(() => Boolean(window.__tree));
  await tapNode(other, READY);
  await expect.poll(async () => (await owned(page)).includes(READY), '這一頁沒跟上另一個分頁').toBe(true);
  await expect(page.locator('#sim-toast')).toContainText('已同步');
  await tapNode(page, TIER_F);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('rd2-sim-v1')!).unlocked as string[]);
  expect(saved).toEqual(expect.arrayContaining([READY, TIER_F]));
  // 被換掉的那份在復原裡
  await page.locator('#sim-undo').click();
  await page.locator('#sim-undo').click();
  expect(await owned(page)).not.toContain(READY);

  // 另一個分頁拖等級滑桿＝一連串 storage 事件：只推一步 undo（PR #90 review：原本每一格推一步）。
  await page.locator('#sim-redo').click();
  await page.locator('#sim-redo').click();
  const before = await owned(page);
  for (let lv = 2; lv <= 6; lv++) {
    await other.evaluate(([id, lv]) => localStorage.setItem('rd2-sim-v1',
      JSON.stringify({ v: 1, unlocked: [id], levels: { [id]: lv }, initial: [] })), [READY, lv] as const);
    await other.waitForTimeout(50);
  }
  await expect.poll(async () => (await owned(page)).includes(TIER_F), '這一頁沒跟上').toBe(false);
  await page.locator('#sim-undo').click();
  expect((await owned(page)).sort(), '一次復原要回到這一串同步之前').toEqual(before.sort());

  // 另一個分頁 localStorage.clear()：持有量輸入框也要清空
  await openTools(page);
  await page.locator('#sim-limit-toggle').click();
  await page.locator('#sim-limit-core').fill('77');
  await other.evaluate(() => localStorage.clear());
  await expect(page.locator('#sim-limit-core')).toHaveValue('');
  await other.close();
});

// sim-8 ＋ sim-1：持有量重整後還在；剛好夠用印「剩餘 0」。
test('S45. 持有資源重新整理後還在；剛好夠用印「剩餘 0」不是「-0」', async ({ page }) => {
  await openSim(page);
  await openTools(page);
  await page.locator('#sim-limit-toggle').click();
  await page.locator('#sim-limit-core').fill('0');
  await expect(page.locator('#sim-gap')).toHaveText(/核心\s*剩餘 0$/);
  await page.locator('#sim-limit-gold').fill('1234');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__tree));
  await expect(page.locator('#sim-limit-core')).toHaveValue('0');
  await expect(page.locator('#sim-limit-gold')).toHaveValue('1234');
  await expect(page.locator('#sim-gap')).toContainText('剩餘 1,234');
});

// sim-6 ＋ sim-7：連帶取消要說出來；空的規劃按重置不推復原。
test('S46. 取消勾選初始骰子說出連帶取消幾顆；空規劃按重置不推一步復原', async ({ page }) => {
  await openSim(page);
  await openTools(page);
  await page.locator('#sim-reset').click();
  await expect(page.locator('#sim-toast')).toHaveText('規劃已經是空的');
  await expect(page.locator('#sim-undo')).toBeDisabled();

  const edges = (readTree() as { edges: [string, string][] }).edges;
  const opt = OPTIONAL_IDS.find(id => edges.some(([from]) => from === id))!;
  const child = edges.find(([from]) => from === opt)![1];
  await page.locator('#sim-initial-toggle').click();
  await page.locator(`[data-initial="${opt}"]`).check();
  await closeTools(page);
  await tapNode(page, child);   // 前置齊了，點一下就取得
  await expect.poll(async () => (await owned(page)).includes(child)).toBe(true);
  await openTools(page);
  if (await page.locator('#sim-initial-menu').isHidden()) await page.locator('#sim-initial-toggle').click();
  await page.locator(`[data-initial="${opt}"]`).uncheck();
  await expect(page.locator('#sim-toast')).toHaveText(/^已連帶取消 \d+ 個後續節點（可按復原）$/);
});

// PR #90 review：手機 reveal 動畫進行中，鍵盤 Tab 到別顆節點（controller 的 ensureVisible 自己平移）
// 要停掉動畫，不然剩下的幀疊上去，新聚焦的節點被推歪、甚至推回抽屜底下。
test('S47. 手機版：選節點的平移還在跑時 Tab 到別顆，新聚焦的節點落定後不再被推走', { tag: '@mobile' }, async ({ page, isMobile }) => {
  test.skip(!isMobile, '桌機沒有 reveal 平移');
  await openSim(page);
  const bad = await page.evaluate(async ids => {
    const frames = (n: number) => new Promise(r => { const f = (k: number) => k ? requestAnimationFrame(() => f(k - 1)) : r(null); f(n); });
    const out: string[] = [];
    const panelTop = () => document.getElementById('sim-panel')!.getBoundingClientRect().top;
    // 收起狀態下最靠下、看得見的幾顆：選了它們一定要平移
    const low = ids.map(id => ({ id, r: window.__tree.nodeScreenRect(id)! }))
      .filter(x => x.r.top + x.r.height / 2 < panelTop() - 40 && x.r.top > 120 && x.r.left > 20 && x.r.left < innerWidth - 90)
      .sort((a, b) => b.r.top - a.r.top).slice(0, 4).map(x => x.id);
    for (const id of low) {
      document.documentElement.style.setProperty('--sim-panel-user-h', '56px');
      (document.querySelector(`.tree-a11y-node[data-id="${id}"]`) as HTMLElement).click();
      await frames(2);                                   // 動畫剛開始
      const next = document.querySelector<HTMLElement>(`.tree-a11y-node[data-id="${id}"]`)!.parentElement!
        .nextElementSibling?.querySelector<HTMLElement>('.tree-a11y-node') ?? null;
      if (!next) continue;
      next.focus();
      await frames(2);                                   // ensureVisible 落地
      const a = window.__tree.nodeScreenRect(next.dataset['id']!)!;
      await frames(30);                                  // 動畫本來會跑完的時間之後
      const r = window.__tree.nodeScreenRect(next.dataset['id']!)!;
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const drift = Math.hypot(r.left - a.left, r.top - a.top);
      if (el?.tagName !== 'CANVAS' || drift > 0.5) {
        out.push(`${id}→${next.dataset['id']}: ${el ? el.tagName + '#' + el.id : 'offscreen'} drift ${drift.toFixed(1)}`);
      }
    }
    return out;
  }, tree.nodes.map(n => n.id));
  expect(bad).toEqual([]);
});

// PR #90 review：拖等級滑桿時另一個分頁存檔 → 同步不准重建詳情（會把手上按著的滑桿換掉、拖曳斷掉）。
test('S48. 拖等級滑桿途中另一個分頁改了存檔：滑桿不被換掉，照樣拖得到底', async ({ page, context, isMobile }) => {
  test.skip(isMobile, '觸控拖曳原生 range 在 Playwright 驅動不了（src/CLAUDE.md S17 那條）');
  await openSim(page);
  await tapNode(page, READY);
  const range = page.locator('#sim-level-range');
  await range.evaluate(el => { (el as unknown as { __mark: number }).__mark = 1; });
  const b = (await range.boundingBox())!;
  await page.mouse.move(b.x + 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 });
  const other = await context.newPage();
  await other.goto('/sim', { waitUntil: 'networkidle' });
  await other.evaluate(() => localStorage.setItem('rd2-sim-v1',
    JSON.stringify({ v: 1, unlocked: ['1201', '1109'], levels: {}, initial: [] })));
  await page.waitForTimeout(200);
  await page.mouse.move(b.x + b.width - 1, b.y + b.height / 2, { steps: 5 });
  // 放開之前量：放開時的 change 本來就會整段重畫（那是刻意的）。
  expect(await page.locator('#sim-level-range').evaluate(el => (el as unknown as { __mark?: number }).__mark ?? null),
    '拖曳途中滑桿元素被換掉了').toBe(1);
  await expect(page.locator('.sim-level-value')).toHaveText('Lv.50 / 50');
  await page.mouse.up();
  await other.close();
});
