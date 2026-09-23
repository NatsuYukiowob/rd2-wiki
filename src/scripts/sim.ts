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
import { mountCanvasTree } from '../lib/canvas/canvas-tree.js';
import { edgeKey } from '../lib/canvas/state.js';
import {
  DESKTOP_ICON_TARGET_PX, MOBILE_ICON_TARGET_PX, minReadableScale,
} from '../lib/canvas/view.js';
import { isTypingTarget } from '../lib/filter.js';
import {
  buildSimContext, initialSimState, ownedIds, isAvailable, missingParents, missingPrereqRanks,
  unlockNode, removeNode, setNodeLevel, setInitialDice, pathTo, unlockMany,
  simTotals, maxSelectableLevel, minSelectableLevel, summarizeAbilities, resourceGap,
  edgeWasUsed, edgeIsLinked,
} from '../lib/sim.js';
import type { AbilityGroup, GapEntry, SimHoldings, SimState } from '../lib/sim.js';
import { SIM_STORAGE_KEY, deserializeSim, serializeSim, simReport } from '../lib/sim-io.js';
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
// （見 canvas-tree.ts 的 MountOptions）。
const tree = mountCanvasTree(host, data);
// `vp` 是 controller 的座標狀態機（src/lib/canvas/view.ts）。
// ⚠️ 它吃的是**相對 host 的 CSS px**，不是 clientX/clientY。
const vp = tree.view;

const isMobile = typeof matchMedia === 'function' && matchMedia('(width <= 720px)').matches;

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
  const floor = minReadableScale(
    rect.width, rect.height, data.meta.viewBox[2], data.meta.viewBox[3],
    tree.scene.diceIconWidth, isMobile ? MOBILE_ICON_TARGET_PX : DESKTOP_ICON_TARGET_PX,
  );
  // 下限只是下限：fitAll 給的倍率已經夠大時不該反過來把畫面拉近。
  if (vp.scale < floor) {
    vp.zoomAt(floor / vp.scale, rect.width / 2, rect.height / 2);
    // 直接動 vp 的地方要自己排一幀——controller 只在自己的 pointer／wheel 路徑上排。
    tree.requestRedraw();
  }
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

/** applyState ＋ 推一步 undo ＋ 重畫。一般的單次操作都走這裡。 */
function commit(next: SimState | null): boolean {
  const before = state;
  if (!applyState(next)) return false;
  undoStack.push(before);
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  redoStack.length = 0;
  render();
  return true;
}

function undo(): void {
  const prev = undoStack.pop();
  if (!prev) return;
  redoStack.push(state);
  state = prev;
  save();
  render();
}

function redo(): void {
  const next = redoStack.pop();
  if (!next) return;
  undoStack.push(state);
  state = next;
  save();
  render();
}

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
  const n = (v: number) => v.toLocaleString('en-US');
  const text = g.short > 0 ? `還差 ${n(g.short)}` : `剩餘 ${n(-g.short)}`;
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
  const owned = ownedIds(state, ctx);
  const available = new Set(
    data.nodes.filter(n => !owned.has(n.id) && isAvailable(n.id, state, ctx)).map(n => n.id),
  );
  const linked = new Set<string>();
  const active = new Set<string>();
  const ready = new Set<string>();
  for (const [from, to] of data.edges) {
    // 三階：沒到手＝暗、兩端都在手上＝正常亮度（edgeIsLinked）、真的走過＝再加金色
    // （edgeWasUsed，是 linked 的子集）。少了中間那階，火骰子連著風與冰那兩條（三顆都是
    // 遊戲一開始就送的）不是被畫成金線＝看起來像自己解過，就是跟沒走到的路一樣暗。
    if (edgeIsLinked(from, to, state, ctx)) linked.add(edgeKey(from, to));
    if (edgeWasUsed(from, to, state, ctx)) active.add(edgeKey(from, to));
    if (owned.has(from) && !owned.has(to) && isAvailable(to, state, ctx)) ready.add(edgeKey(from, to));
  }
  tree.setState({
    sim: {
      owned, available, selected, linked, active, ready,
      // 只帶已取得的等級：painter 也只畫 owned 的牌子，未取得的節點送過去只是白佔快取簽章。
      levels: new Map([...owned].map(id => [id, state.levels.get(id) ?? 1])),
      // 上限走 maxSelectableLevel 而不是 node.maxLevel：查不到費用表的節點在模擬器裡根本
      // 不能升級（回 1），painter 的 `max <= 1` 就是靠這個判斷「這顆不該有牌子」。
      maxLevels: new Map(data.nodes.map(n => [n.id, maxSelectableLevel(n, ctx)])),
    },
  });
}

// 太陽核心只在有值時才印：三列合計是側欄常駐的東西，為一個只有太陽骰子那一支花得到的
// 貨幣固定多佔一段寬度，會讓 239 顆節點裡的 237 顆看到一段永遠是 0 的字。
// 帶貨幣圖的版本在 src/lib/cost-html.ts（文字跟以前逐字相同，E2E 的 toHaveText 不受影響）。
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
    <h3>${esc(node.name)}</h3>
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
  if (!$('sim-ability-modal').hasAttribute('hidden')) renderAbilities();
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

function activate(id: string | null): void {
  selected = id;
  // 前置齊了就直接取得——先選再按按鈕，在一棵 239 節點的樹上太累。
  // ⚠️ 沒有取得（點的是還不能取得的節點、或 `commit()` 失敗）時**一定要自己補一次 render**：`selected` 已經
  // 換人了，不重畫的話面板與畫布上的選取高亮會停在上一顆節點，而面板上那些按鈕讀的是
  // `selected`——按下去作用在畫面上看不到的那顆（`/code-review high` 抓到）。
  const taken = id !== null && isAvailable(id, state, ctx) && commit(unlockNode(state, ctx, id));
  if (!taken) render();
  // 手機抽屜預設收起，選了節點得看得到詳情的主按鈕（見 revealDetail 的說明）。
  if (id !== null) revealDetail();
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
tree.onSelect(id => activate(id !== null && dimmed.has(id) ? null : id));

// Esc 取消選取。掛在 host 上而不是 window：事件要先冒泡經過 host 才會觸發，所以只有「焦點
// 在畫布內（無障礙節點按鈕或兩張 canvas）」時才生效——搜尋框與持有資源輸入框都不是 host 的
// 子節點，在那裡按 Esc 不會被攔截。`isTypingTarget()` 是第二道保險：焦點在表單元件上時
// 一律讓路（同 /tree 的鍵盤平移，見 src/lib/filter.ts）。
host.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !isTypingTarget(document.activeElement?.tagName)) activate(null);
});

// --- 事件：側欄 --------------------------------------------------------------
$('sim-detail').addEventListener('click', e => {
  const btn = (e.target as HTMLElement).closest('button');
  if (!btn || selected === null) return;
  const id = selected;
  if (btn.hasAttribute('data-unlock')) commit(unlockNode(state, ctx, id));
  else if (btn.hasAttribute('data-remove')) commit(removeNode(state, ctx, id));
  else if (btn.hasAttribute('data-check')) commit(setInitialDice(state, ctx, id, true));
  else if (btn.hasAttribute('data-uncheck')) commit(setInitialDice(state, ctx, id, false));
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
  if (levelDragFrom !== null && levelDragFrom !== state) {
    undoStack.push(levelDragFrom);
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack.length = 0;
  }
  levelDragFrom = null;
  render();
});

// --- 事件：工具列 ------------------------------------------------------------
function closeMenus(): void {
  for (const id of ['sim-initial', 'sim-limit']) {
    $(`${id}-menu`).setAttribute('hidden', '');
    $(`${id}-toggle`).setAttribute('aria-expanded', 'false');
  }
}

for (const id of ['sim-initial', 'sim-limit']) {
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
    const ok = commit(setInitialDice(state, ctx, el.dataset['initial']!, el.checked));
    // 被擋下來（那顆根本不是可選初始骰子）時，勾選框要跟著回到真實狀態，
    // 否則畫面上會顯示一個沒有生效的勾。
    if (!ok) el.checked = state.initial.has(el.dataset['initial']!);
  });
}

// 超越核心的持有欄也要掛：以前只掛了核心與金幣，太陽核心那格改了數字要等下一個操作才重算。
for (const id of ['sim-limit-core', 'sim-limit-gold', ...MYTHIC_LIMIT_IDS.map(([, x]) => x)]) {
  $<HTMLInputElement>(id).addEventListener('input', () => { renderTotals(); });
}

$('sim-undo').addEventListener('click', undo);
$('sim-redo').addEventListener('click', redo);

$('sim-reset').addEventListener('click', () => {
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

$('sim-abilities').addEventListener('click', () => {
  renderAbilities();
  $('sim-ability-modal').removeAttribute('hidden');
  $('sim-ability-close').focus();
});
$('sim-ability-close').addEventListener('click', () => $('sim-ability-modal').setAttribute('hidden', ''));
$('sim-ability-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) $('sim-ability-modal').setAttribute('hidden', '');
});
addEventListener('keydown', e => {
  if (e.key === 'Escape') $('sim-ability-modal').setAttribute('hidden', '');
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
});

// --- 手機版：抽屜高度追蹤 ------------------------------------------------------
// 兩個消費者：沒有 JS 時 footer 的讓位（`body:has(#canvas-host) > footer`），以及兩顆
// 浮動鍵的 `bottom`——浮動鍵必須永遠浮在抽屜上緣之上，否則真人點不到。
// 量**實際**高度而不是寫一個 dvh：抽屜可以被拖高拖低，而這個 repo 的固定偏移量已經
// 咬過五次（CLAUDE.md 有一整節）。
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

const clampPanel = (px: number): number =>
  Math.min(Math.max(px, panelMinH()), innerHeight * PANEL_MAX_RATIO);

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
    if (panelCollapsed()) setPanelHeight(openTarget());
    syncHandleState();
    return;
  }
  // ⚠️ 底下只留 CTA_BOTTOM_GAP。以前留的是 `panelMinH()`（＝把手那一列 56px），而把手
  // 是 sticky、`offsetTop` 本來就含它——那 56px 是白給出去的畫布，實測 243 顆全部中招。
  const want = cta.offsetTop + cta.offsetHeight + CTA_BOTTOM_GAP;
  // 只長不縮：使用者自己拖大過的抽屜不該因為換了一顆節點就被收回去。
  if (panelH() < want) setPanelHeight(clampPanel(want));
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
      writePanelPref({ h: openPanelH ?? innerHeight * PANEL_OPEN_RATIO, open });
    }
    syncHandleState();
  };
  addEventListener('pointerup', endDrag);
  addEventListener('pointercancel', endDrag);

  // 沒有位移的那一下＝點擊，收合／展開。鍵盤的 Enter／Space 也走這裡（它是 <button>）。
  handle.addEventListener('click', () => {
    if (moved) { moved = false; return; }
    if (panelCollapsed()) {
      const target = openTarget();
      openPanelH = target;
      setPanelHeight(target);
      writePanelPref({ h: target, open: true });
    } else {
      // 收合之前先把目前的高度記下來——它就是下次展開要回到的地方。
      openPanelH = panelH();
      setPanelHeight(panelMinH());
      writePanelPref({ h: openPanelH, open: false });
    }
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
    if (e.key === 'Escape' && sheetMode !== null) setSheet(null);
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
render();
