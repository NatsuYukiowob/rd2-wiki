import { describe, it, expect } from 'vitest';
import { parseCost } from '../../src/lib/cost';

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
