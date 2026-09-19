import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { deriveTable, numericAt, type StatParams } from '../../src/lib/dice-calc';
import { cardModel } from '../../src/lib/board-card';
import { ROW_TARGETS, namedEffects, type NamedEffect, type OffgameFile } from '../../src/lib/offgame';
import {
  BULLET_LABEL, appliedEffects, bonusCardModel, detailLines, formatDelta, levelSource, rowValue,
  NO_BOARD,
  type AppliedEffect,
  type BoardBonus,
} from '../../src/lib/offgame-calc';
import { branchOfId } from '../../src/lib/taxonomy';
import type { DiceStatsTable } from '../../src/lib/types';

const nodes = JSON.parse(readFileSync('data/nodes.json', 'utf8')) as
  Record<string, { name: string; type: string; gameId: string; description: string }>;
const derived = deriveTable(JSON.parse(readFileSync('data/dice-stats.json', 'utf8')) as DiceStatsTable);
const effects = namedEffects(JSON.parse(readFileSync('data/offgame-effects.json', 'utf8')) as OffgameFile, nodes);
const diceIds = Object.keys(nodes).filter(id => nodes[id]!.type === '骰子').sort();
const params = (diceId: string): StatParams[] => derived[nodes[diceId]!.gameId]!;

/** 只有指定的節點、指定的等級，其餘沒解開。 */
const applied = (diceId: string, levels: Record<string, number>): AppliedEffect[] =>
  appliedEffects(diceId, branchOfId(diceId), effects, id => levels[id] ?? 0);
/** 全部練滿（「全滿」模式）。 */
const maxed = (diceId: string): AppliedEffect[] =>
  appliedEffects(diceId, branchOfId(diceId), effects, levelSource('max', null));
const card = (diceId: string, pips: number, lv: number, a: readonly AppliedEffect[]) =>
  bonusCardModel(nodes[diceId]!.name, pips, lv, params(diceId), a);
const row = (c: { rows: { label: string; value: string; bonus: string | null }[] }, label: string) => {
  const r = c.rows.find(x => x.label === label);
  if (!r) throw new Error(`卡片沒有「${label}」這一列`);
  return r;
};
/** 合成的節點：驗逆向讀到、但真實資料湊不出來的規則（例如兩個不同來源的攻速）。 */
const synth = (over: Partial<NamedEffect>): AppliedEffect => ({
  id: 'T',
  level: 1,
  effect: { target: 'intervalPct', scope: 'all', value: 50, rankAdd: 0, maxLevel: 1, name: '測試', ...over },
});

describe('「不含」≡ 一期', () => {
  it('沒有任何局外節點時，每顆骰子 × 骰點 1–7 × 強化 Lv 1–15 都跟一期的卡片逐字相同、沒有括號、沒有子彈行', () => {
    let n = 0;
    for (const id of diceIds) {
      expect(appliedEffects(id, branchOfId(id), effects, levelSource('none', null)), id).toEqual([]);
      for (let pips = 1; pips <= 7; pips++) {
        for (let lv = 1; lv <= 15; lv++) {
          const old = cardModel(nodes[id]!.name, pips, lv, params(id));
          const now = card(id, pips, lv, []);
          expect(now.title).toBe(old.title);
          expect(now.rows.map(r => [r.label, r.value])).toEqual(old.rows.map(r => [r.label, r.value]));
          expect(now.rows.every(r => r.bonus === null && r.sub === undefined), `${id} ${pips}/${lv}`).toBe(true);
          n++;
        }
      }
    }
    expect(n).toBe(diceIds.length * 7 * 15);
  });
});

describe('攻擊力：被動同池只乘一次，子彈%符文另起一行', () => {
  it('火 7 骰點 Lv.1 ＋ 子彈傷害%增加 Lv.50：面板不變、子彈實際 2370', () => {
    const c = card('1001', 7, 1, applied('1001', { '1201': 50 }));
    expect(row(c, '攻擊力')).toMatchObject({ value: '750', bonus: null });
    expect(row(c, BULLET_LABEL)).toMatchObject({ value: '2370', bonus: null, sub: true });
    expect(c.rows.map(r => r.label).slice(0, 2)).toEqual(['攻擊力', BULLET_LABEL]);
  });
  it('再加所有骰子傷害 Lv.50：750 (+516)、子彈 4001', () => {
    const c = card('1001', 7, 1, applied('1001', { '1201': 50, '1102': 50 }));
    expect(row(c, '攻擊力').bonus).toBe('(+516)');
    expect(row(c, BULLET_LABEL).value).toBe('4001');
  });
  it('/sim 存檔那一組（1102 Lv.50＋1109 Lv.1＋1201 Lv.50）：750 (+554)、子彈 4121', () => {
    const c = card('1001', 7, 1, applied('1001', { '1102': 50, '1109': 1, '1201': 50 }));
    expect(row(c, '攻擊力').bonus).toBe('(+554)');
    expect(row(c, BULLET_LABEL).value).toBe('4121');
  });
  it('兩條所有骰子傷害 Lv.1 是相加（+30），不是連乘（150 × 1.1 × 1.1 會是 +32）', () => {
    expect(row(card('1001', 1, 1, applied('1001', { '1102': 1, '2102': 1 })), '攻擊力').bonus).toBe('(+30)');
  });
  it('花的綻放（命中時另乘）與齒輪的基本傷害（命中時 flat）併進子彈實際', () => {
    expect(row(card('1003', 1, 1, applied('1003', { '1203': 1 })), BULLET_LABEL).value).toBe('150');
    expect(row(card('2003', 1, 1, applied('2003', { '2203': 1 })), BULLET_LABEL).value).toBe('200');
  });
  it('全滿的火 7 骰點 Lv.1：750 (+8588)、子彈 29509', () => {
    const c = card('1001', 7, 1, maxed('1001'));
    expect(row(c, '攻擊力').bonus).toBe('(+8588)');
    expect(row(c, BULLET_LABEL).value).toBe('29509');
  });
});

describe('攻擊速度：每個來源各自減，0.01 秒下限前後各夾一次', () => {
  it('恐懼 1 骰點 ＋ 攻速%符文：Lv.1 → 1.091（−0.109），Lv.50 → 0.926（−0.274）', () => {
    expect(row(card('5002', 1, 1, applied('5002', { '5202': 1 })), '攻擊速度').bonus).toBe('(−0.109)');
    expect(row(card('5002', 1, 1, applied('5002', { '5202': 50 })), '攻擊速度').bonus).toBe('(−0.274)');
  });
  it('全滿的火 7 骰點：自然系兩條攻速先相加成一個來源（38.5%）→ 0.103（−0.04）', () => {
    expect(row(card('1001', 7, 1, maxed('1001')), '攻擊速度').bonus).toBe('(−0.04)');
  });
  it('兩個不同來源各 50%：1 秒 → 1/3 秒（不是 1/2）；同一個來源兩條各 50%＝一個 100% 的來源 → 1/2', () => {
    const two = [synth({ scope: 'all' }), synth({ scope: 'faction:nature' })];
    expect(row(card('1001', 1, 1, two), '攻擊速度').bonus).toBe('(−0.667)');
    const one = [synth({ scope: 'all' }), synth({ scope: 'all' })];
    expect(row(card('1001', 1, 1, one), '攻擊速度').bonus).toBe('(−0.5)');
  });
  it('下限：攻速加成大到離譜也停在 0.01 秒，攻速%符文再除一次仍是 0.01', () => {
    const huge = [synth({ value: 100000 }), synth({ target: 'bulletIntervalPct', value: 1000 })];
    expect(row(card('1001', 7, 1, huge), '攻擊速度').bonus).toBe('(−0.133)');
  });
});

describe('專屬列：成長之後才加', () => {
  it('光增益攻擊速度%增加：Lv.1 +5、Lv.50 +14.8（加百分點）', () => {
    expect(row(card('1006', 1, 1, applied('1006', { '1206': 1 })), '攻擊速度增益').bonus).toBe('(+5)');
    expect(row(card('1006', 1, 1, applied('1006', { '1206': 50 })), '攻擊速度增益').bonus).toBe('(+14.8)');
  });
  it('毒素最大疊加：覆寫成 3＋int(V)——Lv.1 是 5（+2）、Lv.50 是 54（+51）', () => {
    expect(row(card('1008', 1, 1, applied('1008', { '1208': 1 })), '最大疊加').bonus).toBe('(+2)');
    expect(row(card('1008', 1, 1, applied('1008', { '1208': 50 })), '最大疊加').bonus).toBe('(+51)');
  });
  it('減的方向與下限：換位冷卻 Lv.50 −10.3、暴君攻擊週期 −3、恐懼需要攻擊次數 −10（下限 1）', () => {
    expect(row(card('2002', 1, 1, applied('2002', { '2202': 50 })), '技能冷卻時間').bonus).toBe('(−10.3)');
    expect(row(card('5003', 1, 1, applied('5003', { '5303': 1 })), '攻擊週期').bonus).toBe('(−3)');
    expect(row(card('5002', 1, 1, applied('5002', { '5402': 1 })), '需要攻擊次數').bonus).toBe('(−10)');
    const floor = [synth({ target: 'statAdd', scope: 'dice:5002', label: '需要攻擊次數', value: -100, int: true, min: 1 })];
    expect(row(card('5002', 1, 1, floor), '需要攻擊次數').bonus).toBe('(−39)');
  });
  it('乘倍率：執行劍傷害 Lv.1 ×1.5（200% → 300%）、恐懼範圍 ×1.3（1.1 → 1.43）', () => {
    expect(row(card('4005', 1, 1, applied('4005', { '4205': 1 })), '執行劍傷害').bonus).toBe('(+100)');
    expect(row(card('5002', 1, 1, applied('5002', { '5302': 1 })), '僵硬範圍').bonus).toBe('(+0.33)');
  });
});

describe('盤面增益用的符文與施加者那一列（2b）', () => {
  it('appliedEffects 不收 board：光增益範圍（1306）不是單顆骰子的局外加成', () => {
    expect(applied('1006', { '1206': 1, '1306': 1 }).map(x => x.id)).toEqual(['1206']);
    for (const id of diceIds) expect(maxed(id).some(a => a.effect.target === 'board'), id).toBe(false);
  });
  it('施加者的增益符文加在自己那一列上：排序增幅 Lv.50 +29.5、共鳴增幅 +5、陰之和諧 +3、陽之和諧 +7', () => {
    expect(row(card('4007', 1, 1, applied('4007', { '4207': 50 })), '傷害增益量').bonus).toBe('(+29.5)');
    expect(row(card('3002', 1, 1, applied('3002', { '3202': 1 })), '攻擊速度增益量').bonus).toBe('(+5)');
    expect(row(card('4008', 1, 1, applied('4008', { '4208': 1 })), '橫排攻擊速度增加量').bonus).toBe('(+3)');
    expect(row(card('4008', 1, 1, applied('4008', { '4308': 1 })), '直排傷害增加量').bonus).toBe('(+7)');
  });
  it('rowValue：套上局外加成之後的數值（跟卡片那一列同一個數）；列不存在或不是數字回 null', () => {
    expect(rowValue(params('1006'), '攻擊速度增益', 1, 1, [])).toBe(6);
    expect(rowValue(params('1006'), '攻擊速度增益', 7, 1, applied('1006', { '1206': 50 }))).toBe(38.8);
    expect(rowValue(params('4007'), '傷害增益量', 1, 1, applied('4007', { '4207': 1 }))).toBe(25);
    expect(rowValue(params('1001'), '目標', 1, 1, [])).toBeNull();
    expect(rowValue(params('1001'), '沒有這一列', 1, 1, [])).toBeNull();
  });
});

describe('盤面加成合進卡片（2b）', () => {
  const bb = (over: Partial<BoardBonus>): BoardBonus => ({ ...NO_BOARD, ...over });
  const cardB = (diceId: string, pips: number, lv: number, a: readonly AppliedEffect[], b: BoardBonus) =>
    bonusCardModel(nodes[diceId]!.name, pips, lv, params(diceId), a, b);

  it('傳 NO_BOARD 跟不傳完全相同（每顆骰子 × 骰點 1／7 × 強化 Lv 1／15 × 不含／全滿）', () => {
    for (const id of diceIds) {
      for (const pips of [1, 7]) {
        for (const lv of [1, 15]) {
          for (const a of [[], maxed(id)]) expect(cardB(id, pips, lv, a, NO_BOARD), `${id} ${pips}/${lv}`).toEqual(card(id, pips, lv, a));
        }
      }
    }
  });
  it('盤面攻擊% 與被動同一個池：各 0.3% 合起來 0.9 → +1（分開 ceil 會是 +2）', () => {
    expect(row(cardB('1001', 1, 1, [synth({ target: 'attackPct', value: 0.3 })], bb({ attackPct: 0.3 })), '攻擊力').bonus).toBe('(+1)');
  });
  it('陰陽直排走狀態效果池、另外 ceil：攻擊% 0.3 ＋ 狀態 0.3 → +2；狀態 50% → +75', () => {
    expect(row(cardB('1001', 1, 1, [], bb({ attackPct: 0.3, statusPct: 0.3 })), '攻擊力').bonus).toBe('(+2)');
    expect(row(cardB('1001', 1, 1, [], bb({ statusPct: 50 })), '攻擊力').bonus).toBe('(+75)');
  });
  it('每個盤面攻速來源各自減：兩個 50% → 1/3 秒；被動一個＋盤面一個也是兩個來源', () => {
    expect(row(cardB('1001', 1, 1, [], bb({ intervalPcts: [50, 50] })), '攻擊速度').bonus).toBe('(−0.667)');
    expect(row(cardB('1001', 1, 1, [synth({ scope: 'all' })], bb({ intervalPcts: [50] })), '攻擊速度').bonus).toBe('(−0.667)');
  });
  it('霓虹在攻速%符文之後再除：霓虹 100% → 0.5 秒；再加攻速%符文 100% → 0.25 秒', () => {
    expect(row(cardB('1001', 1, 1, [], bb({ neonPct: 100 })), '攻擊速度').bonus).toBe('(−0.5)');
    const rune = [synth({ target: 'bulletIntervalPct', value: 100 })];
    expect(row(cardB('1001', 1, 1, rune, bb({ neonPct: 100 })), '攻擊速度').bonus).toBe('(−0.75)');
  });
  it('下限：盤面攻速大到離譜、霓虹再除，仍停在 0.01 秒', () => {
    expect(row(cardB('1001', 7, 1, [], bb({ intervalPcts: [100000], neonPct: 1000 })), '攻擊速度').bonus).toBe('(−0.133)');
  });
  it('子彈實際吃含盤面的面板值（900 × 3.16 → 2844）；只有盤面加成時不多出子彈行', () => {
    const c = cardB('1001', 7, 1, applied('1001', { '1201': 50 }), bb({ attackPct: 20 }));
    expect(row(c, '攻擊力').bonus).toBe('(+150)');
    expect(row(c, BULLET_LABEL).value).toBe('2844');
    expect(cardB('1001', 7, 1, [], bb({ attackPct: 20 })).rows.map(r => r.label)).not.toContain(BULLET_LABEL);
  });
});

describe('明細面板', () => {
  it('全滿的火 7 骰點：同名同類合成一行、單一節點帶等級；機制符文印描述', () => {
    const d = detailLines(params('1001'), 7, 1, maxed('1001'));
    for (const line of [
      '所有骰子傷害 ×15：攻擊 +1026%',
      '自然骰子傷害 ×2：攻擊 +119%',
      '自然骰子攻擊速度 ×2：攻速 +38.5%',
      '自然骰子暴擊率 Lv.10：暴擊率 +4.55%',
      '子彈傷害%增加 Lv.50：子彈 ×3.16',
    ]) expect(d.offgame).toContain(line);
    expect(d.mechanic).toEqual([
      '火焰射程增加：範圍傷害套用範圍大幅增加',
      '獲得燙傷：基本攻擊擊中時，賦予燙傷 7骰點為2倍的燙傷傷害',
    ]);
  });
  it('/sim 存檔那一組：兩行，照節點 id 的先後', () => {
    expect(detailLines(params('1001'), 7, 1, applied('1001', { '1102': 50, '1109': 1, '1201': 50 })))
      .toEqual({ offgame: ['所有骰子傷害 ×2：攻擊 +73.8%', '子彈傷害%增加 Lv.50：子彈 ×3.16'], mechanic: [] });
  });
  it('列加值帶該列的單位；覆寫印結果；機制 template 換成當前等級的值', () => {
    expect(detailLines(params('2002'), 1, 1, applied('2002', { '2202': 50 })).offgame)
      .toEqual(['換位骰子冷卻減少 Lv.50：技能冷卻時間 −10.3s']);
    expect(detailLines(params('1008'), 1, 1, applied('1008', { '1208': 1 })).offgame)
      .toEqual(['毒素最大疊加增加 Lv.1：最大疊加 5']);
    expect(detailLines(params('1002'), 1, 1, applied('1002', { '1202': 50 })).mechanic)
      .toEqual(['尖刺+3 Lv.50：14.8% 機率額外產生 3 個尖刺']);
  });
  it('沒有任何節點時兩邊都是空的', () => {
    expect(detailLines(params('1001'), 1, 1, [])).toEqual({ offgame: [], mechanic: [] });
  });
});

describe('等級來源與套用範圍', () => {
  const e = effects['1201']!;
  it('levelSource：不含＝0、全滿＝上限、存檔＝手上有的那顆的等級（沒存等級＝1）', () => {
    expect(levelSource('none', null)('1201', e)).toBe(0);
    expect(levelSource('max', null)('1201', e)).toBe(50);
    const save = { owned: new Set(['1201', '1301']), levels: new Map([['1201', 12]]) };
    expect(levelSource('sim', save)('1201', e)).toBe(12);
    expect(levelSource('sim', save)('1301', effects['1301']!)).toBe(1);
    expect(levelSource('sim', save)('1401', effects['1401']!)).toBe(0);
    expect(levelSource('sim', null)('1201', e)).toBe(0);
  });
  it('appliedEffects：只收作用在這顆骰子上的；等級夾到上限；照 id 排序', () => {
    const a = applied('1001', { '1201': 999, '1205': 50, '1101': 1, '3102': 1 });
    expect(a.map(x => x.id)).toEqual(['1101', '1201']);
    expect(a.find(x => x.id === '1201')!.level).toBe(50);
  });
});

describe('真實資料的單一來源守門', () => {
  // 多來源時的疊法——statMul 連乘、hitAttackFlat 逐筆進位、statSet 後寫蓋前寫、min 逐筆夾，以及同一顆骰子
  // 命中時的倍率與定值誰先誰後——既沒有逆向依據、也沒有測試，現在只是「程式剛好這樣寫」。真實資料目前每一種
  // 都只有單一來源，所以卡片上的數字不受影響；產生腳本哪天產出多來源，這條先紅，逼人先去查客戶端怎麼疊。
  it('每個 (scope, label) 最多一筆改列的效果；每顆骰子最多一筆命中時的子彈加成', () => {
    const rows = new Map<string, string[]>();
    for (const [id, e] of Object.entries(effects)) {
      if (!ROW_TARGETS.includes(e.target)) continue;
      const k = `${e.scope} ${e.label}`;
      rows.set(k, [...(rows.get(k) ?? []), id]);
    }
    expect(rows.size, '正向控制：真實資料裡有改列的效果').toBeGreaterThan(0);
    expect([...rows].filter(([, ids]) => ids.length > 1)).toEqual([]);

    let withHit = 0;
    for (const id of diceIds) {
      const hits = maxed(id).filter(a => a.effect.target === 'hitAttackMul' || a.effect.target === 'hitAttackFlat');
      expect(hits.length, `${id}：${hits.map(a => a.id).join('、')}`).toBeLessThanOrEqual(1);
      if (hits.length > 0) withHit++;
    }
    expect(withHit, '正向控制：真實資料裡有命中時的子彈加成').toBeGreaterThan(0);
  });
});

describe('小工具', () => {
  it('numericAt：非數字的常數回 null；常數、攻擊間隔、線性各自取值', () => {
    const p = params('1001');
    expect(numericAt(p.find(x => x.label === '目標')!, 1, 1)).toBeNull();
    expect(numericAt(params('1008').find(x => x.label === '最大疊加')!, 1, 1)).toEqual({ value: 3, unit: '', decimals: 0 });
    expect(numericAt(p.find(x => x.label === '攻擊速度')!, 7, 1)!.value).toBeCloseTo(1 / 7, 9);
    expect(numericAt(p.find(x => x.label === '攻擊力')!, 7, 1)).toEqual({ value: 750, unit: '', decimals: 0 });
  });
  it('formatDelta：四捨五入後是 0 就 null；負號是 U+2212', () => {
    expect(formatDelta(0.0004, 3)).toBeNull();
    expect(formatDelta(516, 0)).toBe('(+516)');
    expect(formatDelta(-0.109, 3)).toBe('(−0.109)');
  });
});
