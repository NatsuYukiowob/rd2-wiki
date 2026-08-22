// 分享圖的版面算式。
//
// 刻意跟繪製分開：`drawBoard()` 要一個真的 CanvasRenderingContext2D 才跑得起來，
// 而「第 n 格畫在哪」是純算術。把算式留在這裡，vitest 就測得到格子有沒有重疊、有沒有
// 掉出畫布——那些正是改版面時最容易弄壞、又最不容易用眼睛看出來的東西。
import { COLS, CELLS, DECK_SIZE, ROWS, cellPos } from './board.js';

/** 輸出尺寸固定，跟觀看者的螢幕 dpr 無關——分享圖是要被貼到別的地方看的。 */
export const IMAGE_W = 1200;
export const IMAGE_H = 900;

export interface Rect { x: number; y: number; w: number; h: number }

const EMPTY: Rect = { x: 0, y: 0, w: 0, h: 0 };

/** 標題列高度。 */
const HEADER_H = 96;
/** 骰盤格邊長與格間距。5 格 ＋ 4 個縫 ＝ 5×140 + 4×16 = 764，置中後左右各留 218。 */
const CELL = 140;
const GAP = 16;
const BOARD_W = COLS * CELL + (COLS - 1) * GAP;
const BOARD_H = ROWS * CELL + (ROWS - 1) * GAP;
const BOARD_X = Math.round((IMAGE_W - BOARD_W) / 2);
const BOARD_Y = HEADER_H + 24;

/** 組合列：5 個 96px 方塊，置中排在骰盤下方。 */
const DECK_BOX = 96;
const DECK_GAP = 24;
const DECK_W = DECK_SIZE * DECK_BOX + (DECK_SIZE - 1) * DECK_GAP;
const DECK_X = Math.round((IMAGE_W - DECK_W) / 2);
const DECK_Y = BOARD_Y + BOARD_H + 56;

export function cellRect(index: number): Rect {
  if (!Number.isInteger(index) || index < 0 || index >= CELLS) return { ...EMPTY };
  const { row, col } = cellPos(index);
  return {
    x: BOARD_X + col * (CELL + GAP),
    y: BOARD_Y + row * (CELL + GAP),
    w: CELL,
    h: CELL,
  };
}

export function deckRect(slot: number): Rect {
  if (!Number.isInteger(slot) || slot < 0 || slot >= DECK_SIZE) return { ...EMPTY };
  return {
    x: DECK_X + slot * (DECK_BOX + DECK_GAP),
    y: DECK_Y,
    w: DECK_BOX,
    h: DECK_BOX,
  };
}

/**
 * 圖示在一個框裡等比縮放置中。
 *
 * 兩步走，跟畫面上的 CSS 完全對應：先把 `box` 依 `ratio` 收縮成置中的「內框」
 * （對應 `.board-cell img { width: 78%; height: 78% }` 那一步），再把圖片依自己的
 * 長寬比塞進這個內框（對應 `object-fit: contain`）——用 `min(innerW / imgW, innerH / imgH)`
 * 決定縮放倍率，短邊先頂到內框邊界，另一邊留白，最後在內框裡置中。
 *
 * ⚠️ **這是等比縮放，不是把內框直接當成輸出尺寸。** `/board` 的骰子來源圖尺寸與長寬比都不
 * 統一（寬 147–174、高 171–186，長寬比 0.847–0.935），舊版只回傳 78% 的正方形內框、
 * 呼叫端直接拿它當 `drawImage` 的目的地矩形，等於把每張圖都拉伸貼滿那個框——長寬比不是
 * 1:1 的圖會被拉變形，而畫面上的 `<img>` 因為有 `object-fit: contain` 從來不會拉伸，
 * 分享圖因此跟畫面不一致。`imgW`／`imgH` 必填（不像 `ratio` 有預設值）：呼叫端如果沒有
 * 圖片的真實尺寸，寧可在型別層面就過不了，也不要悄悄退回「當它是正方形」的舊行為。
 *
 * 預設 `ratio` 是 0.78，跟畫面上的 `.board-cell img` 一致（`tests/lib/board-image.test.ts`
 * 有一條讀 `global.css` 比對兩邊沒有各自漂移）。
 */
export function iconRect(box: Rect, imgW: number, imgH: number, ratio = 0.78): Rect {
  const innerW = box.w * ratio;
  const innerH = box.h * ratio;
  // 沒有正的圖片尺寸可用時（呼叫端量不到、或還沒載入），退回舊行為：把整個內框當作輸出
  // 尺寸——比「完全不畫」安全，而且跟長寬比 1:1 的輸入結果一致，不會是一個新的分岔。
  if (!(imgW > 0) || !(imgH > 0)) {
    return { x: box.x + (box.w - innerW) / 2, y: box.y + (box.h - innerH) / 2, w: innerW, h: innerH };
  }
  const scale = Math.min(innerW / imgW, innerH / imgH);
  const w = imgW * scale;
  const h = imgH * scale;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}
