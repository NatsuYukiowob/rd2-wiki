// rewards 儲存格式。只保存進度；完成狀態與獎勵總計永遠由正式資料推導。
import { normalizeRewardProgress } from './rewards.js';

export const REWARDS_STORAGE_KEY = 'rd2-rewards-v2';
export const LEGACY_REWARDS_STORAGE_KEY = 'rd2-rewards-v1';
const FORMAT_VERSION = 2;

export interface RewardProgressSave {
  /** 五種門檻分類，各自一個最高紀錄。 */
  currentProgress: Record<string, number>;
  /** 成就名稱 → 該組最高完成階段；不是逐 checkbox 的 boolean。 */
  achievementProgress: Record<string, number>;
}

export function emptyRewardProgress(): RewardProgressSave {
  return { currentProgress: {}, achievementProgress: {} };
}

export function hasRewardProgress(save: RewardProgressSave): boolean {
  return Object.keys(save.currentProgress).length > 0 || Object.keys(save.achievementProgress).length > 0;
}

function cleanProgress(raw: unknown, validIds: ReadonlySet<string>): Record<string, number> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const next: Record<string, number> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!validIds.has(id) || typeof value !== 'number' || !Number.isFinite(value) || value < 0) continue;
    const normalized = normalizeRewardProgress(value);
    if (normalized > 0) next[id] = normalized;
  }
  return next;
}

function orderedProgress(progress: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(progress)
    .map(([id, value]) => [id, normalizeRewardProgress(value)] as const)
    .filter(([, value]) => value > 0)
    .sort(([a], [b]) => a.localeCompare(b)));
}

export function serializeRewardProgress(save: RewardProgressSave): string {
  return JSON.stringify({
    v: FORMAT_VERSION,
    currentProgress: orderedProgress(save.currentProgress),
    achievementProgress: orderedProgress(save.achievementProgress),
  });
}

export function deserializeRewardProgress(
  text: string | null,
  validModeIds: ReadonlySet<string>,
  validAchievementIds: ReadonlySet<string>,
): RewardProgressSave | null {
  if (text === null) return null;
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const { v, currentProgress, achievementProgress } = raw as Record<string, unknown>;
  if (v !== FORMAT_VERSION) return null;
  const threshold = cleanProgress(currentProgress, validModeIds);
  const achievements = cleanProgress(achievementProgress, validAchievementIds);
  if (!threshold || !achievements) return null;
  return { currentProgress: threshold, achievementProgress: achievements };
}

/** v1 測試期紀錄只有討伐門檻。有效模式的最高紀錄可沿用；壞資料安全丟棄。 */
export function migrateLegacyRewardProgress(
  text: string | null,
  validModeIds: ReadonlySet<string>,
): RewardProgressSave | null {
  if (text === null) return null;
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const { v, currentProgress } = raw as Record<string, unknown>;
  if (v !== 1) return null;
  const threshold = cleanProgress(currentProgress, validModeIds);
  return threshold ? { currentProgress: threshold, achievementProgress: {} } : null;
}

export function withModeProgress(save: RewardProgressSave, modeId: string, value: number): RewardProgressSave {
  const currentProgress = { ...save.currentProgress };
  const normalized = normalizeRewardProgress(value);
  if (normalized > 0) currentProgress[modeId] = normalized;
  else delete currentProgress[modeId];
  return { ...save, currentProgress };
}

export function withAchievementProgress(
  save: RewardProgressSave,
  groupId: string,
  value: number,
): RewardProgressSave {
  const achievementProgress = { ...save.achievementProgress };
  const normalized = normalizeRewardProgress(value);
  if (normalized > 0) achievementProgress[groupId] = normalized;
  else delete achievementProgress[groupId];
  return { ...save, achievementProgress };
}

export function withoutModeProgress(save: RewardProgressSave, modeId: string): RewardProgressSave {
  const currentProgress = { ...save.currentProgress };
  delete currentProgress[modeId];
  return { ...save, currentProgress };
}

export function withoutAchievementProgress(save: RewardProgressSave): RewardProgressSave {
  return { ...save, achievementProgress: {} };
}
