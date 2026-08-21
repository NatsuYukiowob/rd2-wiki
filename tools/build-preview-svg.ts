import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadNodeText, MAX_TEXT_LENGTH, type NodeTextMap } from './lib/node-text.js';

const CANONICAL = 'data/dice-tree.svg';
const NODES = 'data/nodes.json';
const OUT = 'data/dice-tree.preview.svg';

/**
 * `<text>` 的基線相對節點中心的位移，跟 `src/lib/render.ts` 用同一條公式。
 *
 * 那個 15（不是更貼的 12）是留給鍵盤 focus 外框的：外框掛在圖示的 rect 上、往外擴 2px 間距
 * ＋ 2px 線寬，貼太近會壓到標籤上緣（E2E 測試 H 會擋）。這段公式在 #21 PR2 之前住在
 * `tools/render-nodes.ts`，因為正本上還有 `<text>` 要它去改寫；現在正本只有幾何，公式跟著
 * 標籤一起搬到這裡——預覽檔是唯一還會畫出標籤的地方。
 */
const labelY = (h: number) => Math.round(h / 2 + 15);

/** id 標記畫在圖示正上方，跟標籤分別在節點的兩側，不會互相壓到。 */
const idY = (h: number) => Math.round(-h / 2 - 4);

/**
 * 依字數縮小標籤字級，讓長標籤不至於糊成一片。
 *
 * ⚠️ **只套用在 `mini-label`**：這幾個值是相對它的 8px 基準挑的，套到 10px 的 `dice-label`
 * 上會把骰子名字縮得比設計小。骰子只有 41 顆、名字都短，本來就不需要。
 *
 * #21 PR2 之前，正本上有 49 個 mini-label 帶著手調的 `style="font-size:…"`，另外 149 個沒有。
 * 那 49 個既不是幾何的函數也不是字數的函數（7px 涵蓋 4–8 字、預設 8px 涵蓋 2–9 字，完全重疊），
 * 是逐個用眼睛調出來的，沒有任何東西驗它。預覽檔是產生物，改用一條對 198 個一致生效的規則。
 */
function miniFontSize(label: string): number | null {
  const len = [...label].length;
  if (len >= 10) return 5.5;
  if (len >= 8) return 6;
  if (len >= 6) return 7;
  return null;
}

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * 把 `data/nodes.json` 的 `label` 注回正本幾何，產出一份人眼可讀的預覽 SVG。
 *
 * 存在的理由：#21 PR2 把標籤搬進 JSON 之後，正本用瀏覽器或 Inkscape 打開就是 239 個無名圖示，
 * 幾何 PR 無從 review。這支把名字（外加 `data-id`，那才是跟 JSON 對照的鍵）畫回去。
 *
 * 產物**不進版控**，也不該存回正本——`parseTree` 會擋下含 `<text>` 的正本，`npm run normalize`
 * 則會把它刪掉並比對內容。所以檔頭那行註解不是裝飾，它是唯一會在編輯器裡提醒人的東西。
 *
 * 用純文字替換而不是 linkedom 序列化：序列化會重排整份檔案，預覽檔與正本逐行對不起來，
 * 「這次幾何改了什麼」就得靠猜。正本裡零個 `>` `<` `&` 出現在屬性值內，regex 是安全的。
 */
export function buildPreviewSvg(svgText: string, nodeText: NodeTextMap): string {
  const seen = new Set<string>();
  const out = svgText.replace(/<g class="node"[\s\S]*?<\/g>/g, block => {
    const id = /data-id="(\d+)"/.exec(block)?.[1];
    if (!id) throw new Error(`正本有一個節點缺少 data-id：${block.slice(0, 80)}…`);
    const t = nodeText[id];
    if (!t) throw new Error(`節點 ${id} 在 data/nodes.json 裡沒有對應文案`);
    const h = Number(/<image [^>]*height="([\d.]+)"/.exec(block)?.[1]);
    if (!Number.isFinite(h) || h <= 0) throw new Error(`節點 ${id} 的 <image> 沒有可用的 height`);
    seen.add(id);

    const cls = t.type === '骰子' ? 'dice-label' : 'mini-label';
    const size = cls === 'mini-label' ? miniFontSize(t.label) : null;
    const style = size === null ? '' : ` style="font-size:${size}px"`;
    const label = `<text class="${cls}" y="${labelY(h)}"${style}>${escapeXml(t.label)}</text>`;
    const idTag = `<text class="id" y="${idY(h)}">${id}</text>`;
    return block.replace(/<\/g>$/, `${idTag}${label}</g>`);
  });

  const missing = Object.keys(nodeText).filter(id => !seen.has(id));
  if (missing.length > 0) {
    throw new Error(`data/nodes.json 有 ${missing.length} 筆在正本 SVG 裡找不到節點：${missing.join('、')}`);
  }
  return out.replace(
    /^(<\?xml[^>]*\?>\n)/,
    '$1<!-- 產生檔：npm run preview。請勿編輯，也不要存回 data/dice-tree.svg——'
      + '節點標籤的正本是 data/nodes.json 的 label 欄位。 -->\n',
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const nodeText = loadNodeText(JSON.parse(readFileSync(NODES, 'utf8')), MAX_TEXT_LENGTH);
  const svg = buildPreviewSvg(readFileSync(CANONICAL, 'utf8'), nodeText);
  writeFileSync(OUT, svg);
  console.log(`${OUT}（${Object.keys(nodeText).length} 個節點標籤，用瀏覽器開來看版面；此檔不進版控）`);
}
