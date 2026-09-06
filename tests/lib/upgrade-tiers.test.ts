import { describe, it, expect } from 'vitest';
import { expandTier, tierKeyOf, levelTableFor, upgradeExtraCost } from '../../src/lib/upgrade-tiers';
import type { LevelCost, PassiveUpgradeCost, TreeNode, UpgradeCostTable } from '../../src/lib/types';

// 官方資料表的 tier A：解鎖 12000、Lv.2-5 每級 8000、Lv.5→6 是 16000+6、Max Lv.10。
// 表頭註記「等級5以後未說明之等級費用以前一級所需金幣資源相同」＝ Lv.7~10 沿用 16000，
// 而那 6 核心只在跨進區間的那一級（Lv.6）收一次。
const TIER_A = {
  maxLevel: 10,
  unlockGold: 12000,
  bands: [
    { from: 2, to: 5, gold: 8000, core: 0 },
    { from: 6, to: 10, gold: 16000, core: 6 },
  ],
};

const TABLES: PassiveUpgradeCost = {
  note: '', source: '',
  tiers: { A: TIER_A },
  special: {
    '4303': { maxLevel: 3, levels: [
      { level: 2, gold: 60000, core: 6 },
      { level: 3, gold: 120000, core: 10 },
    ] },
  },
};

const RUNE_TABLE: UpgradeCostTable = {
  appliesTo: { type: 'rune', maxLevel: 50 },
  levels: [
    { level: 1, gold: 2000, core: 0 },
    { level: 2, gold: 800, core: 0 },
    { level: 3, gold: 800, core: 0 },
  ],
};

const node = (over: Partial<TreeNode>) => ({
  id: 'x', type: 'passive', maxLevel: 10, unlockCost: { core: 0, gold: 12000, solar: 0 }, unlockVia: 'cost',
  ...over,
} as TreeNode);

describe('expandTier', () => {
  it('把 band 展開成逐級表，核心只落在區間第一級', () => {
    const rows = expandTier(TIER_A);
    expect(rows).toHaveLength(9); // Lv.2 ~ Lv.10
    expect(rows[0]).toEqual({ level: 2, gold: 8000, core: 0, solar: 0 });
    expect(rows[3]).toEqual({ level: 5, gold: 8000, core: 0, solar: 0 });
    expect(rows[4]).toEqual({ level: 6, gold: 16000, core: 6, solar: 0 });
    expect(rows[5]).toEqual({ level: 7, gold: 16000, core: 0, solar: 0 });
    expect(rows[8]).toEqual({ level: 10, gold: 16000, core: 0, solar: 0 });
  });

  // 這張表是社群改得到的 JSON，band 少一段的話展開結果會在中間缺級，而「缺級」在畫面上
  // 長得跟「那一級免費」一模一樣（累加時直接跳過）。寧可當場丟錯。
  it('band 沒有連續涵蓋 2..maxLevel 時丟錯', () => {
    expect(() => expandTier({ maxLevel: 10, unlockGold: 0, bands: [{ from: 2, to: 5, gold: 1, core: 0 }] }))
      .toThrow(/涵蓋/);
    expect(() => expandTier({ maxLevel: 10, unlockGold: 0, bands: [
      { from: 2, to: 5, gold: 1, core: 0 }, { from: 7, to: 10, gold: 1, core: 0 },
    ] })).toThrow(/連續/);
  });

  it('band 重疊時丟錯', () => {
    expect(() => expandTier({ maxLevel: 10, unlockGold: 0, bands: [
      { from: 2, to: 6, gold: 1, core: 0 }, { from: 6, to: 10, gold: 1, core: 0 },
    ] })).toThrow(/連續/);
  });
});

describe('tierKeyOf', () => {
  it('用 (maxLevel, 解鎖金幣) 找 tier', () => {
    expect(tierKeyOf(node({ maxLevel: 10, unlockCost: { core: 0, gold: 12000, solar: 0 } }), TABLES)).toBe('A');
  });

  it('對不到任何 tier 時回 null', () => {
    expect(tierKeyOf(node({ maxLevel: 20, unlockCost: { core: 0, gold: 3000, solar: 0 } }), TABLES)).toBeNull();
  });

  // tier 表只描述玩家被動與支援。一顆剛好也是 (10, 12000) 的骰子符文套上去會算出一個
  // 看起來很專業的錯數字——同 upgradeTableApplies() 擋 type 的理由。
  it('只認 passive 與 support，其他型別一律 null', () => {
    expect(tierKeyOf(node({ type: 'support' }), TABLES)).toBe('A');
    expect(tierKeyOf(node({ type: 'rune' }), TABLES)).toBeNull();
    expect(tierKeyOf(node({ type: 'dice' }), TABLES)).toBeNull();
  });

  // 表格的解鎖那一格就是玩家付的那筆錢；預設／任務解鎖的節點根本沒付過，
  // 拿 unlockCost.gold 當 key 去查表在語意上就不成立（sumUnlockCost 也是這樣排除的）。
  it('沒有真的付解鎖費用的節點回 null', () => {
    expect(tierKeyOf(node({ unlockVia: 'default' }), TABLES)).toBeNull();
    expect(tierKeyOf(node({ unlockVia: 'achievement', unlockPaid: true }), TABLES)).toBe('A');
  });
});

describe('levelTableFor', () => {
  it('骰子符文 50 級走共用的符文表', () => {
    const t = levelTableFor(node({ id: '1002', type: 'rune', maxLevel: 50 }), TABLES, RUNE_TABLE);
    expect(t?.[0]).toEqual({ level: 1, gold: 2000, core: 0 });
  });

  it('4303 走特例表', () => {
    const t = levelTableFor(node({ id: '4303', type: 'rune', maxLevel: 3 }), TABLES, RUNE_TABLE);
    expect(t).toEqual(TABLES.special['4303']!.levels);
  });

  it('玩家被動走 tier 表', () => {
    const t = levelTableFor(node({ maxLevel: 10, unlockCost: { core: 0, gold: 12000, solar: 0 } }), TABLES, RUNE_TABLE);
    expect(t?.[0]).toEqual({ level: 2, gold: 8000, core: 0, solar: 0 });
  });

  it('不可升級的節點回 null', () => {
    expect(levelTableFor(node({ maxLevel: 1 }), TABLES, RUNE_TABLE)).toBeNull();
  });

  // 特例表以 id 為鍵，但那顆節點的等級上限哪天被官方改了，表就對不上了——
  // 靜靜沿用舊表會讓 Lv.4 以後的花費憑空消失。
  it('特例表的 maxLevel 與節點對不上時回 null', () => {
    expect(levelTableFor(node({ id: '4303', type: 'rune', maxLevel: 5 }), TABLES, RUNE_TABLE)).toBeNull();
  });
});

describe('upgradeExtraCost', () => {
  const rows: LevelCost[] = expandTier(TIER_A);

  it('Lv.1 不花錢', () => {
    expect(upgradeExtraCost(rows, 1)).toEqual({ core: 0, gold: 0, solar: 0 });
  });

  it('累加 Lv.2 到目標等級', () => {
    expect(upgradeExtraCost(rows, 5)).toEqual({ core: 0, gold: 32000, solar: 0 });
    expect(upgradeExtraCost(rows, 6)).toEqual({ core: 6, gold: 48000, solar: 0 });
    expect(upgradeExtraCost(rows, 10)).toEqual({ core: 6, gold: 112000, solar: 0 });
  });

  // 符文表自己帶著 level 1（＝解鎖那一次，金額與節點的 unlockCost 相同）。
  // 不跳過它的話每顆符文的解鎖費用會被算兩次。
  it('表格自帶 level 1 時跳過它', () => {
    expect(upgradeExtraCost(RUNE_TABLE.levels, 3)).toEqual({ core: 0, gold: 1600, solar: 0 });
  });

  // 太陽核心（v1.1.0）走 special 表：太陽強化的 2–20 級費用逐級不同，官方單獨列表。
  // ⚠️ 累加兩級以上才驗得到「有加總」，只驗一級的話直接指派也會綠。
  it('special 表帶 solar 時照樣逐級累加', () => {
    const solarRows: LevelCost[] = [
      { level: 2, gold: 100000, core: 0, solar: 200 },
      { level: 3, gold: 150000, core: 0, solar: 300 },
      // 缺席的 solar 當 0——兩份費用表 JSON 的既有列都沒有這個欄位
      { level: 4, gold: 200000, core: 0 },
    ];
    expect(upgradeExtraCost(solarRows, 2)).toEqual({ core: 0, gold: 100000, solar: 200 });
    expect(upgradeExtraCost(solarRows, 3)).toEqual({ core: 0, gold: 250000, solar: 500 });
    expect(upgradeExtraCost(solarRows, 4)).toEqual({ core: 0, gold: 450000, solar: 500 });
  });

  it('目標等級超出表格範圍時回 null', () => {
    expect(upgradeExtraCost(rows, 11)).toBeNull();
    expect(upgradeExtraCost(rows, 0)).toBeNull();
    expect(upgradeExtraCost(rows, 2.5)).toBeNull();
  });
});
