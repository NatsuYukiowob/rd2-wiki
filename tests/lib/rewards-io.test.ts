import { describe, expect, it } from 'vitest';
import {
  LEGACY_REWARDS_STORAGE_KEY,
  REWARDS_STORAGE_KEY,
  deserializeRewardProgress,
  emptyRewardProgress,
  hasRewardProgress,
  migrateLegacyRewardProgress,
  serializeRewardProgress,
  withAchievementProgress,
  withModeProgress,
  withoutAchievementProgress,
  withoutModeProgress,
} from '../../src/lib/rewards-io';

const modes = new Set(['raid-normal', 'raid-hard', 'arena-pass', 'journey-7day', 'hunt-event']);
const groups = new Set(['召喚骰子', '升級骰子']);

describe('獎勵進度 v2 存檔', () => {
  it('只存門檻與群組最高階段，不存 totals 或 boolean', () => {
    expect(REWARDS_STORAGE_KEY).toBe('rd2-rewards-v2');
    expect(LEGACY_REWARDS_STORAGE_KEY).toBe('rd2-rewards-v1');
    const save = { currentProgress: { 'raid-normal': 7700 }, achievementProgress: { '召喚骰子': 3 } };
    expect(serializeRewardProgress(save))
      .toBe('{"v":2,"currentProgress":{"raid-normal":7700},"achievementProgress":{"召喚骰子":3}}');
    expect(deserializeRewardProgress(serializeRewardProgress(save), modes, groups)).toEqual(save);
  });

  it('壞 JSON、錯誤版本與錯誤形狀安全拒絕', () => {
    expect(deserializeRewardProgress(null, modes, groups)).toBeNull();
    expect(deserializeRewardProgress('{', modes, groups)).toBeNull();
    expect(deserializeRewardProgress('{"v":1,"currentProgress":{}}', modes, groups)).toBeNull();
    expect(deserializeRewardProgress('{"v":2,"currentProgress":[],"achievementProgress":{}}', modes, groups)).toBeNull();
    expect(deserializeRewardProgress('{"v":2,"currentProgress":{},"achievementProgress":[]}', modes, groups)).toBeNull();
  });

  it('移除未知 mode/group、負值與非數字，並取整', () => {
    const text = JSON.stringify({ v: 2,
      currentProgress: { 'raid-normal': 7700.9, unknown: 10, 'raid-hard': -1 },
      achievementProgress: { '召喚骰子': 4.9, bogus: 7, '升級骰子': '3' },
    });
    expect(deserializeRewardProgress(text, modes, groups)).toEqual({
      currentProgress: { 'raid-normal': 7700 }, achievementProgress: { '召喚骰子': 4 },
    });
  });

  it('v1 只遷移仍有效的最高紀錄，壞測試資料不造成 crash', () => {
    expect(migrateLegacyRewardProgress('{', modes)).toBeNull();
    expect(migrateLegacyRewardProgress('{"v":9,"currentProgress":{}}', modes)).toBeNull();
    expect(migrateLegacyRewardProgress(JSON.stringify({ v: 1,
      currentProgress: { 'raid-normal': 7700, unknown: 500 }, totals: { gold: 123 },
    }), modes)).toEqual({ currentProgress: { 'raid-normal': 7700 }, achievementProgress: {} });
  });

  it('清此頁只清對應分類；清成就清所有群組；全部清空', () => {
    let save = emptyRewardProgress();
    expect(hasRewardProgress(save)).toBe(false);
    save = withModeProgress(save, 'raid-normal', 7700);
    save = withModeProgress(save, 'arena-pass', 300);
    save = withAchievementProgress(save, '召喚骰子', 2);
    expect(hasRewardProgress(save)).toBe(true);
    expect(withoutModeProgress(save, 'raid-normal')).toEqual({
      currentProgress: { 'arena-pass': 300 }, achievementProgress: { '召喚骰子': 2 },
    });
    expect(withoutAchievementProgress(save)).toEqual({
      currentProgress: { 'raid-normal': 7700, 'arena-pass': 300 }, achievementProgress: {},
    });
    expect(withAchievementProgress(save, '召喚骰子', 0).achievementProgress).toEqual({});
    expect(emptyRewardProgress()).toEqual({ currentProgress: {}, achievementProgress: {} });
  });
});
