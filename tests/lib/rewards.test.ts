import { describe, expect, it } from 'vitest';
import { modeRewardTotals, rewardGrantKey, sortedRewardTiers } from '../../src/lib/rewards';
import type { RewardAchievementMode, RewardGrant, RewardThresholdMode } from '../../src/lib/types';

const mode: RewardThresholdMode = {
  kind: 'threshold',
  id: 'raid-normal',
  name: '討伐一般',
  requirementLabel: '累積擊殺',
  tiers: [
    { id: 'low', requirement: 500, rewards: [{ type: 'currency', kind: 'a', amount: 1 }] },
    { id: 'high', requirement: 10000, rewards: [{ type: 'currency', kind: 'b', amount: 5 }] },
    { id: 'middle-a', requirement: 2100, rewards: [{ type: 'currency', kind: 'b', amount: 3 }] },
    { id: 'middle-b', requirement: 5000, rewards: [{ type: 'currency', kind: 'a', amount: 2 }] },
  ],
};

const achievementMode: RewardAchievementMode = {
  kind: 'achievement', id: 'achievements', name: '成就', groups: [
    { id: 'a', name: 'A', stages: [
      { id: 'a1', stage: 1, requirement: 10, rewards: [{ type: 'currency', kind: 'a', amount: 2 }] },
      { id: 'a2', stage: 2, requirement: 20, rewards: [{ type: 'currency', kind: 'b', amount: 4 }] },
    ] },
    { id: 'b', name: 'B', stages: [
      { id: 'b1', stage: 1, requirement: 5, rewards: [{ type: 'currency', kind: 'a', amount: 3 }] },
    ] },
  ],
};

describe('獎勵系統（純瀏覽）', () => {
  const asMode = (grants: RewardGrant[]): RewardThresholdMode => ({
    kind: 'threshold', id: 'x', name: 'x', requirementLabel: 'x',
    tiers: grants.map((reward, i) => ({ id: `t${i}`, requirement: i + 1, rewards: [reward] })),
  });

  it('摘要固定貨幣排序不依資料／數量', () => {
    const kinds = ['arenaTicket', 'treeSeed', 'skinCoin', 'core', 'coopTicket', 'gold'];
    const grants: RewardGrant[] = kinds.map((kind, i) => ({ type: 'currency', kind, amount: i + 1 }));
    expect(modeRewardTotals(asMode(grants)).currency.map(entry => entry.reward.kind))
      .toEqual(['gold', 'core', 'skinCoin', 'treeSeed', 'coopTicket', 'arenaTicket']);
  });

  it('收藏依 type/subtype 排序，類內維持原始次序，不看顯示名稱', () => {
    const grants: RewardGrant[] = [
      { type: 'cosmetic', subtype: 'frame', itemId: 'frame', label: 'A', amount: 1 },
      { type: 'cosmetic', subtype: 'avatar', itemId: 'avatar', label: 'B', amount: 1 },
      { type: 'cosmetic', subtype: 'banner', itemId: 'banner', label: 'C', amount: 1 },
      { type: 'emote', itemId: 'emote', label: 'D', amount: 1 },
      { type: 'cosmetic', subtype: 'dice-skin', itemId: 'skin', label: 'E', amount: 1 },
      { type: 'dice', itemId: 'dice', label: 'F', amount: 1 },
    ];
    expect(modeRewardTotals(asMode(grants)).collectible.map(entry => entry.reward.itemId))
      .toEqual(['skin', 'dice', 'emote', 'banner', 'avatar', 'frame']);
  });

  it('門檻由小到大排列，而且不改原陣列', () => {
    expect(sortedRewardTiers(mode.tiers).map(tier => tier.requirement)).toEqual([500, 2100, 5000, 10000]);
    expect(mode.tiers.map(tier => tier.requirement)).toEqual([500, 10000, 2100, 5000]);
  });

  it('門檻分類的總計＝全部階段相加', () => {
    const totals = modeRewardTotals(mode);
    expect(totals.currency.map(({ key, amount }) => [key, amount]))
      .toEqual([['currency:a', 3], ['currency:b', 8]]);
    expect(totals.collectible).toEqual([]);
  });

  it('成就分類的總計＝每一組每一階相加', () => {
    expect(modeRewardTotals(achievementMode).currency.map(({ key, amount }) => [key, amount]))
      .toEqual([['currency:a', 5], ['currency:b', 4]]);
  });

  it('同一件收藏品跨階段合併數量；總計 key 包含 reward 類型', () => {
    const grants: RewardGrant[] = [
      { type: 'dice', itemId: 'dice-1', label: '陰陽骰子', amount: 1 },
      { type: 'currency', kind: 'gold', amount: 100 },
      { type: 'dice', itemId: 'dice-1', label: '陰陽骰子', amount: 1 },
    ];
    const totals = modeRewardTotals(asMode(grants));
    expect(totals.collectible.map(({ key, amount }) => [key, amount])).toEqual([['dice:dice-1', 2]]);
    expect(totals.currency.map(({ key, amount }) => [key, amount])).toEqual([['currency:gold', 100]]);
    expect(rewardGrantKey({ type: 'emote', itemId: 'verified-id', label: '表情', amount: 1 })).toBe('emote:verified-id');
  });
});
