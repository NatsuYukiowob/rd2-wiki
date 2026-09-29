// 「現在疊在畫布上、看得見的浮層」的矩形（視窗座標），餵給 controller 的 `MountOptions.obscurers`。
// /tree 與 /sim 各自決定要量哪幾個元素，「怎樣才算看得見」只有這一份。
import type { ScreenRect } from './canvas-tree.js';

/**
 * 依 id 量元素，只回**現在看得見**的：hidden、0 尺寸、整個在視窗外、`visibility: hidden` 都跳過。
 * ⚠️ 收起來的東西仍量得到 rect（/sim 手機版收起的 sheet 在視窗底下、只是 visibility: hidden），
 * 照扣的話安全區會被扣光（src/pages/CLAUDE.md 的 /sim 一節：只扣現在真的看得見的遮蔽物）。
 * linkedom（單元測試）沒有版面：量不到就當沒有遮蔽，跟 nodeScreenRect() 回 null 同一個退路。
 */
export function visibleRects(ids: readonly string[], doc: Document = document): ScreenRect[] {
  const out: ScreenRect[] = [];
  const vh = doc.defaultView?.innerHeight ?? Infinity;
  for (const id of ids) {
    const el = doc.getElementById(id);
    if (!el || el.hidden || typeof el.getBoundingClientRect !== 'function') continue;
    const r = el.getBoundingClientRect();
    if (!r || r.width <= 0 || r.height <= 0 || r.bottom <= 0 || r.top >= vh) continue;
    if (typeof getComputedStyle === 'function' && getComputedStyle(el).visibility === 'hidden') continue;
    out.push({ left: r.left, top: r.top, width: r.width, height: r.height });
  }
  return out;
}
