import { readFileSync, writeFileSync } from 'node:fs';
import { loadSvg } from './lib/dom.js';

const f = (n: number) => n.toFixed(2);

/**
 * 解析 transform 屬性，攤平為 [x, y] 位移量。
 * 只支援平移：`translate(x,y)` 或等價的 `matrix(1,0,0,1,tx,ty)`。
 * 含旋轉／縮放的 matrix（a、b、c、d 不等於 1,0,0,1）無法安全攤平，直接拋錯，
 * 讓貢獻者知道要手動處理，而不是默默忽略造成資料失真。
 */
function readTransform(t: string | null): [number, number] {
  if (!t) return [0, 0];
  const tr = /^translate\(\s*(-?[\d.]+)\s*[, ]\s*(-?[\d.]+)\s*\)$/.exec(t.trim());
  if (tr) return [Number(tr[1]), Number(tr[2])];
  // SVG 規範允許 matrix(...) 的參數用逗號或空白分隔，跟上面 translate 分支一致；
  // 這裡曾經寫死只接受逗號（`\s*,\s*`），漏改成跟 translate 一樣的 `[, ]`。
  const mx = /^matrix\(\s*1\s*[, ]\s*0\s*[, ]\s*0\s*[, ]\s*1\s*[, ]\s*(-?[\d.]+)\s*[, ]\s*(-?[\d.]+)\s*\)$/.exec(t.trim());
  if (mx) return [Number(mx[1]), Number(mx[2])];
  throw new Error(`無法正規化的 transform（僅支援平移）: ${t}`);
}

/**
 * 把邊的路徑 `d` 屬性正規化為絕對指令 `M x y L x y`。
 * 支援輸入：已經是絕對形式（原樣重新格式化），或 Inkscape 常見的相對形式 `m dx dy dx2 dy2`。
 * `dx`/`dy` 是邊所在圖層的累積位移（見 `normalizeSvg()` 的 `ancestorOffset()`）——邊如果包在
 * 圖層 `<g transform="translate(...)">` 裡，圖層本身會被攤平拿掉，位移必須先併入座標，否則邊會
 * 整批偏移到圖層攤平前的位置（節點那邊已經有做這件事，這裡原本漏做）。
 */
function normalizePath(d: string, dx = 0, dy = 0): string {
  const tokens = d.trim().split(/[\s,]+/);
  const nums = (i: number) => Number(tokens[i]);
  if (tokens[0] === 'M' && tokens[3] === 'L') {
    return `M ${f(nums(1) + dx)} ${f(nums(2) + dy)} L ${f(nums(4) + dx)} ${f(nums(5) + dy)}`;
  }
  if (tokens[0] === 'm' && tokens.length === 5) {
    const x = nums(1) + dx, y = nums(2) + dy;
    return `M ${f(x)} ${f(y)} L ${f(x + nums(3))} ${f(y + nums(4))}`;
  }
  throw new Error(`無法正規化的路徑: ${d}`);
}

/**
 * 把 GUI 編輯工具（例如 Inkscape）存檔後產生的變形攤平回專案要求的正規形式：
 * - `<g class="node">` 的 transform 一律變成絕對 `translate(x,y)`，且必須是 `<svg>` 的直屬子元素
 *   （若原本包在圖層 `<g>` 裡，把圖層的位移併入節點後搬出來，圖層本身移除）
 * - `<path class="edge">` 的 `d` 一律變成絕對 `M x y L x y`
 * 對已經是正規形式的輸入，重新跑一次不會有任何實質改動（冪等）。
 */
export function normalizeSvg(svgText: string): string {
  const doc = loadSvg(svgText);
  const svg = doc.querySelector('svg')!;

  // 累積某個元素所有祖先 <g>（一路到 <svg> 為止）的 transform 位移。節點與邊都要用同一套
  // 邏輯累加圖層位移，才不會其中一種被漏算（這裡原本只有節點迴圈自己內嵌一份，邊沒有）。
  const ancestorOffset = (el: Element): [number, number] => {
    let x = 0, y = 0;
    let p = el.parentNode as Element | null;
    while (p && p !== svg) {
      const [px, py] = readTransform(p.getAttribute?.('transform') ?? null);
      x += px; y += py;
      p = p.parentNode as Element | null;
    }
    return [x, y];
  };

  for (const g of [...doc.querySelectorAll('g.node')]) {
    const [ox, oy] = readTransform(g.getAttribute('transform'));
    const [px, py] = ancestorOffset(g);
    g.setAttribute('transform', `translate(${f(ox + px)},${f(oy + py)})`);
    if (g.parentNode !== svg) svg.appendChild(g);
  }
  for (const path of [...doc.querySelectorAll('path.edge')]) {
    const [dx, dy] = ancestorOffset(path);
    path.setAttribute('d', normalizePath(path.getAttribute('d') ?? '', dx, dy));
    if (path.parentNode !== svg) svg.appendChild(path);
  }
  // 中央樞紐：整組跟節點走同一套攤平規矩——把「祖先圖層 ＋ 自己」的 transform 併進**所有**
  // 子元素的座標（放射線的 d、圖與標籤的 x/y），清掉 transform，再搬成 <svg> 直屬子元素。
  //
  // 三件事都不能少，各自對應一個真的會壞的情形：
  // - 只折 d、不清 transform ⇒ 位移被套兩次（transform 還在，座標又已經加過），而且每跑一次
  //   normalize 就再飄一次，冪等性直接破功。
  // - 只折 d、不折圖與標籤的 x/y ⇒ 外層圖層被下面的攤平迴圈連 transform 一起刪掉之後，
  //   五條腳跑到新位置、樹的圖還留在原地，正本看起來就是「圖跟腳分家」。
  // - 不搬出群組 ⇒ 樞紐留在圖層裡，parseCenter 會擋下來（要求 <svg> 直屬子元素）。
  //
  // 必須排在下面「攤平圖層」之前：那一段會把祖先 wrapper 連同它的 transform 一起移除，
  // 位移在那之後就再也讀不到了。
  const hub = doc.querySelector('g.tree-center');
  if (hub) {
    const [ax, ay] = ancestorOffset(hub);
    const [ox, oy] = readTransform(hub.getAttribute('transform'));
    const [dx, dy] = [ax + ox, ay + oy];
    for (const path of [...hub.querySelectorAll('path.tree-center-link')]) {
      path.setAttribute('d', normalizePath(path.getAttribute('d') ?? '', dx, dy));
    }
    for (const el of [...hub.querySelectorAll('image, text')]) {
      if (el.hasAttribute('x')) el.setAttribute('x', f(Number(el.getAttribute('x')) + dx));
      if (el.hasAttribute('y')) el.setAttribute('y', f(Number(el.getAttribute('y')) + dy));
    }
    hub.removeAttribute('transform');
    if (hub.parentNode !== svg) svg.appendChild(hub);
  }
  // 攤平圖層：節點與邊已經在上面各自搬出（並修正座標），這裡處理的是 wrapper 底下「剩下」
  // 的任何內容（理論上不該有，但沒有任何規則保證圖層裡只會有節點跟邊）——一律原封不動搬到
  // <svg> 底下再移除空 wrapper，不能連 wrapper 一起整組刪掉，那會把還沒被上面兩個迴圈認得的
  // 內容一併銷毀（這正是這次修的 bug：舊版直接 `wrapper.remove()`，邊還留在 wrapper 裡就被
  // 陪葬）。用 while 迴圈是為了處理圖層疊圖層（Inkscape 巢狀群組）的情況：每輪把「目前是
  // <svg> 直屬子元素」的 wrapper 攤平一層，內層的 wrapper 會在下一輪變成直屬子元素再被處理。
  // `:not(.tree-center)`：中央樞紐是刻意保留的群組，不是 GUI 工具留下的圖層 wrapper。
  // 少了這個排除條件，normalize 會把樞紐拆散、子元素散落到 <svg> 底下，parseTree 找不到
  // g.tree-center 就當作「沒有樞紐」——站台安靜地少畫一塊，而且 validate 也不會抱怨。
  let wrappers = [...doc.querySelectorAll('svg > g:not(.node):not(.tree-center)')];
  while (wrappers.length > 0) {
    for (const wrapper of wrappers) {
      for (const child of [...wrapper.children]) svg.appendChild(child);
      wrapper.remove();
    }
    wrappers = [...doc.querySelectorAll('svg > g:not(.node):not(.tree-center)')];
  }
  return doc.toString();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2] ?? 'data/dice-tree.svg';
  writeFileSync(file, normalizeSvg(readFileSync(file, 'utf8')));
  console.log(`normalized ${file}`);
}
