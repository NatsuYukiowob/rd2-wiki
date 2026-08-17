import type { XmlParser } from './dom.js';
import type { Shape } from './types.js';

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

/** SVG 根節點與 `<metadata>` 帶出的圖表中繼資料。 */
export interface RawMeta {
  svgVersion: string;
  gameBundle: string;
  updated: string;
  viewBox: [number, number, number, number];
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

/** 解析資料正本 SVG，抽出節點、邊與中繼資料，供後續任務轉換為站台可用的語意資料。 */
export function parseTreeWith(
  svgText: string,
  parseXml: XmlParser,
): { meta: RawMeta; nodes: RawNode[]; edges: RawEdge[] } {
  const doc = parseXml(svgText);
  const svg = doc.querySelector('svg')!;
  const vb = (svg.getAttribute('viewBox') ?? '').split(/\s+/).map(Number);
  const metaText = doc.querySelector('metadata')?.textContent ?? '';
  const bundle = /resource bundle ([\d.]+)/.exec(metaText)?.[1] ?? '';

  const meta: RawMeta = {
    svgVersion: svg.getAttribute('data-version') ?? '',
    gameBundle: bundle,
    updated: svg.getAttribute('data-updated') ?? '',
    viewBox: [vb[0]!, vb[1]!, vb[2]!, vb[3]!],
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
