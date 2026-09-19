import { describe, expect, it } from 'vitest';
import {
  ALIGNMENT_ID, CELLS, COLS, DECK_SIZE, GEAR_SECOND_ID, MAX_PIPS, MAX_SP_LEVEL, ROWS,
  badgeKind, badgeText, cellPos, clampPips, clampSp, clear, cycleBadge, emptyBoard, emptyDeck, inBoard, place,
  setDeckSlot, swap,
  type Board, type Dir, type GearKind, type Placed,
} from '../../src/lib/board';

const fire = { diceId: '1001', pips: 3 };
const wind = { diceId: '2001', pips: 1 };

describe('常數', () => {
  it('骰盤是 5 欄 3 列共 15 格，骰面上限 7，組合 5 槽', () => {
    expect([COLS, ROWS, CELLS, MAX_PIPS, DECK_SIZE]).toEqual([5, 3, 15, 7, 5]);
  });
});

describe('emptyBoard / emptyDeck', () => {
  it('空骰盤是 15 個 null', () => {
    expect(emptyBoard()).toEqual(Array(15).fill(null));
  });

  it('空組合是 5 個 null', () => {
    expect(emptyDeck()).toEqual(Array(5).fill(null));
  });
});

describe('clampPips', () => {
  it.each([
    [0, 1], [1, 1], [4, 4], [7, 7], [8, 7], [-3, 1], [3.7, 3],
  ])('clampPips(%s) === %s', (input, expected) => {
    expect(clampPips(input)).toBe(expected);
  });

  it('NaN 夾成 1 而不是傳出去污染狀態', () => {
    expect(clampPips(Number.NaN)).toBe(1);
  });
});

describe('clampSp', () => {
  it('局內強化上限是 15', () => {
    expect(MAX_SP_LEVEL).toBe(15);
  });

  it.each([
    [0, 1], [1, 1], [9, 9], [15, 15], [16, 15], [-3, 1], [3.7, 3],
  ])('clampSp(%s) === %s', (input, expected) => {
    expect(clampSp(input)).toBe(expected);
  });

  it('NaN 夾成 1 而不是傳出去污染狀態', () => {
    expect(clampSp(Number.NaN)).toBe(1);
  });
});

describe('inBoard', () => {
  it.each([[-1, false], [0, true], [14, true], [15, false], [1.5, false]])(
    'inBoard(%s) === %s', (i, expected) => expect(inBoard(i)).toBe(expected));
});

describe('place', () => {
  it('把骰子放進指定格，其餘格不動', () => {
    const b = place(emptyBoard(), 7, fire);
    expect(b[7]).toEqual(fire);
    expect(b.filter(Boolean)).toHaveLength(1);
  });

  it('放進已有骰子的格＝覆蓋', () => {
    const b = place(place(emptyBoard(), 7, fire), 7, wind);
    expect(b[7]).toEqual(wind);
  });

  it('pips 超出 1–7 會被夾住', () => {
    expect(place(emptyBoard(), 0, { diceId: '1001', pips: 99 })[0]).toEqual({ diceId: '1001', pips: 7 });
  });

  // ⚠️ 越界的斷言一定要跟「另外存的快照」比，不能寫成 `expect(f(before)).toEqual(before)`。
  // 後者在「實作就地改再回傳同一個陣列」時是 `expect(x).toEqual(x)`，恆真——實測把三個
  // 轉移函式全部寫成就地修改，35 條測試仍然全綠，而骰子其實已經被刪掉了。
  it('index 越界＝no-op，且原陣列一個位置都沒被動到', () => {
    const before = place(emptyBoard(), 3, fire);
    const snapshot = structuredClone([...before]);
    expect(place(before, 15, wind)).toEqual(snapshot);
    expect(place(before, -1, wind)).toEqual(snapshot);
    expect(before).toEqual(snapshot);
  });

  it('不就地修改原陣列', () => {
    const before = emptyBoard();
    place(before, 0, fire);
    expect(before[0]).toBeNull();
  });

  // ⚠️ 也不可以改到「傳進來的那個 Placed」，更不可以把它直接放進骰盤當別名——
  // 那會讓骰盤格與組合槽共用同一個物件，改一邊動到另一邊。
  it('不修改傳入的 Placed，也不把它直接放進骰盤', () => {
    const arg = { diceId: '1001', pips: 99 };
    const board = place(emptyBoard(), 0, arg);
    expect(arg.pips).toBe(99);
    expect(board[0]).not.toBe(arg);
    expect(board[0]).toEqual({ diceId: '1001', pips: 7 });
  });
});

describe('swap', () => {
  it('兩格互換，不合成——同種同等互換後兩格都還在且等級沒變', () => {
    const same = { diceId: '1001', pips: 3 };
    const b = place(place(emptyBoard(), 0, same), 1, { ...same });
    const after = swap(b, 0, 1);
    expect(after[0]).toEqual(same);
    expect(after[1]).toEqual(same);
    expect(after.filter(Boolean)).toHaveLength(2);
  });

  it('跟空格互換＝搬過去', () => {
    const after = swap(place(emptyBoard(), 0, fire), 0, 9);
    expect(after[0]).toBeNull();
    expect(after[9]).toEqual(fire);
  });

  it('同一格互換＝no-op，且原陣列沒被動到', () => {
    const b = place(emptyBoard(), 2, fire);
    const snapshot = structuredClone([...b]);
    expect(swap(b, 2, 2)).toEqual(snapshot);
    expect(b).toEqual(snapshot);
  });

  it('任一端越界＝no-op，且原陣列沒被動到', () => {
    const b = place(emptyBoard(), 2, fire);
    const snapshot = structuredClone([...b]);
    expect(swap(b, 2, 15)).toEqual(snapshot);
    expect(swap(b, -1, 2)).toEqual(snapshot);
    expect(b).toEqual(snapshot);
  });

  it('不就地修改原陣列', () => {
    const before = place(emptyBoard(), 0, fire);
    swap(before, 0, 9);
    expect(before[0]).toEqual(fire);
    expect(before[9]).toBeNull();
  });
});

describe('clear', () => {
  it('清掉指定格', () => {
    expect(clear(place(emptyBoard(), 5, fire), 5)[5]).toBeNull();
  });

  it('越界＝no-op，且原陣列沒被動到（含長度）', () => {
    const b = place(emptyBoard(), 5, fire);
    const snapshot = structuredClone([...b]);
    expect(clear(b, 99)).toEqual(snapshot);
    expect(b).toEqual(snapshot);
    expect(b).toHaveLength(15);
  });

  it('不就地修改原陣列', () => {
    const before = place(emptyBoard(), 5, fire);
    clear(before, 5);
    expect(before[5]).toEqual(fire);
  });
});

describe('setDeckSlot', () => {
  it('設定與清空一槽', () => {
    const d = setDeckSlot(emptyDeck(), 2, fire);
    expect(d[2]).toEqual(fire);
    expect(setDeckSlot(d, 2, null)[2]).toBeNull();
  });

  it('pips 一樣被夾住', () => {
    expect(setDeckSlot(emptyDeck(), 0, { diceId: '1001', pips: 0 })[0]).toEqual({ diceId: '1001', pips: 1 });
  });

  it('槽位越界＝no-op', () => {
    expect(setDeckSlot(emptyDeck(), 5, fire)).toEqual(emptyDeck());
  });

  it('不就地修改原陣列', () => {
    const before = emptyDeck();
    setDeckSlot(before, 0, fire);
    expect(before[0]).toBeNull();
  });

  // ⚠️ 跟 place 那條同型：不可以改到「傳進來的那個 Placed」，更不可以把它直接放進組合列當別名
  // ——那會讓骰盤格與組合槽共用同一個物件，改一邊動到另一邊。
  it('不修改傳入的 Placed，也不把它直接放進組合列', () => {
    const arg = { diceId: '1001', pips: 99 };
    const deck = setDeckSlot(emptyDeck(), 0, arg);
    expect(arg.pips).toBe(99);
    expect(deck[0]).not.toBe(arg);
    expect(deck[0]).toEqual({ diceId: '1001', pips: 7 });
  });
});

describe('cellPos', () => {
  it.each([
    [0, { row: 0, col: 0 }],
    [4, { row: 0, col: 4 }],
    [5, { row: 1, col: 0 }],
    [14, { row: 2, col: 4 }],
  ])('cellPos(%s)', (i, expected) => expect(cellPos(i)).toEqual(expected));
});

describe('角標（排序方向／齒輪二階種類）', () => {
  const align = (pips: number): Placed => ({ diceId: ALIGNMENT_ID, pips });
  const gear2 = (pips: number): Placed => ({ diceId: GEAR_SECOND_ID, pips });
  const at = (p: Placed, i = 7): Board => place(emptyBoard(), i, p);

  it('只有 7 骰點以下的排序／齒輪二階要角標', () => {
    expect(badgeKind(align(1))).toBe('dir');
    expect(badgeKind(align(6))).toBe('dir');
    expect(badgeKind(align(7))).toBeNull();
    expect(badgeKind(gear2(3))).toBe('gear');
    expect(badgeKind(gear2(7))).toBeNull();
    expect(badgeKind(fire)).toBeNull();
    expect(badgeKind(null)).toBeNull();
  });

  it('方向循環 ? → ↑ → → → ↓ → ← → ?；回到「?」時整個欄位拿掉', () => {
    let b = at(align(3));
    const seen: (Dir | undefined)[] = [];
    for (let k = 0; k < 5; k++) {
      b = cycleBadge(b, 7);
      seen.push(b[7]!.dir);
    }
    expect(seen).toEqual([0, 1, 2, 3, undefined]);
    expect(b[7]).toEqual(align(3));
    expect('dir' in b[7]!).toBe(false);
  });

  it('齒輪循環 ? → 強 → 動 → 變 → ?', () => {
    let b = at(gear2(2));
    const seen: (GearKind | undefined)[] = [];
    for (let k = 0; k < 4; k++) {
      b = cycleBadge(b, 7);
      seen.push(b[7]!.gear);
    }
    expect(seen).toEqual(['reinforce', 'power', 'speed', undefined]);
    expect('gear' in b[7]!).toBe(false);
  });

  it('沒有角標的格子、空格、越界都 no-op（回原陣列）', () => {
    for (const p of [align(7), gear2(7), fire]) {
      const b = at(p);
      expect(cycleBadge(b, 7)).toBe(b);
    }
    const b = at(align(1));
    expect(cycleBadge(b, 0)).toBe(b);
    expect(cycleBadge(b, CELLS)).toBe(b);
    expect(cycleBadge(b, -1)).toBe(b);
  });

  it('角標跟著骰子走：交換後在新位置；放下別的骰子（或從組合列再放同一種）就清掉', () => {
    const b = cycleBadge(cycleBadge(at(align(3), 0), 0), 0);
    expect(b[0]!.dir).toBe(1);
    const s = swap(place(b, 1, fire), 0, 1);
    expect(s[1]).toEqual({ diceId: ALIGNMENT_ID, pips: 3, dir: 1 });
    expect(s[0]).toEqual(fire);
    expect(place(b, 0, fire)[0]).toEqual(fire);
    expect(place(b, 0, align(3))[0]).toEqual(align(3));
  });

  it('badgeText：格子上的字、aria-label 的尾巴、切換後的播報', () => {
    expect(badgeText(align(3))).toEqual({ glyph: '?', spoken: '方向未指定', announce: '排序改為未指定' });
    expect(badgeText({ ...align(3), dir: 1 })).toEqual({ glyph: '→', spoken: '方向朝右', announce: '排序改為朝右' });
    expect(badgeText({ ...align(3), dir: 0 })!.glyph).toBe('↑');
    expect(badgeText({ ...align(3), dir: 2 })!.glyph).toBe('↓');
    expect(badgeText({ ...align(3), dir: 3 })!.glyph).toBe('←');
    expect(badgeText(gear2(1))).toEqual({ glyph: '?', spoken: '種類未指定', announce: '齒輪二階改為未指定' });
    expect(badgeText({ ...gear2(1), gear: 'speed' }))
      .toEqual({ glyph: '變', spoken: '種類：變速齒輪', announce: '齒輪二階改為變速齒輪' });
    expect(badgeText({ ...gear2(1), gear: 'reinforce' })!.glyph).toBe('強');
    expect(badgeText({ ...gear2(1), gear: 'power' })!.glyph).toBe('動');
    expect(badgeText(fire)).toBeNull();
    expect(badgeText(align(7))).toBeNull();
  });
});
