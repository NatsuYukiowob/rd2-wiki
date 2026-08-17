import { describe, it, expect } from 'vitest';
import type { TreeData, TreeNode, Edge } from '../../src/lib/types';
import { buildDiffSummary } from '../../tools/diff-summary';

/** 最小可用的 TreeNode 替身，個別測試只覆寫需要的欄位。 */
const n = (p: Partial<TreeNode>): TreeNode =>
  ({
    id: '1001', branch: 'nature', element: 'nature', type: 'dice', name: '火骰子', label: '火',
    shape: 'rect', size: [48, 52], x: 0, y: 0,
    unlockCost: { core: 10, gold: 1000 }, unlockVia: 'cost', maxLevel: 1,
    prereqMode: null, upgradeCost: null, description: '造成傷害', keywords: [],
    growth: null, dataIssue: null, icon: 'aaaaaaaaaaaa',
    ...p,
  }) as TreeNode;

const meta = (totalUnlockCost: { core: number; gold: number }) =>
  ({
    svgVersion: '1', gameBundle: 'x', updated: '2026-01-01',
    viewBox: [0, 0, 100, 100],
    roots: ['1001'],
    bounds: {},
    totalUnlockCost,
    sprite: { url: '/assets/sprite.webp', size: [768, 458], index: {} },
  }) as TreeData['meta'];

const tree = (nodes: TreeNode[], edges: Edge[] = [], totalUnlockCost = { core: 0, gold: 0 }): TreeData => ({
  meta: meta(totalUnlockCost),
  nodes,
  edges,
});

describe('buildDiffSummary（規則 10：id 變動警告）', () => {
  it('新增節點：計入「新增」計數，不觸發 id 消失警告', () => {
    const base = tree([n({ id: '1001' })], [], { core: 10, gold: 1000 });
    const head = tree([n({ id: '1001' }), n({ id: '1002', name: '風骰子' })], [], { core: 25, gold: 2000 });

    const summary = buildDiffSummary(base, head);

    expect(summary).toContain('節點：1 → 2');
    expect(summary).toContain('新增 1｜刪除 0｜修改 0');
    expect(summary).not.toContain('id 消失');
  });

  it('刪除節點：id 消失要有顯眼警告，且點出分享網址會失效', () => {
    const base = tree([n({ id: '1001' }), n({ id: '1002', name: '風骰子' })], [], { core: 20, gold: 2000 });
    const head = tree([n({ id: '1001' })], [], { core: 10, gold: 1000 });

    const summary = buildDiffSummary(base, head);

    expect(summary).toContain('節點：2 → 1');
    expect(summary).toContain('新增 0｜刪除 1｜修改 0');
    expect(summary).toContain('⚠️ **有節點 id 消失**：1002');
    expect(summary).toContain('分享網址會失效');
  });

  it('修改成本：同 id 但 unlockCost 不同要計入「修改」並列進清單', () => {
    const base = tree([n({ id: '1001', unlockCost: { core: 10, gold: 1000 } })], [], { core: 10, gold: 1000 });
    const head = tree([n({ id: '1001', unlockCost: { core: 20, gold: 2000 } })], [], { core: 20, gold: 2000 });

    const summary = buildDiffSummary(base, head);

    expect(summary).toContain('新增 0｜刪除 0｜修改 1');
    expect(summary).toContain('全樹解鎖成本：核心 10 → 20，金幣 1,000 → 2,000');
    expect(summary).toContain('<details><summary>修改的節點</summary>');
    expect(summary).toContain('- 1001 火骰子');
  });

  it('完全無變動時不附加警告或修改清單區塊', () => {
    const base = tree([n({ id: '1001' })], [], { core: 10, gold: 1000 });
    const head = tree([n({ id: '1001' })], [], { core: 10, gold: 1000 });

    const summary = buildDiffSummary(base, head);

    expect(summary).not.toContain('⚠️');
    expect(summary).not.toContain('<details>');
  });
});
