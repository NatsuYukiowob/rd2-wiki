// `/events`（期間限定活動）的共用層：一格資料 → 一段 HTML。
//
// 活動資料的每一格可以是純文字，也可以是「貨幣圖 ＋ 文字」（`{ icon, text }`）。圖的來源
// 有兩處：`cost-html.ts` 的固定登記表（核心／金幣／討伐硬幣／活動貨幣）與 `currency.ts`
// 的 `MYTHIC_CORES`（太陽核心、齒輪二階核心……，圖檔是 `/currency/<kind>.png`）。
//
// ⚠️ **合法的 `icon` 值只有這裡列舉的這一份**，規則 29 與版面共用它。分成兩份清單的話，
// 資料檔寫一個沒登記的 kind 會是「驗證全綠、畫面上一張破圖」。

import { CURRENCY_ICON_KINDS, currencyIcon, mythicIcon, type CurrencyIconKind } from './cost-html.js';
import { mythicCoreByKind, MYTHIC_CORES } from './currency.js';
import type { EventCell } from './types.js';

/** 資料檔的 `icon` 欄允許的值：登記過的貨幣圖 ＋ 每一種超越核心。 */
export const EVENT_ICON_KINDS: readonly string[] = [
  ...CURRENCY_ICON_KINDS,
  ...MYTHIC_CORES.map(d => d.kind),
];

/**
 * 一種貨幣的 `<img>`。未登記的 kind 直接丟——這個函式只在建置期跑（Astro 的靜態渲染），
 * 丟出來就是建置紅，比在頁面上放一張 404 的圖好。
 */
export function eventIcon(kind: string): string {
  const mythic = mythicCoreByKind(kind);
  if (mythic) return mythicIcon(mythic);
  if ((CURRENCY_ICON_KINDS as readonly string[]).includes(kind)) {
    return currencyIcon(kind as CurrencyIconKind);
  }
  throw new Error(`未登記的貨幣圖種類 ${JSON.stringify(kind)}（合法值：${EVENT_ICON_KINDS.join('／')}）`);
}

/**
 * 一格的 HTML。純文字的格子**不經過任何標記處理**：這份資料是從客戶端表機器產出的，
 * 沒有 `#關鍵字` 標記，也不該有 HTML——所以這裡只做 escape。
 */
export function eventCellHtml(cell: EventCell): string {
  if (typeof cell === 'string') return escapeHtml(cell);
  return `${eventIcon(cell.icon)}${escapeHtml(cell.text)}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}
