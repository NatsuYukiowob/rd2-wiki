// /tree ⇄ /sim 的模式切換鈕（src/components/ModeSwitch.astro）帶到另一頁的網址參數：
// `?node=` 選取的節點、`?view=cx,cy,ppu` 畫面中心的 world 座標與 px/unit。
// 帶 world 中心而不是 tx/ty：兩頁的浮層與容器尺寸不同，對得上的只有「中心看哪裡、看多大」。
// 落地頁套用後就把參數從網址拿掉（/sim 刻意不做網址分享，見 sim.astro 檔頭）。
import type { CanvasView, ViewGeometry } from './canvas/view';

export interface CarriedView { cx: number; cy: number; ppu: number }

export function modeSwitchHref(path: string, node: string | null, view: ViewGeometry): string {
  const [w, h] = view.cssSize;
  const [cx, cy] = view.screenToWorld(w / 2, h / 2);
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
export function applyCarriedView(view: CanvasView, c: CarriedView): void {
  const [w, h] = view.cssSize;
  view.zoomAt(c.ppu / view.pxPerUnit, w / 2, h / 2);
  const [sx, sy] = view.worldToScreen(c.cx, c.cy);
  view.pan(w / 2 - sx, h / 2 - sy);
}
