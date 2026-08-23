import { describe, it, expect } from 'vitest';
import { STAT_MODES, statValue, isFixed, growthNote, statsOf } from '../../src/lib/dice-stats';
import type { DiceStat, DiceStatsTable } from '../../src/lib/types';

// 火骰子的攻擊力：四檔都不一樣，是「會成長」的樣本。
const ATK: DiceStat = {
  label: '攻擊力',
  base: '150', dice7: '750', lv15: '2250', lv15dice7: '2850',
  diceGrowth: '每提升1骰點：+100', spGrowth: '每強化1級：+150',
};
// 火骰子的範圍傷害：sheet3 完全沒收錄，代表它不隨骰點或 SP 改變。
const FIXED: DiceStat = { label: '範圍傷害', base: '50%' };
// 陰陽骰子的攻擊力：sheet3 有收錄，但「骰點不變＋無變化」讓四檔值全等。
const FLAT: DiceStat = {
  label: '攻擊力',
  base: '100', dice7: '100', lv15: '100', lv15dice7: '100',
  diceGrowth: '骰點不變', spGrowth: '無變化',
};

const TABLE: DiceStatsTable = {
  D000: { name: '火骰子', stats: [ATK, FIXED] },
  D201: { name: '鋸齒骰子', note: '技能物件型，無標準基本攻擊', stats: [] },
};

describe('STAT_MODES', () => {
  it('四個檔位，第一個是基礎——頁面預設顯示的就是它', () => {
    expect(STAT_MODES.map(m => m.key)).toEqual(['base', 'dice7', 'lv15', 'lv15dice7']);
  });
});

describe('statValue', () => {
  it('回傳指定檔位的值', () => {
    expect(statValue(ATK, 'base')).toBe('150');
    expect(statValue(ATK, 'dice7')).toBe('750');
    expect(statValue(ATK, 'lv15')).toBe('2250');
    expect(statValue(ATK, 'lv15dice7')).toBe('2850');
  });

  // 這條是「切檔時 pill 數量不變」的地基：固定項目沒有其他檔位的值，退回 base 才不會
  // 在畫面上留下一顆空白的 pill（那看起來像資料掉了）。
  it('沒有該檔位的值時退回基礎值', () => {
    for (const m of STAT_MODES) expect(statValue(FIXED, m.key)).toBe('50%');
  });
});

describe('isFixed', () => {
  it('只有基礎值的項目是固定的', () => {
    expect(isFixed(FIXED)).toBe(true);
  });

  // 「表裡有這一列」不等於「它會變」——陰陽骰子的攻擊力四檔全等，標成會成長是騙人的。
  it('四檔值全等時也算固定', () => {
    expect(isFixed(FLAT)).toBe(true);
  });

  it('四檔有任何差異就不是固定', () => {
    expect(isFixed(ATK)).toBe(false);
  });
});

describe('growthNote', () => {
  it('把骰點與 SP 兩條成長規則併成一句', () => {
    expect(growthNote(ATK)).toBe('骰點：每提升1骰點：+100／強化：每強化1級：+150');
  });

  it('固定項目沒有成長規則可寫', () => {
    expect(growthNote(FIXED)).toBeNull();
  });
});

describe('statsOf', () => {
  it('查得到就回那一筆', () => {
    expect(statsOf(TABLE, 'D000')?.name).toBe('火骰子');
  });

  // 這三條各自對應一種「資料還沒進來」的狀態。任何一種都必須是「不顯示數值區」，
  // 不是丟例外，也不是印出一塊空的面板。
  it('gameId 查不到時回 null', () => {
    expect(statsOf(TABLE, 'D999')).toBeNull();
  });

  it('gameId 是 undefined 時回 null', () => {
    expect(statsOf(TABLE, undefined)).toBeNull();
  });

  it('整張表是 null 時回 null', () => {
    expect(statsOf(null, 'D000')).toBeNull();
  });
});
