// `/rewards` 的純狀態與計算。
//
// checkbox 不是各自一份 boolean：唯一狀態是 currentProgress。完成狀態、完成數與資源總計
// 全部在需要時由這個數字與資料表推導，才不會出現「進度是 5,000、10,000 那格卻被存成完成」
// 這種遊戲裡不可能存在的組合。
import type { RewardAchievementGroup, RewardAchievementMode, RewardCurrencyGrant, RewardCollectibleGrant, RewardGrant, RewardMode, RewardThresholdMode, RewardTier } from './types.js';

export function normalizeRewardProgress(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.floor(value), Number.MAX_SAFE_INTEGER);
}

/** 門檻最高的排最前；同門檻時用 id 固定順序，資料檔換行不會讓畫面跳動。 */
export function sortedRewardTiers(tiers: readonly RewardTier[]): RewardTier[] {
  return [...tiers].sort((a, b) => b.requirement - a.requirement || a.id.localeCompare(b.id));
}

export function isRewardTierComplete(tier: RewardTier, currentProgress: number): boolean {
  return tier.requirement <= normalizeRewardProgress(currentProgress);
}

export function completedRewardTiers(mode: RewardThresholdMode, currentProgress: number): RewardTier[] {
  return sortedRewardTiers(mode.tiers).filter(tier => isRewardTierComplete(tier, currentProgress));
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

/** 固定貨幣／收藏型的唯一分流點；資料的 type 由主表「固定獎勵統計」匯入時裁定。 */
export function splitRewardTotals(
  grants: readonly RewardGrant[],
  totals: Readonly<Record<string, number>>,
): {
  currency: RewardSummaryEntry<RewardCurrencyGrant>[];
  collectible: RewardSummaryEntry<RewardCollectibleGrant>[];
} {
  const currency: RewardSummaryEntry<RewardCurrencyGrant>[] = [];
  const collectible: RewardSummaryEntry<RewardCollectibleGrant>[] = [];
  const seen = new Set<string>();
  for (const reward of grants) {
    const key = rewardGrantKey(reward);
    if (seen.has(key)) continue;
    seen.add(key);
    const amount = totals[key] ?? 0;
    if (amount <= 0) continue;
    if (reward.type === 'currency') currency.push({ key, reward, amount });
    else collectible.push({ key, reward, amount });
  }
  // Stable sort: within a category retain the catalog's original secondary order.
  currency.sort((a, b) => currencySummaryRank(a.reward.kind) - currencySummaryRank(b.reward.kind));
  collectible.sort((a, b) => collectibleSummaryRank(a.reward) - collectibleSummaryRank(b.reward));
  return { currency, collectible };
}

/** 一個模式實際用到的獎勵，依資料首次出現排列，總計區不維護第二份清單。 */
export function rewardGrantsInMode(mode: RewardMode): RewardGrant[] {
  const seen = new Set<string>();
  const grants: RewardGrant[] = [];
  const stages = mode.kind === 'threshold' ? mode.tiers : mode.groups.flatMap(group => group.stages);
  for (const stage of stages) {
    for (const reward of stage.rewards) {
      const key = rewardGrantKey(reward);
      if (seen.has(key)) continue;
      seen.add(key);
      grants.push(reward);
    }
  }
  return grants;
}

/** 資源總計永遠由完成的階段現算，不在狀態或存檔裡留第二份。 */
export function rewardTotals(mode: RewardThresholdMode, currentProgress: number): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const tier of completedRewardTiers(mode, currentProgress)) {
    for (const reward of tier.rewards) {
      const key = rewardGrantKey(reward);
      totals[key] = (totals[key] ?? 0) + reward.amount;
    }
  }
  return totals;
}

/** 每個成就只存最高已完成 stage；不同 group 不互相影響。 */
export function completedAchievementStages(group: RewardAchievementGroup, progress: number) {
  return group.stages.filter(stage => stage.stage <= normalizeRewardProgress(progress));
}

export function achievementTotals(
  mode: RewardAchievementMode,
  progress: Readonly<Record<string, number>>,
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const group of mode.groups) {
    for (const stage of completedAchievementStages(group, progress[group.id] ?? 0)) {
      for (const reward of stage.rewards) {
        const key = rewardGrantKey(reward);
        totals[key] = (totals[key] ?? 0) + reward.amount;
      }
    }
  }
  return totals;
}

export function achievementProgressAfterToggle(
  group: RewardAchievementGroup,
  stageNumber: number,
  checked: boolean,
): number {
  if (!group.stages.some(stage => stage.stage === stageNumber)) return 0;
  if (checked) return stageNumber;
  return Math.max(0, ...group.stages.filter(stage => stage.stage < stageNumber).map(stage => stage.stage));
}

export function modeTotals(
  mode: RewardMode,
  thresholdProgress: number,
  achievementProgress: Readonly<Record<string, number>>,
): Record<string, number> {
  return mode.kind === 'threshold'
    ? rewardTotals(mode, thresholdProgress)
    : achievementTotals(mode, achievementProgress);
}

/** 全部 rewards 模式的總計，同樣只由各模式的 currentProgress 即時計算。 */
export function rewardTotalsAcrossModes(
  modes: readonly RewardMode[],
  currentProgress: Readonly<Record<string, number>>,
  achievementProgress: Readonly<Record<string, number>> = {},
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const mode of modes) {
    for (const [key, amount] of Object.entries(modeTotals(mode, currentProgress[mode.id] ?? 0, achievementProgress))) {
      totals[key] = (totals[key] ?? 0) + amount;
    }
  }
  return totals;
}

/**
 * 點一個階段後的新進度。
 *
 * - 勾選：把目前進度直接設成該門檻，因此它以下全部完成。
 * - 取消：退到下一個較低門檻；該門檻與更高門檻全部取消。
 */
export function progressAfterTierToggle(
  mode: RewardThresholdMode,
  requirement: number,
  checked: boolean,
): number {
  const tiers = sortedRewardTiers(mode.tiers);
  if (!tiers.some(tier => tier.requirement === requirement)) return 0;
  if (checked) return requirement;
  return tiers.find(tier => tier.requirement < requirement)?.requirement ?? 0;
}
