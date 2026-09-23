// `/sim` 匯出圖片的純函式層：圖上要放什麼、放在哪裡、完整版的固定視圖。
// 實際畫圖在 src/scripts/sim-export-image.ts（比照 board-image.ts ↔ board-export.ts 的分工）。
import { emptyPaintState, type PaintState, type SimPaint } from './canvas/state.js';
import type { ViewGeometry } from './canvas/view.js';
import { mythicEntries } from './cost.js';
import { BRANCH_ZH } from './labels.js';
import { maxSelectableLevel, simTotals } from './sim.js';
import type { SimContext, SimState } from './sim.js';
import type { Branch } from './types.js';

export const IMAGE_TITLE = 'Random Dice 2 骰子樹規劃';
const BRANCH_ORDER: readonly Branch[] = ['nature', 'engineering', 'magic', 'order', 'chaos'];
const num = (n: number) => n.toLocaleString('en-US');

/**
 * 圖頂的總計一行。超越核心只在總計用得到時才印，判準同 `simReport()`（`mythicEntries(total)`）。
 * 只印總計、不拆解鎖／升級（Yuki 2026-09-23）。
 */
export function headerTotalLine(state: SimState, ctx: SimContext): string {
  const t = simTotals(state, ctx).total;
  const parts = [
    `核心 ${num(t.core)}`, `金幣 ${num(t.gold)}`,
    ...mythicEntries(t).map(([def, n]) => `${def.label} ${num(n)}`),
  ];
  return `總計  ${parts.join(' ／')}`;
}

export interface CompactEntry { id: string; name: string; level: string | null }
export interface CompactSection { branch: Branch; title: string; entries: CompactEntry[] }

/**
 * 精簡版要列的節點，依系別分區。列入＝玩家點開的（`unlocked`）＋有勾的可選初始骰子
 * （`initial`）；起始送的（`ctx.free`）不列，理由同 `simReport()`：玩家沒為它們做過選擇。
 * 區頭的分母同樣不含 `ctx.free`，分子分母口徑一致。取得 0 顆的系整區不出現。
 */
export function compactSections(state: SimState, ctx: SimContext): CompactSection[] {
  const picked = new Set([...state.unlocked, ...state.initial]);
  const out: CompactSection[] = [];
  for (const branch of BRANCH_ORDER) {
    const pool = [...ctx.byId.values()].filter(n => n.branch === branch && !ctx.free.has(n.id));
    const got = pool.filter(n => picked.has(n.id)).sort((a, b) => a.id.localeCompare(b.id));
    if (got.length === 0) continue;
    out.push({
      branch,
      title: `${BRANCH_ZH[branch]} ${got.length}/${pool.length}`,
      entries: got.map(n => {
        const cap = maxSelectableLevel(n, ctx);
        return { id: n.id, name: n.name, level: cap > 1 ? `Lv.${state.levels.get(n.id) ?? 1}/${cap}` : null };
      }),
    });
  }
  return out;
}

/**
 * 精簡版的版面常數（px）。寬 1080：手機直式分享時不會被再縮一次。
 * 3 欄（Yuki 2026-09-24）：4 欄時全樹點滿大半名稱被截成「…」；3 欄讓全站最長的名稱（10 字）
 * 以 namePx 全形字寬計也放得下，`sim-image.test.ts` 守。
 */
export const COMPACT = {
  width: 1080, pad: 40, headerH: 140, emptyH: 80,
  sectionHeadH: 56, sectionGap: 24,
  cols: 3, gap: 12, cellH: 96, cellPad: 10, radius: 10, icon: 72, namePx: 22,
} as const;

export interface CompactCell { x: number; y: number; w: number; h: number; entry: CompactEntry }
export interface CompactLayout { height: number; sections: { title: string; y: number; cells: CompactCell[] }[] }

export function compactLayout(sections: CompactSection[]): CompactLayout {
  const { width, pad, headerH, emptyH, sectionHeadH, sectionGap, cols, gap, cellH } = COMPACT;
  const cellW = (width - pad * 2 - gap * (cols - 1)) / cols;
  let y = headerH;
  const out: CompactLayout['sections'] = [];
  for (const s of sections) {
    const headY = y;
    y += sectionHeadH;
    const top = y;
    const cells = s.entries.map((entry, i) => ({
      entry, w: cellW, h: cellH,
      x: pad + (i % cols) * (cellW + gap),
      y: top + Math.floor(i / cols) * (cellH + gap),
    }));
    const rows = Math.ceil(s.entries.length / cols);
    y += rows * cellH + (rows - 1) * gap + sectionGap;
    out.push({ title: s.title, y: headY, cells });
  }
  if (sections.length === 0) y += emptyH;
  return { height: y + pad, sections: out };
}

/** 放不下就從尾端截斷加「…」。`measure` 由呼叫端傳（canvas 的 measureText），這裡才測得動。 */
export function fitText(text: string, maxW: number, measure: (s: string) => number): string {
  if (measure(text) <= maxW) return text;
  const chars = [...text];
  while (chars.length > 0 && measure(`${chars.join('')}…`) > maxW) chars.pop();
  return `${chars.join('')}…`;
}

/** 完整版：2×，標題列高度是 world→px 之前的值（跟精簡版同一組字級，乘上 scale）。 */
export const FULL = { scale: 2, headerH: COMPACT.headerH } as const;
/** iOS Safari 的 canvas 面積上限（4096×4096）；超過會畫出空白圖而不是報錯。 */
export const IOS_MAX_CANVAS_AREA = 16_777_216;

export function fullImageSize(viewBox: [number, number, number, number]): [number, number] {
  return [viewBox[2] * FULL.scale, (viewBox[3] + FULL.headerH) * FULL.scale];
}

/**
 * 匯出用的固定視圖：viewBox 左上角對到 (0, offsetY)，每個 world 單位 k px。
 * painter 只讀 `pxPerUnit`／`worldToScreen`／`cssSize`；`cssSize` 回整張圖，
 * 所以 `drawStatic()` 開頭的 clear 會清掉整張（含標題列），標題列要在它之後畫。
 */
export function fixedView(
  viewBox: [number, number, number, number], k: number, offsetY: number, size: [number, number],
): ViewGeometry {
  const [vx, vy, vw, vh] = viewBox;
  return {
    scale: 1, base: k, pxPerUnit: k, version: 0, cssSize: size,
    worldToScreen: (x, y) => [(x - vx) * k, (y - vy) * k + offsetY],
    screenToWorld: (px, py) => [px / k + vx, (py - offsetY) / k + vy],
    visibleWorldRect: () => ({ x: vx, y: vy, w: vw, h: vh }),
  };
}

/**
 * 匯出的畫布狀態：只留「規劃」，清掉「互動」。搜尋淡出（filteredOut）、選取光暈、
 * 焦點與 hover 都是玩家當下在畫面上的操作，不該被烙進分享出去的圖。投影開著（2× 下圖示
 * 約 100px，遠超畫面的 SHADOW_ON 門檻，畫面在同樣大小時也是開的）。
 */
export function exportPaintState(sim: SimPaint): PaintState {
  return { ...emptyPaintState(), shadows: true, sim: { ...sim, selected: null } };
}
