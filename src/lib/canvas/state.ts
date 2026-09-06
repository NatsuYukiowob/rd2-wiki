// 把「畫面現在該長什麼樣」從 Scene（不變的幾何）拆出來：PaintState 是每一幀可能不同的
// 互動狀態（選取／篩選／hover／focus／模擬器），這裡的函式把它換算成 canvas.css 舊版
// 用 class 表達的那幾條 opacity／顏色規則，數值原封不動搬過來，方便跟舊版逐一核對。
import type { SceneEdge, SceneNode } from './scene.js';

export interface SimPaint {
  owned: Set<string>; available: Set<string>; selected: string | null;
  linked: Set<string>; active: Set<string>; ready: Set<string>;     // 鍵用 edgeKey()
  levels: Map<string, number>; maxLevels: Map<string, number>;
}
export interface PaintState {
  selected: string | null; chain: Set<string>; filteredOut: Set<string>;
  focus: string | null; hover: string | null; shadows: boolean; sim: SimPaint | null;
}
export const emptyPaintState = (): PaintState =>
  ({ selected: null, chain: new Set(), filteredOut: new Set(), focus: null, hover: null, shadows: false, sim: null });
export const edgeKey = (from: string, to: string): string => `${from}>${to}`;

/** 舊 canvas.css／sim.astro 的 opacity 規則，數值原封不動搬過來。 */
export function nodeAlpha(s: PaintState, id: string): number {
  if (s.sim) {
    // 搜尋淡出排在最前面，跟舊 CSS 的具體度一致：`#tree.sim .node.sim-dimmed` (1,3,0) 壓過
    // `.sim-selected`／`.sim-locked` (1,2,0)，所以搜尋不符的節點連被選取時也是淡的。
    // ⚠️ 這條只吃節點，邊刻意不跟著淡（舊版 `.sim-dimmed` 也只掛在 `.node` 上）。
    if (s.filteredOut.has(id)) return 0.08;
    if (s.sim.selected === id) return 1;
    if (!s.sim.owned.has(id) && !s.sim.available.has(id)) return 0.28;
    return 1;
  }
  if (s.chain.has(id)) return 1;                        // 前置鏈蓋過篩選淡出（.filtered-out.in-chain）
  if (s.filteredOut.has(id)) return 0.1;
  if (s.selected !== null) return 0.25;                 // has-selection 且不在鏈上
  return 1;
}
export function edgeAlpha(s: PaintState, e: SceneEdge): number {
  if (s.sim) return s.sim.linked.has(edgeKey(e.from, e.to)) ? 1 : s.sim.ready.has(edgeKey(e.from, e.to)) ? 0.7 : 0.25;
  const inChain = s.chain.has(e.from) && s.chain.has(e.to);
  if (inChain) return 1;
  if (s.filteredOut.has(e.from) && s.filteredOut.has(e.to)) return 0.1;
  if (s.selected !== null) return 0.12;
  return 0.9;
}
export function edgeColor(s: PaintState, e: SceneEdge): 'edge' | 'gold' {
  if (s.sim) return s.sim.active.has(edgeKey(e.from, e.to)) ? 'gold' : 'edge';
  return s.chain.has(e.from) && s.chain.has(e.to) ? 'gold' : 'edge';
}
export function labelVisible(s: PaintState, n: SceneNode): boolean {
  return n.labelAlways || s.hover === n.id || s.focus === n.id || s.chain.has(n.id);
}
export function centerAlpha(s: PaintState, allVisible: boolean): number {
  if (s.selected !== null) return 0.12;
  return allVisible ? 1 : 0.1;
}
/** 靜態層要不要重畫的判準。hover／focus 只畫在互動層，刻意不進簽名。 */
export function stateSignature(s: PaintState): string {
  const sim = s.sim ? `|o${[...s.sim.owned].sort().join(',')}|v${[...s.sim.available].sort().join(',')}|s${s.sim.selected ?? ''}|l${[...s.sim.linked].sort().join(',')}|a${[...s.sim.active].sort().join(',')}|r${[...s.sim.ready].sort().join(',')}|L${[...s.sim.levels].map(([k, v]) => `${k}:${v}`).sort().join(',')}` : '';
  return `${s.selected ?? ''}|c${[...s.chain].sort().join(',')}|f${[...s.filteredOut].sort().join(',')}|sh${s.shadows ? 1 : 0}${sim}`;
}
