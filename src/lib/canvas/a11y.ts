// canvas 對鍵盤與讀屏是一塊黑洞：<canvas> 裡畫的東西不會進無障礙樹，Tab 也跳不進去。
// 所以每顆節點另外掛一份「隱形但可聚焦」的真實 DOM：一顆節點一顆 <button>，
// aria-label 沿用 SVG 時期的「名稱，類型，成本」（見 scene.ts 的 ariaLabel）。
import type { Scene } from './scene.js';

export interface NodeButtons { list: HTMLUListElement; byId: Map<string, HTMLButtonElement> }

/**
 * 掛上整棵樹的隱形節點按鈕。
 *
 * 視覺隱藏一律交給 CSS 的 `.tree-a11y`（Task 10 用 clip-path 裁到 1px），
 * 這裡刻意不設 hidden／display:none／visibility:hidden 這三種屬性——
 * 它們會讓元素同時退出 Tab 順序與無障礙樹，等於把這份 DOM 存在的理由砍掉。
 *
 * 方向鍵不在這裡攔截：那是 tree-canvas.ts 掛在 window 上的鍵盤平移，兩邊搶同一個按鍵
 * 會讓「按鈕上按方向鍵」與「畫面平移」互相打架，所以交給呼叫端決定要不要接。
 * 焦點框本身也不畫在按鈕上——它畫在 canvas 上（painter.drawOverlay），這裡只負責
 * 回報「誰拿到焦點」「誰被啟用」，畫面怎麼呈現是呼叫端的事。
 */
export function mountNodeButtons(doc: Document, host: HTMLElement, scene: Scene, handlers: {
  onFocus(id: string): void; onBlur(id: string): void; onActivate(id: string): void;
}): NodeButtons {
  const list = doc.createElement('ul');
  list.className = 'tree-a11y';
  list.setAttribute('aria-label', '骰子樹節點');
  const byId = new Map<string, HTMLButtonElement>();
  for (const n of scene.nodes) {
    const li = doc.createElement('li');
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'tree-a11y-node';
    btn.dataset.id = n.id;
    btn.setAttribute('aria-label', n.ariaLabel);
    btn.textContent = n.label;
    btn.addEventListener('focus', () => handlers.onFocus(n.id));
    btn.addEventListener('blur', () => handlers.onBlur(n.id));
    btn.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handlers.onActivate(n.id); }
    });
    btn.addEventListener('click', () => handlers.onActivate(n.id));
    li.appendChild(btn);
    list.appendChild(li);
    byId.set(n.id, btn);
  }
  host.appendChild(list);
  return { list, byId };
}
