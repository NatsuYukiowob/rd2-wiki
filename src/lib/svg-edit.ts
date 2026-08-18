// 行區塊外科手術：在整份 SVG 字串裡定位、替換、插入、刪除節點與邊，全部只做字串操作，
// 不重新序列化（不 loadSvg 再 toString）。理由跟 svg-emit.ts 檔頭是同一個：整檔 diff 會讓
// 維護者失去審查能力，這個專案明確假設「CI 是唯一防線，但 CI 之後還是要有人看得懂 PR 動了什麼」。
// 一個 PR 動三個節點，diff 就該只有三個區塊——這個檔案是那個承諾的落地機制。
//
// 檔案結構（實測，見任務簡報）是嚴格分區的：檔頭 → 邊區段（每條邊恰好一行，無節點夾雜）→
// 節點區段（無邊夾雜）→ `</svg>`。這讓「邊區段末尾」與「節點區段末尾」都是明確定義的插入點，
// 不需要理解整份 SVG 的語意，只要能切出正確的字串範圍。
//
// 跟 svg-emit.ts 一樣刻意不 import linkedom／node:*：src/lib/ 會被 Astro 打包進瀏覽器
// （線上編輯器 /edit 會用），DOM 解析再序列化本身就無法保證「未觸及的位元組不變」。
import { emitEdgeLine } from './svg-emit.js';

/** 節點區塊：非貪婪比對到最近的 `</g>` 是安全的，因為節點內容（shape/image/text）不會巢狀出現 `</g>`。 */
const NODE_BLOCK_RE = /<g class="node"[\s\S]*?<\/g>/g;
/** 邊行：`<path class="edge" ... />`，每條邊在資料裡恰好占一整行，比對到行尾即可。 */
const EDGE_LINE_RE = /<path class="edge"[^\n]*/g;
const ID_RE = /data-id="([^"]*)"/;

/** 把訊息截短給錯誤用，避免區塊本身（可能好幾百字）洗版終端機輸出。跟 svg-emit.ts 的 preview 同款。 */
function preview(text: string): string {
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

/**
 * 掃描整份 SVG，回傳每個節點區塊在原字串中的 `[起, 迄)` 位移，依出現順序（`Map` 的鍵插入順序）。
 * 只取 `data-id` 當鍵，不呼叫 `parseNodeBlock`——這裡只是定位，不需要解析欄位，呼叫端要完整
 * 解析的話自己對切出來的字串呼叫 `parseNodeBlock`（見 svg-emit.ts 的分工說明）。
 */
export function locateNodeBlocks(svgText: string): Map<string, [number, number]> {
  const map = new Map<string, [number, number]>();
  for (const m of svgText.matchAll(NODE_BLOCK_RE)) {
    const idMatch = ID_RE.exec(m[0]);
    if (!idMatch) throw new Error(`節點區塊缺少 data-id，位移 ${m.index}: ${preview(m[0])}`);
    // matchAll 對帶 g 旗標的正則保證每個結果都有 index（內部用複製的正則逐一往前掃），
    // 只是 TS 的 RegExpMatchArray 型別把它標成可選——這裡用非空斷言，跟 svg-emit.ts 對
    // requireMatch() 回傳的捕捉群組一樣的處理方式。
    map.set(idMatch[1]!, [m.index!, m.index! + m[0].length]);
  }
  return map;
}

/** 用新區塊字串整段替換 id 對應的節點區塊，其餘位元組不動。找不到 id 時 throw，不回傳原字串。 */
export function replaceNode(svgText: string, id: string, block: string): string {
  const loc = locateNodeBlocks(svgText).get(id);
  if (!loc) throw new Error(`replaceNode: 找不到節點 ${id}`);
  const [s, e] = loc;
  return svgText.slice(0, s) + block + svgText.slice(e);
}

/** 把新節點區塊插在節點區段末尾（最後一個節點區塊之後），前面補一個換行分隔。 */
export function insertNode(svgText: string, block: string): string {
  const matches = [...svgText.matchAll(NODE_BLOCK_RE)];
  const last = matches[matches.length - 1];
  if (!last) throw new Error('insertNode: SVG 中找不到任何既有節點區塊，無法定位節點區段末尾');
  const end = last.index! + last[0].length;
  return svgText.slice(0, end) + '\n' + block + svgText.slice(end);
}

/**
 * 刪除 id 對應的節點區塊，連同前導的一個 `\n` 一起移除——只刪區塊本身會留下一行空行，
 * `normalizeSvg()`（linkedom 重新序列化）不會保留那個空行，CI 的正規化定點檢查就會產生 diff。
 */
export function removeNode(svgText: string, id: string): string {
  const loc = locateNodeBlocks(svgText).get(id);
  if (!loc) throw new Error(`removeNode: 找不到節點 ${id}`);
  let [s, e] = loc;
  if (svgText[s - 1] === '\n') s -= 1;
  return svgText.slice(0, s) + svgText.slice(e);
}

/** 把新邊行插在邊區段末尾（最後一條 `<path class="edge">` 之後），前面補一個換行分隔。 */
export function insertEdge(svgText: string, line: string): string {
  const matches = [...svgText.matchAll(EDGE_LINE_RE)];
  const last = matches[matches.length - 1];
  if (!last) throw new Error('insertEdge: SVG 中找不到任何既有邊，無法定位邊區段末尾');
  const end = last.index! + last[0].length;
  return svgText.slice(0, end) + '\n' + line + svgText.slice(end);
}

/**
 * 刪除 from→to 對應的邊，連同前導的一個 `\n` 一起移除（理由同 removeNode）。
 * 用 `emitEdgeLine` 把座標組回跟資料裡逐字相符的字串再原文搜尋，不用座標另外寫一套比對邏輯
 * ——保證「怎麼插入就怎麼刪除」，兩邊永遠用同一份格式化規則，不會因為各自維護一套格式而漂移。
 */
export function removeEdge(svgText: string, from: [number, number], to: [number, number]): string {
  const line = emitEdgeLine(from, to);
  const idx = svgText.indexOf(line);
  if (idx === -1) throw new Error(`removeEdge: 找不到邊 ${from.join(',')} → ${to.join(',')}: ${line}`);
  let s = idx;
  const e = idx + line.length;
  if (svgText[s - 1] === '\n') s -= 1;
  return svgText.slice(0, s) + svgText.slice(e);
}
