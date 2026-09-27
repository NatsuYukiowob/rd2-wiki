import dice3Icons from '../../data/dice3-icons.json';
import { currencyIconDetails } from './cost-html.js';
import type { RewardGrant } from './types.js';

export interface RewardDisplay {
  label: string;
  iconHtml?: string;
  iconSrc?: string;
  fallback?: string;
}

/** 收藏品單件省略數量；可堆疊資源始終顯示，收藏品多件仍可顯示。 */
export function rewardAmountVisible(reward: RewardGrant, amount?: number): boolean {
  return amount !== undefined && (reward.type === 'currency' || amount !== 1);
}

/** 單一 grant resolver：currency 沿用現有 registry，其餘只用已確認的正式圖片。 */
export function rewardDisplay(reward: RewardGrant): RewardDisplay {
  if (reward.type === 'currency') {
    const { label, html } = currencyIconDetails(reward.kind);
    return { label, iconHtml: html };
  }
  if (reward.type === 'dice' && reward.nodeId) {
    const hash = (dice3Icons as Record<string, string>)[reward.nodeId];
    if (!hash) throw new Error(`缺少骰子 ${reward.nodeId} 的 dice3 圖示`);
    return { label: reward.label, iconSrc: `/assets/dice3-icons/${hash}.webp` };
  }
  if (reward.assetStatus === 'ready' && reward.icon) {
    return { label: reward.label, iconSrc: reward.icon };
  }
  const fallback = reward.type === 'emote' ? '表情' : reward.type === 'cosmetic' ? '外觀' : '收藏品';
  return { label: reward.label, fallback };
}
