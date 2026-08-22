/**
 * 全站導覽列 `<nav id="site-nav">` 的實際渲染高度，量出來寫進 :root 的 `--nav-h`。
 *
 * 消費者（三處，全部吃同一個變數）：
 * - `#tree-controls`（src/pages/tree.astro）：position: fixed 的工具列。
 * - `#detail`（src/styles/global.css）：position: fixed 的詳情面板。
 * - `.filters`（src/styles/global.css）：/dice 沾在導覽列底下的篩選列。
 * 另外 `html { scroll-padding-top }` 與 `.kw-entry { scroll-margin-top }` 也用它，
 * 讓錨點跳轉不會躲進沾頂的導覽列底下。
 *
 * 為什麼要量而不是寫死：#tree-controls 舊版寫死 `top: 3rem`，假設導覽列恆 48px 高，
 * 但實測是 padding 0.75rem×2 ＋ 行高 ＋ 1px 下框線 ≈ 50.59px，2.59px 的落差讓
 * #toolbar 右上角的 border-right 往上戳出導覽列下緣。那是「寫死版面偏移量」在這個 repo
 * 咬人的第三次（另外兩次見 tree.astro #tree-controls 的註解）。字型、行高、瀏覽器預設值
 * 任何一個變動都會讓新的魔術數字再錯一次，所以一律實測。
 *
 * 2026-08-22 從 src/scripts/tree-canvas.ts 搬到這裡：導覽列改成 position: sticky 之後
 * 每一頁都需要這個值（/dice 的篩選列、全站的錨點偏移），不再只有 /tree 用得到。
 */
export function updateNavHeight(): void {
  const nav = document.getElementById('site-nav');
  if (!nav) return;
  // ⚠️ 這裡要的是**視窗座標**：--nav-h 的消費者都是 position: fixed／sticky，`top` 本來
  // 就是相對視窗算的。一度改成 `+ window.scrollY` 換算成文件座標是錯的——捲到 y=100 時
  // 會把它們放到導覽列下方 100px，畫布頂端多出一條死區。
  //
  //
  // ⚠️ 不要再包一層 `Math.max(0, …)`。那樣寫過一版，但它跟底下的 `> 0` 判斷互相抵消：
  // clamp 只有在真實值 ≤ 0 時才會產出 0，而 0 又會被判斷擋掉，兩條規則各自宣稱的行為
  // 一個都沒發生（2026-08-22 review 抓到）。留判斷、不留 clamp。
  const bottom = nav.getBoundingClientRect().bottom;
  // 單元測試環境（linkedom）沒有版面引擎，getBoundingClientRect() 預設全 0；量到 0 或負數
  // 一定不是真實渲染結果，跳過寫入、讓 CSS 的 3rem fallback 留著。
  if (bottom > 0) {
    document.documentElement.style.setProperty('--nav-h', `${bottom}px`);
  }
}

/**
 * 量一次，之後跟著視窗尺寸變動重量。/tree 以外的頁面由 src/layouts/Base.astro 呼叫；
 * /tree 由 tree-canvas.ts 自己的 resize handler 一併處理（那裡還有別的東西要重算，
 * 順序有講究，見該檔案的說明）。重複呼叫是安全的——寫入同一個屬性、同一個值。
 */
export function installNavHeight(): void {
  updateNavHeight();
  window.addEventListener('resize', updateNavHeight);
}
