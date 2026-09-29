// `/sim` 骰子樹模擬器的掛載與互動。
//
// 狀態機、費用計算、能力彙總、存檔與報告全部在 src/lib/sim.ts 與 src/lib/sim-io.ts
// （純函式、測得動）。這裡只做三件事：把狀態畫成畫面、把事件翻成狀態轉換、存檔。
//
// 畫布跟 /tree 共用 src/lib/canvas/ 那一層（`mountCanvasTree()`）：平移、雙指縮放、滾輪、
// 5px 拖曳門檻、命中測試、無障礙節點按鈕、LOD 與投影門檻全在 controller 裡，這一頁只餵狀態
// （`setState({ sim })`）與收「使用者選了哪一顆」（`onSelect`）。⚠️ 這裡以前另外維護一份
// SVG 渲染器（src/lib/render.ts）與 Viewport，平移縮放、點選判定、等級牌各寫了第二份——
// 那正是這個 repo 反覆被咬的「複製第二份出去」（規則 21 複製規則 7、FILTERS_MS 複製 --t-med）。
// 模擬器的差異全部收斂成 state.ts 的 `SimPaint`，controller 內沒有第二條繪圖路徑。
import { treeData as rawData } from '../lib/tree-data.js';
import rawTables from '../../data/passive-upgrade-cost.json';
import { mountCanvasTree, type ScreenRect } from '../lib/canvas/canvas-tree.js';
import { animatePan } from '../lib/canvas/animate-pan.js';
import { visibleRects } from '../lib/canvas/obscurers.js';
import type { SimPaint } from '../lib/canvas/state.js';
import { cssMs } from '../lib/css-ms.js';
import {
  DESKTOP_ICON_TARGET_PX, MOBILE_ICON_TARGET_PX, minReadableScale,
} from '../lib/canvas/view.js';
import { isTypingTarget } from '../lib/filter.js';
import {
  buildSimContext, initialSimState, ownedIds, isAvailable, missingParents, missingPrereqRanks,
  unlockNode, removeNode, setNodeLevel, setInitialDice, pathTo, unlockMany,
  simTotals, maxSelectableLevel, minSelectableLevel, summarizeAbilities, resourceGap, gapText,
} from '../lib/sim.js';
import type { AbilityGroup, GapEntry, SimHoldings, SimState } from '../lib/sim.js';
import { SIM_STORAGE_KEY, deserializeSim, serializeSim, simReport } from '../lib/sim-io.js';
import { simPaintFor } from '../lib/sim-paint.js';
import { buildScene, type Scene } from '../lib/canvas/scene.js';
import { compactSections, headerTotalLine } from '../lib/sim-image.js';
import { renderCompactImage, renderFullImage } from './sim-export-image.js';
import { levelTableFor, upgradeExtraCost } from '../lib/upgrade-tiers.js';
import { costHtml, currencyIcon, mythicIcon, simCostHtml } from '../lib/cost-html.js';
import { subCost, zeroCost } from '../lib/cost.js';
import { MYTHIC_CORES, mythicCoreByKind } from '../lib/currency.js';
import { typeLabel } from '../lib/labels.js';
import { renderTaggedText } from '../lib/markup.js';
import type { Cost, PassiveUpgradeCost, TreeData, TreeNode } from '../lib/types.js';

/** 「這一級沒有追加花費」的零成本。 */
const ZERO_COST: Cost = zeroCost();

const data = rawData as unknown as TreeData;
const tables = rawTables as unknown as PassiveUpgradeCost;
const ctx = buildSimContext(data, tables);

const GROUP_ZH: Record<AbilityGroup, string> = {
  global: '全部骰子', nature: '自然', engineering: '工學', magic: '魔法', order: '秩序', chaos: '渾沌',
};

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

// --- 畫布 -------------------------------------------------------------------
const host = $('canvas-host');
// controller 會在 host 底下掛兩張 canvas（靜態層／互動層）與一份無障礙節點按鈕清單，
// 並自己接上 pointer（拖曳平移、雙指縮放、滾輪、hover 命中）與鍵盤焦點。
// ⚠️ 跟 `/tree` 呼叫的是**同一支、同樣的參數**：模擬器的差異全部由 `setState({ sim })`
// 表達，controller 內部沒有第二條繪圖路徑，也沒有任何「這是 /sim」的旗標可傳
// （見 canvas-tree.ts 的 MountOptions）。`obscurers` 不是這種旗標：兩頁各自量自己的浮層。
const tree = mountCanvasTree(host, data, { obscurers: obscuringRects });
// `vp` 是 controller 的座標狀態機（src/lib/canvas/view.ts）。
// ⚠️ 它吃的是**相對 host 的 CSS px**，不是 clientX/clientY。
const vp = tree.view;

const isMobile = typeof matchMedia === 'function' && matchMedia('(width <= 720px)').matches;

/**
 * 疊在畫布上、看得見的浮層（視窗座標），給 controller 的鍵盤焦點 ensureVisible 與手機版選節點後
 * 的 revealSelected() 共用（2026-09-24 review tree-canvas-5 的 /sim 那一半）。
 * 桌機：左上的工具列、右側整條側欄。手機：抽屜、兩顆浮動鍵、升起來時的 sheet
 * （收起的 sheet 是 visibility: hidden，visibleRects() 會跳過）。
 * ⚠️ 宣告是 function（會 hoist）：mountCanvasTree() 在它之前就拿到這個參照。
 */
function obscuringRects(): ScreenRect[] {
  const rects = visibleRects(['sim-toolbar', 'sim-panel']);
  // ⚠️ 浮動鍵不能直接量：它的 bottom 綁 `--sim-panel-h`，那個變數由 ResizeObserver **之後**才寫、
  // 而且 bottom 還有過場——revealDetail() 剛把抽屜撐高時量到的是舊位置（在新抽屜範圍裡、等於沒算），
  // 平移完它才滑上來蓋住剛挪出來的節點（PR #90 review：390×844 點右下的 3405）。用終點算：
  // 抽屜上緣往上 FABS_GAP。
  const fabs = visibleRects(['sim-fabs'])[0];   // 桌機 display:none → 量不到
  if (fabs) rects.push({ ...fabs, top: $('sim-panel').getBoundingClientRect().top - FABS_GAP - fabs.height });
  return rects;
}

/** 桌機常駐側欄從 host 右緣吃掉多寬（手機或量不到時 0）。 */
function sidePanelInset(hostRect: DOMRect): number {
  if (mobile()) return 0;
  const p = $('sim-panel').getBoundingClientRect();
  return p.width > 0 ? Math.max(0, hostRect.right - p.left) : 0;
}

/**
 * 初始視角：整棵樹塞進容器，再套一次可讀性下限。
 *
 * `fitAll(0.9)` 沿用 SVG 時期 `fitTo()` 的 0.9 留白。之後那個下限跟 /tree 是同一條
 * （`minReadableScale()`）：容器夠扁時「整棵樹塞進去」跟「看得清圖示」不可能同時成立，
 * 優先保證看得清。⚠️ 縮放錨點是**相對 host 的 CSS px**（畫布中心），拿視窗座標進去的話
 * host 有 offset（導覽列高度）時畫面會被推走。
 */
function fitAll(): void {
  tree.fitAll(0.9);
  const rect = host.getBoundingClientRect();
  // ⚠️ 桌機的側欄常駐在 host 右邊（host 是全寬、在側欄底下）。以全寬置中的話樹的右半塞在側欄
  // 底下（2026-09-24 review gap-canvas-mobile-4：1024 寬 64 顆、1280 寬 24 顆節點中心被蓋）。
  // 樹寬超過可視寬度就先縮，最後再往左平移半個側欄寬，讓樹的中心落在可視區中央。
  const side = sidePanelInset(rect);
  const visW = rect.width - side;
  if (side > 0 && visW > 0) {
    const treeW = data.meta.viewBox[2] * vp.pxPerUnit;
    if (treeW > visW * 0.9) vp.zoomAt((visW * 0.9) / treeW, rect.width / 2, rect.height / 2);
  }
  const floor = minReadableScale(
    rect.width, rect.height, data.meta.viewBox[2], data.meta.viewBox[3],
    tree.scene.diceIconWidth, isMobile ? MOBILE_ICON_TARGET_PX : DESKTOP_ICON_TARGET_PX,
  );
  // 下限只是下限：fitAll 給的倍率已經夠大時不該反過來把畫面拉近。
  if (vp.scale < floor) vp.zoomAt(floor / vp.scale, rect.width / 2, rect.height / 2);
  if (side > 0) vp.pan(-side / 2, 0);
  // 直接動 vp 的地方要自己排一幀——controller 只在自己的 pointer／wheel 路徑上排。
  tree.requestRedraw();
}

// 平移、雙指縮放、滾輪縮放、視窗尺寸變化全部在 controller 裡（canvas-tree.ts 的 pointer
// 監聽器與 ResizeObserver），這裡一行都不寫——以前 /sim 與 /tree 各有一份，而那兩份對
// 「第二指落下要不要停掉單指拖曳」這種細節必須各自記得一次。

// --- 狀態與 undo／redo -------------------------------------------------------
const UNDO_LIMIT = 100;
let state: SimState = deserializeSim(readSaved(), ctx) ?? initialSimState(ctx);
const undoStack: SimState[] = [];
const redoStack: SimState[] = [];
let selected: string | null = null;

function readSaved(): string | null {
  // localStorage 在無痕模式、或使用者關掉網站資料時會直接丟例外（不是回 null）。
  try { return localStorage.getItem(SIM_STORAGE_KEY); } catch { return null; }
}

function save(): void {
  try { localStorage.setItem(SIM_STORAGE_KEY, serializeSim(state)); } catch { /* 存不了就算了，不影響這一次的模擬 */ }
}

/**
 * 套用一個狀態轉換並存檔，**但不碰 undo 堆疊、也不重畫**。回 false 代表那個操作不合法
 * （前置沒齊、等級超出範圍）或根本沒改變狀態。
 *
 * ⚠️ 持有資源**不擋**任何操作（2026-09-23 以前這幾格是「上限」，會擋掉變貴的方向）：
 * 規劃超過手上的量是常態，玩家要看的是還差多少，那份差額由 renderTotals() 畫在側欄。
 */
function applyState(next: SimState | null): boolean {
  if (next === null || next === state) return false;
  state = next;
  save();
  return true;
}

/**
 * 推一步 undo、清掉 redo。**本頁自己的操作**（commit、放開等級滑桿）走這裡；跨分頁同步也推，
 * 但一串連續同步只推第一次（見 syncFromStorage 的 syncBurst）。
 */
function pushUndo(prev: SimState, fromSync = false): void {
  undoStack.push(prev);
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  redoStack.length = 0;
  syncBurst = fromSync;
}
/** 上一步 undo 是跨分頁同步推的、之後本頁還沒自己動過。 */
let syncBurst = false;

/** applyState ＋ 推一步 undo ＋ 重畫。一般的單次操作都走這裡。 */
function commit(next: SimState | null): boolean {
  const before = state;
  if (!applyState(next)) return false;
  pushUndo(before);
  render();
  return true;
}

function undo(): void {
  const prev = undoStack.pop();
  if (!prev) return;
  redoStack.push(state);
  state = prev;
  syncBurst = false;
  save();
  render();
}

function redo(): void {
  const next = redoStack.pop();
  if (!next) return;
  undoStack.push(state);
  state = next;
  syncBurst = false;
  save();
  render();
}

/**
 * 另一個分頁改了存檔（`storage` 事件），或從 bfcache 回到這一頁（`pageshow`）：換成存檔裡的那份。
 *
 * ⚠️ 不跟上的話兩個 /sim 分頁會互相覆寫：`save()` 每次都把**整份**記憶體裡的狀態寫回去，
 * B 分頁解了 5 顆、回 A 分頁再解一顆，B 的 5 顆就沒了，全程沒有任何提示（2026-09-24 review sim-2）。
 * 被換掉的那份推進 undo（按復原救得回來），不是清空堆疊。自己不 save()：內容就是從存檔來的。
 */
function syncFromStorage(): void {
  // ⚠️ 這一頁正在拖等級滑桿：render() 會整段重寫詳情、把手上按著的滑桿換掉（見 updateLevelReadout），
  // 拖曳當場斷掉。延到放開（change）再同步——那時存檔多半已被這一頁的拖曳寫回自己那份，同步是 no-op，
  // 另一個分頁那一步則由它自己的 storage 事件推進它自己的 undo（PR #90 review）。
  if (levelDragFrom !== null) { syncPending = true; return; }
  const next = deserializeSim(readSaved(), ctx) ?? initialSimState(ctx);
  if (serializeSim(next) === serializeSim(state)) return;
  // ⚠️ 一串連續同步只推一步 undo：另一個分頁拖等級滑桿時每一格都 save()，每一格都是一次 storage
  // 事件——每次都推的話拖一顆 50 級節點就塞進 49 步幾乎一樣的復原、把這一頁真正的歷史擠出 UNDO_LIMIT
  // （PR #90 review）。本頁自己動過（pushUndo／undo／redo）之後，下一次同步才重新推。
  if (!syncBurst) pushUndo(state, true);
  state = next;
  // 焦點在詳情裡（鍵盤使用者）時，innerHTML 重寫會把它丟回 <body>：接回標題。
  const hadFocus = $('sim-detail').contains(document.activeElement);
  render();
  if (hadFocus) $('sim-detail').querySelector<HTMLElement>('h3')?.focus({ preventScroll: true });
  toast('已同步其他分頁的變更（可按復原）');
}
let syncPending = false;

// --- 持有資源 ---------------------------------------------------------------
function readHolding(el: HTMLInputElement): number | null {
  const raw = el.value.trim();
  if (raw === '') return null;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
}

// 超越核心的持有欄由 sim.astro 依 MYTHIC_CORES 逐種產生（`sim-limit-<kind>`；id 沿用上限時代的名字）。
const MYTHIC_LIMIT_IDS = MYTHIC_CORES.map(d => [d.kind, `sim-limit-${d.kind}`] as const);
const HOLDING_INPUT: Record<string, string> = {
  core: 'sim-limit-core', gold: 'sim-limit-gold', ...Object.fromEntries(MYTHIC_LIMIT_IDS),
};

/**
 * 持有量另存一個鍵（2026-09-24 review sim-8：以前重新整理就要重填）。⚠️ 不塞進 `rd2-sim-v1`：
 * `/board` 讀那份存檔，改它的格式就得換鍵名，而換鍵名 `/board` 就讀不到（src/pages/CLAUDE.md 的 /board 與 /sim 兩節）。
 * 存的是輸入框的原字串（留白＝不計算，跟畫面一致），鍵是貨幣種類不是元素 id。
 */
const HOLDINGS_KEY = 'rd2-wiki:sim-holdings';

function saveHoldings(): void {
  const v = Object.fromEntries(Object.entries(HOLDING_INPUT).map(([k, id]) => [k, $<HTMLInputElement>(id).value]));
  try { localStorage.setItem(HOLDINGS_KEY, JSON.stringify(v)); } catch { /* 存不了就算了 */ }
}

/**
 * 回填輸入框。沒有存檔時不動（留白）；有存檔時以存檔為準，蓋掉瀏覽器自己還原的表單值。
 * `clearIfMissing`：另一個分頁 localStorage.clear() 之後存檔沒了，這一頁的輸入框也要跟著清空，
 * 不然差額一直拿著一份哪裡都不存在的數字算（PR #90 review）。
 */
function loadHoldings(clearIfMissing = false): void {
  let v: unknown = null;
  try { v = JSON.parse(localStorage.getItem(HOLDINGS_KEY) ?? 'null'); } catch { return; }
  if (v === null && clearIfMissing) v = {};
  if (typeof v !== 'object' || v === null) return;
  for (const [k, id] of Object.entries(HOLDING_INPUT)) {
    const raw = (v as Record<string, unknown>)[k];
    $<HTMLInputElement>(id).value = typeof raw === 'string' ? raw : '';
  }
}

function holdings(): SimHoldings {
  return {
    core: readHolding($<HTMLInputElement>('sim-limit-core')),
    gold: readHolding($<HTMLInputElement>('sim-limit-gold')),
    mythic: Object.fromEntries(MYTHIC_LIMIT_IDS.map(([kind, id]) => [kind, readHolding($<HTMLInputElement>(id))])),
  };
}

function gapIcon(key: string): string {
  if (key === 'core' || key === 'gold') return currencyIcon(key);
  const def = mythicCoreByKind(key);
  return def ? mythicIcon(def) : '';
}

/** 差額的一列：「還差」標警示色，夠用的印剩餘量。數字全來自 number，不含自由文字（innerHTML 安全）。 */
function gapRow(g: GapEntry): string {
  const text = gapText(g);
  return `<div class="sim-total-row ${g.short > 0 ? 'is-short' : 'is-enough'}" data-gap="${g.key}">`
    + `<dt>${gapIcon(g.key)}${g.label}</dt><dd>${text}</dd></div>`;
}

// --- 畫面 -------------------------------------------------------------------
/**
 * 把模擬器的狀態餵給畫布。
 *
 * canvas 裡畫的節點不是 DOM 元素、沒有 classList 可掛，所以舊版那一整套
 * `.sim-owned`／`.sim-available`／`.sim-locked`／`.sim-selected`／`.sim-linked`／
 * `.sim-active`／`.sim-ready` class 切換全部收斂成一份 `SimPaint`（src/lib/canvas/state.ts），
 * 由 painter 換算成 opacity 與顏色——數值是從舊的 CSS 規則原封不動搬過去的。
 *
 * ⚠️ 等級牌也不再是自己建的 `<g class="sim-badge">`：painter 依 `levels`／`maxLevels` 直接畫
 * （只畫 owned 且 `maxLevels > 1` 的那幾顆）。舊版那份 SVG 實作踩過一個測試完全看不到的坑
 * ——**SVG 元素不吃 HTML 的 `hidden` 屬性**，`toggleAttribute('hidden')` 是完全沒有作用的
 * 一行，239 個牌子全部留在畫面上，全套測試綠、截圖才看得出來。
 */
function renderCanvas(): void {
  const paint = simPaintFor(state, ctx, data, selected);
  tree.setState({ sim: paint });
  syncButtons(paint);
}

/**
 * 把模擬器狀態寫到無障礙節點按鈕上（2026-09-24 review sim-4／tree-canvas-6）。
 *
 * 畫布上「已取得／可取得／鎖住」全是顏色，按鈕的 aria-label 只在掛載時寫一次（名稱，類型，成本），
 * 讀屏使用者按 Enter 之前聽不出這顆取得了沒——而可取得的節點按 Enter 就直接花資源取得。
 * - 狀態走 `aria-description`，**不動 aria-label**：a11y.ts 是 /tree 共用的，aria-label 也是
 *   E2E 選取器與 a11y.test 斷言的來源。
 * - 選取走 `aria-current`（同 /tree 的 markSelectedButton）。
 * - 只寫有變的那幾顆：拖等級滑桿時每一格都會跑到這裡。
 */
const describedAs = new Map<string, string>();
let lastPaint: SimPaint | null = null;
let markedSelected: string | null = null;

function describeNode(id: string, p: SimPaint): string {
  let text: string;
  if (p.owned.has(id)) {
    const max = p.maxLevels.get(id) ?? 1;
    text = max > 1 ? `已取得，Lv.${p.levels.get(id) ?? 1} / ${max}` : '已取得';
  } else if (ctx.optional.has(id)) text = '未勾選的初始骰子';
  // 被搜尋淡出的節點按 Enter 是「取消選取」不是取得（onSelect 的 dimmed 那道），不能說「按下即取得」。
  else if (p.available.has(id)) text = dimmed.has(id) ? '可取得' : '可取得，按下即取得';
  else text = '未解鎖';
  return dimmed.has(id) ? `${text}，不符合搜尋` : text;
}

function syncButtons(p: SimPaint | null = lastPaint): void {
  if (!p) return;
  lastPaint = p;
  for (const [id, btn] of tree.buttons.byId) {
    const text = describeNode(id, p);
    if (describedAs.get(id) === text) continue;
    btn.setAttribute('aria-description', text);
    describedAs.set(id, text);
  }
  if (markedSelected !== selected) {
    if (markedSelected) tree.buttons.byId.get(markedSelected)?.removeAttribute('aria-current');
    if (selected) tree.buttons.byId.get(selected)?.setAttribute('aria-current', 'true');
    markedSelected = selected;
  }
}

// 太陽核心只在有值時才印：三列合計是側欄常駐的東西，為一個只有太陽骰子那一支花得到的
// 貨幣固定多佔一段寬度，會讓絕大多數節點看到一段永遠是 0 的字。
// 帶貨幣圖的版本在 src/lib/cost-html.ts（文字跟以前逐字相同，E2E 的 toHaveText 不受影響）。
// ⚠️ 下面用 innerHTML 塞進三列合計：安全只因為字串裡的數字全部來自 `Cost` 的 number 欄位、
// 圖示網址是本站常數。日後要併入任何資料來的文字（節點名稱、描述），先跳脫再拼。
const cost = (c: Cost) => simCostHtml(c);

function renderTotals(): void {
  const t = simTotals(state, ctx);
  const ownedText = `${ownedIds(state, ctx).size} / ${data.nodes.length}`;
  $('sim-total').innerHTML = cost(t.total);
  $('sim-total-unlock').innerHTML = cost(t.unlock);
  $('sim-total-upgrade').innerHTML = cost(t.upgrade);
  $('sim-owned-count').textContent = ownedText;
  // 手機抽屜收起時把手上那一行摘要（桌機 display:none）。它跟上面兩列是同一份計算的
  // 兩個出口，不是第二份真相——「資源合計常駐顯示」因此在收起狀態下仍然成立。
  $('sim-head-cost').innerHTML = cost(t.total);
  $('sim-head-owned').textContent = ownedText;

  // 對照持有資源：只列有填的貨幣，一格都沒填就整塊收起來。輸入框的 .over-limit 標的是
  // 「手上的不夠」那幾格（class 名沿用上限時代）。
  const gaps = resourceGap(t.total, holdings());
  const gapBox = $('sim-gap');
  gapBox.innerHTML = gaps.map(gapRow).join('');
  gapBox.toggleAttribute('hidden', gaps.length === 0);
  const short = new Set(gaps.filter(g => g.short > 0).map(g => g.key));
  for (const [key, id] of Object.entries(HOLDING_INPUT)) {
    $<HTMLInputElement>(id).classList.toggle('over-limit', short.has(key));
  }

  $<HTMLButtonElement>('sim-undo').disabled = undoStack.length === 0;
  $<HTMLButtonElement>('sim-redo').disabled = redoStack.length === 0;
  $('sim-initial-count').textContent = String(state.initial.size);
  for (const el of document.querySelectorAll<HTMLInputElement>('[data-initial]')) {
    el.checked = state.initial.has(el.dataset['initial']!);
  }
}

const esc = (s: string): string => {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
};

/** 等級區塊要顯示的四個數字。完整重建與拖曳中的局部更新共用同一份計算。 */
function levelInfo(node: TreeNode) {
  const cap = maxSelectableLevel(node, ctx);
  // 下限不是恆等於 1：已取得的太陽骰子要求 1201 至少 Lv.50，降到那以下在遊戲裡做不到。
  const floor = minSelectableLevel(node, state, ctx);
  const lv = state.levels.get(node.id) ?? 1;
  const table = levelTableFor(node, ctx.tables, ctx.runeTable);
  const extra = table ? upgradeExtraCost(table, lv) : null;
  const next = table && lv < cap ? upgradeExtraCost(table, lv + 1) : null;
  const step: Cost | null = next && extra
    ? subCost(next, extra)
    : null;
  return { cap, floor, lv, extra, step };
}

const nextLevelText = (lv: number, cap: number, step: Cost | null): string =>
  lv >= cap ? '已滿級' : step ? costHtml(step) : '成本未確認';

/**
 * 拖曳滑桿時**只改文字**，不重建等級區塊。
 *
 * ⚠️ 這是整頁最容易寫壞的一段：`renderDetailPanel()` 是用 `innerHTML` 整段重寫的，拖曳中
 * 途重寫會把玩家正按著的那個 `<input type="range">` 換成新元素，瀏覽器的指標捕捉隨之失效
 * ——實測 100 級的節點從最左端一路拖到最右端**只走到 Lv.6**（Yuki 回報＋`/code-review high`
 * 各自獨立抓到）。S3 用 `fill()` ＋ `dispatchEvent('input')` 完全繞過這條路徑，所以是綠的。
 */
function updateLevelReadout(): void {
  const node = selected === null ? undefined : ctx.byId.get(selected);
  const box = $('sim-detail');
  const value = box.querySelector('.sim-level-value');
  if (!node || !value) return;
  const { cap, floor, lv, extra, step } = levelInfo(node);
  value.textContent = `Lv.${lv} / ${cap}`;
  const notes = box.querySelectorAll('.sim-level .note');
  if (notes[0]) notes[0].innerHTML = `下一級：${nextLevelText(lv, cap, step)}`;
  if (notes[1]) notes[1].innerHTML = `Lv.1 → Lv.${lv} 追加：${costHtml(extra ?? ZERO_COST)}`;
  const dec = box.querySelector<HTMLButtonElement>('[data-step="-1"]');
  const inc = box.querySelector<HTMLButtonElement>('[data-step="1"]');
  if (dec) dec.disabled = lv <= floor;
  if (inc) inc.disabled = lv >= cap;
}

function levelBlockHtml(node: TreeNode): string {
  if (maxSelectableLevel(node, ctx) <= 1 || !ownedIds(state, ctx).has(node.id)) return '';
  const { cap, floor, lv, extra, step } = levelInfo(node);
  // 卡著它的是哪幾顆？滑桿的 min 與停用的「−」只表達得出「不能再低了」，說不出為什麼。
  const heldBy = (ctx.rankHolders.get(node.id) ?? [])
    .filter(h => ownedIds(state, ctx).has(h.id) && h.rank >= floor)
    .map(h => ctx.byId.get(h.id)?.name ?? h.id);
  return `
    <div class="sim-level">
      <div class="sim-level-row">
        <button type="button" data-step="-1" aria-label="降低等級"${lv <= floor ? ' disabled' : ''}>−</button>
        <input type="range" id="sim-level-range" min="${floor}" max="${cap}" value="${lv}" aria-label="等級" />
        <button type="button" data-step="1" aria-label="提高等級"${lv >= cap ? ' disabled' : ''}>＋</button>
        <span class="sim-level-value">Lv.${lv} / ${cap}</span>
      </div>
      <p class="note">下一級：${nextLevelText(lv, cap, step)}</p>
      <p class="note">Lv.1 → Lv.${lv} 追加：${costHtml(extra ?? ZERO_COST)}</p>
      ${floor > 1 ? `<p class="note">已取得的${esc(heldBy.join('、'))}要求它達到 Lv.${floor}，不能再往下調</p>` : ''}
    </div>`;
}

function renderDetailPanel(): void {
  const box = $('sim-detail');
  const node = selected === null ? undefined : ctx.byId.get(selected);
  if (!node) {
    box.classList.add('empty');
    box.innerHTML = '<p class="note">點畫布上的節點看它的詳情；前置都解開的節點點一下就會取得。</p>';
    return;
  }
  box.classList.remove('empty');
  const owned = ownedIds(state, ctx).has(node.id);
  const optional = ctx.optional.has(node.id);
  const free = ctx.free.has(node.id);
  const avail = isAvailable(node.id, state, ctx);
  const missing = missingParents(node.id, state, ctx);

  let action: string;
  if (free) action = '<button type="button" class="cta btn btn-pri" disabled>起始骰子（一開始就有）</button>';
  else if (optional) {
    action = owned
      ? '<button type="button" class="cta danger btn btn-alt" data-uncheck>取消勾選（會連帶取消後續）</button>'
      : '<button type="button" class="cta btn btn-pri" data-check>我已經有這顆了</button>';
  } else if (owned) action = '<button type="button" class="cta danger btn btn-alt" data-remove>取消此節點（會連帶取消後續）</button>';
  else if (avail) action = `<button type="button" class="cta btn btn-pri" data-unlock>取得 · ${costHtml(node.unlockCost)}</button>`;
  else {
    // ⚠️ 不可以只說「還缺前置」：太陽骰子的三顆前置全在手上時它照樣點不開，那句話會讓玩家
    // 對著一棵已經解完的前置鏈找不到問題在哪。缺前置與等級不夠是兩句不同的話，各印各的。
    const lines: string[] = [];
    if (missing.length > 0) {
      lines.push(`缺少前置：${missing.map(id => esc(ctx.byId.get(id)?.name ?? id)).join('、')}`);
    }
    for (const m of missingPrereqRanks(node.id, state, ctx)) {
      lines.push(`${esc(m.name)}需達 Lv.${m.rank}（目前 ${m.owned ? `Lv.${m.level}` : '未取得'}）`);
    }
    action = lines.map(t => `<p class="note warn">${t}</p>`).join('')
      + '<button type="button" class="cta btn btn-pri" data-path>一鍵點亮到這裡</button>';
  }

  box.innerHTML = `
    <h3 tabindex="-1">${esc(node.name)}</h3>
    <p><span class="tag">${esc(typeLabel(node))}</span><span class="tag">${esc(node.id)}</span></p>
    <p class="desc">${renderTaggedText(node.description, node.keywords, data.meta.glossary, (term, entry) => {
      // 顏色照抄遊戲內該標記的底色（同色＝同一類機制），跟 /tree 的詳情面板同一份資料來源。
      // 這一頁刻意**不做**可點的詞彙視圖：模擬器的側欄只有一層，堆疊視圖在這裡沒有返回鍵可用。
      const color = entry ? ` style="color:${esc(entry.color)}"` : '';
      return `<span class="sim-term"${color}>#${esc(term)}</span>`;
    })}</p>
    ${node.unlockNote ? `<p class="note">取得條件：${esc(node.unlockNote)}</p>` : ''}
    ${action}
    ${levelBlockHtml(node)}`;
}

function render(): void {
  renderCanvas();
  renderTotals();
  renderDetailPanel();
  if ($<HTMLDialogElement>('sim-ability-modal').open) renderAbilities();
}

// --- toast ------------------------------------------------------------------
let toastTimer: ReturnType<typeof setTimeout> | undefined;
/**
 * ⚠️ 收放靠的是**清空內容**，不是 `hidden`／`display:none`／`visibility:hidden`。
 * `#sim-toast` 是這一頁唯一的 `role="status"`，那三種收法會讓它一併從無障礙樹消失，
 * 於是「請先在初始骰子勾選」這類**唯一**的失敗回饋對螢幕閱讀器完全不存在
 * ——而畫面上看起來一切正常。CLAUDE.md 為 `#filter-live` 記過同一條（`/code-review high` 抓到）。
 * 空元素的視覺由 CSS 的 `:empty` 收掉。
 */
function toast(msg: string): void {
  const el = $('sim-toast');
  el.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.textContent = ''; }, 2600);
}

// --- 事件：畫布 --------------------------------------------------------------
// 「使用者選了哪一顆」由 controller 判定：它在 pointerdown 當下用幾何命中記下被按到的是誰
// （⚠️ `setPointerCapture()` 生效後 `e.target` 一律被改標成捕捉的那個元素，事後反推一定
// 答錯——那個坑連同 5px 拖曳門檻與雙指判定一起搬進 canvas-tree.ts 了），pointerup 時位移
// 沒超過門檻才算點選。空白處回 null＝清掉選取。
// 鍵盤的 Enter／Space 走同一條路：a11y.ts 那份隱形按鈕清單的 onActivate 也進 onSelect。

function activate(id: string | null, source: 'pointer' | 'keyboard' = 'pointer'): void {
  selected = id;
  // 前置齊了就直接取得——先選再按按鈕，在一棵 239 節點的樹上太累。
  // ⚠️ 沒有取得（點的是還不能取得的節點、或 `commit()` 失敗）時**一定要自己補一次 render**：`selected` 已經
  // 換人了，不重畫的話面板與畫布上的選取高亮會停在上一顆節點，而面板上那些按鈕讀的是
  // `selected`——按下去作用在畫面上看不到的那顆（`/code-review high` 抓到）。
  const taken = id !== null && isAvailable(id, state, ctx) && commit(unlockNode(state, ctx, id));
  if (!taken) render();
  // 取得是會花資源的動作，畫面上只是節點變亮、側欄數字變了——讀屏什麼都聽不到
  // （#sim-toast 是這一頁唯一的 live region；2026-09-24 review sim-4）。
  if (taken) toast(`已取得 ${ctx.byId.get(id)?.name ?? id}`);
  if (id === null) return;
  // 手機抽屜預設收起，選了節點得看得到詳情的主按鈕（見 revealDetail 的說明）；抽屜長高之後
  // 被選的節點可能落在它底下，再把畫布挪一下（revealSelected）。
  revealDetail();
  revealSelected();
  // 鍵盤開的：焦點移進詳情（標題），不然 Enter 之後還得 Tab 過其餘兩百多顆節點按鈕才到得了
  // 面板（DOM 順序是畫布在前、側欄在後）。Esc 回到節點按鈕（見 #sim-panel 的 keydown）。
  // preventScroll：revealDetail 已經把主按鈕捲進抽屜可視範圍，標題不該把它捲回去。
  if (source === 'keyboard') $('sim-detail').querySelector<HTMLElement>('h3')?.focus({ preventScroll: true });
}

/** 手機版選節點後的平移長度，從 CSS 讀（同 /tree 的 CENTER_MS）。 */
const REVEAL_MS = cssMs('--t-med', 200);
let stopReveal: () => void = () => {};

/**
 * 手機版：抽屜為了露出主按鈕長高之後，被選的節點若落在抽屜、浮動鍵底下或畫面外，把畫布挪到
 * 剛好露出來（2026-09-24 review gap-canvas-mobile-3：390×844 點 2007 之後節點在抽屜底下，
 * 接著點下半部其他節點點到的是抽屜）。位移跟鍵盤焦點同一份計算（`tree.visibleShift()`）。
 * 桌機不需要：點得到的節點本來就看得見，鍵盤聚焦則由 controller 的 ensureVisible 處理。
 */
function revealSelected(): void {
  if (!mobile() || selected === null) return;
  stopReveal();
  const [dx, dy] = tree.visibleShift(selected);
  if (dx || dy) stopReveal = animatePan(tree, dx, dy, REVEAL_MS, () => { stopReveal = () => {}; });
}
// 使用者自己動畫布就停掉（兩股力量同時寫 view 會互相拉扯）。capture：controller 的監聽掛在
// host 底下的互動層 canvas 上，要搶在它前面。
// focusin：鍵盤 Tab 到別顆節點時 controller 的 ensureVisible 會自己平移，動畫剩下的幀再疊上去就歪了
// （PR #90 review）。Enter 開節點時焦點是移到側欄（不在 host 裡），不會誤停自己。
for (const type of ['pointerdown', 'wheel', 'focusin'] as const) {
  host.addEventListener(type, () => { stopReveal(); stopReveal = () => {}; }, { capture: true, passive: true });
}

/**
 * 搜尋不符的節點淡出但留在原位（同 /tree 的篩選）。
 *
 * 這份集合是「誰被搜尋淡出」的**唯一**事實：畫布拿它算 opacity（state.ts 的 `nodeAlpha`
 * 在 sim 分支裡先看它，數值 0.08 是從舊的 `#tree.sim .node.sim-dimmed` 原封不動搬過來的），
 * `onSelect` 拿它把「點到淡出的節點」翻譯成「點空白處」。舊版把它散在 241 個 `<g>` 的
 * classList 上，而 class 本身沒有辦法被別的程式碼問到。
 */
const dimmed = new Set<string>();

// ⚠️ 被搜尋淡出的節點點不到。舊版靠 CSS 的 `.sim-dimmed { pointer-events: none }`，事件會
// 穿到 SVG 本身、`downTarget` 是 null，於是那一下等於「點空白處」＝清掉選取。canvas 沒有
// pointer-events 這回事（畫的是像素不是元素），命中測試一律答得出節點 id，所以那條語意要
// 在這裡自己補回來——不補的話搜尋中點一顆看不見的節點會直接把它解鎖，而畫面上幾乎沒有反應。
tree.onSelect((id, source) => activate(id !== null && dimmed.has(id) ? null : id, source));

// Esc 取消選取。掛在 host 上而不是 window：事件要先冒泡經過 host 才會觸發，所以只有「焦點
// 在畫布內（無障礙節點按鈕或兩張 canvas）」時才生效——搜尋框與持有資源輸入框都不是 host 的
// 子節點，在那裡按 Esc 不會被攔截。`isTypingTarget()` 是第二道保險：焦點在表單元件上時
// 一律讓路（同 /tree 的鍵盤平移，見 src/lib/filter.ts）。
host.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !isTypingTarget(document.activeElement?.tagName)) activate(null);
});

/**
 * 取消節點／取消勾選初始骰子：會連帶取消靠它解開的後續，最多一次 46 顆（4008 陰陽骰子）。
 * 畫面上只是一片節點變暗，被連帶的有幾顆要說出來，並提示可以復原（2026-09-24 review sim-6）。
 */
function commitCascading(next: SimState | null): boolean {
  const before = ownedIds(state, ctx).size;
  if (!commit(next)) return false;
  const lost = before - ownedIds(state, ctx).size - 1;   // 扣掉被取消的那一顆自己
  if (lost > 0) toast(`已連帶取消 ${lost} 個後續節點（可按復原）`);
  return true;
}

// --- 事件：側欄 --------------------------------------------------------------
// 焦點在側欄裡按 Esc：回到被選節點的按鈕（鍵盤 Enter 開節點會把焦點移進來，這是回去的路）。
// 選取不動；在節點按鈕上再按一次 Esc 才取消選取（host 上那個監聽）。
$('sim-panel').addEventListener('keydown', e => {
  if (e.key !== 'Escape' || selected === null) return;
  // 文字與數字輸入框讓路；等級滑桿（也是 INPUT）不打字，照樣可以 Esc 回去。
  const a = document.activeElement as HTMLInputElement | null;
  if (isTypingTarget(a?.tagName) && a?.type !== 'range') return;
  tree.buttons.byId.get(selected)?.focus({ preventScroll: true });
});

$('sim-detail').addEventListener('click', e => {
  const btn = (e.target as HTMLElement).closest('button');
  if (!btn || selected === null) return;
  const id = selected;
  if (btn.hasAttribute('data-unlock')) commit(unlockNode(state, ctx, id));
  else if (btn.hasAttribute('data-remove')) commitCascading(removeNode(state, ctx, id));
  else if (btn.hasAttribute('data-check')) commit(setInitialDice(state, ctx, id, true));
  else if (btn.hasAttribute('data-uncheck')) commitCascading(setInitialDice(state, ctx, id, false));
  else if (btn.hasAttribute('data-path')) {
    const plan = pathTo(id, state, ctx);
    if (plan.blocked.length > 0) {
      toast(`請先在「初始骰子」勾選：${plan.blocked.map(x => ctx.byId.get(x)?.name ?? x).join('、')}`);
      return;
    }
    if (plan.need.length === 0 && plan.levels.length === 0) return;
    // 整份計畫一起套用（節點 ＋ 練等），算一步復原：分兩次的話 undo 會停在「解完節點、
    // 還沒練完」的中間狀態，而那正是「解一半」要避免的情形。
    const levelText = plan.levels
      .map(l => `${ctx.byId.get(l.id)?.name ?? l.id} 練到 Lv.${l.level}`)
      .join('、');
    if (commit(unlockMany(state, ctx, plan))) {
      toast(`已點亮 ${plan.need.length} 個節點${levelText ? `，並把${levelText}` : ''}`);
    }
  } else if (btn.hasAttribute('data-step')) {
    const lv = (state.levels.get(id) ?? 1) + Number(btn.getAttribute('data-step'));
    commit(setNodeLevel(state, ctx, id, lv));
  }
});

/**
 * 這一次拖曳開始前的狀態。放開滑桿時才把它推進 undo——每動一級推一步的話，把一顆 100 級的
 * 節點拖到底會塞進 99 步復原，玩家要按 99 次才回得去。
 */
let levelDragFrom: SimState | null = null;

$('sim-detail').addEventListener('input', e => {
  const range = e.target as HTMLInputElement;
  if (range.id !== 'sim-level-range' || selected === null) return;
  const before = state;
  if (!applyState(setNodeLevel(state, ctx, selected, Number(range.value)))) {
    // 沒生效（等級超出可選範圍）：把滑桿拉回真實等級，不要留一個沒生效的位置在畫面上。
    range.value = String(state.levels.get(selected) ?? 1);
    return;
  }
  if (levelDragFrom === null) levelDragFrom = before;
  // ⚠️ 這裡刻意**不呼叫 render()**——見 updateLevelReadout() 的說明。
  renderCanvas();
  renderTotals();
  updateLevelReadout();
});

$('sim-detail').addEventListener('change', e => {
  if ((e.target as HTMLInputElement).id !== 'sim-level-range') return;
  if (levelDragFrom !== null && levelDragFrom !== state) pushUndo(levelDragFrom);
  levelDragFrom = null;
  render();
  if (syncPending) { syncPending = false; syncFromStorage(); }
});

// --- 事件：工具列 ------------------------------------------------------------
function closeMenus(): void {
  for (const id of ['sim-initial', 'sim-limit', 'sim-image']) {
    $(`${id}-menu`).setAttribute('hidden', '');
    $(`${id}-toggle`).setAttribute('aria-expanded', 'false');
  }
}

for (const id of ['sim-initial', 'sim-limit', 'sim-image']) {
  const toggle = $(`${id}-toggle`);
  const menu = $(`${id}-menu`);
  toggle.addEventListener('click', e => {
    e.stopPropagation();
    const willOpen = menu.hasAttribute('hidden');
    closeMenus();
    if (willOpen) {
      menu.removeAttribute('hidden');
      toggle.setAttribute('aria-expanded', 'true');
    }
  });
  menu.addEventListener('click', e => e.stopPropagation());
}
document.addEventListener('click', closeMenus);

for (const el of document.querySelectorAll<HTMLInputElement>('[data-initial]')) {
  el.addEventListener('change', () => {
    const next = setInitialDice(state, ctx, el.dataset['initial']!, el.checked);
    const ok = el.checked ? commit(next) : commitCascading(next);
    // 被擋下來（那顆根本不是可選初始骰子）時，勾選框要跟著回到真實狀態，
    // 否則畫面上會顯示一個沒有生效的勾。
    if (!ok) el.checked = state.initial.has(el.dataset['initial']!);
  });
}

// 超越核心的持有欄也要掛：以前只掛了核心與金幣，太陽核心那格改了數字要等下一個操作才重算。
for (const id of ['sim-limit-core', 'sim-limit-gold', ...MYTHIC_LIMIT_IDS.map(([, x]) => x)]) {
  $<HTMLInputElement>(id).addEventListener('input', () => { renderTotals(); saveHoldings(); });
}

$('sim-undo').addEventListener('click', undo);
$('sim-redo').addEventListener('click', redo);

$('sim-reset').addEventListener('click', () => {
  // initialSimState() 每次都是新物件，commit() 的 `next === state` 擋不到「本來就是空的」：
  // 會推一步內容相同的復原、清掉重做、還說「已重置」（2026-09-24 review sim-7）。
  // 比序列化而不是比 size：拖回 Lv.1 的等級會留在 levels 裡，serializeSim 會濾掉它。
  if (serializeSim(state) === serializeSim(initialSimState(ctx))) {
    toast('規劃已經是空的');
    return;
  }
  if (commit(initialSimState(ctx))) {
    selected = null;
    render();
    toast('已重置');
  }
});

$('sim-export').addEventListener('click', async () => {
  const text = simReport(state, ctx);
  try {
    await navigator.clipboard.writeText(text);
    toast('已複製到剪貼簿');
  } catch {
    // 沒有剪貼簿權限（非 HTTPS、或使用者拒絕）時退回選取模式，至少讓玩家自己複製。
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    document.body.appendChild(ta);
    ta.select();
    toast('剪貼簿不可用，請手動複製選取的文字');
    setTimeout(() => ta.remove(), 8000);
  }
});

// --- 匯出圖片 ---------------------------------------------------------------
// 場景只在第一次匯出時才建（畫面那份在 controller 裡、不對外）。
let exportScene: Scene | null = null;
/** 上一張圖的 blob URL，換新圖時收掉，不然每按一次就漏一份（同 /board）。 */
let lastImageUrl: string | null = null;
let exporting = false;

async function exportImage(kind: 'compact' | 'full'): Promise<void> {
  if (exporting) return;
  exporting = true;
  const buttons = ['sim-image-toggle', 'sim-export-compact', 'sim-export-full'].map(id => $<HTMLButtonElement>(id));
  for (const b of buttons) b.disabled = true;
  closeMenus();
  try {
    exportScene ??= buildScene(data);
    // 內容在按下去那一刻就決定（參數先求值），產生途中玩家再改規劃不會混進這張圖。
    const total = headerTotalLine(state, ctx);
    const canvas = kind === 'compact'
      ? await renderCompactImage(exportScene, compactSections(state, ctx), total)
      : await renderFullImage(exportScene, simPaintFor(state, ctx, data, null), total);
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/png'));
    if (!blob) {
      toast('圖片產生失敗');
      return;
    }
    if (lastImageUrl) URL.revokeObjectURL(lastImageUrl);
    lastImageUrl = URL.createObjectURL(blob);
    const name = `rd2-sim-${kind}.png`;
    $<HTMLImageElement>('sim-image-out').src = lastImageUrl;
    const save = $<HTMLAnchorElement>('sim-image-save');
    save.href = lastImageUrl;
    save.download = name;
    $<HTMLDialogElement>('sim-image-dialog').showModal();
    const a = document.createElement('a');
    a.href = lastImageUrl;
    a.download = name;
    a.click();
    toast('圖片已產生');
  } catch {
    // 沒有這個 catch 的話任何例外都只是一個未捕捉的 rejection：按鈕恢復可按、
    // 什麼都沒出現——使用者看到的是「按了沒反應」（board.ts 同一條理由）。
    toast('圖片產生失敗');
  } finally {
    exporting = false;
    for (const b of buttons) b.disabled = false;
    // 失敗時對話框沒開：焦點隨著被停用的選項掉到 <body>，接回入口。
    if (!$<HTMLDialogElement>('sim-image-dialog').open) restoreExportFocus();
  }
}

/**
 * 焦點接回「匯出圖片」入口。按下的選項在產生前就被停用、選單也收起，焦點於是掉到 `<body>`
 * ——對話框記住的「關閉後回到哪」也就是 `<body>`，鍵盤使用者一關掉就被丟回頁首。
 * 只在焦點真的掉到 `<body>` 時才接，不搶走使用者自己移到別處的焦點。
 */
function restoreExportFocus(): void {
  const a = document.activeElement;
  // 關閉那一刻焦點可能還停在已隱藏的對話框裡（「關閉」鈕），瀏覽器要到下一次畫面更新才把它
  // 修正成 <body>——所以「在對話框裡」也要算進來，只看 <body> 會漏掉滑鼠按「關閉」這條路。
  if (a === null || a === document.body || $('sim-image-dialog').contains(a)) {
    $<HTMLButtonElement>('sim-image-toggle').focus();
  }
}

$('sim-export-compact').addEventListener('click', () => { void exportImage('compact'); });
$('sim-export-full').addEventListener('click', () => { void exportImage('full'); });
$('sim-image-close').addEventListener('click', () => { $<HTMLDialogElement>('sim-image-dialog').close(); });
// Esc 與「關閉」都走 close 事件（瀏覽器在它之前已經把焦點還給記住的原焦點＝<body>）。
$('sim-image-dialog').addEventListener('close', restoreExportFocus);

// --- 能力彙總 ---------------------------------------------------------------
function renderAbilities(): void {
  const groups = summarizeAbilities(state, ctx);
  const body = $('sim-ability-body');
  if (groups.length === 0) {
    body.innerHTML = '<p class="sim-ability-empty">還沒有取得任何玩家被動。</p>';
    return;
  }
  body.innerHTML = groups.map(g => `
    <section class="sim-ability-group">
      <h3>${esc(GROUP_ZH[g.group])}</h3>
      ${g.entries.map(e => {
        if (e.total) {
          const unit = e.total.unit === 's' ? '秒' : e.total.unit === 'count' ? '次' : e.total.unit === 'x' ? '倍' : e.total.unit;
          return `<div class="sim-ability-row"><span>${esc(e.name)}</span><strong>${e.total.value}${esc(unit)}</strong></div>`;
        }
        // 沒有成長值的節點不硬湊數字（見 src/lib/sim.ts 的說明），照描述列出來並標次數。
        return e.fixed.map(f =>
          `<div class="sim-ability-row"><span>${esc(f.description || e.name)}</span><strong>${f.count > 1 ? `×${f.count}` : ''}</strong></div>`,
        ).join('');
      }).join('')}
    </section>`).join('');
}

// 原生 <dialog>（sim.astro 有理由）：焦點困住、Esc 關閉都是 showModal() 給的，這裡只接開與關。
const abilityDialog = $<HTMLDialogElement>('sim-ability-modal');
$('sim-abilities').addEventListener('click', () => {
  renderAbilities();
  abilityDialog.showModal();
  $('sim-ability-close').focus();
});
$('sim-ability-close').addEventListener('click', () => abilityDialog.close());
// dialog 撐滿整個視窗、盒子在中間：點到 dialog 自己＝點盒子外面的背景。
abilityDialog.addEventListener('click', e => {
  if (e.target === abilityDialog) abilityDialog.close();
});
// 關掉之後焦點回到「能力彙總」。瀏覽器會自己還給開啟前的焦點，但那顆按鈕在手機 sheet 裡、
// 開啟前焦點不一定在它身上；只在焦點掉到 <body> 或還卡在對話框裡時才接（同 restoreExportFocus）。
abilityDialog.addEventListener('close', () => {
  const a = document.activeElement;
  if (a === null || a === document.body || abilityDialog.contains(a)) $<HTMLButtonElement>('sim-abilities').focus();
});

// --- 搜尋 -------------------------------------------------------------------
$<HTMLInputElement>('sim-search').addEventListener('input', e => {
  const q = (e.target as HTMLInputElement).value.trim().toLowerCase();
  dimmed.clear();
  if (q !== '') {
    for (const n of data.nodes) if (!n.name.toLowerCase().includes(q)) dimmed.add(n.id);
  }
  // 用 `new Set(dimmed)` 而不是把 `dimmed` 本身交出去：PaintState 是 spread 出來的新物件，
  // 但集合是同一個參照——controller 的 stateSignature() 會拿它算靜態層快取簽章，共用參照的話
  // 「下一次輸入就地改掉內容」在簽章看來是同一份狀態，畫面不會跟著更新。
  tree.setState({ filteredOut: new Set(dimmed) });
  syncButtons();
});

// --- 手機版：抽屜高度追蹤 ------------------------------------------------------
// 兩個消費者：沒有 JS 時 footer 的讓位（`body:has(#canvas-host) > footer`），以及兩顆
// 浮動鍵的 `bottom`——浮動鍵必須永遠浮在抽屜上緣之上，否則真人點不到。
// 量**實際**高度而不是寫一個 dvh：抽屜可以被拖高拖低，而這個 repo 的固定偏移量已經
// 咬過五次（CLAUDE.md〈版面沒有固定偏移量〉）。
function trackPanelHeight(): void {
  const panel = $('sim-panel');
  const write = (): void => {
    document.documentElement.style.setProperty('--sim-panel-h', `${panel.getBoundingClientRect().height}px`);
  };
  write();
  // linkedom 沒有 ResizeObserver；這條路徑在單元測試環境本來就不做事。
  if (typeof ResizeObserver === 'function') new ResizeObserver(write).observe(panel);
}

// --- 手機版：底部 sheet、可拖曳抽屜、著作權搬家 ---------------------------------
//
// ≤720px 的版面跟桌機是兩件事（版面說明寫在 sim.astro 的媒體查詢裡）：工具列變成從下緣
// 升起的 sheet、側欄變成預設只露出把手那一列的抽屜。這一段是它的行為，桌機一律不作用
// ——每個入口都先問 `mobile()`，那是**當下**問 matchMedia，不是開機時的快照
// （`isMobile` 那個常數只給圖示目標尺寸用，視窗縮放後不會跟著變）。

const PANEL_H_KEY = 'rd2-wiki:sim-panel-h';
/** 展開時的預設高度（佔視窗的比例）。使用者拖過之後改用他拖到的高度。 */
const PANEL_OPEN_RATIO = 0.5;
const PANEL_MAX_RATIO = 0.8;
/** 主按鈕下方要留的呼吸空間（px）。純視覺值，CSS 沒有任何規則依賴它，所以不從 token 讀
 *  ——`getComputedStyle` 讀 `--space-*` 回的是 `rem` 字串，為了一個數字去蓋一層換算器
 *  才是多出來的第二份東西。 */
const CTA_BOTTOM_GAP = 24;

const panelMq = typeof matchMedia === 'function' ? matchMedia('(width <= 720px)') : null;
const mobile = (): boolean => panelMq?.matches ?? false;

/** 抽屜的下限＝把手那一列的實際高度。⚠️ 不在這裡寫第二份數字，CSS 的 3.5rem 是唯一來源。 */
function panelMinH(): number {
  const h = $('sim-panel-handle').getBoundingClientRect().height;
  return h > 0 ? h : 56;
}

/** 浮動鍵與抽屜上緣、與導覽列之間的間距（px）。＝CSS `#sim-fabs` bottom 裡的 `--space-3`；
 *  純視覺值，差幾 px 只是浮動鍵離導覽列近一點（理由同 CTA_BOTTOM_GAP 不從 token 讀）。 */
const FABS_GAP = 12;

/**
 * 抽屜最高能到哪：80dvh，**而且要留得下兩顆浮動鍵**。
 * 浮動鍵的 bottom 綁抽屜高度，矮螢幕（手機橫放 640×360、667×375）撐到 80dvh 時它們被推出
 * 視窗頂端、藏到導覽列底下（2026-09-24 review gap-canvas-mobile-2：fabs top −36）。
 * 撐不到的部分 revealDetail() 照舊用捲動補。
 */
function panelMaxH(): number {
  const navBottom = document.getElementById('site-nav')?.getBoundingClientRect().bottom ?? 0;
  const fabsH = $('sim-fabs').getBoundingClientRect().height;
  const room = innerHeight - navBottom - fabsH - FABS_GAP * 2;
  return Math.max(panelMinH(), Math.min(innerHeight * PANEL_MAX_RATIO, room));
}

const clampPanel = (px: number): number => Math.min(Math.max(px, panelMinH()), panelMaxH());

function setPanelHeight(px: number): void {
  document.documentElement.style.setProperty('--sim-panel-user-h', `${Math.round(px)}px`);
}

/**
 * 抽屜的偏好＝**展開時的高度** ＋ **上次離開時是不是展開的**，兩個值。
 *
 * ⚠️ 只存一個「目前高度」會把兩件事混在一起：收合一次就把它覆寫成把手的高度，
 * 使用者拖出來的那個高度永久消失，再展開只會回到 50% 的預設值
 * （2026-09-22 /code-review 實測：拖到 306 → 收合 → 再展開變 422）。
 */
interface PanelPref { h: number; open: boolean }

function readPanelPref(): PanelPref | null {
  // localStorage 在無痕模式、或使用者關掉網站資料時會直接丟例外（不是回 null）。
  try {
    const raw = localStorage.getItem(PANEL_H_KEY);
    if (raw === null) return null;
    const v = JSON.parse(raw) as Partial<PanelPref> | null;
    const h = Number(v?.h);
    return Number.isFinite(h) && h > 0 ? { h, open: v?.open !== false } : null;
  } catch { return null; }   // 舊格式（純數字）也會走到這裡，當成沒存過
}

function writePanelPref(pref: PanelPref): void {
  try {
    localStorage.setItem(PANEL_H_KEY, JSON.stringify({ h: Math.round(pref.h), open: pref.open }));
  } catch { /* 存不了就算了 */ }
}

/** 使用者展開時要回到的高度。拖曳與點開都會更新它，收合**不會**。 */
let openPanelH: number | null = null;
/**
 * 目前的高度是 revealDetail() 為了露出主按鈕撐出來的（不是使用者拖／點出來的）。
 * 收合時看它：是的話不把這個高度記成「下次展開要回到的地方」——否則使用者拖到 256、選一顆
 * 節點被撐到 406、收合，再展開就變 406（2026-09-24 review gap-canvas-mobile-9）。
 */
let systemOpened = false;
const openTarget = (): number => clampPanel(openPanelH ?? innerHeight * PANEL_OPEN_RATIO);

const panelH = (): number => $('sim-panel').getBoundingClientRect().height;
const panelCollapsed = (): boolean => panelH() <= panelMinH() + 4;

function syncHandleState(): void {
  const open = !panelCollapsed();
  const handle = $('sim-panel-handle');
  handle.setAttribute('aria-expanded', String(open));
  handle.setAttribute('aria-label', open ? '收合資源合計' : '展開資源合計');
}

/**
 * 選了節點之後把詳情的主按鈕拉進視線。
 *
 * 抽屜預設收起成一行，而「取得 · 核心 5」這種按鈕正是使用者點完節點要按的下一個東西
 * ——看不到它等於這一頁在手機上不能用。刻意**不寫回偏好**：這是系統為了這一次操作把
 * 抽屜拉開，不是使用者拖出來的高度。
 */
function revealDetail(): void {
  if (!mobile()) return;
  const panel = $('sim-panel');
  // `#sim-panel` 是 fixed，所以它就是子孫的 offsetParent：`offsetTop` 直接是元素在抽屜
  // 捲動內容裡的位置（把手是 sticky，仍然佔著那一列，所以已經算進去了）。
  const cta = panel.querySelector<HTMLElement>('#sim-detail .cta');
  if (!cta) {
    if (panelCollapsed()) { setPanelHeight(openTarget()); systemOpened = true; }
    syncHandleState();
    return;
  }
  // ⚠️ 底下只留 CTA_BOTTOM_GAP。以前留的是 `panelMinH()`（＝把手那一列 56px），而把手
  // 是 sticky、`offsetTop` 本來就含它——那 56px 是白給出去的畫布，實測 243 顆全部中招。
  const want = cta.offsetTop + cta.offsetHeight + CTA_BOTTOM_GAP;
  // 只長不縮：使用者自己拖大過的抽屜不該因為換了一顆節點就被收回去。
  if (panelH() < want) { setPanelHeight(clampPanel(want)); systemOpened = true; }
  // ⚠️ `want` 會被 80dvh 的上限夾住：矮螢幕 ＋ 多行「缺少前置／需達 Lv.N」的節點高度不夠，
  // 光改高度主按鈕仍然在框外（實測 iPhone SE 375×568 的 2503 差 2px）。夾住時改用捲動把它
  // 帶進可視範圍——「選了節點就看得到主按鈕」不能只在大螢幕上成立。
  const r = cta.getBoundingClientRect();
  const p = panel.getBoundingClientRect();
  if (r.bottom > p.bottom) panel.scrollTop += r.bottom - p.bottom + CTA_BOTTOM_GAP;
  syncHandleState();
}

function installPanelHandle(): void {
  const handle = $('sim-panel-handle');
  let dragFrom: { id: number; y: number; h: number } | null = null;
  let moved = false;

  // ⚠️ 刻意**不用** `setPointerCapture()`：合成的 PointerEvent 沒有對應的真實 pointer id，
  // 它會丟 NotFoundError 並中斷後面的 handler（這個 repo 的驗證腳本因此拿過假結果）。
  // 改成在 window 上收 move／up，手指拖出把手範圍一樣跟得上，而且測得動。
  handle.addEventListener('pointerdown', e => {
    if (!mobile()) return;
    dragFrom = { id: e.pointerId, y: e.clientY, h: panelH() };
    moved = false;
  });

  addEventListener('pointermove', e => {
    // ⚠️ 要比對 pointerId：監聽掛在 window 上，不比對的話「另一根手指／滑鼠在畫布上移動」
    // 也會被算進這一次拖曳。
    if (!dragFrom || e.pointerId !== dragFrom.id) return;
    const dy = dragFrom.y - e.clientY;    // 往上拖＝變高
    if (Math.abs(dy) > 4) moved = true;
    setPanelHeight(clampPanel(dragFrom.h + dy));
  });

  /** 拖曳收尾。⚠️ `pointercancel` 一定要接：Android 的邊緣返回手勢、長按選單、旋轉螢幕
   *  之後**不會**再有 `pointerup`，少接它 `dragFrom` 會一直留著，而 `pointermove` 掛在
   *  window 上——之後使用者在畫布上平移都會變成在改抽屜高度（2026-09-22 /code-review
   *  實測：cancel 之後隨便滑一下，抽屜從 56 跳到 673）。 */
  const endDrag = (e: PointerEvent): void => {
    if (!dragFrom || e.pointerId !== dragFrom.id) return;
    dragFrom = null;
    // 只有真的拖動過才寫偏好：沒位移的那一下是點擊，收合／展開由 click 那支決定。
    if (moved) {
      const h = panelH();
      const open = h > panelMinH() + 4;
      if (open) openPanelH = h;
      systemOpened = false;
      writePanelPref({ h: openPanelH ?? innerHeight * PANEL_OPEN_RATIO, open });
    }
    syncHandleState();
  };
  addEventListener('pointerup', endDrag);
  addEventListener('pointercancel', endDrag);

  // 沒有位移的那一下＝點擊，收合／展開。鍵盤的 Enter／Space 也走這裡（它是 <button>）。
  handle.addEventListener('click', e => {
    // 拖曳收尾那一下的 click 要吞掉，但**鍵盤觸發的 click（detail 0）不算**：在把手外放開、或觸控
    // 拖曳（不產生 click）之後 moved 會一直留著 true，下一次按 Enter 就被吞掉
    // （2026-09-24 review gap-canvas-mobile-8：拖到上限在把手外放開，Enter 要按兩次）。
    const swallow = moved && e.detail !== 0;
    moved = false;
    if (swallow) return;
    if (panelCollapsed()) {
      const target = openTarget();
      openPanelH = target;
      setPanelHeight(target);
      writePanelPref({ h: target, open: true });
    } else {
      // 收合之前先把目前的高度記下來——它就是下次展開要回到的地方。系統撐出來的不算（見 systemOpened）。
      if (!systemOpened) openPanelH = panelH();
      setPanelHeight(panelMinH());
      writePanelPref({ h: openPanelH ?? innerHeight * PANEL_OPEN_RATIO, open: false });
    }
    systemOpened = false;
    syncHandleState();
  });
}

type SheetMode = 'search' | 'all' | null;
let sheetMode: SheetMode = null;

function setSheet(mode: SheetMode): void {
  sheetMode = mode;
  const bar = $('sim-toolbar');
  bar.classList.toggle('is-open', mode !== null);
  bar.classList.toggle('is-search', mode === 'search');
  $('sim-scrim').toggleAttribute('hidden', mode === null);
  $('sim-fab-search').setAttribute('aria-expanded', String(mode === 'search'));
  $('sim-fab-more').setAttribute('aria-expanded', String(mode === 'all'));
  if (mode === null) closeMenus();
  else if (mode === 'search') $<HTMLInputElement>('sim-search').focus();
}

function installSheet(): void {
  for (const [id, mode] of [['sim-fab-search', 'search'], ['sim-fab-more', 'all']] as const) {
    $(id).addEventListener('click', e => {
      // 不讓它冒泡到 document 上那個 closeMenus——在 sheet 裡兩個下拉是就地展開的，
      // 按 ⋯ 再按一次應該只收 sheet，不該順手把使用者剛展開的那一段也收掉。
      e.stopPropagation();
      setSheet(sheetMode === mode ? null : mode);
    });
  }
  $('sim-scrim').addEventListener('click', () => setSheet(null));
  $('sim-sheet-close').addEventListener('click', () => setSheet(null));
  addEventListener('keydown', e => {
    // 對話框開著時 Esc 是關對話框的：同一下不該連 sheet 一起收掉（能力彙總的入口就在 sheet 裡，
    // 收掉之後焦點回不去）。
    if (e.key === 'Escape' && sheetMode !== null && !document.querySelector('dialog[open]')) setSheet(null);
  });
}

/**
 * 著作權那兩行在手機上搬進抽屜最底。
 *
 * 它在 Base.astro 裡是 <body> 的直屬子節點、排在 <main> 後面。留在原處的話，抽屜
 * （fixed bottom:0）得靠 footer 的 padding-bottom 讓位，光那兩行就在 390×844 上吃掉
 * 73px 的畫布。搬進抽屜之後捲到底仍然讀得到，而讓位規則因為選擇器是 `> footer` 自動失效。
 *
 * ⚠️ 跨斷點要搬回去（桌機的抽屜是右側整條側欄，著作權塞進去只是把它藏起來）。
 */
function syncCredit(): void {
  const foot = document.querySelector('footer');
  const main = document.querySelector('main');
  if (!foot || !main) return;
  const panel = $('sim-panel');
  if (mobile()) {
    if (foot.parentElement !== panel) panel.appendChild(foot);
  } else if (foot.parentElement !== document.body) {
    document.body.insertBefore(foot, main.nextSibling);
  }
}

function installMobileLayout(): void {
  // linkedom 的 matchMedia 替身只回一個 `{ matches }`，沒有 addEventListener——掛之前
  // 一定要確認它存在，否則整支腳本載入時就丟錯（CLAUDE.md 記過同一條）。
  installPanelHandle();
  installSheet();
  const pref = readPanelPref();
  if (pref !== null) {
    openPanelH = pref.h;
    setPanelHeight(pref.open ? clampPanel(pref.h) : panelMinH());
  }
  syncCredit();
  syncHandleState();
  // 轉向／視窗變矮時上限跟著變（panelMaxH），已經撐高的抽屜要重新夾：CSS 只有 80dvh，
  // 直立拖到頂再轉橫放，浮動鍵會被推出視窗頂端（PR #90 review：360×640 → 640×360，fabs top −36）。
  // 不寫偏好：這是系統夾的，不是使用者拖的。
  addEventListener('resize', () => {
    if (!mobile()) return;
    const max = panelMaxH();
    if (panelH() > max + 0.5) { setPanelHeight(max); syncHandleState(); }
  });
  if (panelMq && typeof panelMq.addEventListener === 'function') {
    // ⚠️ 跨斷點要重設狀態：桌機開著 sheet 把視窗縮到手機寬度（或反過來），留著的
    // `.is-open` 會變成一個使用者從沒打開過的面板。
    panelMq.addEventListener('change', () => {
      setSheet(null);
      syncCredit();
      syncHandleState();
    });
  }
}

// --- 啟動 -------------------------------------------------------------------
trackPanelHeight();
installMobileLayout();
fitAll();
loadHoldings();   // 要在第一次 renderTotals() 之前
render();

addEventListener('storage', e => {
  // key 為 null＝另一個分頁 localStorage.clear()。
  if (e.key === SIM_STORAGE_KEY || e.key === null) syncFromStorage();
  if (e.key === HOLDINGS_KEY || e.key === null) { loadHoldings(true); renderTotals(); }
});
// bfcache 回來（/sim → 別頁 → 上一頁）時記憶體是離開前那份，這之間存檔可能被別的分頁改過。
addEventListener('pageshow', e => {
  if (!e.persisted) return;
  syncFromStorage();
  loadHoldings(true);
  renderTotals();
});
