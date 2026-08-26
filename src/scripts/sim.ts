// `/sim` 骰子樹模擬器的掛載與互動。
//
// 狀態機、費用計算、能力彙總、存檔與報告全部在 src/lib/sim.ts 與 src/lib/sim-io.ts
// （純函式、測得動）。這裡只做三件事：把狀態畫成畫面、把事件翻成狀態轉換、存檔。
//
// ⚠️ **不重用 src/scripts/tree-canvas.ts**：那支是 side-effect 腳本（載入即掛載），而且跟
// /tree 的篩選器、詳情卡片擺位、高解析圖示 LOD 綁死。共用的是純函式層（renderTree、
// Viewport、graph、cost）與 canvas.css 的畫布骨架。
import rawData from '../generated/tree.json';
import rawTables from '../../data/passive-upgrade-cost.json';
import { renderTree } from '../lib/render.js';
import {
  DESKTOP_ICON_TARGET_PX, MOBILE_ICON_TARGET_PX, Viewport, minReadableScale,
} from '../lib/viewport.js';
import {
  buildSimContext, initialSimState, ownedIds, isAvailable, missingParents,
  unlockNode, removeNode, setNodeLevel, setInitialDice, pathTo, unlockMany,
  simTotals, maxSelectableLevel, summarizeAbilities, exceedsLimit, edgeWasUsed, edgeIsLinked,
} from '../lib/sim.js';
import type { AbilityGroup, SimState } from '../lib/sim.js';
import { SIM_STORAGE_KEY, deserializeSim, serializeSim, simReport } from '../lib/sim-io.js';
import { levelTableFor, upgradeExtraCost } from '../lib/upgrade-tiers.js';
import { formatCost } from '../lib/format.js';
import { typeLabel } from '../lib/labels.js';
import { renderTaggedText } from '../lib/markup.js';
import type { PassiveUpgradeCost, TreeData, TreeNode } from '../lib/types.js';

const data = rawData as unknown as TreeData;
const tables = rawTables as unknown as PassiveUpgradeCost;
const ctx = buildSimContext(data, tables);

const GROUP_ZH: Record<AbilityGroup, string> = {
  global: '全部骰子', nature: '自然', engineering: '工學', magic: '魔法', order: '秩序', chaos: '渾沌',
};

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

// --- 畫布 -------------------------------------------------------------------
const host = $('canvas-host');
const svg = renderTree(data, document);
// `.sim` 讓模擬器專屬的 CSS 認得這張畫布——/tree 的 SVG 也叫 #tree，基本樣式共用一份。
svg.classList.add('sim');
host.appendChild(svg);
const layer = svg.querySelector('#viewport') as SVGGElement;
const vp = new Viewport(svg, layer);

const nodeEls = new Map<string, SVGGElement>();
for (const el of svg.querySelectorAll<SVGGElement>('g.node')) {
  nodeEls.set(el.getAttribute('data-id')!, el);
}
const edgeEls = [...svg.querySelectorAll<SVGLineElement>('line.edge')];

const isMobile = typeof matchMedia === 'function' && matchMedia('(width <= 720px)').matches;

function fitAll(): void {
  vp.invalidateCtm();
  vp.fitTo(data.meta.viewBox);
  const rect = svg.getBoundingClientRect();
  const diceWidth = data.nodes.find(n => n.type === 'dice')?.size[0] ?? 50;
  const floor = minReadableScale(
    rect.width, rect.height, data.meta.viewBox[2], data.meta.viewBox[3],
    diceWidth, isMobile ? MOBILE_ICON_TARGET_PX : DESKTOP_ICON_TARGET_PX,
  );
  // 下限只是下限：fitTo 給的倍率已經夠大時不該反過來把畫面拉近。
  if (vp.scale < floor) vp.zoomAt(floor / vp.scale, rect.left + rect.width / 2, rect.top + rect.height / 2);
}

// --- 平移與縮放 --------------------------------------------------------------
// 跟 /tree 是兩份實作（見檔頭）。這裡刻意做得比較薄：沒有高解析圖示 LOD、沒有投影門檻、
// 沒有分支跳轉——模擬器的重點是「這套規劃要花多少」，不是把樹看得多清楚。
let dragging = false;
svg.addEventListener('pointerdown', e => {
  dragging = true;
  svg.setPointerCapture(e.pointerId);
});
svg.addEventListener('pointerup', e => {
  dragging = false;
  svg.releasePointerCapture(e.pointerId);
});
svg.addEventListener('pointercancel', () => { dragging = false; });
svg.addEventListener('pointermove', e => {
  if (dragging) vp.pan(e.movementX, e.movementY);
});
svg.addEventListener('wheel', e => {
  e.preventDefault();
  vp.zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX, e.clientY);
}, { passive: false });

// 雙指縮放。⚠️ `dragging` 要在第二指落下的 pointerdown 當下就關掉，不能等到 pointermove
// ——上面那個 handler 先註冊，會把兩指移動的第一幀當成單指拖曳多 pan 一次（/tree 記過同一件事）。
const touches = new Map<number, { x: number; y: number }>();
let lastDist = 0;
svg.addEventListener('pointerdown', e => {
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size >= 2) dragging = false;
});
svg.addEventListener('pointerup', e => { touches.delete(e.pointerId); lastDist = 0; });
svg.addEventListener('pointercancel', e => { touches.delete(e.pointerId); lastDist = 0; });
svg.addEventListener('pointermove', e => {
  if (!touches.has(e.pointerId)) return;
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size !== 2) return;
  const [a, b] = [...touches.values()];
  if (!a || !b) return;
  const dist = Math.hypot(a.x - b.x, a.y - b.y);
  if (lastDist > 0) vp.zoomAt(dist / lastDist, (a.x + b.x) / 2, (a.y + b.y) / 2);
  lastDist = dist;
});

addEventListener('resize', () => { vp.invalidateCtm(); });

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
 * （前置沒齊、等級超出範圍）或被資源上限擋下來。
 *
 * ⚠️ 上限檢查帶著「操作前的總額」進去，只擋**會讓事情變糟**的方向。玩家的實際用法是
 * 「先規劃、事後才填上限」，填完的那一刻通常已經超支——若連取消節點、降等級這些會讓成本
 * 下降的操作都一起擋掉，他除了 undo 或整份重置之外沒有出路（`/code-review high` 抓到，
 * 實測：4,000 金幣的規劃填上限 1,000 之後連「取消此節點」都按不動）。
 */
function applyState(next: SimState | null): boolean {
  if (next === null || next === state) return false;
  const over = exceedsLimit(simTotals(next, ctx).total, limits(), simTotals(state, ctx).total);
  if (over.length > 0) {
    toast(`超出資源上限：${over.join('、')}`);
    return false;
  }
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

// --- 資源上限 ---------------------------------------------------------------
function readLimit(el: HTMLInputElement): number | null {
  const raw = el.value.trim();
  if (raw === '') return null;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
}

function limits(): { core: number | null; gold: number | null } {
  return { core: readLimit($<HTMLInputElement>('sim-limit-core')), gold: readLimit($<HTMLInputElement>('sim-limit-gold')) };
}

// --- 畫面 -------------------------------------------------------------------
const SVG_NS = 'http://www.w3.org/2000/svg';

/** 等級牌。只建一次，之後靠 hidden 與文字內容更新——每次重畫都重建的話會在拖曳中閃。 */
function ensureBadges(): void {
  for (const [id, el] of nodeEls) {
    const node = ctx.byId.get(id);
    if (!node || maxSelectableLevel(node, ctx) <= 1) continue;
    if (el.querySelector(':scope > .sim-badge')) continue;
    const [, h] = node.size;
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'sim-badge');
    // 貼在圖示下緣外側；標籤本來就在 h/2 + 15，等級牌放它上面一點不會撞到。
    g.setAttribute('transform', `translate(0,${h / 2 - 2})`);
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', '-16');
    rect.setAttribute('y', '0');
    rect.setAttribute('width', '32');
    rect.setAttribute('height', '16');
    rect.setAttribute('rx', '3');
    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('x', '0');
    text.setAttribute('y', '12');
    g.append(rect, text);
    el.appendChild(g);
  }
}

function renderCanvas(): void {
  const owned = ownedIds(state, ctx);
  for (const [id, el] of nodeEls) {
    const isOwned = owned.has(id);
    el.classList.toggle('sim-owned', isOwned);
    el.classList.toggle('sim-available', !isOwned && isAvailable(id, state, ctx));
    el.classList.toggle('sim-locked', !isOwned && !isAvailable(id, state, ctx));
    el.classList.toggle('sim-selected', id === selected);
    // ⚠️ 等級牌的顯示交給 CSS（`.node:not(.sim-owned) .sim-badge`）——**SVG 元素不吃 HTML 的
    // `hidden` 屬性**，`toggleAttribute('hidden')` 在這裡是完全沒有作用的一行，239 個牌子
    // 會全部留在畫面上。
    const badge = el.querySelector<SVGGElement>(':scope > .sim-badge');
    if (badge && isOwned) {
      const node = ctx.byId.get(id)!;
      const t = badge.querySelector('text');
      if (t) t.textContent = `${state.levels.get(id) ?? 1}/${node.maxLevel}`;
    }
  }
  for (const el of edgeEls) {
    const from = el.getAttribute('data-from')!;
    const to = el.getAttribute('data-to')!;
    el.classList.toggle('sim-linked', edgeIsLinked(from, to, state, ctx));
    el.classList.toggle('sim-active', edgeWasUsed(from, to, state, ctx));
    el.classList.toggle('sim-ready', owned.has(from) && !owned.has(to) && isAvailable(to, state, ctx));
  }
}

const num = (n: number) => n.toLocaleString('en-US');
const cost = (c: { core: number; gold: number }) => `核心 ${num(c.core)} ／金幣 ${num(c.gold)}`;

function renderTotals(): void {
  const t = simTotals(state, ctx);
  $('sim-total').textContent = cost(t.total);
  $('sim-total-unlock').textContent = cost(t.unlock);
  $('sim-total-upgrade').textContent = cost(t.upgrade);
  $('sim-owned-count').textContent = `${ownedIds(state, ctx).size} / ${data.nodes.length}`;

  const over = exceedsLimit(t.total, limits());
  const warn = $('sim-limit-warn');
  warn.textContent = over.length > 0 ? `已超出設定的上限：${over.join('、')}` : '';
  warn.toggleAttribute('hidden', over.length === 0);
  const lim = limits();
  $<HTMLInputElement>('sim-limit-core').classList.toggle('over-limit', lim.core !== null && t.total.core > lim.core);
  $<HTMLInputElement>('sim-limit-gold').classList.toggle('over-limit', lim.gold !== null && t.total.gold > lim.gold);

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
  const lv = state.levels.get(node.id) ?? 1;
  const table = levelTableFor(node, ctx.tables, ctx.runeTable);
  const extra = table ? upgradeExtraCost(table, lv) : null;
  const next = table && lv < cap ? upgradeExtraCost(table, lv + 1) : null;
  const step = next && extra ? { core: next.core - extra.core, gold: next.gold - extra.gold } : null;
  return { cap, lv, extra, step };
}

const nextLevelText = (lv: number, cap: number, step: { core: number; gold: number } | null): string =>
  lv >= cap ? '已滿級' : step ? formatCost(step) : '成本未確認';

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
  const { cap, lv, extra, step } = levelInfo(node);
  value.textContent = `Lv.${lv} / ${cap}`;
  const notes = box.querySelectorAll('.sim-level .note');
  if (notes[0]) notes[0].textContent = `下一級：${nextLevelText(lv, cap, step)}`;
  if (notes[1]) notes[1].textContent = `Lv.1 → Lv.${lv} 追加：${formatCost(extra ?? { core: 0, gold: 0 })}`;
  const dec = box.querySelector<HTMLButtonElement>('[data-step="-1"]');
  const inc = box.querySelector<HTMLButtonElement>('[data-step="1"]');
  if (dec) dec.disabled = lv <= 1;
  if (inc) inc.disabled = lv >= cap;
}

function levelBlockHtml(node: TreeNode): string {
  if (maxSelectableLevel(node, ctx) <= 1 || !ownedIds(state, ctx).has(node.id)) return '';
  const { cap, lv, extra, step } = levelInfo(node);
  return `
    <div class="sim-level">
      <div class="sim-level-row">
        <button type="button" data-step="-1" aria-label="降低等級"${lv <= 1 ? ' disabled' : ''}>−</button>
        <input type="range" id="sim-level-range" min="1" max="${cap}" value="${lv}" aria-label="等級" />
        <button type="button" data-step="1" aria-label="提高等級"${lv >= cap ? ' disabled' : ''}>＋</button>
        <span class="sim-level-value">Lv.${lv} / ${cap}</span>
      </div>
      <p class="note">下一級：${esc(nextLevelText(lv, cap, step))}</p>
      <p class="note">Lv.1 → Lv.${lv} 追加：${esc(formatCost(extra ?? { core: 0, gold: 0 }))}</p>
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
  if (free) action = '<button type="button" class="cta" disabled>起始骰子（一開始就有）</button>';
  else if (optional) {
    action = owned
      ? '<button type="button" class="cta danger" data-uncheck>取消勾選（會連帶取消後續）</button>'
      : '<button type="button" class="cta" data-check>我已經有這顆了</button>';
  } else if (owned) action = '<button type="button" class="cta danger" data-remove>取消此節點（會連帶取消後續）</button>';
  else if (avail) action = `<button type="button" class="cta" data-unlock>取得 · ${esc(formatCost(node.unlockCost))}</button>`;
  else {
    action = `<p class="note warn">缺少前置：${missing.map(id => esc(ctx.byId.get(id)?.name ?? id)).join('、')}</p>`
      + '<button type="button" class="cta" data-path>一鍵點亮到這裡</button>';
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
 * 於是「超出資源上限」「請先在初始骰子勾選」這些**唯一**的失敗回饋對螢幕閱讀器完全不存在
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
// ⚠️ **不能在節點上綁 `click`**：`svg.setPointerCapture()` 一旦生效，後續 pointer 事件
// （以及由它們合成的 click）的 target 全部被改標成 svg 本身，節點的 handler 永遠不會跑
// ——實測就是「點下去完全沒反應」。改成在 pointerdown「當下」（capture 還沒生效、target
// 還沒被改標）記下被按到的節點，pointerup 只用來量位移、判定這一下算不算點選。
// /tree 的 tree-canvas.ts 也是同一套做法。
const DRAG_THRESHOLD_PX = 5;
let downTarget: Element | null = null;
let downPos = { x: 0, y: 0 };

function activate(id: string | null): void {
  selected = id;
  // 前置齊了就直接取得——先選再按按鈕，在一棵 239 節點的樹上太累。
  // ⚠️ `commit()` 失敗（例如被資源上限擋下）時**一定要自己補一次 render**：`selected` 已經
  // 換人了，不重畫的話面板與 `.sim-selected` 會停在上一顆節點，而面板上那些按鈕讀的是
  // `selected`——按下去作用在畫面上看不到的那顆（`/code-review high` 抓到）。
  const taken = id !== null && isAvailable(id, state, ctx) && commit(unlockNode(state, ctx, id));
  if (!taken) render();
}

svg.addEventListener('pointerdown', e => {
  downTarget = (e.target as Element).closest('g.node');
  downPos = { x: e.clientX, y: e.clientY };
});
svg.addEventListener('pointerup', e => {
  // 雙指縮放中途放開一指不算點選（此時 touches 已被上面那個 handler 刪掉這一指）。
  if (touches.size > 0) return;
  if (Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > DRAG_THRESHOLD_PX) return;
  activate(downTarget ? downTarget.getAttribute('data-id') : null);
});
svg.addEventListener('keydown', e => {
  const g = (e.target as Element).closest?.('g.node');
  if ((e.key === 'Enter' || e.key === ' ') && g) {
    e.preventDefault();
    activate(g.getAttribute('data-id'));
  }
  if (e.key === 'Escape') activate(null);
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
    const { need, blocked } = pathTo(id, state, ctx);
    if (blocked.length > 0) {
      toast(`請先在「初始骰子」勾選：${blocked.map(x => ctx.byId.get(x)?.name ?? x).join('、')}`);
      return;
    }
    if (need.length === 0) return;
    if (commit(unlockMany(state, ctx, need))) toast(`已點亮 ${need.length} 個節點`);
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
    // 被上限擋下來：把滑桿拉回真實等級，不要留一個沒生效的位置在畫面上。
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
    // 被擋下來（超出上限、或那顆根本不是可選初始骰子）時，勾選框要跟著回到真實狀態，
    // 否則畫面上會顯示一個沒有生效的勾。
    if (!ok) el.checked = state.initial.has(el.dataset['initial']!);
  });
}

for (const id of ['sim-limit-core', 'sim-limit-gold']) {
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
  for (const [id, el] of nodeEls) {
    const node = ctx.byId.get(id);
    const hit = q === '' || (node !== undefined && node.name.toLowerCase().includes(q));
    el.classList.toggle('sim-dimmed', !hit);
  }
});

// --- 手機版：footer 讓位給抽屜 ------------------------------------------------
// 抽屜是 fixed bottom:0，而這一頁不捲動——不讓位的話 footer 的著作權聲明在手機上完全
// 讀不到。量**實際**高度而不是寫一個 42dvh：抽屜會隨「有沒有選節點」長高變矮，而這個
// repo 的固定偏移量已經咬過五次（CLAUDE.md 有一整節）。
function trackPanelHeight(): void {
  const panel = $('sim-panel');
  const write = (): void => {
    document.documentElement.style.setProperty('--sim-panel-h', `${panel.getBoundingClientRect().height}px`);
  };
  write();
  // linkedom 沒有 ResizeObserver；這條路徑在單元測試環境本來就不做事。
  if (typeof ResizeObserver === 'function') new ResizeObserver(write).observe(panel);
}

// --- 啟動 -------------------------------------------------------------------
trackPanelHeight();
ensureBadges();
fitAll();
render();
