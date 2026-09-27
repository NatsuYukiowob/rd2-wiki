import type { Tactic, TacticMode, TacticStage } from './types';

export const TACTIC_MODES = [
  { key: 'coopNormal', label: '合作一般' },
  { key: 'coopHard', label: '合作困難' },
  { key: 'versus', label: '對戰' },
] as const;
export const TACTIC_STAGES: readonly TacticStage[] = ['前期', '中期', '後期', '終盤'];
export const DEFAULT_TACTIC_MODE: TacticMode = 'coopNormal';

export function tacticMatches(tactic: Pick<Tactic, 'stage' | 'availability'>, mode: TacticMode, stages: readonly string[]): boolean {
  return tactic.availability[mode] && stages.includes(tactic.stage);
}

/** 全選時清空，部分／全未選時全開；不是逐項反轉。 */
export function toggleAllTacticStages(stages: readonly string[]): TacticStage[] {
  return TACTIC_STAGES.every(stage => stages.includes(stage)) ? [] : [...TACTIC_STAGES];
}
