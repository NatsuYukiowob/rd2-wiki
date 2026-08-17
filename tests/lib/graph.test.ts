import { describe, it, expect } from 'vitest';
import {
  buildAdjacency, findRoots, detectCycle, unreachableFrom, prerequisiteChain, sumUnlockCost,
} from '../../src/lib/graph';
import type { Edge, TreeNode } from '../../src/lib/types';

const node = (id: string, core: number, gold: number, via: TreeNode['unlockVia'] = 'cost') =>
  ({ id, unlockCost: { core, gold }, unlockVia: via } as TreeNode);

describe('graph', () => {
  //  A → B → D
  //  A → C → D   (D 為多重前置)
  const edges: Edge[] = [['A', 'B'], ['A', 'C'], ['B', 'D'], ['C', 'D']];
  const { parents, children } = buildAdjacency(edges);

  it('findRoots 找出入度 0 的節點', () => {
    expect(findRoots(['A', 'B', 'C', 'D'], parents)).toEqual(['A']);
  });

  it('prerequisiteChain 回傳所有祖先的聯集且含自身', () => {
    expect([...prerequisiteChain('D', parents)].sort()).toEqual(['A', 'B', 'C', 'D']);
  });

  it('prerequisiteChain 對根節點只回傳自身', () => {
    expect([...prerequisiteChain('A', parents)]).toEqual(['A']);
  });

  it('prerequisiteChain 遇到環仍會終止', () => {
    const cyc = buildAdjacency([['X', 'Y'], ['Y', 'X']] as Edge[]);
    expect([...prerequisiteChain('X', cyc.parents)].sort()).toEqual(['X', 'Y']);
  });

  it('detectCycle 無環時回傳 null，有環時列出環上節點', () => {
    expect(detectCycle(['A', 'B', 'C', 'D'], children)).toBeNull();
    const cyc = buildAdjacency([['X', 'Y'], ['Y', 'X']] as Edge[]);
    expect(detectCycle(['X', 'Y'], cyc.children)).not.toBeNull();
  });

  it('unreachableFrom 找出不可達根的節點', () => {
    const g = buildAdjacency([['A', 'B'], ['P', 'Q']] as Edge[]);
    expect(unreachableFrom(['A'], ['A', 'B', 'P', 'Q'], g.children).sort()).toEqual(['P', 'Q']);
  });

  it('sumUnlockCost 對節點去重加總', () => {
    const byId = new Map([node('A', 5, 0), node('B', 0, 3000), node('C', 10, 0), node('D', 0, 8000)]
      .map(n => [n.id, n]));
    const r = sumUnlockCost(prerequisiteChain('D', parents), byId);
    expect(r.cost).toEqual({ core: 15, gold: 11000 });
    expect(r.skipped).toEqual([]);
  });

  it('sumUnlockCost 排除非 cost 解鎖的節點並回報', () => {
    const byId = new Map([node('A', 5, 0, 'quest'), node('B', 0, 3000), node('C', 10, 0), node('D', 0, 8000)]
      .map(n => [n.id, n]));
    const r = sumUnlockCost(prerequisiteChain('D', parents), byId);
    expect(r.cost).toEqual({ core: 10, gold: 11000 });
    expect(r.skipped).toEqual(['A']);
  });
});
