/**
 * 手機版斷點，TS 這邊只有這一份。CSS 的媒體查詢沒辦法讀變數，所以 `chrome.css`、`components.css`、
 * `rewards.css`、`tree.astro`、`sim.astro` 各自寫死 720px——改斷點時 grep `720px` 一起改。
 */
export const NARROW_QUERY = '(max-width: 720px)';
