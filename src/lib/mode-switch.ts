// /tree ⇄ /sim 的模式切換鈕（src/components/ModeSwitch.astro）帶到另一頁的網址參數：
// `?node=` 選取的節點、`?view=cx,cy,ppu` 可視區中心的 world 座標與 px/unit。
// 帶 world 中心而不是 tx/ty：兩頁的浮層與容器尺寸不同，對得上的只有「中心看哪裡、看多大」。
// 「中心」是**可視區**的中心（相對 host 的 CSS px）：/sim 桌機右邊常駐側欄，可視區是 host 扣掉側欄，
// 拿整個 host 的中心算會偏半個側欄寬（/code-review 抓到，E2E MS1／MS2 守）。
// 落地頁套用後就把參數從網址拿掉（/sim 刻意不做網址分享，見 sim.astro 檔頭）。
import type { CanvasView, ViewGeometry } from './canvas/view';

export interface CarriedView { cx: number; cy: number; ppu: number }
/** 可視區中心，相對 host 的 CSS px。 */
export type VisibleCenter = () => [number, number];

const hostCenter = (view: ViewGeometry): [number, number] => [view.cssSize[0] / 2, view.cssSize[1] / 2];

export function modeSwitchHref(path: string, node: string | null, view: ViewGeometry, center = hostCenter(view)): string {
  const [cx, cy] = view.screenToWorld(center[0], center[1]);
  const p = new URLSearchParams();
  if (node) p.set('node', node);
  p.set('view', `${Math.round(cx)},${Math.round(cy)},${+view.pxPerUnit.toFixed(4)}`);
  return `${path}?${p}`;
}

export function parseViewParam(s: string | null): CarriedView | null {
  const parts = s?.split(',') ?? [];
  if (parts.length !== 3 || parts.some(x => x.trim() === '')) return null;
  const [cx, cy, ppu] = parts.map(Number) as [number, number, number];
  if (![cx, cy, ppu].every(Number.isFinite) || ppu <= 0) return null;
  return { cx, cy, ppu };
}

/** 直接改 `view`，呼叫端自己排重畫（`tree.requestRedraw()`）。倍率由 zoomAt 夾在 MIN／MAX_SCALE 內。 */
export function applyCarriedView(view: CanvasView, c: CarriedView, center = hostCenter(view)): void {
  view.zoomAt(c.ppu / view.pxPerUnit, center[0], center[1]);
  const [sx, sy] = view.worldToScreen(c.cx, c.cy);
  view.pan(center[0] - sx, center[1] - sy);
}

/**
 * 接上另一頁那顆切換鈕：按下那一刻才組網址（選取與視角隨時在變）。pointerdown 讓中鍵／右鍵複製
 * 也拿得到，click 涵蓋鍵盤 Enter。`onLeave` 在同一刻呼叫（/tree 用它把篩選存起來，見 tree-canvas.ts）。
 */
export function wireModeLink(
  path: string, getNode: () => string | null, view: ViewGeometry, center?: VisibleCenter, onLeave?: () => void,
): void {
  const link = document.querySelector<HTMLAnchorElement>('[data-mode-switch]');
  if (!link) return;
  const fill = (): void => { link.href = modeSwitchHref(path, getNode(), view, center?.()); onLeave?.(); };
  link.addEventListener('pointerdown', fill);
  link.addEventListener('click', fill);
}

/**
 * /tree 的篩選（`?branch=`／`?type=`／`?q=`）在去 /sim 的這一趟要保住：/sim 不認得它們，切回來的網址
 * 只有 node／view。離開 /tree 時存在 sessionStorage，帶著 `view` 回來時補回網址裡沒有的那幾個。
 * sessionStorage 在無痕或關掉網站資料時會丟例外，存不了就算了（篩選掉了而已）。
 */
const TREE_FILTER_KEY = 'rd2-wiki:tree-filter';

export function saveTreeFilter(qs: string): void {
  try { sessionStorage.setItem(TREE_FILTER_KEY, qs); } catch { /* 存不了就算了 */ }
}

/** `search` 帶了 `view`（從 /sim 切回來）才補；網址本身有的參數優先。 */
export function withSavedTreeFilter(search: string): string {
  const p = new URLSearchParams(search);
  if (!p.has('view')) return search;
  let saved = '';
  try { saved = sessionStorage.getItem(TREE_FILTER_KEY) ?? ''; } catch { return search; }
  for (const [k, v] of new URLSearchParams(saved)) if (k !== 'node' && !p.has(k)) p.set(k, v);
  return `?${p}`;
}
