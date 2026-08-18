import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { readPngSize } from './lib/png.js';
import type { Shape } from '../src/lib/types.js';

/**
 * 把「遊戲原圖」裡每個節點的實際長相，用真的瀏覽器渲染成一張獨立 PNG 寫進 `data/icons/`，
 * 並把資料正本 `data/dice-tree.svg` 的圖示引用與顯示尺寸一併改成對應的新值。
 *
 * ## 為什麼要用瀏覽器，不自己合成
 *
 * 原圖的節點不是「一個節點一張圖」，是好幾層疊出來的。以玩家被動 1101 為例：
 *
 *     <g class="node-body" filter="url(#node-shadow)">
 *       <use class="node-icon" href="#sprite-188">          ← 外圈底盤（圖片）
 *       <circle r="32" fill="url(#passive-big-gradient)">   ← 漸層內圓（SVG 圖形，不是圖片）
 *       <use class="node-icon-flat" href="#sprite-33">      ← 符號，帶 CSS filter
 *     </g>                                                     brightness(.72) saturate(1.4) hue-rotate(10deg)
 *
 * 要在建置期自己疊出同樣的結果，等於重寫一份 SVG 濾鏡與漸層的實作（`feDropShadow`、
 * `linearGradient`、CSS `filter` 的色彩空間），寫得再小心也只會是「很像」。交給 Chromium
 * 算則是定義上就一樣——它就是使用者最後會看到那個東西的同一個算繪器。
 *
 * ## 為什麼產物要進版控、而不是每次建置現算
 *
 * `data/icons/` 是資料正本的一部分，社群 PR 會直接改它，CI 也逐檔驗雜湊（規則 7）。
 * 把「需要一顆瀏覽器」塞進建置流程會讓 CI 與貢獻者的本機環境都多背一個重相依，而這件事
 * 一年也跑不了幾次（只有遊戲改版、重畫原圖時才跑）。所以這支是**維護用的一次性腳本**，
 * 不掛在 `npm run build` 上。
 *
 * ## 用法
 *
 *     npm run render-nodes -- [原圖路徑]
 *
 * 跑完 `data/icons/` 會被整個換掉、`data/dice-tree.svg` 的每個節點會指向新圖並帶上新的
 * 顯示尺寸。之後照常跑 `npm run validate`／`npm test`／`npm run build`。
 */

/** 原圖的座標系是站台的兩倍（見 CLAUDE.md「版面來自遊戲內的原圖」：座標取原圖 ×0.5）。 */
const DRAWING_TO_SITE = 0.5;
/**
 * 瀏覽器的算繪倍率。輸出 PNG 的邊長＝站台顯示尺寸 ×（1/DRAWING_TO_SITE）× SCALE ＝ 4 倍。
 *
 * 取 4 倍而不是剛好 2 倍：最小的符文站台只有約 26 單位寬，2 倍後最長邊 52px，會撞到驗證
 * 規則 7(c) 的「最長邊至少 96px」。4 倍讓每一類都安全過線，也給高解析輸出（buildHiRes 取
 * 顯示尺寸的 2 倍）留下往下縮的餘裕。
 */
const SCALE = 2;
/** PNG 像素 → 站台顯示尺寸的換算倍率。 */
const PX_PER_SITE_UNIT = SCALE / DRAWING_TO_SITE;

const SRC = process.argv[2]
  ?? '/mnt/data/share/Yuki/random dice 2 dice tree/RD2骰子樹v1.0.1/dice_tree_v1.0.1_fixed.svg';
const OUT_DIR = 'data/icons';
const CANONICAL = 'data/dice-tree.svg';

const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ''));

/**
 * 依顯示尺寸算出「要用哪個正則、換成什麼」來重畫正本裡那個裝飾用的形狀元素。
 *
 * 回傳描述而不是直接做替換：是否真的替換成功一律交給 mustReplace() 判斷。用「替換前後字串
 * 有沒有變」是錯的——重跑時值本來就一樣，替換成功也會得到相同字串（第一次接這個守衛時就
 * 立刻誤報了）。
 *
 * 形狀本身不能拿掉——`tools/lib/svg-parse.ts` 靠「有 rect / 4 點 polygon / circle / 6 點
 * polygon」判定節點類型，也靠它身上的 `stroke` 判定元素（規則 3）。但它的**大小**純粹是
 * 正本自己被打開來看時的長相；圖示 PNG 現在已經含外框了，這裡只要讓它貼合圖示的框即可。
 */
function reshape(shape: Shape, w: number, h: number): { re: RegExp; to: string } {
  const [hw, hh] = [w / 2, h / 2];
  switch (shape) {
    case 'rect':
      return {
        re: /<rect x="[-\d.]+" y="[-\d.]+" width="[\d.]+" height="[\d.]+" rx="[\d.]+"/,
        to: `<rect x="${num(-hw)}" y="${num(-hh)}" width="${num(w)}" height="${num(h)}" rx="${num(Math.round(w * 0.15))}"`,
      };
    case 'circle':
      return { re: /<circle r="[\d.]+"/, to: `<circle r="${num(Math.round(hw))}"` };
    case 'diamond':
      return {
        re: /points="[^"]*"/,
        to: `points="0,${num(-hh)} ${num(hw)},0 0,${num(hh)} ${num(-hw)},0"`,
      };
    case 'hex':
      return {
        re: /points="[^"]*"/,
        to: `points="0,${num(-hh)} ${num(hw)},${num(-hh / 2)} ${num(hw)},${num(hh / 2)} 0,${num(hh)} ${num(-hw)},${num(hh / 2)} ${num(-hw)},${num(-hh / 2)}"`,
      };
  }
}

function shapeOf(block: string): Shape {
  if (/<rect /.test(block)) return 'rect';
  if (/<circle /.test(block)) return 'circle';
  const pts = /points="([^"]*)"/.exec(block);
  if (pts) return pts[1]!.trim().split(/\s+/).length === 6 ? 'hex' : 'diamond';
  throw new Error(`節點缺少形狀元素：${block.slice(0, 120)}`);
}

const svgText = readFileSync(SRC, 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: SCALE });
await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svgText}</body></html>`, {
  waitUntil: 'load',
});

// 一次只讓一個節點可見。邊與中央樞紐整組關掉——它們會穿過節點底下，留著就會被一起截進去。
// 用切換 class 而不是逐一改 inline style：一次 DOM 寫入，239 輪下來差很多。
// `.tree-center .tree-center-link` 另外處理：樞紐自己被渲染時，那五條放射線不能一起入鏡
// （站台是拿節點座標自己重畫這五條線的，圖裡再帶一份會變成兩層）。
// `svg > rect` 是原圖自己那張 `<rect width="100%" height="100%" fill="#2f2942"/>` 背景矩形，
// 一定要一起藏掉。它沒有 class、又是 <svg> 的直屬子元素（節點自己的 rect 都包在 <g> 裡，
// 不會被這個選擇器掃到）；留著的話 `omitBackground: true` 完全沒有作用——截出來的每張圖都
// 夾帶一塊實心底色，於是站台上每個節點都變成一個不透明方塊：蓋掉從底下穿過的線、蓋掉鄰近
// 節點的標籤，focus 外框與前置鏈的金色光暈也會去描那個方塊而不是按鈕本身。
// `.node-body{filter:none}` 把原圖的投影（`#node-shadow`）從截圖裡拿掉，改由站台用 CSS 畫
// （見 src/pages/tree.astro 的 `.node .icon`）。理由是**圖示的框要剛好等於看得見的底板**：
// 投影是往外糊開的半透明區塊，留在圖裡的話，框會比底板大一圈，於是鍵盤 focus 的外框、前置鏈
// 的金色光暈都會去描那一圈空白而不是按鈕本身（image8 回報）。投影改成 CSS 還多一個好處——
// 它會跟著縮放走，不會在放大後變成一塊糊掉的貼圖。
//
// `.dice-shadow` 同理但更明顯：那是骰子往左下投出去的黑色剪影，比底板本身還寬，留著會讓
// 圖示的框比看得見的底板多出一圈（image8 回報的黃框與紅線的落差就是它）。
await page.addStyleTag({
  content:
    'svg > rect{display:none}' +
    '.node-body{filter:none !important}.dice-shadow{display:none}' +
    '.edge,.tree-center{display:none}.node{display:none}.node.solo{display:inline}' +
    '.tree-center.solo{display:inline}.tree-center.solo .tree-center-link{display:none}',
});

const ids: string[] = await page.$$eval('[data-node-id]', els =>
  els.map(e => e.getAttribute('data-node-id')!),
);
if (ids.length === 0) throw new Error(`${SRC} 裡找不到任何 [data-node-id] 節點`);

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

/** 節點 id → { 圖示雜湊, 站台顯示尺寸 }。尺寸一律回頭讀 PNG 的實際像素再換算，不用瀏覽器
 *  回報的 bounding box：截圖時的裁切框會被取整成整數像素，兩者會差到零點幾，長寬比對不上
 *  就會讓 sprite 的格子與站台畫的 <rect> 錯位（見 src/lib/render.ts 對 pattern 對齊的說明）。 */
const info = new Map<string, { hash: string; size: [number, number] }>();

for (const id of ids) {
  await page.evaluate(x => {
    document.querySelector('.node.solo')?.classList.remove('solo');
    document.querySelector(`[data-node-id="${x}"]`)!.classList.add('solo');
  }, id);

  const buf = await page.locator(`[data-node-id="${id}"]`).screenshot({ omitBackground: true });
  const hash = createHash('sha256').update(buf).digest('hex').slice(0, 12);
  writeFileSync(`${OUT_DIR}/${hash}.png`, buf);

  const px = readPngSize(buf);
  if (!px) throw new Error(`節點 ${id} 截出來的不是有效 PNG`);
  // 取整：sprite 的格子尺寸就是這個值，而格子要拿去做點陣圖縮放，必須是整數像素。
  // 截圖的裁切框本來就會被瀏覽器取整，除以 4 之後不見得整除（實測骰子會算出 52.5），
  // 這裡統一收斂到整數，讓「正本的框 → sprite 格子 → pattern tile」三者是同一個數字。
  // 代價是最多半個單位的長寬比誤差，打包時 fit: 'inside' 會補成留白，肉眼看不出來。
  info.set(id, {
    hash,
    size: [Math.round(px.width / PX_PER_SITE_UNIT), Math.round(px.height / PX_PER_SITE_UNIT)],
  });
}

// --- 中央樞紐：同一套做法，整組（底板＋骰子樹圖示＋五個淡淡的分支符號）渲染成一張圖 ---
// 分支符號的 opacity 只有 .22、還各自套了一個色相濾鏡（tree-center-stat-color-N），
// 自己合成同樣會是「很像」；交給瀏覽器一次解決。放射線在上面的樣式裡關掉了，理由見那裡。
await page.evaluate(() => {
  document.querySelector('.node.solo')?.classList.remove('solo');
  document.querySelector('.tree-center')!.classList.add('solo');
});
const hubBuf = await page.locator('.tree-center').screenshot({ omitBackground: true });
writeFileSync('data/tree-center.png', hubBuf);
const hubPx = readPngSize(hubBuf);
if (!hubPx) throw new Error('樞紐截出來的不是有效 PNG');
const hubSize: [number, number] = [
  Math.round(hubPx.width / PX_PER_SITE_UNIT),
  Math.round(hubPx.height / PX_PER_SITE_UNIT),
];

await browser.close();

// --- 把結果寫回資料正本 ---
let canonical = readFileSync(CANONICAL, 'utf8');
let patched = 0;
/**
 * 做一次替換，並確認它真的發生了。
 *
 * `String.replace` 比對不到時會**原樣回傳**，不會報錯——所以「跑完沒爆」跟「改好了」是兩件事。
 * 這裡的三個正則都依賴屬性順序與 class 名稱（例如 `href x y width height`、
 * `<text class="dice-label" y="…">`），日後任何一次 normalize 調整屬性順序都會讓它們默默失效：
 * 圖示雜湊留在正本裡指向 `rmSync(OUT_DIR)` 已經刪掉的檔案，validate 才會爆出 239 個規則
 * 7(a) 錯誤，而且完全看不出是哪一步說了謊。下面的樞紐改寫已經用旗標確認過，節點這邊當時
 * 只數了區塊數（每個區塊必定 +1，等於什麼都沒驗），code review 抓到後改成一致的做法。
 */
function mustReplace(text: string, re: RegExp, to: string, what: string, id: string): string {
  let hit = false;
  const out = text.replace(re, (...args) => {
    hit = true;
    return to.replace(/\$1/, String(args[1] ?? ''));
  });
  if (!hit) throw new Error(`節點 ${id} 的${what}沒有被改到——正本的格式可能變了，${re}`);
  return out;
}

canonical = canonical.replace(/<g class="node"[\s\S]*?<\/g>/g, block => {
  const id = /data-id="(\d+)"/.exec(block)![1]!;
  const it = info.get(id);
  if (!it) throw new Error(`原圖沒有節點 ${id}，正本與原圖的節點集合對不上`);
  const [w, h] = it.size;
  const shape = reshape(shapeOf(block), w, h);
  let b = mustReplace(block, shape.re, shape.to, '形狀元素', id);
  b = mustReplace(
    b,
    /<image href="icons\/[0-9a-f]{12}\.png" x="[-\d.]+" y="[-\d.]+" width="[\d.]+" height="[\d.]+"/,
    `<image href="icons/${it.hash}.png" x="${num(-w / 2)}" y="${num(-h / 2)}" width="${num(w)}" height="${num(h)}"`,
    '圖示引用',
    id,
  );
  // 標籤位置跟 src/lib/render.ts 的 h/2 + 15 對齊，讓正本與站台畫出來的位置一致。
  // 那個 15（不是更貼的 12）是留給鍵盤 focus 外框的：外框掛在圖示的 rect 上、往外擴
  // 2px 間距 ＋ 2px 線寬，貼太近會壓到標籤上緣（E2E 測試 H 會擋）。
  b = mustReplace(b, /(<text class="[a-z-]+" )y="[-\d.]+"/, `$1y="${Math.round(h / 2 + 15)}"`, '標籤位置', id);
  patched++;
  return b;
});
if (patched !== info.size) throw new Error(`正本只改到 ${patched} 個節點，原圖有 ${info.size} 個`);

// 樞紐的圖必須以樞紐中心對齊（tools/lib/svg-parse.ts 的 parseCenter 會強制檢查），
// 所以這裡從放射線的共同起點回推 x/y，不是沿用舊值。
const origin = /<path class="tree-center-link" d="M ([-\d.]+) ([-\d.]+)/.exec(canonical);
if (!origin) throw new Error('正本找不到樞紐的放射線，無法回推中心');
const [cx, cy] = [Number(origin[1]), Number(origin[2])];
// 用「有沒有比對到」判斷，不是「前後字串有沒有變」：樞紐尺寸剛好跟上次一樣時，替換結果
// 與原文相同，比字串會誤判成「沒改到」而中斷整個流程（第一次接上這段時就踩到了）。
let hubPatched = false;
canonical = canonical.replace(
  /<image href="tree-center\.png" x="[-\d.]+" y="[-\d.]+" width="[\d.]+" height="[\d.]+"/,
  () => {
    hubPatched = true;
    return `<image href="tree-center.png" x="${num(cx - hubSize[0] / 2)}" y="${num(cy - hubSize[1] / 2)}" width="${num(hubSize[0])}" height="${num(hubSize[1])}"`;
  },
);
if (!hubPatched) throw new Error('正本的樞紐 <image> 沒有被改到');
writeFileSync(CANONICAL, canonical);

const files = readdirSync(OUT_DIR).filter(f => f.endsWith('.png'));
console.log(`渲染 ${info.size} 個節點 → ${files.length} 張不重複圖示（同圖自動去重），正本已更新`);
console.log(`中央樞紐 ${hubSize[0]}x${hubSize[1]}（含五個分支符號）`);
const bySize = new Map<string, number>();
for (const { size } of info.values()) {
  const k = `${size[0]}x${size[1]}`;
  bySize.set(k, (bySize.get(k) ?? 0) + 1);
}
console.log('站台顯示尺寸分佈：');
for (const [k, v] of [...bySize].sort((a, b) => b[1] - a[1])) console.log(`  ${k} × ${v}`);
