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
 * 把序列化結果中「屬性值內」的字面換行編成 `&#10;` 實體，元素內容（例如 <title> 的文字）不動。
 *
 * 為什麼一定要做：XML 規範 §3.3.3 要求 parser 把屬性值內的字面換行正規化成空格。linkedom
 * 沒有實作這條、Chromium 有——同一份檔案兩邊讀出來的 data-cost/data-description 會不一樣。
 * 線上編輯器在瀏覽器解析這份檔案，若不編成實體，節點的成本／描述會各少一個換行，
 * 玩家一改就永久遺失，而且會撞上 validate 規則 1（title 與 data-* 逐字一致）而看不懂原因。
 *
 * 實作方式是掃描字串狀態機而不是正則：屬性值與元素內容都可能含 `"`／`<`／`>`，
 * 用正則區分兩者會在多行描述上誤判。
 *
 * 除了一般標籤，狀態機還要認得幾種會混進 `<...>` 的構造，不能被當成一般標籤掃描屬性值──
 * 否則裡面的引號會去切換給屬性值用的 `quote` 旗標，接下來每一個字面換行（包括 <title> 這類
 * 元素內容的換行）都會被誤編成 `&#10;`：
 * - `<!-- 註解 -->`：註解內容可以出現任意數量、不成對的 `"`／`'`（GUI 匯出工具很常見，例如
 *   `<!-- Bob's export -->`），奇數個引號會讓 `quote` 卡在開啟狀態、再也關不上（這是實測重現過
 *   的 bug：一路吃到檔尾，把後面所有 <title> 換行都當成屬性值換行誤編碼）。整段原樣照抄，
 *   完全不掃描內容、不切換 `quote`。
 * - `<![CDATA[ ... ]]>`：內容屬於元素內容（不是屬性值），換行不編碼，跟 <title> 一致，原樣照抄。
 * - `<? ... ?>` 處理指令（含檔案開頭的 `<?xml version="1.0" encoding="utf-8"?>`）：內容不是
 *   屬性值語意，原樣照抄跳過，不依賴「內部剛好引號成對」這個外部假設（目前之所以沒出過事，
 *   純粹是因為 XML 宣告的假屬性語法本來就強制引號成對，屬於巧合而非保證）。
 * - `<!DOCTYPE ...>`：本專案的 SVG 不會有 DOCTYPE，但正確性不該建立在這個假設上。若有內部子集
 *   `[ ... ]`，先跳過整個中括號區塊（不解析子集內容——不會出現在這個工具的輸入裡，解析它的
 *   價值不值得對應的複雜度），只在括號深度回到 0 時遇到的 `>` 才算宣告結束。
 *
 * 用 `Array.from(xml)` 依 code point（而非 UTF-16 code unit）切成陣列再逐一比對定界符，是因為
 * 要對 `<!--`／`]]>`／`?>` 這類多字元定界符做前瞻比對，同時仍要保持逐 code point 安全——
 * CJK 罕見字／emoji 這類 astral 字元是 surrogate pair，直接用字串索引切片會把一個字元劈成兩半。
 */
export function encodeAttributeNewlines(xml: string): string {
  const chars = Array.from(xml);
  const n = chars.length;
  let out = '';
  let i = 0;
  let inTag = false;
  let quote: '"' | "'" | null = null;

  // 比對 chars 陣列從 at 開始是否等於 seq（seq 只會是 ASCII 定界符字面量，逐字元比對即可）。
  const matchesAt = (seq: string, at: number): boolean => {
    for (let j = 0; j < seq.length; j++) {
      if (chars[at + j] !== seq[j]) return false;
    }
    return true;
  };
  // 註解／CDATA／處理指令是同一種形狀：找到起始定界符後，整段原樣照抄到對應的結束定界符為止，
  // 過程完全不掃描引號、不編碼換行（找不到結束定界符就照抄到檔尾——容錯優先於拋錯，這支工具
  // 的職責是正規化既有檔案，不是驗證 XML 是否合法，那是 validate.ts 的工作）。
  const copyVerbatimSection = (endDelim: string, contentStart: number): number => {
    let end = -1;
    for (let k = contentStart; k <= n - endDelim.length; k++) {
      if (matchesAt(endDelim, k)) { end = k; break; }
    }
    const stop = end === -1 ? n : end + endDelim.length;
    out += chars.slice(i, stop).join('');
    return stop;
  };

  while (i < n) {
    if (!inTag && chars[i] === '<') {
      if (matchesAt('<!--', i)) { i = copyVerbatimSection('-->', i + 4); continue; }
      if (matchesAt('<![CDATA[', i)) { i = copyVerbatimSection(']]>', i + 9); continue; }
      if (matchesAt('<?', i)) { i = copyVerbatimSection('?>', i + 2); continue; }
      if (matchesAt('<!DOCTYPE', i)) {
        let depth = 0;
        let k = i + 9;
        for (; k < n; k++) {
          if (chars[k] === '[') depth++;
          else if (chars[k] === ']') depth--;
          else if (chars[k] === '>' && depth <= 0) { k++; break; }
        }
        out += chars.slice(i, k).join('');
        i = k;
        continue;
      }
      inTag = true;
      out += chars[i];
      i++;
      continue;
    }
    const ch = chars[i];
    if (quote) {
      if (ch === quote) { quote = null; out += ch; }
      else if (ch === '\n') out += '&#10;';
      else if (ch === '\r') out += '&#13;';
      else out += ch;
    } else if (inTag) {
      if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '>') inTag = false;
      out += ch;
    } else {
      out += ch;
    }
    i++;
  }
  return out;
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
  // 攤平圖層：節點與邊已經在上面各自搬出（並修正座標），這裡處理的是 wrapper 底下「剩下」
  // 的任何內容（理論上不該有，但沒有任何規則保證圖層裡只會有節點跟邊）——一律原封不動搬到
  // <svg> 底下再移除空 wrapper，不能連 wrapper 一起整組刪掉，那會把還沒被上面兩個迴圈認得的
  // 內容一併銷毀（這正是這次修的 bug：舊版直接 `wrapper.remove()`，邊還留在 wrapper 裡就被
  // 陪葬）。用 while 迴圈是為了處理圖層疊圖層（Inkscape 巢狀群組）的情況：每輪把「目前是
  // <svg> 直屬子元素」的 wrapper 攤平一層，內層的 wrapper 會在下一輪變成直屬子元素再被處理。
  let wrappers = [...doc.querySelectorAll('svg > g:not(.node)')];
  while (wrappers.length > 0) {
    for (const wrapper of wrappers) {
      for (const child of [...wrapper.children]) svg.appendChild(child);
      wrapper.remove();
    }
    wrappers = [...doc.querySelectorAll('svg > g:not(.node)')];
  }
  return encodeAttributeNewlines(doc.toString());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2] ?? 'data/dice-tree.svg';
  writeFileSync(file, normalizeSvg(readFileSync(file, 'utf8')));
  console.log(`normalized ${file}`);
}
