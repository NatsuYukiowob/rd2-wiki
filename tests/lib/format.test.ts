import { describe, it, expect } from 'vitest';
import { formatCost, formatGrowth, formatUnlockVia } from '../../src/lib/format';
import type { TreeNode } from '../../src/lib/types';

const node = (p: Partial<TreeNode>) => ({ maxLevel: 1, growth: null, ...p } as TreeNode);

describe('format', () => {
  it('成本含千分位', () => {
    expect(formatCost({ core: 26, gold: 12000 })).toBe('核心 26 ＋ 金幣 12,000');
  });
  it('只有一種貨幣時不顯示另一種', () => {
    expect(formatCost({ core: 5, gold: 0 })).toBe('核心 5');
    expect(formatCost({ core: 0, gold: 8000 })).toBe('金幣 8,000');
  });
  it('滿級換算', () => {
    const n = node({ maxLevel: 15, growth: { base: 20, perLevel: 5, unit: '%' } });
    expect(formatGrowth(n)).toBe('1 級 20% → 15 級 90%');
  });
  it('秒與無單位', () => {
    expect(formatGrowth(node({ maxLevel: 5, growth: { base: 0.5, perLevel: 0.2, unit: 's' } })))
      .toBe('1 級 0.5秒 → 5 級 1.3秒');
    expect(formatGrowth(node({ maxLevel: 3, growth: { base: 5, perLevel: 11, unit: '' } })))
      .toBe('1 級 5 → 3 級 27');
  });
  it('等級上限為 1 或無成長資料時回傳 null', () => {
    expect(formatGrowth(node({ maxLevel: 1, growth: { base: 20, perLevel: 4, unit: '%' } }))).toBeNull();
    expect(formatGrowth(node({ maxLevel: 50, growth: null }))).toBeNull();
  });
});

// 審查回饋（2026-08-17 第 1 輪修正）：unlockVia !== 'cost' 的節點不能顯示 unlockCost，
// 否則面板會暗示玩家可以直接花錢買到只能靠任務／預設取得的節點。
describe('formatUnlockVia', () => {
  it("unlockVia 為 'cost' 時顯示成本金額", () => {
    expect(formatUnlockVia({ unlockVia: 'cost', unlockCost: { core: 8, gold: 0 } })).toBe('核心 8');
  });
  it("unlockVia 為 'quest' 時顯示「任務解鎖」，不顯示 unlockCost 裡的數字", () => {
    expect(formatUnlockVia({ unlockVia: 'quest', unlockCost: { core: 8, gold: 0 } })).toBe('任務解鎖');
  });
  it("unlockVia 為 'default' 時顯示「預設解鎖」，不顯示 unlockCost 裡的數字", () => {
    expect(formatUnlockVia({ unlockVia: 'default', unlockCost: { core: 5, gold: 0 } })).toBe('預設解鎖');
  });
});
