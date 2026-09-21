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
/** 合作模式：兩盤各自的局外等級可以不同（隊友預設全滿＝levels 給大數）。 */
function runCoop(
  board: Board,
  partnerBoard: Board,
  levels: Record<string, number> = {},
  partnerLevels: Record<string, number> = levels,
  sp: Record<string, number> = {},
  partnerSp: Record<string, number> = sp,
): CellBuffs[] {
  const levelOf = (id: string) => levels[id] ?? 0;
  const pLevelOf = (id: string) => partnerLevels[id] ?? 0;
  return boardBuffs({
    board,
    params,
    spLevel: id => sp[id] ?? 1,
    applied: id => appliedEffects(id, branchOfId(id), effects, levelOf),
    rune: boardRunes(effects, levelOf),
    partner: {
      board: partnerBoard,
      params,
      spLevel: id => partnerSp[id] ?? 1,
      applied: id => appliedEffects(id, branchOfId(id), effects, pLevelOf),
      rune: boardRunes(effects, pLevelOf),
    },
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
    expect(buffHighlights(cells, 2)).toEqual({ src: [7], dst: [], srcPartner: [], dstPartner: [] });
    expect(buffHighlights(cells, 7)).toEqual({ src: [], dst: [2, 12], srcPartner: [], dstPartner: [] });
    expect(buffHighlights(cells, 0)).toEqual({ src: [], dst: [], srcPartner: [], dstPartner: [] });
  });
  it('buffHighlights：排序朝右 → 射線上有骰子的格子是目標', () => {
    const cells = run(boardOf({ 0: align(1, 1), 1: dice(FIRE), 3: dice(FIRE) }));
    expect(buffHighlights(cells, 0)).toEqual({ src: [], dst: [1, 3], srcPartner: [], dstPartner: [] });
    expect(buffHighlights(cells, 3)).toEqual({ src: [0], dst: [], srcPartner: [], dstPartner: [] });
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

describe('合作雙盤：介面', () => {
  it('每一個 entry 都有 fromPartner，對戰模式一律是空陣列', () => {
    const board = filled({ 0: dice(LIGHT_ID), 6: dice(FIRE) });
    const cells = run(board);
    const all = cells.flatMap(c => c.entries);
    expect(all.length).toBeGreaterThan(0);
    for (const e of all) expect(e.fromPartner).toEqual([]);
  });

  it('傳 partner 但兩條跨盤規則都用不到時，結果與不傳 partner 完全相同', () => {
    // 隊友盤擺滿光：光不跨盤，所以我的盤一格都不該變。
    const mine = filled({ 7: dice(FIRE) });
    const theirs = filled({ 0: dice(LIGHT_ID), 1: dice(LIGHT_ID), 2: dice(LIGHT_ID) });
    expect(runCoop(mine, theirs)).toEqual(run(mine));
  });
});

describe('合作雙盤：跨盤排序', () => {
  // 盤面座標：index = row * 5 + col。第 0 欄＝index 0/5/10。
  it('隊友盤同欄的方向 0 排序骰，加到我這一欄的整欄三格；其他欄不吃', () => {
    const mine = filled({});
    const theirs = boardOf({ 7: align(1, 0) });   // 隊友第 1 列第 2 欄（col 2），方向 0
    const cells = runCoop(mine, theirs);
    expect(withKind(cells, 'alignment')).toEqual([2, 7, 12]);   // 我的 col 2 整欄
  });

  it('是同欄不是鏡像欄：隊友盤 col 0 的方向 0 排序骰，只加到我的 col 0，col 4（鏡像＝4−0）不吃', () => {
    const theirs = boardOf({ 5: align(1, 0) });   // 隊友第 2 列第 1 欄（col 0），方向 0
    const cells = runCoop(filled({}), theirs);
    // 若過濾條件誤寫成鏡像公式（4 − col(j) === myCol），這裡會算出 [4, 9, 14] 而不是 [0, 5, 10]。
    expect(withKind(cells, 'alignment')).toEqual([0, 5, 10]);
  });

  it('隊友那顆在自己盤最上排（盤內方向 0 沒有目標）時，我這一欄照樣吃到', () => {
    const theirs = boardOf({ 2: align(1, 0) });   // 隊友 row 0、col 2
    const cells = runCoop(filled({}), theirs);
    expect(withKind(cells, 'alignment')).toEqual([2, 7, 12]);
  });

  it('隊友盤的方向 1／2／3 不跨盤，方向未指定也不跨盤', () => {
    for (const d of [1, 2, 3] as const) {
      expect(withKind(runCoop(filled({}), boardOf({ 7: align(1, d) })), 'alignment')).toEqual([]);
    }
    expect(withKind(runCoop(filled({}), boardOf({ 7: align(1) })), 'alignment')).toEqual([]);
  });

  it('隊友盤的 7 骰點排序骰四向全開，跨盤照樣只給同一欄', () => {
    const cells = runCoop(filled({}), boardOf({ 7: dice(ALIGNMENT_ID, 7) }));
    expect(withKind(cells, 'alignment')).toEqual([2, 7, 12]);
  });

  it('雙向：換成從隊友盤的視角算，我的排序骰一樣打到他的同一欄', () => {
    const mine = boardOf({ 7: align(1, 0) });
    const theirs = filled({});
    // 隊友盤的那一份＝把兩邊對調再算一次（Task 8 的 buffsOf() 就是這樣呼叫的）
    expect(withKind(runCoop(theirs, mine), 'alignment')).toEqual([2, 7, 12]);
  });

  it('跨盤來源記在 fromPartner，不混進 from', () => {
    const cells = runCoop(filled({}), boardOf({ 7: align(1, 0) }));
    const e = cells[2]!.entries.find(x => x.kind === 'alignment')!;
    expect(e.from).toEqual([]);
    expect(e.fromPartner).toEqual([7]);
    expect(e.text).toContain('隊友盤');
  });

  it('partnerLabel 換掉跨盤來源的盤名，三條跨盤文字都跟著換（看隊友盤時來源是「我的盤」）', () => {
    // 呼叫端算隊友盤那一份時，partner 指的是使用者自己的盤——預設的「隊友盤」會指到相反的地方。
    // 三條會印出盤名的跨盤文字（排序、共鳴攻速、三重共鳴）在同一次呼叫裡一起驗，漏改一條就會紅。
    const theirs = boardOf({
      2: align(1, 0),                                   // 跨盤排序（col 2，方向 0）
      5: dice(RESONANCE_ID), 6: dice(RESONANCE_ID), 7: dice(RESONANCE_ID),   // 3 顆同骰點共鳴 → 三重共鳴
    });
    const input = {
      board: filled({}),
      params,
      spLevel: () => 1,
      applied: (id: string) => appliedEffects(id, branchOfId(id), effects, () => 0),
      rune: boardRunes(effects, (id: string) => (id === BOARD_RUNES.resonanceTrio ? 1 : 0)),
      partner: {
        board: theirs,
        params,
        spLevel: () => 1,
        applied: (id: string) => appliedEffects(id, branchOfId(id), effects, () => 0),
        rune: boardRunes(effects, () => 0),
      },
    };
    const kinds = ['alignment', 'resonanceSpeed', 'resonanceAttack'] as const;
    const textsOf = (cells: readonly CellBuffs[]): string[] =>
      cells[2]!.entries.filter(e => (kinds as readonly string[]).includes(e.kind)).map(e => e.text);

    const fallback = textsOf(boardBuffs(input));
    expect(fallback).toHaveLength(kinds.length);
    for (const t of fallback) expect(t).toContain('隊友盤');

    const overridden = textsOf(boardBuffs({ ...input, partnerLabel: '我的盤' }));
    expect(overridden).toHaveLength(kinds.length);
    for (const t of overridden) {
      expect(t).toContain('我的盤');
      expect(t).not.toContain('隊友盤');
    }
    // 換的只是那個詞：其餘逐字相同（數字、格號、骰點都不該跟著動）。
    expect(overridden).toEqual(fallback.map(t => t.replace('隊友盤', '我的盤')));
  });

  it('本盤與跨盤排序同時命中同一格：層數相加（4307），兩種來源的 entry 都在', () => {
    const mine = boardOf({ 2: align(1, 2), 7: dice(FIRE) });   // 我方 col 2、方向 2（下），射線蓋到 index 7
    const theirs = boardOf({ 2: align(1, 0) });                // 隊友同欄（col 2）、方向 0，跨盤蓋到我的 col 2 整欄
    const cells = runCoop(mine, theirs, { '4307': 1 });
    const alignEntries = cells[7]!.entries.filter(e => e.kind === 'alignment');
    expect(alignEntries).toHaveLength(2);
    expect(alignEntries.some(e => e.from.length === 1 && e.fromPartner.length === 0)).toBe(true);
    expect(alignEntries.some(e => e.from.length === 0 && e.fromPartner.length === 1)).toBe(true);
    const stack = cells[7]!.entries.find(e => e.kind === 'alignmentStack')!;
    expect(stack.text).toBe('排序疊加強化 ×2：攻擊 +20%');
    expect(cells[7]!.attackPct).toBe(60);   // 20（本盤）＋20（跨盤）＋20（疊加 ×2 層）
  });

  it('隊友盤用自己的局外加成算值：隊友全滿時的值大於隊友不含時的值', () => {
    const theirs = boardOf({ 7: align(1, 0) });
    const lo = runCoop(filled({}), theirs, {}, {})[2]!.attackPct;
    // ⚠️ 只給 4207（施加者那一列的 statAdd）。4307 是**我的**符文、走 input.rune()，
    //    放進 partnerLevels 不會有作用，擺在這裡只會混淆這條測試在測什麼。
    const hi = runCoop(filled({}), theirs, {}, { '4207': 99 })[2]!.attackPct;
    expect(hi).toBeGreaterThan(lo);
  });
});

describe('合作雙盤：跨盤共鳴', () => {
  const RES = RESONANCE_ID;
  it('隊友盤 5 骰點共鳴 → 我盤所有 5 骰點的格子吃到，其他骰點不吃', () => {
    const mine = boardOf({ 0: dice(FIRE, 5), 1: dice(FIRE, 3), 2: dice(FIRE, 5) });
    const theirs = boardOf({ 0: dice(RES, 5) });
    const cells = runCoop(mine, theirs);
    expect(withKind(cells, 'resonanceSpeed')).toEqual([0, 2]);
  });

  it('隊友盤 7 骰點共鳴 → 我盤每一格都吃到', () => {
    const mine = boardOf({ 0: dice(FIRE, 1), 1: dice(FIRE, 4), 2: dice(FIRE, 6) });
    const cells = runCoop(mine, boardOf({ 0: dice(RES, 7) }));
    expect(withKind(cells, 'resonanceSpeed')).toEqual([0, 1, 2]);
  });

  // ⭐ 這一條是整份設計最容易寫錯的地方：攻速累加、三重共鳴各盤獨立判門檻。
  it('我 2 顆 ＋ 隊友 2 顆同骰點共鳴：攻速四顆全加，三重共鳴兩邊都不觸發', () => {
    const mine = boardOf({ 0: dice(FIRE, 5), 1: dice(RES, 5), 2: dice(RES, 5) });
    const theirs = boardOf({ 0: dice(RES, 5), 1: dice(RES, 5) });
    const trio = { '3402': 1 };
    const cells = runCoop(mine, theirs, trio, trio);
    const me = cells[0]!;
    expect(me.entries.filter(e => e.kind === 'resonanceSpeed').length).toBeGreaterThan(0);
    expect(me.entries.some(e => e.kind === 'resonanceAttack')).toBe(false);
    const solo = run(mine, trio);   // 只有我那 2 顆
    // ⚠️ 兩段共鳴攻速要合併成一個來源再扣（intervalAfter() 對每個元素各自扣 i0·r/(1+r)，
    //    元素數量本身就會改變結果，拆成兩個會扣得比合併多）：我 28％ ＋ 隊友 28％＝56％，
    //    不是 [28, 28] 兩個元素。
    expect(solo[0]!.intervalPcts).toEqual([28]);
    expect(me.intervalPcts).toEqual([56]);
  });

  it('我 3 顆同骰點共鳴 → 我這邊觸發三重共鳴；隊友只有 2 顆 → 隊友那 2 顆不加攻擊%', () => {
    const mine = boardOf({ 0: dice(FIRE, 5), 1: dice(RES, 5), 2: dice(RES, 5), 3: dice(RES, 5) });
    const theirs = boardOf({ 0: dice(RES, 5), 1: dice(RES, 5) });
    const trio = { '3402': 1 };
    const withPartner = runCoop(mine, theirs, trio, trio)[0]!;
    const alone = run(mine, trio)[0]!;
    // 三重共鳴只數本盤的 3 顆 → 攻擊% 與單盤時相同
    expect(withPartner.attackPct).toBe(alone.attackPct);
    // 但攻速多了隊友那 2 顆
    expect(withPartner.intervalPcts.reduce((a, b) => a + b, 0))
      .toBeGreaterThan(alone.intervalPcts.reduce((a, b) => a + b, 0));
  });

  it('隊友盤 3 顆同骰點共鳴 → 隊友那邊自己觸發三重共鳴，加到我的攻擊%', () => {
    const mine = boardOf({ 0: dice(FIRE, 5) });
    const theirs = boardOf({ 0: dice(RES, 5), 1: dice(RES, 5), 2: dice(RES, 5) });
    const trio = { '3402': 1 };
    const cells = runCoop(mine, theirs, trio, trio);
    const e = cells[0]!.entries.find(x => x.kind === 'resonanceAttack')!;
    expect(e.fromPartner).toEqual([0, 1, 2]);
    expect(e.from).toEqual([]);
    expect(e.text).toContain('隊友盤');
    expect(cells[0]!.attackPct).toBeGreaterThan(0);
  });

  it('跨盤共鳴的攻速來源記在 fromPartner', () => {
    const cells = runCoop(boardOf({ 0: dice(FIRE, 5) }), boardOf({ 3: dice(RES, 5) }));
    const e = cells[0]!.entries.find(x => x.kind === 'resonanceSpeed')!;
    expect(e.fromPartner).toEqual([3]);
    expect(e.text).toContain('隊友盤');
  });

  it('三重共鳴的門檻值讀我自己的符文，不是隊友的', () => {
    // 我這盤自己有 3 顆同骰點共鳴（≥3 顆才夠門檻）；隊友盤完全沒有共鳴骰，跟門檻值無關。
    const mine = boardOf({ 0: dice(FIRE, 5), 1: dice(RES, 5), 2: dice(RES, 5), 3: dice(RES, 5) });
    const theirs = boardOf({});
    const trio = { '3402': 1 };
    // 隊友解了 3402、我沒解 → 不觸發：trio 要讀我的 rune()，不是隊友的。
    expect(runCoop(mine, theirs, {}, trio)[0]!.entries.some(e => e.kind === 'resonanceAttack')).toBe(false);
    // 反過來我解了、隊友沒解 → 觸發。
    expect(runCoop(mine, theirs, trio, {})[0]!.entries.some(e => e.kind === 'resonanceAttack')).toBe(true);
  });
});

describe('合作雙盤：高亮', () => {
  it('跨盤來源進 srcPartner，不混進 src', () => {
    const mine = filled({});
    const theirs = boardOf({ 7: align(1, 0) });
    const cells = runCoop(mine, theirs);
    const h = buffHighlights(cells, 2);
    expect(h.srcPartner).toEqual([7]);
    expect(h.src).toEqual([]);
  });

  it('dstPartner＝我這一格加成到的隊友盤格子', () => {
    // 我這顆方向 0 的排序骰在 col 2 → 打到隊友盤 col 2 的整欄。
    const mine = boardOf({ 7: align(1, 0) });
    const theirs = filled({});
    const mineCells = runCoop(mine, theirs);
    const theirsCells = runCoop(theirs, mine);
    const h = buffHighlights(mineCells, 7, theirsCells);
    expect(h.dstPartner).toEqual([2, 7, 12]);
  });

  it('沒有 partnerCells 時 dstPartner 是空陣列', () => {
    const cells = run(filled({ 7: align(1, 0) }));
    expect(buffHighlights(cells, 7).dstPartner).toEqual([]);
  });

  it('非對稱：來源在 col 0（index 5），查詢的 index 跟來源 index 不同時要嘛正確帶出整欄要嘛正確為空', () => {
    // col 2 是 5 欄棋盤的正中欄，鏡像不變，容易讓錯誤實作矇混過關；改用 col 0。
    const mine = boardOf({ 5: align(1, 0) }); // row1 col0
    const theirs = filled({});
    const mineCells = runCoop(mine, theirs);
    const theirsCells = runCoop(theirs, mine);
    // 查詢的 index（10＝row2 col0）不是排序骰自己的格子（5）：那一格沒有 fromPartner=[10] 的
    // entry，正確答案必須是空陣列。錯把 `e.fromPartner.includes(index)` 寫成
    // `includes(j)`（j 是被掃描的隊友格自己）的話，這裡會誤中 [5]。
    expect(buffHighlights(mineCells, 10, theirsCells).dstPartner).toEqual([]);
    // 查詢排序骰自己的格子（5）才會拿到整欄三格。
    expect(buffHighlights(mineCells, 5, theirsCells).dstPartner).toEqual([0, 5, 10]);
  });

  it('非對稱：srcPartner 查詢格與來源格 index 不同（col 0，不是自鏡像的 col 2）', () => {
    const mine = filled({});
    const theirs = boardOf({ 5: align(1, 0) }); // row1 col0
    const cells = runCoop(mine, theirs);
    const h = buffHighlights(cells, 10); // row2 col0：跟來源格 5 不同 index
    expect(h.srcPartner).toEqual([5]);
    expect(h.src).toEqual([]);
  });
});
