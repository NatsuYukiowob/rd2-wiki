import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { currencyIconDetails } from '../../src/lib/cost-html';
import { rewardDisplay } from '../../src/lib/reward-display';
import type { RewardCatalog, RewardCollectibleGrant, RewardGrant } from '../../src/lib/types';

const catalog = JSON.parse(readFileSync('data/rewards.json', 'utf8')) as RewardCatalog;
const allRewards = catalog.modes.flatMap(mode => mode.kind === 'threshold'
  ? mode.tiers.flatMap(tier => tier.rewards)
  : mode.groups.flatMap(group => group.stages.flatMap(stage => stage.rewards)));

describe('data/rewards.json 正式里程碑', () => {
  it('重複性獎勵是獨立唯讀資料，不屬於有總計的分類', () => {
    expect(catalog.modes.some(mode => mode.id === 'repeatable')).toBe(false);
    const repeatable = catalog.repeatable!;
    expect(repeatable.name).toBe('重複性獎勵');
    expect(repeatable.sections[0]?.tiers.map(tier => tier.requirement)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(repeatable.sections[0]?.tiers.map(tier => tier.rewards))
      .toEqual([300, 1000, 2000, 4000, 8000, 15000].map(amount => [{ type: 'currency', kind: 'gold', amount }]));
    expect(repeatable.dailyTasks.tasks.map(({ name, requirement, points }) => [name, requirement, points]))
      .toEqual([
        ['登入', 1, 100], ['進行合作', 5, 150], ['合成骰子', 30, 100], ['擊殺一般怪物', 500, 100],
        ['擊殺首領怪物', 5, 100], ['狩獵SP魔像', 1, 100], ['使用表情符號', 1, 100], ['進行競技場', 1, 200],
      ]);
    expect(repeatable.dailyTasks.totalPoints).toBe(950);
    expect(repeatable.dailyTasks.rewards.tiers.map(tier => [tier.requirement, tier.rewards]))
      .toEqual([
        [150, [{ type: 'currency', kind: 'gold', amount: 1000 }]],
        [300, [{ type: 'currency', kind: 'coopTicket', amount: 2 }]],
        [450, [{ type: 'currency', kind: 'luckyDiceTicket', amount: 3 }]],
        [600, [{ type: 'currency', kind: 'coopTicket', amount: 3 }]],
        [750, [{ type: 'currency', kind: 'arenaTicket', amount: 1 }]],
      ]);
    expect(repeatable.dailyTasks.rewards.note).toContain('獎勵圖示待辨識');
    for (const section of [...repeatable.sections, repeatable.dailyTasks.rewards]) {
      for (const grant of section.tiers.flatMap(tier => tier.rewards)) {
        expect(() => rewardDisplay(grant)).not.toThrow();
      }
    }
  });
  it('六類完整取代測試資料，階段與 grant 數量符合已核對工作表', () => {
    expect(catalog.status).toBe('official');
    expect(catalog.modes.map(mode => mode.id)).toEqual([
      'raid-normal', 'raid-hard', 'arena-pass', 'journey-7day', 'hunt-event', 'achievements',
    ]);
    expect(catalog.modes.map(mode => mode.kind === 'threshold' ? mode.tiers.length :
      mode.groups.reduce((sum, group) => sum + group.stages.length, 0)))
      .toEqual([31, 50, 19, 5, 14, 274]);
    expect(allRewards).toHaveLength(535);
    expect(allRewards.reduce<Record<string, number>>((totals, reward) => {
      totals[reward.type] = (totals[reward.type] ?? 0) + 1;
      return totals;
    }, {})).toEqual({ currency: 513, cosmetic: 16, dice: 3, emote: 3 });
  });

  it('五類門檻與 39 個成就群組完整且唯一，不含非法數量', () => {
    expect(new Set(catalog.modes.map(mode => mode.id)).size).toBe(6);
    for (const mode of catalog.modes) {
      if (mode.kind === 'threshold') {
        expect(new Set(mode.tiers.map(tier => tier.requirement)).size).toBe(mode.tiers.length);
        for (const tier of mode.tiers) {
          expect(tier.requirement).toBeGreaterThan(0);
          expect(tier.rewards.length).toBeGreaterThan(0);
        }
      } else {
        expect(mode.groups).toHaveLength(39);
        expect(new Set(mode.groups.map(group => group.id)).size).toBe(39);
        for (const group of mode.groups) {
          expect(group.stages.map(stage => stage.stage)).toEqual(
            Array.from({ length: group.stages.length }, (_, index) => index + 1));
          expect(group.stages.every(stage => stage.requirement > 0 && stage.rewards.length > 0)).toBe(true);
        }
      }
    }
    expect(allRewards.every(reward => Number.isInteger(reward.amount) && reward.amount > 0)).toBe(true);
  });

  it('系屬頭像改用已確認角色名稱，所有外觀都有排序子類型', () => {
    const cosmetics = allRewards.filter((reward): reward is RewardCollectibleGrant => reward.type === 'cosmetic');
    expect(cosmetics.every(reward => reward.subtype)).toBe(true);
    const labels = cosmetics.map(reward => reward.label);
    for (const label of ['青兒頭像', '迪奇頭像', '里克頭像', '艾科頭像']) expect(labels).toContain(label);
    expect(labels.some(label => /(?:工程|入侵|自然|魔法|渾沌)系頭像/.test(label))).toBe(false);
    // 此版正式里程碑沒有渾沌頭像，不新增未存在的 reward。
    expect(cosmetics.find(reward => reward.itemId === 'UNIQUE:Dice_Predator3_skin1'))
      .toMatchObject({ label: '吞噬骰子－鯊魚造型', subtype: 'dice-skin', assetStatus: 'ready', icon: '/rewards/cosmetic/Dice_Predator3_skin1.png' });
    expect(cosmetics.some(reward => reward.label === 'Predator3 skin1')).toBe(false);
  });

  it('三張人工核准表情都有正式完整圖，不再使用 pending fallback', () => {
    const emotes = allRewards.filter((reward): reward is RewardCollectibleGrant => reward.type === 'emote');
    expect(emotes).toHaveLength(3);
    for (const name of ['target', 'STOP', 'NO_SIGN']) {
      const reward = emotes.find(reward => reward.label === `${name} 表情`)!;
      expect(reward).toMatchObject({ assetStatus: 'ready', icon: `/rewards/emote/${name}.png` });
      expect(existsSync(`public${reward.icon}`)).toBe(true);
      expect(rewardDisplay(reward).fallback).toBeUndefined();
    }
  });

  it('貨幣共用 registry，dice/cosmetic 只用已核對圖，待素材品不冒用圖片', () => {
    const currencies = allRewards.filter((reward): reward is Extract<RewardGrant, { type: 'currency' }> =>
      reward.type === 'currency');
    for (const reward of currencies) expect(() => currencyIconDetails(reward.kind)).not.toThrow();
    expect(new Set(currencies.map(reward => reward.kind))).toEqual(new Set([
      'gold', 'core', 'treeSeed', 'coopTicket', 'arenaTicket', 'skinCoin',
    ]));
    for (const reward of allRewards.filter(reward => reward.type !== 'currency')) {
      const display = rewardDisplay(reward);
      if (reward.assetStatus === 'pending') {
        expect(display.iconSrc).toBeUndefined();
        expect(display.fallback).toBeTruthy();
      } else {
        expect(display.iconSrc).toBeTruthy();
        if (reward.type === 'cosmetic') {
          expect(existsSync(`public${reward.icon}`)).toBe(true);
        }
      }
    }
  });

  it('連勝區塊使用完整官方撲滿圖，與獎勵 grants 分開', () => {
    const images = catalog.repeatable!.sections[0]!.tierImages!;
    for (let wins = 0; wins <= 5; wins++) {
      expect(images[wins]?.src).toBe(`/rewards/reference/${wins}_pig.png`);
      expect(existsSync(`public${images[wins]!.src}`)).toBe(true);
    }
  });

  it('7日旅程 35 筆、狩獵活動 70 筆任務分日匯入，點數與主表日合計一致', () => {
    for (const [id, dayCount, firstTaskName, firstDayTotal] of [
      ['journey-7day', 7, '登入', 600],
      ['hunt-event', 14, '登入', 500],
    ] as const) {
      const mode = catalog.modes.find(mode => mode.id === id);
      expect(mode?.kind).toBe('threshold');
      if (mode?.kind !== 'threshold') continue;
      expect(mode.taskDays).toHaveLength(dayCount);
      expect(mode.taskDays?.flatMap(day => day.tasks)).toHaveLength(dayCount * 5);
      expect(mode.taskDays?.[0]?.tasks[0]).toMatchObject({
        name: firstTaskName, requirement: 1, points: 100,
      });
      expect(mode.taskDays?.[0]?.totalPoints).toBe(firstDayTotal);
      for (const day of mode.taskDays ?? []) {
        expect(day.tasks).toHaveLength(5);
        expect(day.tasks.reduce((sum, task) => sum + task.points, 0)).toBe(day.totalPoints);
        expect(day.tasks.every(task => task.name.length > 0 && task.requirement > 0 && task.points > 0)).toBe(true);
      }
    }
    expect(catalog.modes.filter(mode => mode.kind === 'threshold' && mode.taskDays?.length)).toHaveLength(2);
  });
});
