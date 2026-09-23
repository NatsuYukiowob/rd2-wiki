/**
 * 全站 inline SVG 圖示（2026-09-23 骰桌改版）。
 *
 * 字串常數而不是 Astro component：`/tree`、`/sim` 有大量由 TS 以 innerHTML 生成的 DOM，
 * `.astro` 用 `<Fragment set:html={ICONS.x} />`、TS 用字串拼接，兩邊吃同一份——做成 component
 * 的話 TS 那邊得再抄一份 SVG，那就是這個 repo 一路在收的「同一個東西兩份」。
 *
 * 每個圖示都是裝飾（旁邊一定有文字），所以 aria-hidden ＋ focusable="false"；顏色只准
 * currentColor／none（`tests/lib/icons.test.ts` 守），尺寸由 `.icon`（components.css）給 1em。
 */
// `extra` 是額外的 class：箭頭用它標出自己在文字的哪一側（`icon-trail`／`icon-lead`），間距規則
// 靠它而不是 `:first-child`／`:last-child`——後兩者不計文字節點，「圖示＋一段文字」的連結裡
// 圖示同時是 first 與 last child，兩側都會吃到間距（2026-09-23 /code-review）。
const svg = (body: string, viewBox = '0 0 24 24', extra = ''): string =>
  `<svg class="icon${extra ? ` ${extra}` : ''}" viewBox="${viewBox}" aria-hidden="true" focusable="false">${body}</svg>`;

export const ICONS = {
  /** 骰點品牌標：圓角骰面＋對角三點（骰子的「3」）。 */
  brand: svg(
    '<rect x="2.5" y="2.5" width="19" height="19" rx="5" fill="none" stroke="currentColor" stroke-width="2"/>'
    + '<circle cx="8" cy="8" r="1.8" fill="currentColor"/>'
    + '<circle cx="12" cy="12" r="1.8" fill="currentColor"/>'
    + '<circle cx="16" cy="16" r="1.8" fill="currentColor"/>',
  ),
  /** 往前（連結的「進去」）。取代文字 `→`。 */
  arrow: svg('<path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>', undefined, 'icon-trail'),
  /** 往回（「← 活動」這種回上一層的路標）。 */
  back: svg('<path d="M19 12H6M11 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>', undefined, 'icon-lead'),
  /** 步進的「減」（‹）。按鈕裡唯一的內容，名字由按鈕的 aria-label 給。 */
  prev: svg('<path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'),
  /** 步進的「加」（›）。 */
  next: svg('<path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'),
  /** 復原（↶）。按鈕裡唯一的內容，名字由按鈕的 aria-label 給。 */
  undo: svg('<path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'),
  /** 下拉（▾）。導覽列「遊戲介紹」的 <summary> 用，間距由 chrome.css 給。 */
  down: svg('<path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'),
  /** 重做（↷）。 */
  redo: svg('<path d="m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'),
} as const;

export type IconName = keyof typeof ICONS;
