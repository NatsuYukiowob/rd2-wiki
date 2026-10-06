/**
 * `/dice` 圖鑑卡片上那張 3D 骰子圖的**版面尺寸**（CSS px），正本是 `src/styles/dice.css` 的
 * `.dice-card header img { width: 3rem; height: 3rem }`。
 *
 * 為什麼 `<img width/height>` 寫的是這個方框、而不是圖檔自己的尺寸：那兩個屬性唯一的用途是
 * 「CSS 生效前先把位置佔好」，而這裡的 CSS **把兩邊都釘死成同一個方框** ＋ `object-fit: contain`
 * ——圖檔的長寬比在版面上從頭到尾沒有人會讀。寫圖檔的真實尺寸反而是假的：這批來源是
 * 384–426 × 398–437，而送到瀏覽器的 WebP 已經被 `DICE3_ICON_TARGET_PX` 縮到最長邊 144，
 * 兩個數字都不是那張圖在畫面上的大小（2026-09-21 /code-review 抓到）。
 *
 * ⚠️ **它跟 `dice.css` 的 `3rem` 是同一個數字的兩份**，所以 `tests/styles/dice-icon.test.ts`
 * 直接讀那個 CSS 檔比對（同 `tests/lib/board-image.test.ts` 對 `.board-cell img` 的 78% 做的事）。
 * 改 CSS 的 `3rem` 而沒改這裡，測試會紅。
 */
export const DICE_CARD_ICON_PX = 48;

/**
 * 從「節點 id → 內容雜湊」對應表取一顆骰子的圖示雜湊，少一筆就 throw。
 *
 * ⚠️ 不要讓 `map[id]!` 把 undefined 放行：版面會安靜地印出 `src="…/undefined.webp"`，畫面上
 * 一張破圖而 build 回 0。CI 的 validate（規則 21／30）擋得到同一件事，但它跑在 build 之前的另一個
 * 步驟——`astro dev` 與單跑 `npm run build` 的人完全不會被告知（2026-09-21 /code-review 在 /dice
 * 抓到；/board 同一個寫法到 2026-09-24 review 才補上）。
 *
 * @param flag `add-icon` 的旗標（`dice3`／`board`），錯誤訊息直接給補圖的指令。
 */
export function iconHashOf(map: Record<string, string>, id: string, flag: 'dice3' | 'board'): string {
  const hash = map[id];
  if (!hash) throw new Error(`data/${flag}-icons.json 沒有節點 ${id} 的圖示（npm run add-icon -- --${flag} ${id} <png>）`);
  return hash;
}
