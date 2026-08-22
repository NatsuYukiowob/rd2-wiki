// 骰盤擺放編輯器（/board）的狀態模型。
//
// 這裡只有純資料轉移：輸入一份骰盤／組合，輸出一份新的。沒有 DOM、沒有事件、沒有隨機。
// 拖曳那一層（src/scripts/board.ts）唯一的工作就是把指標事件翻譯成底下這幾個呼叫，
// 所以整個「放哪、換哪、清哪」的正確性可以純用 vitest 測完，不必開瀏覽器。
//
// ⚠️ 越界一律 no-op 而不是丟例外：index 的唯一來源是指標座標換算與鍵盤位移，兩者都可能
// 在版面變動的瞬間算出界。讓它安靜回原值，比讓整支腳本在拖曳中途丟例外好。
// 但「安靜」跟「寫錯」在畫面上長得一模一樣，所以每一條 no-op 都有對應的單元測試。

export const COLS = 5;
export const ROWS = 3;
export const CELLS = COLS * ROWS;
/** 骰面點數上限。依據 src/lib/labels.ts 的 AWAKENING_CONDITION：官方 41 條覺醒條件
 *  全是「7 骰點時啟用」，所以 7 是遊戲裡的骰面上限，不是本站自訂的數字。 */
export const MAX_PIPS = 7;
export const DECK_SIZE = 5;

/** 一顆已決定種類與等級的骰子。diceId 是節點 id（41 顆 type === 'dice' 之一）。 */
export interface Placed {
  diceId: string;
  /** 骰面點數，1–7。 */
  pips: number;
}

/** 骰盤：長度固定 15，index = row * COLS + col，空格為 null。 */
export type Board = readonly (Placed | null)[];

/** 組合列：長度固定 5，每一槽自帶等級（拖進骰盤時就用這個等級）。 */
export type Deck = readonly (Placed | null)[];

export function emptyBoard(): Board {
  return Array<Placed | null>(CELLS).fill(null);
}

export function emptyDeck(): Deck {
  return Array<Placed | null>(DECK_SIZE).fill(null);
}

/** 把任意數字夾成合法骰面點數。NaN 也回 1——寧可顯示一個明顯的 1，不要把 NaN 傳下去。 */
export function clampPips(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_PIPS, Math.max(1, Math.trunc(n)));
}

export function inBoard(i: number): boolean {
  return Number.isInteger(i) && i >= 0 && i < CELLS;
}

function inDeck(i: number): boolean {
  return Number.isInteger(i) && i >= 0 && i < DECK_SIZE;
}

export function place(board: Board, index: number, p: Placed): Board {
  if (!inBoard(index)) return board;
  const next = [...board];
  next[index] = { diceId: p.diceId, pips: clampPips(p.pips) };
  return next;
}

/** 兩格互換。⚠️ 刻意不合成：同種同等疊在一起也只是換位置（設計決策 5）。 */
export function swap(board: Board, a: number, b: number): Board {
  if (!inBoard(a) || !inBoard(b) || a === b) return board;
  const next = [...board];
  [next[a], next[b]] = [next[b]!, next[a]!];
  return next;
}

export function clear(board: Board, index: number): Board {
  if (!inBoard(index)) return board;
  const next = [...board];
  next[index] = null;
  return next;
}

export function setDeckSlot(deck: Deck, slot: number, p: Placed | null): Deck {
  if (!inDeck(slot)) return deck;
  const next = [...deck];
  next[slot] = p === null ? null : { diceId: p.diceId, pips: clampPips(p.pips) };
  return next;
}

export function cellPos(index: number): { row: number; col: number } {
  return { row: Math.floor(index / COLS), col: index % COLS };
}
