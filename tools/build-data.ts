import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { parseTree } from './lib/svg-parse.js';
import { buildSprite, buildHiRes, type IconEntry } from './lib/icons.js';
import { parseCost } from '../src/lib/cost.js';
import { parseGrowth } from '../src/lib/growth.js';
import { extractKeywords } from '../src/lib/keywords.js';
import { branchOfId, elementOfStroke, typeOfZh, sizeOfType } from '../src/lib/taxonomy.js';
import { buildAdjacency, findRoots } from '../src/lib/graph.js';
import type { Branch, Edge, TreeData, TreeNode, UnlockVia } from '../src/lib/types.js';

interface BuildOpts {
  keywords: string[];
  unlockExceptions: Record<string, { unlockVia: UnlockVia }>;
  spriteIndex: Record<string, [number, number, number, number]>;
  /** sprite.webp 的實際像素尺寸 [寬, 高]，直接寫進 meta.sprite.size 供渲染時的 <image> width/height 使用。 */
  spriteSize: [number, number];
}

export function buildTreeData(svgText: string, opts: BuildOpts): TreeData {
  const { meta: rawMeta, nodes: rawNodes, edges: rawEdges } = parseTree(svgText);

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

if (import.meta.url === `file://${process.argv[1]}`) {
  const svgText = readFileSync('data/dice-tree.svg', 'utf8');
  const keywords = JSON.parse(readFileSync('data/keywords.json', 'utf8'));
  const unlockExceptions = JSON.parse(readFileSync('data/unlock-exceptions.json', 'utf8'));

  const { nodes: rawNodes } = parseTree(svgText);
  const typeByHash = new Map(rawNodes.map(n => [n.icon, typeOfZh(n.typeZh)]));
  const entries: IconEntry[] = readdirSync('data/icons')
    .filter(f => f.endsWith('.png'))
    .map(f => {
      const hash = f.replace('.png', '');
      return { hash, buf: readFileSync(`data/icons/${f}`), type: typeByHash.get(hash) ?? 'dice' };
    });

  const { sprite, index, size } = await buildSprite(entries);
  const hiRes = await buildHiRes(entries);

  mkdirSync('public/assets/icons', { recursive: true });
  mkdirSync('src/generated', { recursive: true });
  writeFileSync('public/assets/sprite.webp', sprite);
  for (const [hash, buf] of hiRes) writeFileSync(`public/assets/icons/${hash}.webp`, buf);

  const data = buildTreeData(svgText, { keywords, unlockExceptions, spriteIndex: index, spriteSize: size });
  const json = JSON.stringify(data);
  writeFileSync('src/generated/tree.json', json);

  console.log(`tree.json ${(Buffer.byteLength(json) / 1024).toFixed(1)} KB, sprite ${(sprite.length / 1024).toFixed(0)} KB`);

  // spec §11 效能預算：正式產物（真實 sprite index，不是測試用的替身資料）
  // 必須量 CLI 實際寫出的 tree.json 與 sprite.webp，測試套件裡的 spriteIndex 是 202 筆全同值
  // [0,0,48,52] 的替身，壓縮率會偏樂觀，量不出真正的邊際。
  //
  // 兩項預算都印出「用了多少 / 預算多少 / 還剩多少」而非只在超標時才報錯：實測值離門檻只有
  // 個位數 KB 的餘裕（tree.json 約 2–3 KB、sprite 約 300 KB），遊戲改版加一整個新分支就可能
  // 一口氣吃掉大半餘裕，提前印出來才有機會在真的撞線前注意到，而不是等紅燈才發現。
  const GZIP_BUDGET_BYTES = 20 * 1024;
  const SPRITE_BUDGET_BYTES = 400 * 1024;
  const gzipBytes = gzipSync(Buffer.from(json)).length;
  const gzipMarginBytes = GZIP_BUDGET_BYTES - gzipBytes;
  const spriteMarginBytes = SPRITE_BUDGET_BYTES - sprite.length;
  console.log(
    `tree.json gzip ${(gzipBytes / 1024).toFixed(1)} KB / ${(GZIP_BUDGET_BYTES / 1024).toFixed(0)} KB，餘裕 ${(gzipMarginBytes / 1024).toFixed(1)} KB`
  );
  console.log(
    `sprite.webp ${(sprite.length / 1024).toFixed(1)} KB / ${(SPRITE_BUDGET_BYTES / 1024).toFixed(0)} KB，餘裕 ${(spriteMarginBytes / 1024).toFixed(1)} KB`
  );
  let budgetExceeded = false;
  if (gzipBytes > GZIP_BUDGET_BYTES) {
    console.error(
      `❌ tree.json gzip 後 ${(gzipBytes / 1024).toFixed(1)} KB 超過效能預算 ${(GZIP_BUDGET_BYTES / 1024).toFixed(0)} KB`
    );
    budgetExceeded = true;
  }
  if (sprite.length > SPRITE_BUDGET_BYTES) {
    console.error(
      `❌ sprite.webp ${(sprite.length / 1024).toFixed(1)} KB 超過效能預算 ${(SPRITE_BUDGET_BYTES / 1024).toFixed(0)} KB`
    );
    budgetExceeded = true;
  }
  if (budgetExceeded) process.exit(1);
}
