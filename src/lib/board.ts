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

/** 局內 SP 強化等級上限。依據：客戶端判斷「還能不能強化」的上限是 14（0 起算＝Lv.1–15，
 *  1.1.2 客戶端確認）；官方四檔的最高檢查點也是 Lv.15。 */
export const MAX_SP_LEVEL = 15;

/** 排序骰子的節點 id：7 骰點以下的方向在局內隨機（客戶端 RT_RandomSeed & 3），站上讓使用者用角標指定。 */
export const ALIGNMENT_ID = '4007';
/** 齒輪二階骰子的節點 id：7 骰點以下的種類在局內隨機（客戶端 GearSecondLink.GetGearType），同上。 */
export const GEAR_SECOND_ID = '2503';

/**
 * 排序方向，站上格子座標：0 上、1 右、2 下、3 左。單盤時四向對稱，H=0 在畫面上是上排還是下排不影響。
 * ⚠️ 合作模式下不對稱：客戶端**只有方向 0** 會跨到隊友盤（對同一欄的整欄 3 格施加），
 * 所以畫面方向必須對得上客戶端的方向索引。跨盤那一段與 H 無關（整欄都打），見 board-buffs.ts。
 */
export type Dir = 0 | 1 | 2 | 3;
/** 齒輪二階的種類：強化／動力／變速。只有變速（與 7 骰點）會加攻速，另外兩種在卡片上跟「?」一樣。 */
export type GearKind = 'reinforce' | 'power' | 'speed';

/** 一顆已決定種類與等級的骰子。diceId 是節點 id（41 顆 type === 'dice' 之一）。 */
export interface Placed {
  diceId: string;
  /** 骰面點數，1–7。 */
  pips: number;
  /** 排序方向（角標）；沒有＝「?」，那顆的加成不套用。只有 7 骰點以下的排序骰子會有。 */
  dir?: Dir;
  /** 齒輪二階種類（角標）；沒有＝「?」。只有 7 骰點以下的齒輪二階會有。 */
  gear?: GearKind;
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

/** 把任意數字夾成合法的局內強化等級。NaN 也回 1，理由同 clampPips()。 */
export function clampSp(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_SP_LEVEL, Math.max(1, Math.trunc(n)));
}

export function inBoard(i: number): boolean {
  return Number.isInteger(i) && i >= 0 && i < CELLS;
}

function inDeck(i: number): boolean {
  return Number.isInteger(i) && i >= 0 && i < DECK_SIZE;
}

/** ⚠️ 只寫 diceId／pips：放下的是一顆新骰子，舊的角標（排序方向、齒輪種類）不該跟著留下來。 */
export function place(board: Board, index: number, p: Placed): Board {
  if (!inBoard(index)) return board;
  const next = [...board];
  next[index] = { diceId: p.diceId, pips: clampPips(p.pips) };
  return next;
}

/** 兩格互換，角標跟著骰子走（整個物件互換）。⚠️ 刻意不合成：同種同等疊在一起也只是換位置（設計決策 5）。 */
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

export type BadgeKind = 'dir' | 'gear';

/** 這顆骰子要不要角標：7 骰點以下的排序骰子（方向）與齒輪二階（種類）。 */
export function badgeKind(p: Placed | null | undefined): BadgeKind | null {
  if (!p || p.pips >= MAX_PIPS) return null;
  if (p.diceId === ALIGNMENT_ID) return 'dir';
  if (p.diceId === GEAR_SECOND_ID) return 'gear';
  return null;
}

const DIR_CYCLE: readonly (Dir | undefined)[] = [undefined, 0, 1, 2, 3];
const GEAR_CYCLE: readonly (GearKind | undefined)[] = [undefined, 'reinforce', 'power', 'speed'];

function nextIn<T>(cycle: readonly (T | undefined)[], cur: T | undefined): T | undefined {
  return cycle[(cycle.indexOf(cur) + 1) % cycle.length];
}

/**
 * 角標往下一個狀態：方向 `? → ↑ → → → ↓ → ← → ?`、齒輪 `? → 強 → 動 → 變 → ?`。
 * 沒有角標的格子（空格、別種骰子、7 骰點）與越界都 no-op，回原陣列——呼叫端靠 `!==` 判斷有沒有變。
 */
export function cycleBadge(board: Board, index: number): Board {
  if (!inBoard(index)) return board;
  const p = board[index];
  const kind = badgeKind(p);
  if (!p || !kind) return board;
  const { dir: _dir, gear: _gear, ...base } = p;
  const next = [...board];
  if (kind === 'dir') {
    const dir = nextIn(DIR_CYCLE, p.dir);
    next[index] = dir === undefined ? base : { ...base, dir };
  } else {
    const gear = nextIn(GEAR_CYCLE, p.gear);
    next[index] = gear === undefined ? base : { ...base, gear };
  }
  return next;
}

const DIR_GLYPH = ['↑', '→', '↓', '←'] as const;
const DIR_WORD = ['朝上', '朝右', '朝下', '朝左'] as const;
const GEAR_GLYPH: Record<GearKind, string> = { reinforce: '強', power: '動', speed: '變' };
const GEAR_WORD: Record<GearKind, string> = { reinforce: '強化齒輪', power: '動力齒輪', speed: '變速齒輪' };

/**
 * 角標的三種文字：`glyph` 畫在格子上（「?」＝未指定）、`spoken` 接在格子的 aria-label 後面、
 * `announce` 是切換後的播報。沒有角標的骰子回 null。畫面、分享圖、明細面板都從這裡拿字，不要各寫一份。
 */
export function badgeText(p: Placed | null | undefined): { glyph: string; spoken: string; announce: string } | null {
  const kind = badgeKind(p);
  if (!p || !kind) return null;
  if (kind === 'dir') {
    if (p.dir === undefined) return { glyph: '?', spoken: '方向未指定', announce: '排序改為未指定' };
    return { glyph: DIR_GLYPH[p.dir], spoken: `方向${DIR_WORD[p.dir]}`, announce: `排序改為${DIR_WORD[p.dir]}` };
  }
  if (p.gear === undefined) return { glyph: '?', spoken: '種類未指定', announce: '齒輪二階改為未指定' };
  return { glyph: GEAR_GLYPH[p.gear], spoken: `種類：${GEAR_WORD[p.gear]}`, announce: `齒輪二階改為${GEAR_WORD[p.gear]}` };
}
