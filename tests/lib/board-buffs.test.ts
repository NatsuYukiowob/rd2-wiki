import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ALIGNMENT_ID, GEAR_SECOND_ID, emptyBoard,
  type Board, type Dir, type GearKind, type Placed,
} from '../../src/lib/board';
import {
  BINGO_ID, BOARD_RUNES, BUFF_ROWS, GEAR_ID, LIGHT_ID, NEON_ID, NO_BUFFS, RESONANCE_ID,
  boardBuffs, boardRunes, buffHighlights, pendingHint, ray,
  type CellBuffs,
} from '../../src/lib/board-buffs';
import { deriveTable, numericAt, type StatParams } from '../../src/lib/dice-calc';
import { namedEffects, type OffgameFile } from '../../src/lib/offgame';
import { appliedEffects, bonusCardModel, levelSource, type AppliedEffect } from '../../src/lib/offgame-calc';
import { branchOfId } from '../../src/lib/taxonomy';
import type { DiceStatsTable } from '../../src/lib/types';

const nodes = JSON.parse(readFileSync('data/nodes.json', 'utf8')) as
  Record<string, { name: string; type: string; gameId: string; description: string }>;
const derived = deriveTable(JSON.parse(readFileSync('data/dice-stats.json', 'utf8')) as DiceStatsTable);
const effects = namedEffects(JSON.parse(readFileSync('data/offgame-effects.json', 'utf8')) as OffgameFile, nodes);
const params = (id: string): StatParams[] => derived[nodes[id]!.gameId] ?? [];

const FIRE = '1001';
const dice = (diceId: string, pips = 1): Placed => ({ diceId, pips });
const align = (pips: number, dir?: Dir): Placed =>
  (dir === undefined ? dice(ALIGNMENT_ID, pips) : { ...dice(ALIGNMENT_ID, pips), dir });
const gear2 = (pips: number, gear?: GearKind): Placed =>
  (gear === undefined ? dice(GEAR_SECOND_ID, pips) : { ...dice(GEAR_SECOND_ID, pips), gear });

/** 指定格子放指定骰子，其餘空。 */
function boardOf(cells: Record<number, Placed>): Board {
  const b = [...emptyBoard()];
  for (const [i, p] of Object.entries(cells)) b[Number(i)] = p;
  return b;
}
/** 指定的格子以外，其餘全放火骰子 1 骰點——量「加成落在哪幾格」用。 */
function filled(cells: Record<number, Placed>): Board {
  return boardOf({ ...Object.fromEntries([...Array(15).keys()].map(i => [i, dice(FIRE)])), ...cells });
}

/** 局外節點只開 levels 指定的那幾顆（沒寫＝沒解開），強化 Lv 預設 1。 */
function run(board: Board, levels: Record<string, number> = {}, sp: Record<string, number> = {}): CellBuffs[] {
  const levelOf = (id: string) => levels[id] ?? 0;
  return boardBuffs({
    board,
    params,
    spLevel: id => sp[id] ?? 1,
    applied: id => appliedEffects(id, branchOfId(id), effects, levelOf),
    rune: boardRunes(effects, levelOf),
  });
}
const withKind = (cells: readonly CellBuffs[], kind: string): number[] =>
  cells.flatMap((c, i) => (c.entries.some(e => e.kind === kind) ? [i] : []));
const texts = (c: CellBuffs): string[] => c.entries.map(e => e.text);

describe('真實資料守門：施加者的列與盤面符文', () => {
  it('每個施加者那一列都在 dice-stats.json 裡、而且是數字', () => {
    const rows: [string, string][] = [
      [LIGHT_ID, BUFF_ROWS.light], [ALIGNMENT_ID, BUFF_ROWS.alignment], [RESONANCE_ID, BUFF_ROWS.resonance],
      [BINGO_ID, BUFF_ROWS.bingoRow], [BINGO_ID, BUFF_ROWS.bingoCol], [GEAR_SECOND_ID, BUFF_ROWS.gearSpeed],
    ];
    for (const [id, label] of rows) {
      const p = params(id).find(x => x.label === label);
      expect(p, `${id} 沒有「${label}」這一列`).toBeDefined();
      expect(numericAt(p!, 1, 1), `${id}「${label}」不是數字`).not.toBeNull();
    }
  });
  it('盤面符文的 target 是 board、scope 對得到骰子；施加者的增益符文是加在那一列上的 statAdd', () => {
    const scopes: Record<string, string> = {
      [BOARD_RUNES.lightArea]: LIGHT_ID, [BOARD_RUNES.neonSpeed]: NEON_ID, [BOARD_RUNES.neonOne]: NEON_ID,
      [BOARD_RUNES.gearLink]: GEAR_ID, [BOARD_RUNES.resonanceTrio]: RESONANCE_ID, [BOARD_RUNES.alignmentStack]: ALIGNMENT_ID,
    };
    for (const [id, diceId] of Object.entries(scopes)) {
      expect(effects[id], id).toMatchObject({ target: 'board', scope: `dice:${diceId}` });
    }
    const rows: Record<string, [string, string]> = {
      '1206': [LIGHT_ID, BUFF_ROWS.light], '4207': [ALIGNMENT_ID, BUFF_ROWS.alignment],
      '3202': [RESONANCE_ID, BUFF_ROWS.resonance], '4208': [BINGO_ID, BUFF_ROWS.bingoRow], '4308': [BINGO_ID, BUFF_ROWS.bingoCol],
    };
    for (const [id, [diceId, label]] of Object.entries(rows)) {
      expect(effects[id], id).toMatchObject({ target: 'statAdd', scope: `dice:${diceId}`, label });
    }
  });
});

describe('光', () => {
  it('四鄰：角落 2 格、邊 3 格、中央 4 格；空格不算', () => {
    expect(withKind(run(filled({ 0: dice(LIGHT_ID) })), 'light')).toEqual([1, 5]);
    expect(withKind(run(filled({ 2: dice(LIGHT_ID) })), 'light')).toEqual([1, 3, 7]);
    expect(withKind(run(filled({ 7: dice(LIGHT_ID) })), 'light')).toEqual([2, 6, 8, 12]);
    expect(run(boardOf({ 7: dice(LIGHT_ID) }))).toEqual(Array(15).fill(NO_BUFFS));
  });
  it('有光增益範圍（1306）→ 八鄰', () => {
    expect(withKind(run(filled({ 7: dice(LIGHT_ID) }), { '1306': 1 }), 'light')).toEqual([1, 2, 3, 6, 8, 11, 12, 13]);
  });
  it('同格的光先相加成一個攻速來源（7 骰點 24% ＋ 1 骰點 6%＝30%）；7 骰點的光另列暴擊率', () => {
    const c = run(boardOf({ 0: dice(LIGHT_ID), 1: dice(FIRE), 2: dice(LIGHT_ID, 7) }))[1]!;
    expect(c.intervalPcts).toEqual([30]);
    expect(texts(c)).toEqual(['鄰格光 ×2：攻速 +30%', '鄰格 7 點光 ×1：暴擊率 +10%']);
    expect(c.entries.map(e => e.from)).toEqual([[0, 2], [2]]);
  });
  it('光增益攻擊速度%增加（1206）從光自己那一列進來：Lv.50 → 20.8%；光的強化 Lv 也算進去（Lv.5 → 10%）', () => {
    const b = boardOf({ 0: dice(LIGHT_ID), 1: dice(FIRE) });
    expect(run(b, { '1206': 50 })[1]!.intervalPcts).toEqual([20.8]);
    expect(run(b, {}, { [LIGHT_ID]: 5 })[1]!.intervalPcts).toEqual([10]);
  });
});

describe('排序', () => {
  const hit = (cells: readonly CellBuffs[]) => cells.flatMap((c, i) => (c.attackPct > 0 ? [i] : []));
  it('射線：自己往方向到盤緣、不含自己；7 骰點四向；「?」不套用', () => {
    expect(ray(7, 0)).toEqual([2]);
    expect(ray(7, 1)).toEqual([8, 9]);
    expect(ray(7, 2)).toEqual([12]);
    expect(ray(7, 3)).toEqual([6, 5]);
    expect(ray(0, 0)).toEqual([]);
    expect(hit(run(filled({ 7: align(1, 1) })))).toEqual([8, 9]);
    expect(hit(run(filled({ 7: align(1, 3) })))).toEqual([5, 6]);
    expect(hit(run(filled({ 7: align(7) })))).toEqual([2, 5, 6, 8, 9, 12]);
    expect(hit(run(filled({ 7: align(1) })))).toEqual([]);
  });
  it('值＝排序那一列（1 骰點 20%、7 骰點 260%）＋排序增幅（4207 Lv.1 → 25%）', () => {
    expect(run(filled({ 7: align(1, 1) }))[8]!.attackPct).toBe(20);
    expect(run(filled({ 7: align(7) }))[8]!.attackPct).toBe(260);
    expect(run(filled({ 7: align(1, 1) }), { '4207': 1 })[8]!.attackPct).toBe(25);
  });
  it('同格兩顆排序相加；排序疊加強化（4307）× 層數，1 層也算', () => {
    const b = boardOf({ 0: align(1, 1), 6: align(1, 0), 1: dice(FIRE) });
    const plain = run(b)[1]!;
    expect(plain.attackPct).toBe(40);
    expect(texts(plain)).toEqual(['排序（第 1 列第 1 格 →）：攻擊 +20%', '排序（第 2 列第 2 格 ↑）：攻擊 +20%']);
    const stacked = run(b, { '4307': 1 })[1]!;
    expect(stacked.attackPct).toBe(60);
    expect(texts(stacked)[2]).toBe('排序疊加強化 ×2：攻擊 +20%');
    expect(run(boardOf({ 0: align(1, 1), 1: dice(FIRE) }), { '4307': 1 })[1]!.attackPct).toBe(30);
  });
  it('7 骰點的排序在明細寫「四向」', () => {
    expect(texts(run(boardOf({ 0: align(7), 1: dice(FIRE) }))[1]!)).toEqual(['排序（第 1 列第 1 格 四向）：攻擊 +260%']);
  });
});

describe('共鳴', () => {
  it('同骰點的骰子（含共鳴自己）拿攻速；別的骰點沒有', () => {
    const cells = run(boardOf({ 0: dice(RESONANCE_ID, 3), 1: dice(FIRE, 3), 2: dice(FIRE, 2) }));
    expect(cells[0]!.intervalPcts).toEqual([8]);
    expect(cells[1]!.intervalPcts).toEqual([8]);
    expect(cells[2]).toEqual(NO_BUFFS);
    expect(texts(cells[1]!)).toEqual(['共鳴（3 骰點 ×1）：攻速 +8%']);
    expect(cells[1]!.entries[0]!.from).toEqual([0]);
    expect(cells[0]!.entries[0]!.from, '自己不算來源格').toEqual([]);
  });
  it('7 骰點的共鳴給全盤', () => {
    const cells = run(boardOf({ 0: dice(RESONANCE_ID, 7), 1: dice(FIRE, 2), 14: dice(FIRE, 5) }));
    for (const i of [0, 1, 14]) expect(cells[i]!.intervalPcts, `第 ${i} 格`).toEqual([20]);
  });
  it('共鳴增幅（3202）從共鳴那一列進來：3 骰點 8% → 13%', () => {
    expect(run(boardOf({ 0: dice(RESONANCE_ID, 3), 1: dice(FIRE, 3) }), { '3202': 1 })[1]!.intervalPcts).toEqual([13]);
  });
  it('三重共鳴（3402）：同骰點共鳴 ≥3 顆才加，每顆 10%；剛好 2 顆不加', () => {
    const three = run(boardOf({
      0: dice(RESONANCE_ID, 2), 1: dice(RESONANCE_ID, 2), 2: dice(RESONANCE_ID, 2), 3: dice(FIRE, 2),
    }), { '3402': 1 })[3]!;
    expect(three.attackPct).toBe(30);
    expect(three.intervalPcts).toEqual([15]);
    expect(texts(three)).toEqual(['共鳴（2 骰點 ×3）：攻速 +15%', '三重共鳴（2 骰點 ×3）：攻擊 +30%']);
    const two = run(boardOf({ 0: dice(RESONANCE_ID, 2), 1: dice(RESONANCE_ID, 2), 3: dice(FIRE, 2) }), { '3402': 1 })[3]!;
    expect(two.attackPct).toBe(0);
  });
  it('7 骰點共鳴的三重共鳴數的是盤上全部共鳴（客戶端 CountSameLevelResonanceDice）：7 骰點 ×1 ＋ 2 骰點 ×2 → 全盤 +10%', () => {
    const cells = run(boardOf({
      0: dice(RESONANCE_ID, 7), 1: dice(RESONANCE_ID, 2), 2: dice(RESONANCE_ID, 2), 3: dice(FIRE, 5),
    }), { '3402': 1 });
    expect(cells[3]!.attackPct).toBe(10);
    expect(texts(cells[3]!)).toEqual(['共鳴（7 骰點 ×1）：攻速 +20%', '三重共鳴（7 骰點 ×1）：攻擊 +10%']);
    expect(cells[1]!.attackPct, '2 骰點那組只有 2 顆不成立，但 7 骰點那顆照樣給').toBe(10);
  });
});

describe('陰陽', () => {
  const bingoRow = (): Record<number, Placed> => ({ 0: dice(BINGO_ID), 1: dice(BINGO_ID), 2: dice(BINGO_ID), 3: dice(BINGO_ID), 4: dice(BINGO_ID) });
  it('自己那一列 5 格全是陰陽 → 攻速（橫排那一列 50%；陰之和諧 4208 Lv.1 → 53%）', () => {
    const cells = run(boardOf(bingoRow()));
    for (const i of [0, 1, 2, 3, 4]) expect(cells[i]!.intervalPcts, `第 ${i} 格`).toEqual([50]);
    expect(texts(cells[0]!)).toEqual(['陰陽橫排：攻速 +50%']);
    expect(cells[0]!.entries[0]!.from).toEqual([1, 2, 3, 4]);
    expect(run(boardOf(bingoRow()), { '4208': 1 })[0]!.intervalPcts).toEqual([53]);
  });
  it('差一格或混進別的骰子都沒有', () => {
    expect(run(boardOf({ ...bingoRow(), 4: dice(FIRE) }))[0]).toEqual(NO_BUFFS);
    const { 4: _gone, ...four } = bingoRow();
    expect(run(boardOf(four))[0]).toEqual(NO_BUFFS);
  });
  it('自己那一欄 3 格全是陰陽 → 狀態效果池（直排那一列：3 骰點 150%；陽之和諧 4308 Lv.1 → 157%）', () => {
    const col = { 0: dice(BINGO_ID, 3), 5: dice(BINGO_ID), 10: dice(BINGO_ID) };
    const cells = run(boardOf(col));
    expect(cells[0]!.statusPct).toBe(150);
    expect(cells[0]!.intervalPcts).toEqual([]);
    expect(cells[5]!.statusPct).toBe(50);
    expect(texts(cells[0]!)).toEqual(['陰陽直排：攻擊 +150%']);
    expect(run(boardOf(col), { '4308': 1 })[0]!.statusPct).toBe(157);
  });
});

describe('齒輪', () => {
  it('四鄰相連（斜角不算）的齒輪數 × 5%，1 顆沒有；沒有齒輪連接加速（2403）就沒有', () => {
    const b = boardOf({ 0: dice(GEAR_ID), 1: dice(GEAR_ID), 3: dice(GEAR_ID), 9: dice(GEAR_ID) });
    const cells = run(b, { '2403': 1 });
    expect(cells[0]!.intervalPcts).toEqual([10]);
    expect(cells[1]!.intervalPcts).toEqual([10]);
    expect(cells[3], '第 3 格與第 9 格只有斜角相鄰').toEqual(NO_BUFFS);
    expect(cells[9]).toEqual(NO_BUFFS);
    expect(texts(cells[0]!)).toEqual(['齒輪相連 ×2：攻速 +10%']);
    expect(run(b)[0]).toEqual(NO_BUFFS);
  });
  it('三顆連成一串：15%', () => {
    expect(run(boardOf({ 0: dice(GEAR_ID), 1: dice(GEAR_ID), 6: dice(GEAR_ID) }), { '2403': 1 })[6]!.intervalPcts).toEqual([15]);
  });
});

describe('齒輪二階', () => {
  it('群組裡每一顆（含「?」）都拿到變速齒輪那一列的加總；強化、動力、「?」不算變速', () => {
    const cells = run(boardOf({ 0: gear2(1, 'speed'), 1: gear2(1, 'power'), 2: gear2(1), 3: gear2(1, 'reinforce') }));
    for (const i of [0, 1, 2, 3]) expect(cells[i]!.intervalPcts, `第 ${i} 格`).toEqual([5]);
    expect(texts(cells[1]!)).toEqual(['齒輪二階變速 ×1：攻速 +5%']);
    expect(cells[1]!.entries[0]!.from).toEqual([0]);
  });
  it('7 骰點算變速（5 ＋ 6＝11%）', () => {
    const cells = run(boardOf({ 0: gear2(7), 1: gear2(1, 'reinforce') }));
    expect(cells[0]!.intervalPcts).toEqual([11]);
    expect(cells[1]!.intervalPcts).toEqual([11]);
  });
  it('單獨一顆沒有；群組裡沒有變速也沒有；只經由齒輪二階相連（中間隔一顆齒輪就斷）', () => {
    expect(run(boardOf({ 0: gear2(3, 'speed') }))[0]).toEqual(NO_BUFFS);
    expect(run(boardOf({ 0: gear2(1, 'power'), 1: gear2(1, 'reinforce') }))[0]).toEqual(NO_BUFFS);
    expect(run(boardOf({ 0: gear2(1, 'speed'), 1: dice(GEAR_ID), 2: gear2(1) }))[2]).toEqual(NO_BUFFS);
  });
});

describe('霓虹', () => {
  const neons = (n: number, firstPips = 1): Board =>
    boardOf(Object.fromEntries([...Array(n).keys()].map(i => [i, dice(NEON_ID, i === 0 ? firstPips : 1)])));
  it('盤上恰好 3／5／7 顆才啟用（2205 Lv.1 → 子彈攻速 20%）；1／2／4／6 顆不啟用', () => {
    const on = (n: number) => run(neons(n), { '2205': 1 })[0]!.neonPct;
    expect([1, 2, 3, 4, 5, 6, 7].map(on)).toEqual([0, 0, 20, 0, 20, 0, 20]);
    expect(texts(run(neons(3), { '2205': 1 })[0]!)).toEqual(['霓虹啟用（盤上 3 顆）：子彈攻速 +20%']);
  });
  it('7 骰點的那顆恆啟用（盤上 2 顆時，只有它；明細寫「7 骰點」、不列來源格）；顆數也成立時照顆數寫', () => {
    const cells = run(neons(2, 7), { '2205': 1 });
    expect(cells[0]!.neonPct).toBe(20);
    expect(cells[1]!.neonPct).toBe(0);
    expect(texts(cells[0]!)).toEqual(['霓虹啟用（7 骰點）：子彈攻速 +20%']);
    expect(cells[0]!.entries[0]!.from).toEqual([]);
    const three = run(neons(3, 7), { '2205': 1 })[0]!;
    expect(texts(three)).toEqual(['霓虹啟用（盤上 3 顆）：子彈攻速 +20%']);
    expect(three.entries[0]!.from).toEqual([1, 2]);
  });
  it('有啟用 1 格霓虹（2305）時 1 顆也啟用、2 顆仍不啟用；沒有 2205 就沒有', () => {
    expect(run(neons(1), { '2205': 1, '2305': 1 })[0]!.neonPct).toBe(20);
    expect(run(neons(2), { '2205': 1, '2305': 1 })[0]!.neonPct).toBe(0);
    expect(run(neons(3))[0]).toEqual(NO_BUFFS);
  });
});

describe('高亮與明細提示', () => {
  it('buffHighlights：開光照到的格子 → 光是來源；開光 → 它照到的格子是目標；自己不標', () => {
    const cells = run(boardOf({ 7: dice(LIGHT_ID), 2: dice(FIRE), 12: dice(FIRE) }));
    expect(buffHighlights(cells, 2)).toEqual({ src: [7], dst: [] });
    expect(buffHighlights(cells, 7)).toEqual({ src: [], dst: [2, 12] });
    expect(buffHighlights(cells, 0)).toEqual({ src: [], dst: [] });
  });
  it('buffHighlights：排序朝右 → 射線上有骰子的格子是目標', () => {
    const cells = run(boardOf({ 0: align(1, 1), 1: dice(FIRE), 3: dice(FIRE) }));
    expect(buffHighlights(cells, 0)).toEqual({ src: [], dst: [1, 3] });
    expect(buffHighlights(cells, 3)).toEqual({ src: [0], dst: [] });
  });
  it('pendingHint：只有 7 骰點以下、還沒指定的排序／齒輪二階才有', () => {
    expect(pendingHint(align(3))).toBe('方向未指定，點左上角標切換');
    expect(pendingHint(align(3, 2))).toBeNull();
    expect(pendingHint(align(7))).toBeNull();
    expect(pendingHint(gear2(1))).toBe('種類未指定，點左上角標切換');
    expect(pendingHint(gear2(1, 'power'))).toBeNull();
    expect(pendingHint(dice(FIRE))).toBeNull();
    expect(pendingHint(null)).toBeNull();
  });
});

describe('合進卡片（真實資料）', () => {
  const fireCard = (pips: number, cell: CellBuffs, a: readonly AppliedEffect[] = []) =>
    bonusCardModel('火骰子', pips, 1, params(FIRE), a, cell);
  const rowNamed = (c: ReturnType<typeof fireCard>, label: string) => c.rows.find(r => r.label === label)!;

  it('火 7 骰點旁邊一顆 1 骰點的光（局外「不含」）：0.143 秒/次 (−0.008)', () => {
    const cells = run(boardOf({ 6: dice(FIRE, 7), 7: dice(LIGHT_ID) }));
    expect(rowNamed(fireCard(7, cells[6]!), '攻擊速度')).toMatchObject({ value: '0.143 秒/次', bonus: '(−0.008)' });
  });
  it('同一組換成「全滿」：光那一列 20.8%、火自己的自然系攻速 38.5% → (−0.064)', () => {
    const levelOf = levelSource('max', null);
    const cells = boardBuffs({
      board: boardOf({ 6: dice(FIRE, 7), 7: dice(LIGHT_ID) }),
      params,
      spLevel: () => 1,
      applied: id => appliedEffects(id, branchOfId(id), effects, levelOf),
      rune: boardRunes(effects, levelOf),
    });
    const a = appliedEffects(FIRE, branchOfId(FIRE), effects, levelOf);
    expect(rowNamed(fireCard(7, cells[6]!, a), '攻擊速度').bonus).toBe('(−0.064)');
  });
  it('排序 1 骰點朝右、火 1 骰點在射線上：150 (+30)', () => {
    const cells = run(boardOf({ 0: align(1, 1), 2: dice(FIRE) }));
    expect(rowNamed(fireCard(1, cells[2]!), '攻擊力')).toMatchObject({ value: '150', bonus: '(+30)' });
  });
  it('陰陽直排 3 顆 1 骰點：陰陽 150 (+75)', () => {
    const cells = run(boardOf({ 0: dice(BINGO_ID), 5: dice(BINGO_ID), 10: dice(BINGO_ID) }));
    const c = bonusCardModel('陰陽骰子', 1, 1, params(BINGO_ID), [], cells[0]!);
    expect(c.rows.find(r => r.label === '攻擊力')!.bonus).toBe('(+75)');
  });
});
