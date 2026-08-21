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
  it("unlockVia 為 'achievement' 時顯示「成就解鎖」，不顯示 unlockCost 裡的數字", () => {
    expect(formatUnlockVia({ unlockVia: 'achievement', unlockCost: { core: 8, gold: 0 } })).toBe('成就解鎖');
  });

  // 分類詞只說得出「不是用買的」，玩家真正要問的是「那要怎麼拿」。有官方取得條件原文時
  // 一律優先顯示它——這三顆骰子的差別（新手任務／合作擊殺數／競技場積分）全在這段文字裡，
  // 退回分類詞就等於把三條完全不同的取得路徑壓成同一句話。
  it('有 unlockNote 時顯示官方取得條件原文，而不是分類詞', () => {
    expect(formatUnlockVia({
      unlockVia: 'achievement', unlockCost: { core: 8, gold: 0 }, unlockNote: '競技場 300 分獎勵',
    })).toBe('競技場 300 分獎勵');
    expect(formatUnlockVia({
      unlockVia: 'quest', unlockCost: { core: 8, gold: 0 }, unlockNote: '新手任務 700 點獎勵',
    })).toBe('新手任務 700 點獎勵');
  });

  // unlockNote 只影響非成本節點。若哪天有人把它也套到 'cost' 上，面板會用一段說明文字
  // 蓋掉真正要顯示的價格，而所有既有斷言都還是綠的。
  it("unlockVia 為 'cost' 時忽略 unlockNote，仍顯示成本金額", () => {
    expect(formatUnlockVia({
      unlockVia: 'cost', unlockCost: { core: 8, gold: 0 }, unlockNote: '不該出現',
    })).toBe('核心 8');
  });
});
