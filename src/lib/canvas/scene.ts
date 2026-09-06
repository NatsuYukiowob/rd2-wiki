// 把 TreeData 攤成一份「畫圖用」的扁平紀錄，Canvas 渲染器每一幀只讀這份、不再碰 TreeData。
// 為什麼要這一層：TreeData 是資料正本的形狀（成本、解鎖方式……），畫布關心的是幾何與樣式；
// 兩者混在一起會讓渲染迴圈每幀重算 formatUnlockVia／sprite 查表這些不變的東西。
import { formatUnlockVia } from '../format.js';
import type { Branch, NodeType, Shape, TreeData } from '../types.js';

export interface SceneNode {
  id: string; x: number; y: number; w: number; h: number; shape: Shape; type: NodeType; branch: Branch;
  icon: string; cell: [number, number, number, number] | null;
  label: string; labelAlways: boolean; ariaLabel: string; bypassPrereq: boolean;
}
export interface SceneEdge { from: string; to: string; x1: number; y1: number; x2: number; y2: number; bypassable: boolean }
// label 是 string 不是 string | null：`TreeMeta.center.label` 是必填欄位（types.ts），
// 舊版的 `label: c.label ?? null` 是永遠走不到的死碼（2026-09-06 最終審查 m10）。
export interface SceneCenter { x: number; y: number; w: number; h: number; url: string; label: string; labelDy: number; links: [number, number][] }
export interface Scene {
  nodes: SceneNode[]; byId: Map<string, SceneNode>; edges: SceneEdge[]; center: SceneCenter | null;
  sprite: { url: string; size: [number, number] }; viewBox: [number, number, number, number]; diceIconWidth: number;
}
// 沿用舊的 SVG 渲染器（`src/lib/render.ts`，2026-09-06 刪）既有的中文對照表
// （aria-label 面向螢幕閱讀器，type 的英文代碼逐字母拼音唸出來體驗很差）。
const TYPE_LABEL: Record<NodeType, string> = { dice: '骰子', rune: '骰子符文', passive: '玩家被動', support: '支援' };

/** 把 TreeData 攤成畫圖紀錄。一次算完，之後每一幀都只讀這份，不再碰 TreeData。 */
export function buildScene(data: TreeData): Scene {
  const nodes: SceneNode[] = data.nodes.map(n => ({
    id: n.id, x: n.x, y: n.y, w: n.size[0], h: n.size[1], shape: n.shape, type: n.type, branch: n.branch,
    icon: n.icon, cell: data.meta.sprite.index[n.icon] ?? null,
    label: n.label, labelAlways: n.type === 'dice' || n.type === 'support',
    ariaLabel: `${n.name}，${TYPE_LABEL[n.type]}，${formatUnlockVia(n)}`,
    bypassPrereq: n.bypassPrereq === true,
  }));
  const byId = new Map(nodes.map(n => [n.id, n]));
  const edges: SceneEdge[] = data.edges.map(([from, to]) => {
    const a = byId.get(from); const b = byId.get(to);
    if (!a || !b) throw new Error(`邊端點找不到對應節點：${from} -> ${to}`);
    return { from, to, x1: a.x, y1: a.y, x2: b.x, y2: b.y, bypassable: b.bypassPrereq };
  });
  const c = data.meta.center;
  const center: SceneCenter | null = c ? {
    x: c.x, y: c.y, w: c.size[0], h: c.size[1], url: c.url, label: c.label, labelDy: c.labelDy,
    links: c.links.map(id => byId.get(id)).filter((n): n is SceneNode => !!n).map(n => [n.x, n.y] as [number, number]),
  } : null;
  return {
    nodes, byId, edges, center,
    sprite: { url: data.meta.sprite.url, size: data.meta.sprite.size }, viewBox: data.meta.viewBox,
    diceIconWidth: data.nodes.find(n => n.type === 'dice')?.size[0] ?? 50,
  };
}
