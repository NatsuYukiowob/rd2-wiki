import { parseTreeWith } from './svg-parse.js';
import { parseCost } from './cost.js';
import { parseGrowth } from './growth.js';
import { extractKeywords } from './keywords.js';
import { branchOfId, elementOfStroke, typeOfZh, sizeOfType } from './taxonomy.js';
import { buildAdjacency, findRoots } from './graph.js';
import type { Branch, Edge, TreeData, TreeNode, UnlockVia } from './types.js';
import type { XmlParser } from './dom.js';

export interface BuildOpts {
  keywords: string[];
  unlockExceptions: Record<string, { unlockVia: UnlockVia }>;
  spriteIndex: Record<string, [number, number, number, number]>;
  /** sprite.webp 的實際像素尺寸 [寬, 高]，直接寫進 meta.sprite.size 供渲染時的 <image> width/height 使用。 */
  spriteSize: [number, number];
}

export function buildTreeDataWith(svgText: string, opts: BuildOpts, parseXml: XmlParser): TreeData {
  const { meta: rawMeta, nodes: rawNodes, edges: rawEdges } = parseTreeWith(svgText, parseXml);

  const nodes: TreeNode[] = rawNodes.map(r => {
    const type = typeOfZh(r.typeZh);
    const branch = branchOfId(r.id);
    const { cost, maxLevel } = parseCost(r.costRaw);
    const { growth, dataIssue } = parseGrowth(r.description);
    const level = maxLevel ?? r.titleMaxLevel ?? 1;
    return {
      id: r.id, branch, element: elementOfStroke(r.stroke), type,
      name: r.name, label: r.label,
      shape: r.shape, size: sizeOfType(type), x: r.x, y: r.y,
      unlockCost: cost,
      unlockVia: opts.unlockExceptions[r.id]?.unlockVia ?? 'cost',
      maxLevel: level,
      prereqMode: null, upgradeCost: null,
      description: r.description,
      keywords: extractKeywords(r.description, opts.keywords),
      growth,
      dataIssue: dataIssue ?? (level > 1 && !growth ? 'no-growth' : null),
      icon: r.icon,
    };
  });

  const at = (x: number, y: number) => nodes.find(n => Math.abs(n.x - x) < 0.5 && Math.abs(n.y - y) < 0.5);
  const edges: Edge[] = rawEdges.map(e => {
    const a = at(e.from[0], e.from[1]);
    const b = at(e.to[0], e.to[1]);
    if (!a || !b) throw new Error(`邊端點未對齊節點中心：${JSON.stringify(e)}`);
    return [a.id, b.id] as Edge;
  });

  const { parents } = buildAdjacency(edges);
  const roots = findRoots(nodes.map(n => n.id), parents).sort();

  // meta.totalUnlockCost 是「SVG 成本總和」，刻意不排除 unlockVia !== 'cost' 的節點：
  // spec §2.1 說明此總和本來就不等於玩家實際支出（任務／預設解鎖節點另有例外標註），
  // 與前置鏈計算（graph.ts 的 sumUnlockCost，會排除非 cost 節點）用途不同，不可混用。
  const totalUnlockCost = nodes.reduce(
    (acc, n) => ({ core: acc.core + n.unlockCost.core, gold: acc.gold + n.unlockCost.gold }),
    { core: 0, gold: 0 }
  );

  const bounds = {} as Record<Branch, [number, number, number, number]>;
  for (const b of ['nature', 'engineering', 'magic', 'order', 'chaos'] as Branch[]) {
    const sub = nodes.filter(n => n.branch === b);
    const xs = sub.map(n => n.x), ys = sub.map(n => n.y);
    bounds[b] = [Math.min(...xs) - 60, Math.min(...ys) - 60,
      Math.max(...xs) - Math.min(...xs) + 120, Math.max(...ys) - Math.min(...ys) + 120];
  }

  return {
    meta: {
      ...rawMeta, roots, bounds,
      totalUnlockCost,
      sprite: { url: '/assets/sprite.webp', size: opts.spriteSize, index: opts.spriteIndex },
    },
    nodes, edges,
  };
}
