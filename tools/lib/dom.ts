import { DOMParser } from 'linkedom';

export function loadSvg(text: string): Document {
  return new DOMParser().parseFromString(text, 'image/svg+xml') as unknown as Document;
}

/**
 * 讀屬性值，並把 linkedom 沒有解掉的 XML 實體解回原字元。
 *
 * ⚠️ linkedom 對「屬性值」與「元素內容」的處理不一致（實測）：
 *
 * ```
 * data-name="A&amp;B"        → getAttribute() 得到 "A&amp;B"   ← 沒解
 * <title>A&amp;B</title>     → textContent   得到 "A&B"        ← 有解
 * data-x="&#65;&#66;"        → getAttribute() 得到 "AB"        ← 數字實體有解
 * ```
 *
 * 後果是 fail-closed 的：名稱含 `&` 的節點（XML 規定必須寫成 `&amp;`）會讓規則 1 的
 * 「title 與 data-* 全等」永遠對不起來——`data-name` 讀出 `A&amp;B`、`<title>` 讀出 `A&B`。
 * 貢獻者做的一切都對，validate 卻擋下來，而錯誤訊息看起來像兩個一模一樣的字串。
 * 目前正本裡剛好沒有含 `&` 的名稱，所以這個地雷還沒被踩到。
 *
 * 解碼順序不能換：具名實體先解、`&amp;` 最後——否則 `&amp;lt;`（要顯示的字面文字 `&lt;`）
 * 會被連解兩次變成 `<`。
 */
export function attr(el: Element | null | undefined, name: string): string {
  const raw = el?.getAttribute(name);
  if (!raw) return '';
  return raw
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}
