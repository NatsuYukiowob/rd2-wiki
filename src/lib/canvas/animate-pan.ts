// 程式化的緩動平移（easeOutCubic）。/tree 的詳情卡片置中、手機版選節點後把節點挪出抽屜，
// 與 /sim 手機版選節點後把節點挪出抽屜共用這一份——兩頁各寫一份的話，「中間幀不能呼叫
// tree.pan()」這條陷阱就得記兩次（src/lib/canvas/CLAUDE.md「`pan()` 只給收尾用」）。
import type { TreeHandle } from './canvas-tree.js';

/**
 * 以螢幕座標的位移量做一段緩動平移，回傳取消函式。
 *
 * 逐幀累加**差值**而不是每幀重算絕對位置：`view.pan()` 收的就是差值，這樣寫不必知道畫布現在
 * 在哪，也不會跟同一幀裡別的平移互相覆蓋。
 * 中間的每一幀只 `view.pan()` ＋ 排一幀；最後一幀才走 `tree.pan()` 補畫靜態層、把位圖邊距
 * 重新置中——每一幀都走 `tree.pan()` 的話，這段緩動等於重畫 241 顆節點十幾次。
 * 沒有 rAF（linkedom 測試環境）、使用者要求減少動態、或位移不到半格時直接跳到位（同步呼叫 onDone）。
 * 取消時停在半路、不補畫：打斷它的一定是使用者自己動畫布，那條路徑收尾時會補。
 */
export function animatePan(
  tree: Pick<TreeHandle, 'view' | 'pan' | 'requestRedraw'>,
  dx: number, dy: number, ms: number, onDone: () => void,
): () => void {
  const animate = typeof requestAnimationFrame === 'function' && typeof performance !== 'undefined'
    && !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (!animate || (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5)) {
    tree.pan(dx, dy);   // 一步到位＝平移已經結束，走會補畫靜態層的那條
    onDone();
    return () => {};
  }
  const start = performance.now();
  let done = 0;
  let raf = 0;
  const step = (now: number): void => {
    const t = Math.min(1, (now - start) / ms);
    const eased = 1 - (1 - t) ** 3;
    if (t < 1) {
      tree.view.pan(dx * (eased - done), dy * (eased - done));
      tree.requestRedraw();
      done = eased;
      raf = requestAnimationFrame(step);
      return;
    }
    tree.pan(dx * (eased - done), dy * (eased - done));
    raf = 0;
    onDone();
  };
  raf = requestAnimationFrame(step);
  return () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };
}
