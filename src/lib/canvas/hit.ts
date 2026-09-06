// src/lib/canvas/hit.ts
// 畫布上的點擊命中測試：把節點依外接矩形塞進 cell×cell 的網格，查詢時只看指標所在格的少數幾顆，
// 不必逐一比對全部節點。命中判準＝點落在節點 w×h 的矩形內（圓形節點動用外接方框），跟 SVG 版
// `<rect class="icon">` 的命中範圍一致。
import type { Scene, SceneNode } from './scene.js';
export interface HitIndex { cell: number; buckets: Map<string, SceneNode[]> }
const key = (cx: number, cy: number) => `${cx},${cy}`;
/** 節點依外接矩形塞進 cell×cell 的格子；跨格的塞進每一格。241 顆、一格通常 0–3 顆。 */
export function buildHitIndex(scene: Scene, cell = 80): HitIndex {
  const buckets = new Map<string, SceneNode[]>();
  for (const n of scene.nodes) {
    const x0 = Math.floor((n.x - n.w / 2) / cell), x1 = Math.floor((n.x + n.w / 2) / cell);
    const y0 = Math.floor((n.y - n.h / 2) / cell), y1 = Math.floor((n.y + n.h / 2) / cell);
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
      const k = key(cx, cy); const b = buckets.get(k); if (b) b.push(n); else buckets.set(k, [n]);
    }
  }
  return { cell, buckets };
}
export function hitTest(index: HitIndex, wx: number, wy: number): string | null {
  const b = index.buckets.get(key(Math.floor(wx / index.cell), Math.floor(wy / index.cell)));
  if (!b) return null;
  for (let i = b.length - 1; i >= 0; i--) {              // 後畫的在上面，先命中
    const n = b[i]!;
    if (Math.abs(wx - n.x) <= n.w / 2 && Math.abs(wy - n.y) <= n.h / 2) return n.id;
  }
  return null;
}
