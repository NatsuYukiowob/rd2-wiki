import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { costRows, critBands, relicEffectRange, relicUnit } from '../../src/lib/relic';
import type { Relic, RelicLevels } from '../../src/lib/types';

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
