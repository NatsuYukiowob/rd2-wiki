/**
 * 從 `:root` 讀一個時間類的 CSS 變數，換算成毫秒。
 *
 * CLAUDE.md 明訂「動畫長度一律從 CSS 讀，JS 不寫第二份」——這支就是那個「一份」。
 * 2026-08-26 之前它有兩份逐字相同的複本（`src/scripts/tree-canvas.ts` 的 `cssMs()` 與
 * `src/pages/dice.astro` 的 `SLIDE_MS`），PR ⑥ 又寫了第三份，而**那一份漏了 `s` 的分支**。
 *
 * ⚠️ **`s` 那條分支不是防禦性程式碼，是必要的**：Astro 的 CSS 壓縮會把
 * `--t-slow: 440ms` 改寫成 `--t-slow: .44s`（少一個字元）。用裸的 `parseFloat` 讀會拿到
 * **0.44**，而不是 440——差三個數量級，而且**只在建置產物裡發生**，`astro dev` 不壓縮，
 * 本機開發完全看不出來。
 *
 * 實際咬過（2026-08-26 code review 抓到）：`Base.astro` 用 `parseFloat` 算「進場動畫跑完
 * 沒有」的時間，於是 `data-enter` 在 ~957ms 就被拿掉，量到那一格**41 張卡片裡有 36 張的
 * `rise` 還沒跑完**，規則一消失它們就直接跳到終點。
 *
 * ⚠️ 不要為了「順便支援」而加上 `parseFloat` 的裸數字分支：無單位的時間值在 CSS 裡是
 * 無效的，讀到那種東西代表變數名打錯或值寫錯，退回 fallback 才是對的。
 *
 * @param name 變數名，含前置的兩個連字號（例：`'--t-slow'`）。
 * @param fallback 讀不到或解析不出正數時的退路（沒有版面的環境如單元測試的 linkedom）。
 */
export function cssMs(name: string, fallback: number): number {
  if (typeof getComputedStyle !== 'function' || typeof document === 'undefined') return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return msFromCss(raw, fallback);
}

/**
 * 純字串版，方便單元測試直接餵值進來（`getComputedStyle` 在 linkedom 底下拿不到東西）。
 * ⚠️ 順序不能反：`'440ms'` 也是 `.endsWith('s')`，先判 `ms` 才不會被當成 440 秒。
 */
export function msFromCss(raw: string, fallback: number): number {
  const ms = raw.endsWith('ms') ? parseFloat(raw)
    : raw.endsWith('s') ? parseFloat(raw) * 1000
      : NaN;
  return Number.isFinite(ms) && ms > 0 ? ms : fallback;
}

/**
 * 無單位的純數字變數（目前只有 `--p-stagger-max`）。
 * ⚠️ 這種**不可以**走 `cssMs()`：它會因為結尾沒有 `s`／`ms` 而一路退回 fallback，
 * 而 fallback 恰好也是對的值，於是「CSS 改了 JS 沒跟上」這件事永遠不會被發現。
 */
export function cssNumber(name: string, fallback: number): number {
  if (typeof getComputedStyle !== 'function' || typeof document === 'undefined') return fallback;
  const n = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
