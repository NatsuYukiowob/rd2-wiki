import { describe, it, expect } from 'vitest';
import { parseGrowth, maxLevelValue, round2 } from '../../src/lib/growth';

describe('parseGrowth', () => {
  it('百分比', () => {
    expect(parseGrowth('基本攻擊傷害增加20%(+4%)').growth).toEqual({ base: 20, perLevel: 4, unit: '%' });
  });
  it('float32 雜訊四捨五入到兩位', () => {
    expect(parseGrowth('所有骰子子彈傷害增加10%(+1.2000000476837158%)').growth)
      .toEqual({ base: 10, perLevel: 1.2, unit: '%' });
  });
  it('秒', () => {
    expect(parseGrowth('位置變更技能冷卻時間減少0.5秒(+0.2秒)').growth)
      .toEqual({ base: 0.5, perLevel: 0.2, unit: 's' });
  });
  it('負值與 +- 雙符號', () => {
    expect(parseGrowth('技能冷卻時間減少-0.5秒(+-0.2秒)').growth)
      .toEqual({ base: -0.5, perLevel: -0.2, unit: 's' });
  });
  it('次／個 視為 count', () => {
    expect(parseGrowth('#毒素最大疊加次數增加2次(+1次)').growth)
      .toEqual({ base: 2, perLevel: 1, unit: 'count' });
    expect(parseGrowth('額外打擊範圍內2個(+1個)').growth)
      .toEqual({ base: 2, perLevel: 1, unit: 'count' });
  });
  it('無單位', () => {
    expect(parseGrowth('基本傷害增加5(+11)').growth).toEqual({ base: 5, perLevel: 11, unit: '' });
  });
  it('倍 視為 x（節點 2208：距離等比傷害倍率）', () => {
    expect(parseGrowth('距離等比傷害倍率增加50倍(+10)').growth)
      .toEqual({ base: 50, perLevel: 10, unit: 'x' });
  });
  it('未替換的樣板佔位符', () => {
    expect(parseGrowth('攻擊速度增加5%(+{1}%)')).toEqual({ growth: null, dataIssue: 'placeholder' });
  });
  it('沒有成長標記回傳 null', () => {
    expect(parseGrowth('於隨機位置召喚#巨石')).toEqual({ growth: null, dataIssue: null });
  });
  it('括號內外單位不一致視為錯誤', () => {
    expect(() => parseGrowth('增加20%(+4秒)')).toThrow(/單位/);
  });
});

describe('maxLevelValue', () => {
  it('滿級換算', () => {
    expect(maxLevelValue({ base: 20, perLevel: 4, unit: '%' }, 50)).toBe(216);
    expect(maxLevelValue({ base: 20, perLevel: 5, unit: '%' }, 15)).toBe(90);
  });
  it('1 級時等於 base', () => {
    expect(maxLevelValue({ base: 20, perLevel: 4, unit: '%' }, 1)).toBe(20);
  });
});

describe('round2', () => {
  it('去除 float32 雜訊', () => {
    expect(round2(1.2000000476837158)).toBe(1.2);
    expect(round2(0.44999998807907104)).toBe(0.45);
  });
});

describe('parseGrowth 的輸入防護', () => {
  it('超長數字不會讓正則爆炸——validate 是 fork PR 也跑得到的工作', () => {
    // 舊的 `[\d.]+` 字元類配上後面的 `\s*\(` 會災難性回溯：實測 2 萬位輸入要 2.5 秒、
    // 20 萬位要數十秒。描述欄位是貢獻者填的，等於送人一個燒 CI 額度的按鈕。
    const evil = `傷害增加${'1'.repeat(200_000)}(`;
    const t = performance.now();
    parseGrowth(evil);
    expect(performance.now() - t).toBeLessThan(100);
  });

  it('float32 雜訊那種 17 位小數仍要解得出來（正本裡真的有）', () => {
    expect(parseGrowth('增加10%(+1.2000000476837158%)').growth?.perLevel).toBe(1.2);
  });

  it('位數超過上限會報錯，不會安靜地只解出後六位', () => {
    // 正則沒有錨點，所以「限制位數」擋不住「從第二位數字開始比對」——這條測的是那個補丁。
    expect(() => parseGrowth(`增加${'9'.repeat(7)}%(+1%)`)).toThrow(/寫壞/);
  });

  it('1.2.3 這種壞數字會報錯，不會被解成 2.3', () => {
    expect(() => parseGrowth('增加1.2.3%(+1%)')).toThrow(/寫壞/);
  });
});
