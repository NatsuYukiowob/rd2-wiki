// /board 數值卡片的純邏輯：卡片內容（標題＋數值列）與浮層擺位。不碰 DOM 所以測得到；
// DOM 組裝在 src/scripts/board.ts。
import { valueAt, type StatParams } from './dice-calc.js';

export interface CardRow { label: string; value: string }
export interface CardModel { title: string; rows: CardRow[] }

/** 卡片與明細面板共用的標題，格式固定為「火骰子 · 3 骰點 · 強化 Lv.5」。只留這一份。 */
export function cardTitle(name: string, pips: number, level: number): string {
  return `${name} · ${pips} 骰點 · 強化 Lv.${level}`;
}

/** 卡片內容。標題見 cardTitle()；列的順序照 dice-stats.json。 */
export function cardModel(name: string, pips: number, level: number, params: readonly StatParams[]): CardModel {
  return {
    title: cardTitle(name, pips, level),
    rows: params.map(p => ({ label: p.label, value: valueAt(p, pips, level) })),
  };
}

export interface Rect { left: number; top: number; width: number; height: number }
export interface Size { width: number; height: number }

/** 卡片與錨點、與視窗邊緣的最小間距（CSS px），＝ --space-2。 */
export const CARD_GAP = 8;

/**
 * 卡片左上角（viewport 座標，給 position: fixed 用）。
 *
 * 垂直：先試 prefer 那一側，放不下試另一側，都放不下就貼齊視窗底部（可能蓋住錨點，但不出界）。
 * 水平：以錨點中線置中，夾在 [CARD_GAP, 視窗寬 − 卡片寬 − CARD_GAP]；卡片比視窗還寬時貼左、不回負值。
 * prefer 由呼叫端依隊伍列在骰盤哪一側決定——卡片開在遠離隊伍列的那側，改強化 Lv 時才看得到按鈕。
 *
 * topInset＝視窗上緣被 sticky 導覽列佔掉的高度（CSS px，由呼叫端量）。卡片的 z-index 高過導覽列，
 * 不讓的話往上開會畫在導覽列上面：上方只有在卡片上緣 ≥ topInset + CARD_GAP 時才算放得下，而且
 * 最後的 top 一律夾在這條線之下——錨點被捲到導覽列底下時，往下開算出來的位置也可能落進導覽列。
 */
export function placeCard(
  anchor: Rect, card: Size, viewport: Size, prefer: 'above' | 'below' = 'below', topInset = 0,
): { left: number; top: number } {
  const minTop = topInset + CARD_GAP;
  const maxLeft = Math.max(CARD_GAP, viewport.width - card.width - CARD_GAP);
  const left = Math.min(maxLeft, Math.max(CARD_GAP, anchor.left + anchor.width / 2 - card.width / 2));
  const below = anchor.top + anchor.height + CARD_GAP;
  const above = anchor.top - CARD_GAP - card.height;
  const fitsBelow = below + card.height + CARD_GAP <= viewport.height;
  const fitsAbove = above >= minTop;
  const candidates: [boolean, number][] = prefer === 'below'
    ? [[fitsBelow, below], [fitsAbove, above]]
    : [[fitsAbove, above], [fitsBelow, below]];
  const hit = candidates.find(([fits]) => fits);
  const top = hit ? hit[1] : Math.max(minTop, viewport.height - card.height - CARD_GAP);
  return { left, top: Math.max(minTop, top) };
}
