// 遊戲文案的 `#關鍵字` 標記解析，以及 HTML 逃逸。
//
// 這裡只有一份斷詞器，兩種輸出共用：`/tree` 的詳情面板要把標記變成「點了在同一張卡片
// 換頁」的 <button>，靜態頁（/dice、/guide）要把它變成跳到同頁詞條的 <a href="#CODE">。
// 差別只在「一個詞怎麼包」，斷詞邏輯完全一樣——所以斷詞留在這裡，包法由呼叫端傳進來。
//
// ⚠️ 斷詞不能用「# 後面到下一個空白或 # 為止」這種正規表達式：遊戲文案的 `#` 標記沒有
// 結束符號，中文又沒有空格分詞，naive 正規表達式會把 `#` 後面一整句都吃進去（spec 附錄
// 異常 8：實測 109 個標記中 50 個會這樣壞掉，例如 4008「#陰陽效果的骰子發動」會被整段
// 誤判成一個關鍵字）。這裡是白名單＋最長優先比對，在每個 `#` 位置只吃剛好對得上白名單
// 詞的長度。這段邏輯是全站唯一一份，複製第二份出去就一定會漂移。
import type { GlossaryDisplay } from './types.js';

const HTML_ESCAPE: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => HTML_ESCAPE[ch] ?? ch);
}

/**
 * 一個命中白名單的標記要怎麼變成 HTML。
 *
 * `entry` 是詞彙表查到的內容（顏色與解釋）；查不到時是 `undefined`——呼叫端自己決定要
 * 退回什麼顏色，這裡不替它決定。回傳的字串會原樣接進輸出，所以實作者有責任逃逸。
 */
export type RenderTerm = (term: string, entry: GlossaryDisplay | undefined) => string;

/**
 * 把帶 `#關鍵字` 標記的遊戲文案轉成可安全塞進 innerHTML／set:html 的字串。
 * `\n` 一律轉 `<br>`（資料裡的換行是排版的一部分，不是可有可無的空白）。
 */
export function renderTaggedText(
  text: string,
  keywords: readonly string[],
  glossary: Record<string, GlossaryDisplay>,
  renderTerm: RenderTerm,
): string {
  const sorted = [...keywords].sort((a, b) => b.length - a.length);
  let html = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i] ?? '';
    if (ch === '#') {
      const rest = text.slice(i + 1);
      const hit = sorted.find(w => rest.startsWith(w));
      if (hit) {
        html += renderTerm(hit, glossary[hit]);
        i += 1 + hit.length;
        continue;
      }
    }
    html += ch === '\n' ? '<br>' : escapeHtml(ch);
    i += 1;
  }
  return html;
}
