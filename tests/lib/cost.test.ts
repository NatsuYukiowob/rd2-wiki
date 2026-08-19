import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseCost, cumulativeUpgradeCost, upgradeTableApplies } from '../../src/lib/cost';
import type { UpgradeCostTable } from '../../src/lib/types';

describe('parseCost', () => {
  it('核心單一貨幣', () => {
    expect(parseCost('核心 5')).toEqual({ cost: { core: 5, gold: 0 }, maxLevel: null });
  });
  it('金幣單一貨幣含千分位', () => {
    expect(parseCost('金幣 8,000')).toEqual({ cost: { core: 0, gold: 8000 }, maxLevel: null });
  });
  it('複合成本，全形斜線', () => {
    expect(parseCost('金幣 100,000／核心 10')).toEqual({ cost: { core: 10, gold: 100000 }, maxLevel: null });
  });
  it('帶等級上限', () => {
    expect(parseCost('金幣 2,000\n最高 50 級')).toEqual({ cost: { core: 0, gold: 2000 }, maxLevel: 50 });
  });
  it('複合成本帶等級上限（實測存在的 最高 3 級）', () => {
    expect(parseCost('金幣 20,000／核心 4\n最高 3 級')).toEqual({ cost: { core: 4, gold: 20000 }, maxLevel: 3 });
  });
  it('半形斜線視為錯誤', () => {
    expect(() => parseCost('金幣 100,000/核心 10')).toThrow(/全形/);
  });
  it('核心不使用千分位', () => {
    expect(() => parseCost('核心 1,000')).toThrow();
  });
  it('等級超出 1..100 視為錯誤', () => {
    expect(() => parseCost('金幣 2,000\n最高 101 級')).toThrow(/1..100/);
  });
  it('完全無法辨識的字串拋錯', () => {
    expect(() => parseCost('免費')).toThrow();
  });
  it('欄位順序顛倒（核心在金幣之前）', () => {
    expect(() => parseCost('核心 10／金幣 100,000')).toThrow(/必須在|順序/);
  });
  it('金幣不帶千分位（4位以上）', () => {
    expect(() => parseCost('金幣 8000')).toThrow(/千分位|逗號|格式/);
  });
  it('重複金幣欄位', () => {
    expect(() => parseCost('金幣 100,000／金幣 200,000')).toThrow(/重複|多次|無法解析/);
  });
});

describe('parseCost 的數值上限', () => {
  it('核心超過上限會被擋', () => {
    expect(() => parseCost('核心 99999')).toThrow(/上限/);
  });

  it('金幣超過上限會被擋', () => {
    expect(() => parseCost('金幣 999,999,999')).toThrow(/上限/);
  });

  it('大到失去精度的數字會被擋——不然全樹成本會安靜地算錯', () => {
    expect(() => parseCost('核心 99999999999999999999')).toThrow(/安全整數|上限/);
  });

  it('正常範圍照常通過', () => {
    expect(parseCost('核心 66').cost).toEqual({ core: 66, gold: 0 });
    expect(parseCost('金幣 23,000／核心 5').cost).toEqual({ core: 5, gold: 23000 });
  });
});

describe('cumulativeUpgradeCost / upgradeTableApplies', () => {
  const table: UpgradeCostTable = JSON.parse(readFileSync('data/upgrade-cost.json', 'utf8'));

  it('練滿 50 級的累計花費與資料表的累計欄一致', () => {
    // RD2 資料表「技能升級花費」分頁第 53 列：累計金幣 465,700／累計核心 99
    expect(cumulativeUpgradeCost(table, 50)).toEqual({ gold: 465700, core: 99 });
  });
  it('1 級就是解鎖那一次，金額等於符文 data-cost 的首級金幣', () => {
    expect(cumulativeUpgradeCost(table, 1)).toEqual({ gold: 2000, core: 0 });
  });
  it('中途等級照樣累加（第 6 級開始才吃核心）', () => {
    expect(cumulativeUpgradeCost(table, 5)).toEqual({ gold: 5200, core: 0 });
    expect(cumulativeUpgradeCost(table, 6)).toEqual({ gold: 6800, core: 1 });
  });
  it('表格涵蓋不到的等級回 null，不是回一個看起來很合理的部分和', () => {
    expect(cumulativeUpgradeCost(table, 51)).toBeNull();
    expect(cumulativeUpgradeCost(table, 0)).toBeNull();
    expect(cumulativeUpgradeCost(table, 1.5)).toBeNull();
  });
  it('只適用骰子符文的 50 級節點——玩家被動套不上', () => {
    expect(upgradeTableApplies(table, { type: 'rune', maxLevel: 50 })).toBe(true);
    // 玩家被動 1102「所有骰子傷害」也是 50 級，但單價是金幣 8,000 不是 2,000
    expect(upgradeTableApplies(table, { type: 'passive', maxLevel: 50 })).toBe(false);
    expect(upgradeTableApplies(table, { type: 'rune', maxLevel: 1 })).toBe(false);
    expect(upgradeTableApplies(null, { type: 'rune', maxLevel: 50 })).toBe(false);
  });
});
