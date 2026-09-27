import { describe, expect, it } from 'vitest';
import { rewardDisplay, rewardAmountVisible } from '../../src/lib/reward-display';

describe('收藏獎勵共用 renderer 資料', () => {
  it('單件收藏省略數量，貨幣與多件收藏保留數量', () => {
    for (const type of ['emote', 'cosmetic', 'dice', 'collectible'] as const) {
      const reward = { type, itemId: 'test', label: '測試收藏', amount: 1, assetStatus: 'pending' as const };
      expect(rewardAmountVisible(reward, 1)).toBe(false);
      expect(rewardAmountVisible(reward, 2)).toBe(true);
      expect(rewardAmountVisible(reward)).toBe(false);
    }
    expect(rewardAmountVisible({ type: 'currency', kind: 'gold', amount: 1 }, 1)).toBe(true);
  });
  it('貨幣沿用 currency registry', () => {
    expect(rewardDisplay({ type: 'currency', kind: 'gold', amount: 1000 }))
      .toMatchObject({ label: '金幣', iconHtml: expect.stringContaining('/currency/gold.png') });
  });

  it('骰子沿用 dice3 registry，不轉存到 currency', () => {
    expect(rewardDisplay({ type: 'dice', itemId: 'RAW:Dice_Slow3', label: '貪婪骰子',
      nodeId: '5006', amount: 1, assetStatus: 'ready' }))
      .toEqual({ label: '貪婪骰子', iconSrc: '/assets/dice3-icons/dfc31835bd58.webp' });
  });

  it('已確認外觀用專用圖片，未確認品仍保留 fallback', () => {
    expect(rewardDisplay({ type: 'cosmetic', itemId: 'RAW:Profile_Banner_simple',
      label: 'simple 橫幅', icon: '/rewards/cosmetic/Profile_Banner_simple.png',
      amount: 1, assetStatus: 'ready' })).toEqual({
      label: 'simple 橫幅', iconSrc: '/rewards/cosmetic/Profile_Banner_simple.png',
    });
    expect(rewardDisplay({ type: 'emote', itemId: 'source:44', label: 'STOP 表情',
      amount: 1, assetStatus: 'pending' })).toEqual({ label: 'STOP 表情', fallback: '表情' });
    expect(rewardDisplay({ type: 'cosmetic', subtype: 'dice-skin', itemId: 'UNIQUE:Dice_Predator3_skin1',
      label: '吞噬骰子－鯊魚造型', amount: 1, assetStatus: 'ready',
      icon: '/rewards/cosmetic/Dice_Predator3_skin1.png' }))
      .toEqual({ label: '吞噬骰子－鯊魚造型', iconSrc: '/rewards/cosmetic/Dice_Predator3_skin1.png' });
  });

  it.each(['target', 'STOP', 'NO_SIGN'])('已核准 %s 完整表情沿用 ready/icon renderer', name => {
    expect(rewardDisplay({ type: 'emote', itemId: `test:${name}`, label: `${name} 表情`,
      amount: 1, assetStatus: 'ready', icon: `/rewards/emote/${name}.png` }))
      .toEqual({ label: `${name} 表情`, iconSrc: `/rewards/emote/${name}.png` });
  });
});
