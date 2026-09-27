import { describe, expect, it } from 'vitest';
import {
  achievementProgressAfterToggle,
  achievementTotals,
  completedRewardTiers,
  normalizeRewardProgress,
  progressAfterTierToggle,
  rewardGrantKey,
  rewardGrantsInMode,
  rewardTotals,
  rewardTotalsAcrossModes,
  splitRewardTotals,
  sortedRewardTiers,
} from '../../src/lib/rewards';
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

const hardMode: RewardThresholdMode = {
  kind: 'threshold',
  id: 'raid-hard',
  name: '討伐困難',
  requirementLabel: '累積擊殺',
  tiers: [
    {
      id: 'hard-low',
      requirement: 100,
      rewards: [
        { type: 'currency', kind: 'a', amount: 4 },
        { type: 'currency', kind: 'c', amount: 2 },
      ],
    },
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

describe('獎勵進度', () => {
  it('摘要固定貨幣排序不依資料／數量，缺少資源不留空位', () => {
    const kinds = ['arenaTicket', 'treeSeed', 'skinCoin', 'core', 'coopTicket', 'gold'];
    const grants: RewardGrant[] = kinds.map(kind => ({ type: 'currency', kind, amount: 1 }));
    const totals = Object.fromEntries(grants.map((grant, index) => [rewardGrantKey(grant), index + 1]));
    expect(splitRewardTotals(grants, totals).currency.map(entry => entry.reward.kind))
      .toEqual(['gold', 'core', 'skinCoin', 'treeSeed', 'coopTicket', 'arenaTicket']);
    expect(splitRewardTotals(grants, { 'currency:arenaTicket': 1, 'currency:gold': 2, 'currency:treeSeed': 3 })
      .currency.map(entry => entry.reward.kind)).toEqual(['gold', 'treeSeed', 'arenaTicket']);
    expect(grants.map(grant => grant.type === 'currency' && grant.kind)).toEqual(kinds);
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
    const totals = Object.fromEntries(grants.map(grant => [rewardGrantKey(grant), 1]));
    expect(splitRewardTotals(grants, totals).collectible.map(entry => entry.reward.itemId))
      .toEqual(['skin', 'dice', 'emote', 'banner', 'avatar', 'frame']);
    expect(splitRewardTotals(grants, {}).collectible).toEqual([]);
  });
  it('排序永遠是需求值由高到低，而且不改原陣列', () => {
    expect(sortedRewardTiers(mode.tiers).map(tier => tier.requirement)).toEqual([10000, 5000, 2100, 500]);
    expect(mode.tiers.map(tier => tier.requirement)).toEqual([500, 10000, 2100, 5000]);
  });

  it('輸入 7700 時只完成需求小於等於 7700 的階段', () => {
    expect(completedRewardTiers(mode, 7700).map(tier => tier.requirement)).toEqual([5000, 2100, 500]);
  });

  it('勾選階段把進度設成該門檻；取消則退到下一個較低門檻', () => {
    expect(progressAfterTierToggle(mode, 5000, true)).toBe(5000);
    expect(progressAfterTierToggle(mode, 2100, false)).toBe(500);
    expect(progressAfterTierToggle(mode, 500, false)).toBe(0);
  });

  it('資源總計只由已完成階段推導', () => {
    expect(rewardTotals(mode, 7700)).toEqual({ 'currency:a': 3, 'currency:b': 3 });
    expect(rewardTotals(mode, 0)).toEqual({});
  });

  it('全部頁面總計由每個 mode 的 currentProgress 合併推導', () => {
    expect(rewardTotalsAcrossModes(
      [mode, hardMode],
      { 'raid-normal': 7700, 'raid-hard': 100 },
    )).toEqual({ 'currency:a': 7, 'currency:b': 3, 'currency:c': 2 });
    expect(rewardTotalsAcrossModes([mode, hardMode], { 'raid-normal': 7700 }))
      .toEqual({ 'currency:a': 3, 'currency:b': 3 });
  });

  it('總計 key 包含 reward 類型，且總計項目由模式資料去重推導', () => {
    expect(rewardGrantKey({ type: 'currency', kind: 'gold', amount: 1 })).toBe('currency:gold');
    expect(rewardGrantKey({ type: 'emote', itemId: 'verified-id', label: '表情', amount: 1 }))
      .toBe('emote:verified-id');
    expect(rewardGrantsInMode(mode).map(rewardGrantKey)).toEqual(['currency:a', 'currency:b']);
  });

  it('進度收斂成非負安全整數', () => {
    expect(normalizeRewardProgress(7.9)).toBe(7);
    expect(normalizeRewardProgress(-1)).toBe(0);
    expect(normalizeRewardProgress(Number.NaN)).toBe(0);
    expect(normalizeRewardProgress(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('成就組各自採最高完成 stage，不是逐 checkbox boolean', () => {
    expect(achievementProgressAfterToggle(achievementMode.groups[0]!, 2, true)).toBe(2);
    expect(achievementProgressAfterToggle(achievementMode.groups[0]!, 1, false)).toBe(0);
    expect(achievementProgressAfterToggle(achievementMode.groups[0]!, 2, false)).toBe(1);
    expect(achievementTotals(achievementMode, { a: 2, b: 0 })).toEqual({ 'currency:a': 2, 'currency:b': 4 });
    expect(achievementTotals(achievementMode, { a: 2, b: 1 })).toEqual({ 'currency:a': 5, 'currency:b': 4 });
    expect(rewardTotalsAcrossModes([mode, achievementMode], { 'raid-normal': 7700 }, { a: 2, b: 1 }))
      .toEqual({ 'currency:a': 8, 'currency:b': 7 });
  });

  it('固定貨幣與收藏獎勵分開，0 完全不輸出，重複收藏品只列一次', () => {
    const grants = [
      { type: 'currency' as const, kind: 'gold', amount: 100 },
      { type: 'currency' as const, kind: 'core', amount: 5 },
      { type: 'dice' as const, itemId: 'dice-1', label: '陰陽骰子', amount: 1 },
      { type: 'emote' as const, itemId: 'emote-1', label: 'STOP 表情', amount: 1 },
      { type: 'dice' as const, itemId: 'dice-1', label: '陰陽骰子', amount: 1 },
    ];
    expect(splitRewardTotals(grants, {
      'currency:gold': 90000, 'currency:core': 0, 'dice:dice-1': 1, 'emote:emote-1': 0,
    })).toEqual({
      currency: [{ key: 'currency:gold', reward: grants[0], amount: 90000 }],
      collectible: [{ key: 'dice:dice-1', reward: grants[2], amount: 1 }],
    });
    expect(splitRewardTotals(grants, {})).toEqual({ currency: [], collectible: [] });
  });
});
