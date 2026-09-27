// `/rewards` 的純計算。頁面是純瀏覽（2026-09-27 Yuki 裁決：不追蹤個人進度），
// 所以這裡只有「排序」與「整個分類全部領完能拿多少」，全部在建置時算好。
import type { RewardCollectibleGrant, RewardCurrencyGrant, RewardGrant, RewardMode, RewardTier } from './types.js';

/** 門檻由小到大（遊戲裡的領取順序）；同門檻時用 id 固定順序，資料檔換行不會讓畫面跳動。 */
export function sortedRewardTiers(tiers: readonly RewardTier[]): RewardTier[] {
  return [...tiers].sort((a, b) => a.requirement - b.requirement || a.id.localeCompare(b.id));
}

/** 資源合計的穩定 key；類型納入 key，收藏品 id 才不會跟貨幣 kind 撞名。 */
export function rewardGrantKey(reward: RewardGrant): string {
  return reward.type === 'currency' ? `currency:${reward.kind}` : `${reward.type}:${reward.itemId}`;
}

export interface RewardSummaryEntry<T extends RewardGrant> {
  key: string;
  reward: T;
  amount: number;
}

const CURRENCY_SUMMARY_ORDER = ['gold', 'core', 'skinCoin', 'treeSeed', 'coopTicket', 'arenaTicket'];
const COSMETIC_SUMMARY_ORDER = { 'dice-skin': 0, banner: 2, avatar: 3, frame: 4 };

function currencySummaryRank(kind: string): number {
  const rank = CURRENCY_SUMMARY_ORDER.indexOf(kind);
  return rank < 0 ? CURRENCY_SUMMARY_ORDER.length : rank;
}

function collectibleSummaryRank(reward: RewardCollectibleGrant): number {
  if (reward.type === 'dice') return 0;
  if (reward.type === 'emote') return 1;
  return reward.subtype ? COSMETIC_SUMMARY_ORDER[reward.subtype] : 5;
}

/** 一個分類的每一階段（門檻或成就 stage），不分資料形狀。 */
function stagesOf(mode: RewardMode): { rewards: RewardGrant[] }[] {
  return mode.kind === 'threshold' ? mode.tiers : mode.groups.flatMap(group => group.stages);
}

/**
 * 整個分類全部領完的資源總量，拆成固定貨幣與收藏型兩組。
 * 同一個 key 合併數量；排序看類別不看數量或資料順序，類內保留首次出現的次序（stable sort）。
 */
export function modeRewardTotals(mode: RewardMode): {
  currency: RewardSummaryEntry<RewardCurrencyGrant>[];
  collectible: RewardSummaryEntry<RewardCollectibleGrant>[];
} {
  const entries = new Map<string, RewardSummaryEntry<RewardGrant>>();
  for (const stage of stagesOf(mode)) {
    for (const reward of stage.rewards) {
      const key = rewardGrantKey(reward);
      const entry = entries.get(key);
      if (entry) entry.amount += reward.amount;
      else entries.set(key, { key, reward, amount: reward.amount });
    }
  }
  const currency: RewardSummaryEntry<RewardCurrencyGrant>[] = [];
  const collectible: RewardSummaryEntry<RewardCollectibleGrant>[] = [];
  for (const entry of entries.values()) {
    if (entry.amount <= 0) continue;
    if (entry.reward.type === 'currency') currency.push(entry as RewardSummaryEntry<RewardCurrencyGrant>);
    else collectible.push(entry as RewardSummaryEntry<RewardCollectibleGrant>);
  }
  currency.sort((a, b) => currencySummaryRank(a.reward.kind) - currencySummaryRank(b.reward.kind));
  collectible.sort((a, b) => collectibleSummaryRank(a.reward) - collectibleSummaryRank(b.reward));
  return { currency, collectible };
}
