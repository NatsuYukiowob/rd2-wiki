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
const svg = (body: string, viewBox = '0 0 24 24'): string =>
  `<svg class="icon" viewBox="${viewBox}" aria-hidden="true" focusable="false">${body}</svg>`;

export const ICONS = {
  /** 骰點品牌標：圓角骰面＋對角三點（骰子的「3」）。 */
  brand: svg(
    '<rect x="2.5" y="2.5" width="19" height="19" rx="5" fill="none" stroke="currentColor" stroke-width="2"/>'
    + '<circle cx="8" cy="8" r="1.8" fill="currentColor"/>'
    + '<circle cx="12" cy="12" r="1.8" fill="currentColor"/>'
    + '<circle cx="16" cy="16" r="1.8" fill="currentColor"/>',
  ),
  /** 往前（連結的「進去」）。取代文字 `→`。 */
  arrow: svg('<path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'),
  /** 往回（「← 活動」這種回上一層的路標）。 */
  back: svg('<path d="M19 12H6M11 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'),
} as const;

export type IconName = keyof typeof ICONS;
