/**
 * canvas 沒有 CSS 層疊，顏色與字型要自己從 token 讀。**預設值必須等於 tokens.css 的正本**——
 * 它只在沒有版面引擎（linkedom）時用到，但漂移了就是兩份色碼（已刪的舊 SVG 渲染器曾有第二份金色色碼的坑）。
 *
 * ⚠️ 2026-09-06 對 tokens.css 逐值核對過一次，DEFAULT_THEME 有兩個值跟原始 brief 草稿不一致，
 * 已改成以 tokens.css 為準（詳見這個任務的報告檔）：`fg` 是 `#f3f1f6` 不是 `#f7f3ff`；
 * `borderStrong` 是 `#575563` 不是 `#4a4655`。
 */
export interface Theme {
  bg: string;
  fg: string;
  edge: string;
  gold: string;
  surface1: string;
  borderStrong: string;
  font: string;
  fontNum: string;
  labelPx: number; // --fs-xs 換算成 px
  shadow: string; // rgb(10 7 18 / 48%)
}

export const DEFAULT_THEME: Theme = {
  bg: '#17161a',
  fg: '#f3f1f6',
  edge: '#a89ad3',
  gold: '#ffd66f',
  surface1: '#26252b',
  borderStrong: '#575563',
  font: "'Noto Sans TC', 'Microsoft JhengHei', sans-serif",
  fontNum: "'Archivo', 'Noto Sans TC', 'Microsoft JhengHei', sans-serif",
  labelPx: 12, // --fs-xs: 0.75rem，用預設 16px 根字級換算
  shadow: 'rgb(10 7 18 / 48%)',
};

/**
 * 從 `root` 讀 `:root` 的 CSS 自訂屬性組出 Theme。`root` 傳 `null`（測試環境沒有真正的
 * `document`）或 `getComputedStyle` 讀不到任何東西（linkedom 沒有樣式引擎，`getPropertyValue`
 * 一律回空字串）時，逐個欄位各自退回 `DEFAULT_THEME` 的值——不是整包放棄，因為部署環境
 * 可能只是還沒套用某幾個 token（例如新加的一組），其餘讀得到的仍要照真的來。
 */
export function readTheme(root: Element | null): Theme {
  if (!root || typeof getComputedStyle !== 'function') return DEFAULT_THEME;
  let cs: CSSStyleDeclaration;
  try {
    cs = getComputedStyle(root);
  } catch {
    return DEFAULT_THEME;
  }
  const v = (name: string, fallback: string) => {
    const raw = cs.getPropertyValue(name).trim();
    return raw || fallback;
  };
  const rem = parseFloat(cs.fontSize) || 16;
  const fsXs = v('--fs-xs', '');
  const labelPx = fsXs.endsWith('rem')
    ? parseFloat(fsXs) * rem
    : fsXs.endsWith('px')
      ? parseFloat(fsXs)
      : DEFAULT_THEME.labelPx;
  return {
    bg: v('--bg', DEFAULT_THEME.bg),
    fg: v('--fg', DEFAULT_THEME.fg),
    edge: v('--edge', DEFAULT_THEME.edge),
    gold: v('--gold', DEFAULT_THEME.gold),
    surface1: v('--surface-1', DEFAULT_THEME.surface1),
    borderStrong: v('--border-strong', DEFAULT_THEME.borderStrong),
    font: v('--font', DEFAULT_THEME.font),
    fontNum: v('--font-num', DEFAULT_THEME.fontNum),
    labelPx,
    shadow: DEFAULT_THEME.shadow,
  };
}
