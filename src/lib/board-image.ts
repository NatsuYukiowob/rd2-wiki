// 分享圖的版面算式。
//
// 刻意跟繪製分開：`drawBoard()` 要一個真的 CanvasRenderingContext2D 才跑得起來，
// 而「第 n 格畫在哪」是純算術。把算式留在這裡，vitest 就測得到格子有沒有重疊、有沒有
// 掉出畫布——那些正是改版面時最容易弄壞、又最不容易用眼睛看出來的東西。
import { COLS, CELLS, DECK_SIZE, ROWS, cellPos } from './board.js';

/**
 * 對戰版的輸出尺寸固定，跟觀看者的螢幕 dpr 無關——分享圖是要被貼到別的地方看的。
 *
 * ⚠️ 合作版**不是**同一個尺寸（兩盤上下疊、各帶一條隊伍列，塞不進 900 的高度），
 * 要畫布尺寸一律問 `imageSize(coop)`，不要直接用這兩個常數當寬高。
 */
export const IMAGE_W = 1200;
export const IMAGE_H = 900;

export interface Rect { x: number; y: number; w: number; h: number }

/** 哪一盤。對戰模式只有 `me`，合作模式 `partner` 在上、`me` 在下。 */
export type BoardSide = 'me' | 'partner';

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

/** 組合列：5 個 96px 方塊，置中排在自己那一盤的外側（對戰與合作的我方在下，合作的隊友在上）。 */
const DECK_BOX = 96;
const DECK_GAP = 24;
const DECK_W = DECK_SIZE * DECK_BOX + (DECK_SIZE - 1) * DECK_GAP;
const DECK_X = Math.round((IMAGE_W - DECK_W) / 2);
/**
 * 隊伍列標題（「我的隊伍」那一行）佔的高度，與它跟骰盤之間的淨留白。
 *
 * 兩個數字加起來就是骰盤底到隊伍列頂的距離。拆成兩個是為了合作版：那裡的隊友隊伍列在
 * **骰盤上方**，標題仍然在列的上面，所以「標題佔多高」與「骰盤跟列之間留多少」要分開算。
 */
const DECK_LABEL_BASELINE = 22;
/** 標題那一行佔的高度：24px 的字以 `textBaseline = middle` 畫，上緣就在基線再往上半個 em。 */
const DECK_LABEL_H = DECK_LABEL_BASELINE + 12;
/** 骰盤與相鄰隊伍列之間的淨留白（標題不算在內）。 */
const DECK_CLEAR = 22;
const DECK_Y = BOARD_Y + BOARD_H + DECK_CLEAR + DECK_LABEL_H;

/**
 * 合作版的垂直順序：標題 → 隊友隊伍列 → 隊友盤 → 中線留白 → 我的盤 → 我的隊伍列 → 下邊距。
 *
 * ⚠️ 高度是這一段**算出來的**，不是挑一個好看的數字寫死：格邊長或間距一改，兩盤各自變高，
 * 寫死的話最下面那條隊伍列會安靜地掉出畫布（canvas 不會報錯，只是畫不到的地方沒有東西）。
 * 兩盤的 x 都走同一個 `BOARD_X`，所以同一欄在兩盤之間逐欄對齊——跨盤加成看的就是欄。
 */
const COOP_MID = 48;
const COOP_BOTTOM = 48;
const COOP_PARTNER_DECK_Y = BOARD_Y + DECK_LABEL_H;
const COOP_PARTNER_BOARD_Y = COOP_PARTNER_DECK_Y + DECK_BOX + DECK_CLEAR;
const COOP_MY_BOARD_Y = COOP_PARTNER_BOARD_Y + BOARD_H + COOP_MID;
const COOP_MY_DECK_Y = COOP_MY_BOARD_Y + BOARD_H + DECK_CLEAR + DECK_LABEL_H;
const IMAGE_H_COOP = COOP_MY_DECK_Y + DECK_BOX + COOP_BOTTOM;

/** 畫布尺寸。合作版只有高度不同——寬度一變，同一份圖在兩種模式下的骰子大小就不一樣了。 */
export function imageSize(coop: boolean): { w: number; h: number } {
  return { w: IMAGE_W, h: coop ? IMAGE_H_COOP : IMAGE_H };
}

function boardTop(coop: boolean, side: BoardSide): number {
  if (!coop) return BOARD_Y;
  return side === 'partner' ? COOP_PARTNER_BOARD_Y : COOP_MY_BOARD_Y;
}

function deckTop(coop: boolean, side: BoardSide): number {
  if (!coop) return DECK_Y;
  return side === 'partner' ? COOP_PARTNER_DECK_Y : COOP_MY_DECK_Y;
}

/** 隊伍列標題的基線。跟著列走，兩種模式、兩盤都是同一個關係。 */
export function deckLabelBaseline(coop: boolean, side: BoardSide): number {
  return deckTop(coop, side) - DECK_LABEL_BASELINE;
}

export function cellRect(index: number, coop = false, side: BoardSide = 'me'): Rect {
  if (!Number.isInteger(index) || index < 0 || index >= CELLS) return { ...EMPTY };
  const { row, col } = cellPos(index);
  return {
    x: BOARD_X + col * (CELL + GAP),
    y: boardTop(coop, side) + row * (CELL + GAP),
    w: CELL,
    h: CELL,
  };
}

export function deckRect(slot: number, coop = false, side: BoardSide = 'me'): Rect {
  if (!Number.isInteger(slot) || slot < 0 || slot >= DECK_SIZE) return { ...EMPTY };
  return {
    x: DECK_X + slot * (DECK_BOX + DECK_GAP),
    y: deckTop(coop, side),
    w: DECK_BOX,
    h: DECK_BOX,
  };
}

/** 角標（排序方向／齒輪二階種類）在分享圖上的框：格子左上角內縮 10px 的 40×40，跟畫面上的 .cell-badge 同一個角。 */
const BADGE_INSET = 10;
const BADGE = 40;

export function badgeRect(index: number, coop = false, side: BoardSide = 'me'): Rect {
  const cell = cellRect(index, coop, side);
  if (cell.w === 0) return { ...EMPTY };
  return { x: cell.x + BADGE_INSET, y: cell.y + BADGE_INSET, w: BADGE, h: BADGE };
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
 * 有一條讀 `board.css` 比對兩邊沒有各自漂移）。
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
