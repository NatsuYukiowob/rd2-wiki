import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { costRows, critBands, potRows, relicEffectRange, relicUnit, rewardText, rewardTotals } from '../../src/lib/relic';
import type { Relic, RelicCrystal, RelicLevels } from '../../src/lib/types';

const relics: Relic[] = JSON.parse(readFileSync('data/relics.json', 'utf8'));
const levels: RelicLevels = JSON.parse(readFileSync('data/relic-levels.json', 'utf8'));
const byGameId = (id: string) => relics.find(r => r.gameId === id)!;

describe('relicEffectRange / relicUnit', () => {
  it('佔位換成 1 級～滿級，單位留在原位', () => {
    expect(relicEffectRange(byGameId('OldWallet'))).toBe('戰鬥開始時，額外發放30～140%SP');
    expect(relicUnit(byGameId('OldWallet').effect, 0)).toBe('%');
  });

  it('往下降的數值照資料順序印（擊殺計數器）', () => {
    expect(relicEffectRange(byGameId('KillCountRandomDicePowerUp'))).toBe('每擊殺3000～1175隻怪物，使隨機骰子強化');
  });

  it('兩個佔位各對自己的那組數值', () => {
    const r = byGameId('SupporterCooldownReduceChance');
    expect(relicEffectRange(r)).toBe('使用支援時，以2～10%機率冷卻時間減少30～47%');
    expect([relicUnit(r.effect, 0), relicUnit(r.effect, 1)]).toEqual(['%', '%']);
  });

  it('沒有單位的佔位回空字串（連擊藥水）', () => {
    expect(relicUnit(byGameId('MergeAttackUp').effect, 0)).toBe('');
  });

  it('單位是白名單：次／個認得，後面接的不是單位時回空字串', () => {
    expect(relicUnit('攻擊{0}次', 0)).toBe('次');
    expect(relicUnit('增加{0}個', 0)).toBe('個');
    expect(relicUnit('增加{0}的效果', 0)).toBe('');
  });

  it('全部 30 種都換得乾淨（不剩大括號、沒有 undefined）', () => {
    for (const r of relics) expect(relicEffectRange(r)).not.toMatch(/[{}]|undefined/);
  });
});

describe('critBands', () => {
  it('相鄰同值併段，累計逐段累加', () => {
    expect(critBands([5, 5, 6, 6, 6, 9], 5)).toEqual([
      { from: 5, to: 10, per: 5, total: 10 },
      { from: 15, to: 25, per: 6, total: 28 },
      { from: 30, to: 30, per: 9, total: 37 },
    ]);
  });

  it('正本：頭尾相接、蓋滿 5～600 級，滿級累計 1000%', () => {
    const bands = critBands(levels.critDamage, levels.critStep);
    expect(bands[0]!.from).toBe(5);
    expect(bands[bands.length - 1]).toMatchObject({ to: 600, total: 1000 });
    for (let i = 1; i < bands.length; i++) expect(bands[i]!.from).toBe(bands[i - 1]!.to + levels.critStep);
  });
});

describe('costRows', () => {
  it('從第 2 級起列，累計到滿級', () => {
    const rows = costRows(levels.pieces, levels.gold);
    expect(rows[0]).toEqual({ level: 2, pieces: 2, gold: 1000, sumPieces: 2, sumGold: 1000 });
    expect(rows[rows.length - 1]).toEqual({ level: 20, pieces: 290, gold: 500000, sumPieces: 1751, sumGold: 1859000 });
  });
});

describe('裂縫結晶的來源', () => {
  const crystal: RelicCrystal = JSON.parse(readFileSync('data/relic-crystal.json', 'utf8'));

  it('rewardText：名稱＋千分位數量', () => {
    expect(rewardText({ goods: 'crystal', amount: 3 })).toBe('裂縫結晶 ×3');
    expect(rewardText({ goods: 'gold', amount: 20000 })).toBe('金幣 ×20,000');
  });

  it('rewardTotals：依種類加總、結晶在前、沒拿到的種類不列', () => {
    expect(rewardTotals([{ goods: 'gold', amount: 5 }, { goods: 'crystal', amount: 1 }, { goods: 'gold', amount: 7 }]))
      .toEqual([{ goods: 'crystal', amount: 1 }, { goods: 'gold', amount: 12 }]);
    expect(rewardTotals([{ goods: 'gold', amount: 5 }])).toEqual([{ goods: 'gold', amount: 5 }]);
  });

  it('potRows：每一檔帶著領到這一檔為止的累計，最後一檔＝全部加總', () => {
    const rows = potRows(crystal.pot.tiers);
    expect(rows[0]!.total).toEqual([{ goods: crystal.pot.tiers[0]!.goods, amount: crystal.pot.tiers[0]!.amount }]);
    expect(rows[rows.length - 1]!.total).toEqual(rewardTotals(crystal.pot.tiers));
    // 累計只增不減（門檻是累計制，規則 33(c)）。
    const sums = rows.map(r => r.total.reduce((n, t) => n + t.amount, 0));
    expect(sums.every((n, i) => i === 0 || n > sums[i - 1]!)).toBe(true);
  });
});
