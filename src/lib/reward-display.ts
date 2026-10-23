import dice3Icons from '../../data/dice3-icons.json';
import { currencyIconDetails } from './cost-html.js';
import { iconHashOf } from './dice-icon.js';
import type { RewardGrant } from './types.js';
import { messages, type Lang } from './i18n.js';

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
export function rewardDisplay(reward: RewardGrant, lang: Lang = 'zh'): RewardDisplay {
  if (reward.type === 'currency') {
    const { label, html } = currencyIconDetails(reward.kind, lang);
    return { label, iconHtml: html };
  }
  if (reward.type === 'dice' && reward.nodeId) {
    const hash = iconHashOf(dice3Icons as Record<string, string>, reward.nodeId, 'dice3');
    return { label: reward.label, iconSrc: `/assets/dice3-icons/${hash}.webp` };
  }
  if (reward.assetStatus === 'ready' && reward.icon) {
    return { label: reward.label, iconSrc: reward.icon };
  }
  const f = messages(lang).labels.rewardFallback;
  const fallback = reward.type === 'emote' ? f.emote : reward.type === 'cosmetic' ? f.cosmetic : f.collectible;
  return { label: reward.label, fallback };
}
