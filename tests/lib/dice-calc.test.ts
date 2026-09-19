import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { INTERVAL_GROWTH, PENDING, deriveParams, deriveTable, formatNumber, valueAt } from '../../src/lib/dice-calc';
import type { DiceStat, DiceStatsTable } from '../../src/lib/types';

// 全表 golden 讀真實資料：四個檢查點就是 dice-stats.json 自己的四個檔位，反推再重算必須逐字相同。
// 這是這支計算層唯一可靠的正本對照——中間點沒有官方資料可對，只能靠「四個角都對＋兩軸各自等差」。
const table = JSON.parse(readFileSync('data/dice-stats.json', 'utf8')) as DiceStatsTable;
const CHECKPOINTS = [['base', 1, 1], ['dice7', 7, 1], ['lv15', 1, 15], ['lv15dice7', 7, 15]] as const;
const stat = (gameId: string, label: string): DiceStat => {
  const s = table[gameId]!.stats.find(x => x.label === label);
  if (!s) throw new Error(`${gameId} 沒有「${label}」`);
  return s;
};

// ⚠️ 骰子顆數與四檔項目數只在 tests/data/dice-stats.test.ts 釘一次；這裡改成跟資料本身比，
// 不再各寫一份會一起漂移的數字——資料一改兩邊都得改，而這支要守的是「算得對」，不是「有幾項」。
describe('全表 golden', () => {
  it('帶四檔的每一項 × 4 個檢查點，反推後重算逐字等於 dice-stats.json', () => {
    const bad: string[] = [];
    let n = 0;
    let scaling = 0;
    for (const [gameId, entry] of Object.entries(table)) {
      for (const s of entry.stats) {
        if (s.dice7 === undefined) continue;
        scaling++;
        const p = deriveParams(s);
        for (const [key, pips, level] of CHECKPOINTS) {
          n++;
          const got = valueAt(p, pips, level);
          if (got !== s[key]) bad.push(`${gameId} ${s.label} ${key}: 算出 ${got}，資料是 ${s[key]}`);
        }
      }
    }
    expect(bad).toEqual([]);
    expect(n).toBeGreaterThan(0);
    expect(n).toBe(4 * scaling);
  });

  it('沒有四檔的項目是常數：任何骰點與強化都原字串照印', () => {
    const consts = Object.values(table).flatMap(e => e.stats).filter(s => s.dice7 === undefined);
    expect(consts.length).toBeGreaterThan(0);
    for (const s of consts) {
      const p = deriveParams(s);
      expect(p.kind).toBe('const');
      expect(valueAt(p, 5, 9)).toBe(s.base);
    }
  });

  it('deriveTable 整張表反推不丟例外，每顆骰子都有', () => {
    expect(Object.keys(deriveTable(table))).toHaveLength(Object.keys(table).length);
  });
});

describe('中間點（四檔以外的組合）', () => {
  it('火骰子 3 骰點 Lv.5：攻擊力 150＋100×2＋150×4＝950', () => {
    expect(valueAt(deriveParams(stat('D000', '攻擊力')), 3, 5)).toBe('950');
  });
  it('火骰子 3 骰點：攻擊速度 1÷3＝0.333 秒/次（強化不影響攻速）', () => {
    expect(valueAt(deriveParams(stat('D000', '攻擊速度')), 3, 5)).toBe('0.333 秒/次');
  });
  it('火骰子 3 骰點 Lv.5：範圍傷害 50＋60×2＋80×4＝490%', () => {
    expect(valueAt(deriveParams(stat('D000', '範圍傷害')), 3, 5)).toBe('490%');
  });
  it('小數位取四檔與 Δ 的較大者：D005 尖刺持續時間 Lv.2＝7.25s（四檔都只到 1 位）', () => {
    expect(valueAt(deriveParams(stat('D005', '尖刺持續時間')), 1, 2)).toBe('7.25s');
  });
});

describe('守門：反推不成立就丟例外，訊息指得出是哪一項', () => {
  const s = (over: Partial<DiceStat>): DiceStat =>
    ({ label: '測試項', base: '100', dice7: '700', lv15: '1500', lv15dice7: '2100', ...over });

  it('基準樣本本身成立（否則下面的反例證明不了什麼）', () => {
    expect(deriveParams(s({})).kind).toBe('linear');
  });
  it('兩軸不可加（非等差）', () => {
    expect(() => deriveParams(s({ lv15dice7: '2500' }))).toThrow(/測試項.*不可加/);
  });
  it('Δ 超過 3 位小數', () => {
    expect(() => deriveParams(s({ dice7: '101' }))).toThrow(/測試項.*超過 3 位小數/);
  });
  it('單位不一致', () => {
    expect(() => deriveParams(s({ base: '100%' }))).toThrow(/測試項.*單位不一致/);
  });
  it('開頭不是數字', () => {
    expect(() => deriveParams(s({ dice7: '前方' }))).toThrow(/測試項.*dice7.*不是數字/);
  });
  it('標成攻擊間隔卻不是 ÷7', () => {
    expect(() => deriveParams({
      label: '攻擊速度', base: '1 秒/次', dice7: '0.2 秒/次', lv15: '1 秒/次', lv15dice7: '0.143 秒/次',
      diceGrowth: INTERVAL_GROWTH,
    })).toThrow(/攻擊速度.*÷ 7/);
  });
  it('deriveTable 的訊息補上 gameId 與骰子名', () => {
    const bad: DiceStatsTable = { D777: { name: '測試骰子', stats: [s({ lv15dice7: '2500' })] } };
    expect(() => deriveTable(bad)).toThrow(/D777（測試骰子）測試項/);
  });
});

describe('待實測', () => {
  // CLAUDE.md 明文允許官方空著的格子寫「待實測」（目前 0 格）。它不能觸發守門把 CI 弄紅，
  // 也不能退回 base 冒充「不會變」。
  it('任一檔是「待實測」：不丟例外，(1,1) 印 base，其餘一律「待實測」', () => {
    const p = deriveParams({ label: '原子旋轉速度', base: '10s', dice7: '7s', lv15: PENDING, lv15dice7: PENDING });
    expect(p.kind).toBe('pending');
    expect(valueAt(p, 1, 1)).toBe('10s');
    expect(valueAt(p, 7, 1)).toBe(PENDING);
    expect(valueAt(p, 1, 2)).toBe(PENDING);
  });
});

describe('formatNumber', () => {
  it.each([
    [0.142857142857, 3, '0.143'],
    [950, 0, '950'],
    [7.25, 2, '7.25'],
    [0.5, 3, '0.5'],
    [0.5005, 3, '0.501'],
    [1.005, 2, '1.01'],
    [-1e-12, 3, '0'],
    [0.1 + 0.2, 2, '0.3'],
  ])('formatNumber(%s, %s) === %s', (n, d, expected) => {
    expect(formatNumber(n, d)).toBe(expected);
  });
});
