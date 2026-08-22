// 靜態頁（/dice、/guide/*）版本的 `#關鍵字` 渲染：標記變成跳到詞條的連結。
//
// 跟 /tree 詳情面板的差別只有「一個詞怎麼包」：面板包成 <button>（點了在同一張卡片換頁），
// 靜態頁包成 <a href="/guide/status#FROZEN">（沒有 JS 也能用，而且搜尋引擎爬得到）。
// 斷詞器是共用的那一支（src/lib/markup.ts），不要在這裡再寫一次。
import { escapeHtml, renderTaggedText } from './markup.js';
import { termHref, type GlossaryIndex } from './glossary-groups.js';
import type { GlossaryDisplay } from './types.js';

/**
 * 把遊戲文案轉成靜態頁用的 HTML。
 *
 * `whitelist` 傳 data/keywords.json 的全部鍵（含別名），不是節點自己的 `keywords`——
 * 覺醒文案的標記不在後者裡，圖鑑頁卻要顯示覺醒。
 *
 * 顏色一律用官方色碼，跟面板同一套視覺；索引裡查不到的詞（規則 8 擋著，正常不會發生）
 * 就只上色不加連結，總比生出一個 404 錨點好。
 */
export function renderStaticText(
  text: string,
  whitelist: readonly string[],
  glossary: Record<string, GlossaryDisplay>,
  index: GlossaryIndex,
): string {
  return renderTaggedText(text, whitelist, glossary, term => {
    // ⚠️ 顏色查 `index.byTerm` 而不是 renderTaggedText 給的 `entry`：後者來自
    // `displayGlossary()`，那份表**不含別名**，於是 `#播種`／`#傳送` 這兩個別名會渲染成
    // 全站唯二沒有官方色的標記，看起來像另一種東西（2026-08-22 code review 抓到）。
    // `index.byTerm` 的別名指向本尊那一筆，顏色跟本尊一致。
    const item = index.byTerm.get(term);
    const color = item ? ` style="color:${escapeHtml(item.color)}"` : '';
    const href = termHref(index, term);
    const label = `#${escapeHtml(term)}`;
    // `data-term` 讓 /dice 的卡片腳本認得出這是哪一個詞，好在**同一張卡片裡**就地展開解釋
    // （見 dice.astro 的委派）。href 仍然指向詞條頁——沒有 JS 時它就是一條正常的連結，
    // 有 JS 時腳本 preventDefault 接手。兩條路都通，不是二選一。
    return href
      ? `<a class="kw-link" href="${escapeHtml(href)}" data-term="${escapeHtml(term)}"${color}>${label}</a>`
      : `<span class="kw-link"${color}>${label}</span>`;
  });
}

/**
 * 給 /dice 的卡片用的詞彙負載：每個詞的顏色、詞條頁網址，以及**已經渲染好的解釋 HTML**。
 *
 * 解釋在建置期就渲染成 HTML（含裡面巢狀的 `#關鍵字` 連結），瀏覽器端只要塞進去就好——
 * 不必把斷詞器再送一份到前端，也不會出現「伺服器與瀏覽器對同一段文字斷出不同結果」。
 * 別名（播種→果實）指到本尊那一筆，點下去看到的是同一個解釋。
 */
export interface TermPayload {
  color: string;
  href: string;
  html: string;
  /** 骰子樹的節點文案有沒有用到這個標記。沒有的話就不要給「在骰子樹搜尋」的入口——
   *  那條路過去會是一個 0 筆結果的搜尋，比不給還糟。 */
  used: boolean;
}

export function buildTermPayload(
  index: GlossaryIndex,
  whitelist: readonly string[],
  glossary: Record<string, GlossaryDisplay>,
): Record<string, TermPayload> {
  const out: Record<string, TermPayload> = {};
  for (const [term, item] of index.byTerm) {
    const href = termHref(index, term);
    if (!href) continue;
    out[term] = {
      color: item.color,
      href,
      html: renderStaticText(item.desc, whitelist, glossary, index),
      used: item.usedBy.length > 0,
    };
  }
  return out;
}
