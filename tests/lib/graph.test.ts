import { describe, it, expect } from 'vitest';
import {
  buildAdjacency, findRoots, detectCycle, unreachableFrom, prerequisiteChain, sumUnlockCost,
} from '../../src/lib/graph';
import type { Edge, TreeNode } from '../../src/lib/types';

const node = (id: string, core: number, gold: number, via: TreeNode['unlockVia'] = 'cost', solar = 0) =>
  ({ id, unlockCost: { core, gold, solar }, unlockVia: via } as TreeNode);
/** 成就／任務開門但仍要付錢的節點（例：恐懼骰子＝合作累積 900 擊殺後，使用 8 核心解鎖）。 */
const paidNode = (id: string, core: number, gold: number, via: TreeNode['unlockVia']) =>
  ({ id, unlockCost: { core, gold, solar: 0 }, unlockVia: via, unlockPaid: true } as TreeNode);

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

  // 「可跳過前置」＝官方資料表寫明「無視骰子樹前置」的節點（貪婪／空虛骰子）。
  // 它們從討伐獎勵／通行證直接領取，所以走到它就不必再往上追祖先。
  it('prerequisiteChain 遇到可跳過的節點就不再往上追祖先', () => {
    expect([...prerequisiteChain('D', parents, new Set(['B', 'C']))].sort()).toEqual(['B', 'C', 'D']);
  });

  it('prerequisiteChain 的起點自己可跳過時只回傳自身', () => {
    expect([...prerequisiteChain('D', parents, new Set(['D']))]).toEqual(['D']);
  });

  it('prerequisiteChain 沒傳 bypass 時行為與原本完全相同', () => {
    expect([...prerequisiteChain('D', parents, new Set())].sort()).toEqual(['A', 'B', 'C', 'D']);
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
    expect(r.cost).toEqual({ core: 15, gold: 11000, solar: 0 });
    expect(r.skipped).toEqual([]);
  });

  it('sumUnlockCost 排除非 cost 解鎖的節點並回報', () => {
    const byId = new Map([node('A', 5, 0, 'quest'), node('B', 0, 3000), node('C', 10, 0), node('D', 0, 8000)]
      .map(n => [n.id, n]));
    const r = sumUnlockCost(prerequisiteChain('D', parents), byId);
    expect(r.cost).toEqual({ core: 10, gold: 11000, solar: 0 });
    expect(r.skipped).toEqual(['A']);
  });

  // 太陽核心（v1.1.0）也要進前置鏈的加總。⚠️ 鏈上放兩顆才驗得到「加總」——只有一顆的話，
  // 一個把 solar 直接指派而不是累加的實作照樣會綠。
  it('sumUnlockCost 加總太陽核心，並照樣排除非 cost 節點', () => {
    const byId = new Map([
      node('A', 5, 0, 'quest', 999), node('B', 0, 3000, 'cost', 100),
      node('C', 10, 0, 'cost', 2000), node('D', 0, 8000),
    ].map(n => [n.id, n]));
    const r = sumUnlockCost(prerequisiteChain('D', parents), byId);
    expect(r.cost).toEqual({ core: 10, gold: 11000, solar: 2100 });
    expect(r.skipped).toEqual(['A']);
  });

  // unlockVia 只說「靠什麼開門」，不等於「不用付錢」。恐懼骰子是成就開門＋仍要 8 核心，
  // 少了 unlockPaid 這個旗標，它的核心會從每一條經過它的前置鏈裡安靜消失。
  it('sumUnlockCost 計入 unlockPaid 的節點，且不列進 skipped', () => {
    const byId = new Map([paidNode('A', 5, 0, 'achievement'), node('B', 0, 3000), node('C', 10, 0), node('D', 0, 8000)]
      .map(n => [n.id, n]));
    const r = sumUnlockCost(prerequisiteChain('D', parents), byId);
    expect(r.cost).toEqual({ core: 15, gold: 11000, solar: 0 });
    expect(r.skipped).toEqual([]);
  });
});
