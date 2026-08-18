import { loadSvg } from './dom.js';
import type { Shape } from '../../src/lib/types.js';

/** 從 SVG `<g class="node">` 抽出的原始節點資料，尚未做語意轉換（分支/元素/花費解析等留給後續任務）。 */
export interface RawNode {
  id: string;
  typeZh: string;
  name: string;
  label: string;
  description: string;
  costRaw: string;
  titleMaxLevel: number | null;
  x: number;
  y: number;
  stroke: string;
  shape: Shape;
  icon: string;
}

/** 從 SVG `<path class="edge">` 抽出的原始邊資料，以座標表示起訖點（尚未對應回節點 id）。 */
export interface RawEdge {
  from: [number, number];
  to: [number, number];
}

/**
 * 骰子樹正中央的樞紐裝飾（遊戲內的「骰子樹」本體）。它不是 239 個節點之一——沒有 id、
 * 沒有花費、不參與成本計算與祖先高亮，純粹是版面上的錨點，五顆起手骰從它放射出去。
 */
export interface RawCenter {
  /** 樞紐圖的中心座標（＝五條放射線的共同起點）。 */
  x: number;
  y: number;
  /** 樞紐圖在畫布上的顯示尺寸 [寬, 高]。 */
  size: [number, number];
  /** 樞紐圖的檔名（相對於 `data/`，不含路徑）。 */
  image: string;
  /** 樞紐連到的節點 id，依 `data-links` 的順序。 */
  links: string[];
  /** 各條放射線的終點座標，順序與 `links` 對應；驗證端用它比對是否真的落在該節點中心。 */
  linkEnds: [number, number][];
  /** 樞紐底下的文字標籤。 */
  label: string;
}

/** SVG 根節點與 `<metadata>` 帶出的圖表中繼資料。 */
export interface RawMeta {
  svgVersion: string;
  gameBundle: string;
  updated: string;
  viewBox: [number, number, number, number];
  center: RawCenter | null;
}

const TRANSLATE = /^translate\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/;
const EDGE_D = /^M\s+(-?[\d.]+)\s+(-?[\d.]+)\s+L\s+(-?[\d.]+)\s+(-?[\d.]+)$/;

/**
 * 解析 `transform="translate(x,y)"`。
 * 資料正本一律使用絕對 translate；若遇到 matrix(...) 等其他形式，代表尚未跑過正規化腳本，直接拋錯提示。
 */
export function parseTranslate(t: string): [number, number] {
  const m = TRANSLATE.exec(t.trim());
  if (!m) throw new Error(`transform 必須是 translate(x,y)，請先執行 npm run normalize：${t}`);
  return [Number(m[1]), Number(m[2])];
}

/**
 * 解析邊的 `d="M x y L x y"`。
 * 資料正本一律使用絕對指令；若遇到相對指令（小寫 m/l）等其他形式，代表尚未跑過正規化腳本，直接拋錯提示。
 */
export function parseEdgePath(d: string): { from: [number, number]; to: [number, number] } {
  const m = EDGE_D.exec(d.trim());
  if (!m) throw new Error(`邊必須是絕對 "M x y L x y"，請先執行 npm run normalize：${d}`);
  return { from: [Number(m[1]), Number(m[2])], to: [Number(m[3]), Number(m[4])] };
}

/**
 * 組出可定位節點的描述字串，供錯誤訊息使用：優先用 `data-id`，取不到時退而求其次用 `data-name`，
 * 兩者都沒有才說明「某個缺少 data-id 的節點」。239 個節點、貢獻者改壞一個時，錯誤訊息必須指出是哪一個。
 */
function nodeRef(g: Element): string {
  const id = g.getAttribute('data-id');
  if (id) return `節點 data-id="${id}"`;
  const name = g.getAttribute('data-name');
  if (name) return `節點 data-name="${name}"（缺少 data-id）`;
  return `某個缺少 data-id 的節點`;
}

/** 依子元素判斷節點形狀：rect＝骰子、4 點 polygon＝符文菱形、circle＝玩家被動、6 點 polygon＝支援六邊形。 */
function shapeOf(g: Element): Shape {
  if (g.querySelector('rect')) return 'rect';
  if (g.querySelector('circle')) return 'circle';
  const poly = g.querySelector('polygon');
  if (poly) {
    const pts = (poly.getAttribute('points') ?? '').trim().split(/\s+/).length;
    if (pts === 4) return 'diamond';
    if (pts === 6) return 'hex';
    throw new Error(`${nodeRef(g)} 的 polygon 頂點數異常：${pts}（預期 4＝符文菱形或 6＝支援六邊形）`);
  }
  throw new Error(`${nodeRef(g)} 缺少形狀元素（rect / circle / polygon 皆無）`);
}

/** stroke 不固定在某種元素上（rect/polygon/circle 皆可能持有），統一從實際存在的形狀元素讀取。 */
function strokeOf(g: Element): string {
  const el = g.querySelector('rect, circle, polygon');
  const s = el?.getAttribute('stroke');
  if (!s) throw new Error(`${nodeRef(g)} 缺少 stroke`);
  return s;
}

/**
 * 解析中央樞紐 `<g class="tree-center">`。整組是選用的——沒有這一組時回傳 null，站台就不畫樞紐，
 * 不會讓舊版正本或精簡測試資料解析失敗。有這一組時每個欄位都必須齊全：缺一個就代表正本被改壞了，
 * 與其畫出半截樞紐（少了圖、或連線接到不存在的節點），不如當場丟錯講清楚是哪個欄位。
 */
function parseCenter(doc: Document, svg: Element): RawCenter | null {
  const g = doc.querySelector('g.tree-center');
  if (!g) return null;

  // 跟節點同一條規矩：正規化後的樞紐必須是 <svg> 直屬子元素、且不帶 transform。少了這兩道，
  // 貢獻者在 Inkscape 裡把樞紐拖進圖層、忘了跑 normalize，解析出來的中心會是「沒有併入圖層
  // 位移」的座標——validate 全綠、站台卻把樞紐畫在跟正本差一個圖層位移的地方。節點那邊丟的是
  // 一樣的錯誤訊息（含「請先執行 npm run normalize」的引導語）。
  if (g.parentNode !== svg) throw new Error('tree-center 必須是 <svg> 直屬子元素，請先執行 npm run normalize');
  if (g.getAttribute('transform')) {
    throw new Error(`tree-center 不可帶 transform（請先執行 npm run normalize）：${g.getAttribute('transform')}`);
  }

  const img = g.querySelector('image');
  if (!img) throw new Error('tree-center 缺少 <image>');
  const image = img.getAttribute('href') ?? '';
  // 檔名格式跟節點圖示一樣要嚴格比對，不能拿 href 直接去接路徑：validate 會用它做 readFileSync，
  // 而 validate 是唯一跑在「不受信任的 fork PR」上的工作。放行任意字串等於送對方一個
  // 「這個路徑存不存在、是不是 PNG」的探測器，而且同一個字串還會被拿去組公開資產的網址。
  if (!/^[a-z0-9][a-z0-9-]*\.png$/.test(image)) {
    throw new Error(`tree-center 的 <image> href 只能是 data/ 底下的 .png 檔名、不可含路徑：${JSON.stringify(image)}`);
  }
  const w = Number(img.getAttribute('width'));
  const h = Number(img.getAttribute('height'));
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    throw new Error(`tree-center 的 <image> 尺寸無效：width="${img.getAttribute('width')}" height="${img.getAttribute('height')}"`);
  }

  // 五條放射線的起點都是樞紐中心，取第一條的起點即可；順帶檢查其餘幾條沒有各自跑掉——
  // 起點不一致代表正本被手改壞了，畫出來會是五條從不同位置發散的線。
  const links = [...g.querySelectorAll('path.tree-center-link')];
  if (links.length === 0) throw new Error('tree-center 缺少 path.tree-center-link');
  const paths = links.map(p => parseEdgePath(p.getAttribute('d') ?? ''));
  const [x, y] = paths[0]!.from;
  for (const { from: [ox, oy] } of paths) {
    if (ox !== x || oy !== y) throw new Error(`tree-center 的放射線起點不一致：(${x}, ${y}) 與 (${ox}, ${oy})`);
  }

  // 圖必須以樞紐中心對齊——站台端（src/lib/render.ts）就是用 c.x - w/2, c.y - h/2 擺這張圖，
  // 正本若擺在別的地方，兩邊畫出來的樞紐會差一段位移，而且沒有任何東西看得出來。
  const ix = Number(img.getAttribute('x'));
  const iy = Number(img.getAttribute('y'));
  if (ix !== x - w / 2 || iy !== y - h / 2) {
    throw new Error(
      `tree-center 的 <image> 必須以樞紐中心對齊：預期 x="${x - w / 2}" y="${y - h / 2}"，實際 x="${ix}" y="${iy}"`,
    );
  }

  const linkIds = (g.getAttribute('data-links') ?? '').trim().split(/\s+/).filter(Boolean);
  if (linkIds.length !== links.length) {
    throw new Error(`tree-center 的 data-links 有 ${linkIds.length} 個 id，但有 ${links.length} 條放射線`);
  }

  return {
    x, y, size: [w, h], image, links: linkIds,
    linkEnds: paths.map(p => p.to),
    label: g.querySelector('text')?.textContent ?? '',
  };
}

/** 解析資料正本 SVG，抽出節點、邊與中繼資料，供後續任務轉換為站台可用的語意資料。 */
export function parseTree(svgText: string): { meta: RawMeta; nodes: RawNode[]; edges: RawEdge[] } {
  const doc = loadSvg(svgText);
  const svg = doc.querySelector('svg')!;
  const vb = (svg.getAttribute('viewBox') ?? '').split(/\s+/).map(Number);
  const metaText = doc.querySelector('metadata')?.textContent ?? '';
  const bundle = /resource bundle ([\d.]+)/.exec(metaText)?.[1] ?? '';

  const meta: RawMeta = {
    svgVersion: svg.getAttribute('data-version') ?? '',
    gameBundle: bundle,
    updated: svg.getAttribute('data-updated') ?? '',
    viewBox: [vb[0]!, vb[1]!, vb[2]!, vb[3]!],
    center: parseCenter(doc, svg),
  };

  const nodes: RawNode[] = [...doc.querySelectorAll('g.node')].map(g => {
    if (g.parentNode !== svg) throw new Error(`${nodeRef(g)} 必須是 <svg> 直屬子元素，請先執行 npm run normalize`);
    const [x, y] = parseTranslate(g.getAttribute('transform') ?? '');
    const title = g.querySelector('title')?.textContent ?? '';
    // 等級行必須取「最後一行」，不是「第二行」——跟 tools/validate.ts 的判定方式一致
    // （見那裡「規則 1」的註解）。data-description 本身可能內嵌換行（多行技能敘述），
    // 這種情況下「最高等級：N」永遠被附加在整段描述之後、也就是最後一行；若像過去這裡
    // 一樣固定取 index 1（第二行），遇到三行以上的多行描述時取到的只是描述本身的第二行，
    // 等級行會被吃掉、maxLevel 靜默變成 1，而且 validate.ts 用的是「最後一行」判定，
    // 兩邊邏輯不一致時 validate 還是會通過，這個 bug 完全沒有防線。
    const titleLines = title.split('\n');
    const levelLine = titleLines.length > 1 ? titleLines[titleLines.length - 1] : undefined;
    const lm = levelLine ? /^最高等級：(\d+)$/.exec(levelLine.trim()) : null;
    const href = g.querySelector('image')?.getAttribute('href') ?? '';
    const icon = /^icons\/([0-9a-f]{12})\.png$/.exec(href)?.[1] ?? '';
    return {
      id: g.getAttribute('data-id') ?? '',
      typeZh: g.getAttribute('data-type') ?? '',
      name: g.getAttribute('data-name') ?? '',
      label: g.querySelector('text')?.textContent ?? '',
      description: g.getAttribute('data-description') ?? '',
      costRaw: g.getAttribute('data-cost') ?? '',
      titleMaxLevel: lm ? Number(lm[1]) : null,
      // 順序很重要：shapeOf 先判斷「有沒有形狀元素」，strokeOf 才去讀該元素的 stroke。
      // 兩者的「找不到元素」條件完全重疊（都是 querySelector('rect, circle, polygon') 落空），
      // 若順序相反，缺形狀元素的節點會先被 strokeOf 攔截、shapeOf 的「缺少形狀元素」分支永遠打不到。
      x, y, shape: shapeOf(g), stroke: strokeOf(g), icon,
    };
  });

  const edges: RawEdge[] = [...doc.querySelectorAll('path.edge')].map(p => {
    const dAttr = p.getAttribute('d') ?? '';
    if (!p.getAttribute('marker-end')) throw new Error(`邊缺少 marker-end，無法判定方向：d="${dAttr}"`);
    return parseEdgePath(dAttr);
  });

  return { meta, nodes, edges };
}
