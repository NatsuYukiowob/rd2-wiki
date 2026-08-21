import { loadSvg, attr } from './dom.js';
import type { Shape } from '../../src/lib/types.js';

/**
 * 判定「邊的端點對到哪顆節點」「樞紐放射線有沒有接準」時的座標容差（單位＝畫布座標）。
 *
 * 這個數字原本在 tools/validate.ts、tools/build-data.ts、parseCenter 各寫一份 0.5。三份要是
 * 漂開，會出現「validate 認為這條邊接到 A、build-data 認為接到 B」這種兩邊都不報錯的裂縫。
 */
export const COORD_TOLERANCE = 0.5;

/**
 * 座標數字的字面格式。
 *
 * 用 `-?\d+(?:\.\d+)?` 而不是 `-?[\d.]+`：後者會吃下 `1.2.3`、`.`、`...` 這種東西，
 * `Number()` 給回 NaN，而 NaN 一路傳下去只會變成「這條邊哪個節點都對不上」或畫布上一個
 * 看不見的節點——沒有任何一步會說「這裡有個數字是壞的」。
 */
const NUM = String.raw`-?\d+(?:\.\d+)?`;

/**
 * 從 SVG `<g class="node">` 抽出的**幾何**資料，尚未做語意轉換（分支／元素解析留給 build-data）。
 *
 * 文案（名稱、描述、花費、覺醒…）自 2026-08-22 起不在 SVG 裡，改由 `data/nodes.json` 以 `id`
 * 為鍵持有，兩邊在 `tools/lib/node-text.ts` 的 `mergeNodes()` 合併成 `RawNode`。
 */
export interface RawGeomNode {
  id: string;
  /**
   * `<text>` 的內容：畫在節點下方的顯示標籤。
   *
   * 它**不是** `name` 的副本——239 個裡有 60 個是為了塞進小圖示而寫的縮寫
   * （`所有骰子傷害` → `全骰傷害`），是真資料。留在 SVG 是刻意的：沒有它，正本用
   * Inkscape 打開就是 239 個無名圖示，幾何 PR 無從 review。（#21 PR2 會把它也搬走，
   * 屆時改由建置期的 preview SVG 把名字注回去。）
   */
  label: string;
  x: number;
  y: number;
  stroke: string;
  shape: Shape;
  icon: string;
  /**
   * `data-wip="1"`＝「先佔位、之後再接線」。規則 6 讓它豁免根／可達性檢查，所以它是資料裡
   * 唯一一種「不接線也合法」的節點——正因如此，規則 6(d) 反過來禁止它出現在任何邊上。
   *
   * 以前這個旗標只有 validate 自己再查一次 DOM 拿得到，build-data 完全不知道它的存在。
   * 放進 RawGeomNode 讓兩邊看到的是同一份事實。
   */
  wip: boolean;
  /**
   * 節點在畫面上的顯示尺寸 [寬, 高]，直接讀自 `<image>` 的 width/height。
   *
   * 這個值以前是寫在 `src/lib/taxonomy.ts` 的「類型 → 尺寸」對照表裡，改成從正本讀，是因為
   * 2026-08-18 換成遊戲原圖的畫法之後，同樣是「玩家被動」卻有大小兩種（45 個 34×34、
   * 25 個 44×44）——尺寸不再是類型的函數。正本本來就逐節點寫著這個數字，讓它當唯一真相，
   * 比在程式碼裡再維護一份會漂移的對照表可靠。
   */
  size: [number, number];
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
  /** 樞紐的文字標籤。 */
  label: string;
  /**
   * 標籤基線相對樞紐中心的垂直位移，直接讀自正本 `<text>` 的 y。
   *
   * 不用「圖高的一半再加固定間距」推算：樞紐的圖是整組渲染出來的，框裡有大半是那五個
   * 淡淡的分支符號留下的空白，照圖高推算會把標籤丟到底板下面很遠的地方。標籤該落在底板
   * 內的哪個位置是視覺決定，讓正本說了算。
   */
  labelDy: number;
}

/** SVG 根節點與 `<metadata>` 帶出的圖表中繼資料。 */
export interface RawMeta {
  svgVersion: string;
  gameBundle: string;
  /**
   * 遊戲版本，讀自 `<svg data-game-version>`。
   *
   * 跟 `gameBundle` 是兩件事：gameBundle 是「資料抄自哪一版遊戲資源包」（0.0.x 這種內部
   * 編號），這個是玩家在遊戲裡看得到的版本號（v1.0.1）。兩者會各自獨立變動，所以分開存。
   */
  gameVersion: string;
  updated: string;
  viewBox: [number, number, number, number];
  center: RawCenter | null;
}

const TRANSLATE = new RegExp(String.raw`^translate\(\s*(${NUM})\s*,\s*(${NUM})\s*\)$`);
const EDGE_D = new RegExp(String.raw`^M\s+(${NUM})\s+(${NUM})\s+L\s+(${NUM})\s+(${NUM})$`);

/** 把比對到的座標字串轉成數字，並確保它真的是有限數。 */
function finite(raw: string, ctx: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${ctx} 的座標不是有限數：${JSON.stringify(raw)}`);
  return n;
}

/**
 * 節點與邊都不准帶這些「讓東西看不見」的屬性。
 *
 * 少了這道，一條邊可以帶著 `display="none"` 或 `opacity="0"` 躺在正本裡：validate 照樣把它
 * 算進圖遍歷（解析看的是 `d`，不是可見性），前置鏈與成本跟著變，但**打開 SVG 的人什麼都看不到**。
 * 貢獻者送 PR 時附的那張圖、維護者點開正本看到的畫面，都不會有那條線。
 */
const HIDING_ATTRS = ['display', 'visibility', 'style'];

function assertNotHidden(el: Element, ref: string): void {
  for (const a of HIDING_ATTRS) {
    if (el.hasAttribute(a)) throw new Error(`${ref} 不可帶 ${a} 屬性（會讓它在畫面上消失卻仍被算進資料）：${a}="${el.getAttribute(a)}"`);
  }
  for (const a of ['opacity', 'fill-opacity', 'stroke-opacity']) {
    const v = el.getAttribute(a);
    if (v !== null && Number(v) === 0) throw new Error(`${ref} 的 ${a} 不可為 0（會讓它在畫面上消失卻仍被算進資料）`);
  }
}

/**
 * 解析 `transform="translate(x,y)"`。
 * 資料正本一律使用絕對 translate；若遇到 matrix(...) 等其他形式，代表尚未跑過正規化腳本，直接拋錯提示。
 */
export function parseTranslate(t: string): [number, number] {
  const m = TRANSLATE.exec(t.trim());
  if (!m) throw new Error(`transform 必須是 translate(x,y)，請先執行 npm run normalize：${t}`);
  return [finite(m[1]!, 'transform'), finite(m[2]!, 'transform')];
}

/**
 * 解析邊的 `d="M x y L x y"`。
 * 資料正本一律使用絕對指令；若遇到相對指令（小寫 m/l）等其他形式，代表尚未跑過正規化腳本，直接拋錯提示。
 */
export function parseEdgePath(d: string): { from: [number, number]; to: [number, number] } {
  const m = EDGE_D.exec(d.trim());
  if (!m) throw new Error(`邊必須是絕對 "M x y L x y"，請先執行 npm run normalize：${d}`);
  return {
    from: [finite(m[1]!, '邊'), finite(m[2]!, '邊')],
    to: [finite(m[3]!, '邊'), finite(m[4]!, '邊')],
  };
}

/**
 * 組出可定位節點的描述字串，供錯誤訊息使用：優先用 `data-id`，取不到時退而求其次用 `<text>` 標籤，
 * 兩者都沒有才說明「某個缺少 data-id 的節點」。239 個節點、貢獻者改壞一個時，錯誤訊息必須指出是哪一個。
 */
function nodeRef(g: Element): string {
  const id = g.getAttribute('data-id');
  if (id) return `節點 data-id="${id}"`;
  // `data-name` 已隨文案搬進 data/nodes.json，正本上只剩 <text> 的標籤可以當人眼線索。
  const label = g.querySelector('text')?.textContent;
  if (label) return `標籤為「${label}」的節點（缺少 data-id）`;
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
  if (Math.abs(ix - (x - w / 2)) >= COORD_TOLERANCE || Math.abs(iy - (y - h / 2)) >= COORD_TOLERANCE) {
    throw new Error(
      `tree-center 的 <image> 必須以樞紐中心對齊：預期 x="${x - w / 2}" y="${y - h / 2}"，實際 x="${ix}" y="${iy}"`,
    );
  }

  const linkIds = (g.getAttribute('data-links') ?? '').trim().split(/\s+/).filter(Boolean);
  if (linkIds.length !== links.length) {
    throw new Error(`tree-center 的 data-links 有 ${linkIds.length} 個 id，但有 ${links.length} 條放射線`);
  }

  const text = g.querySelector('text');
  return {
    x, y, size: [w, h], image, links: linkIds,
    linkEnds: paths.map(p => p.to),
    label: text?.textContent ?? '',
    labelDy: Number(text?.getAttribute('y') ?? y) - y,
  };
}

/** 解析資料正本 SVG，抽出節點、邊與中繼資料，供後續任務轉換為站台可用的語意資料。 */
export function parseTree(svgText: string): { meta: RawMeta; nodes: RawGeomNode[]; edges: RawEdge[] } {
  const doc = loadSvg(svgText);
  const svg = doc.querySelector('svg')!;
  // viewBox 過去是 `.split(/\s+/).map(Number)` 直接取四格：空字串、逗號分隔、前導空白、
  // 少一個數字、寫成 `0 0 -5 abc`——全都會安靜地產出 undefined／NaN 塞進 meta，站台拿到
  // `viewBox="0 0 NaN NaN"` 就是一片空白，而 CI 全綠。
  const vbRaw = (svg.getAttribute('viewBox') ?? '').trim();
  const vb = vbRaw.split(/[\s,]+/).filter(Boolean).map(Number);
  if (vb.length !== 4 || vb.some(n => !Number.isFinite(n))) {
    throw new Error(`viewBox 必須是四個數字：${JSON.stringify(vbRaw)}`);
  }
  if (vb[2]! <= 0 || vb[3]! <= 0) throw new Error(`viewBox 的寬高必須大於 0：${JSON.stringify(vbRaw)}`);
  const metaText = doc.querySelector('metadata')?.textContent ?? '';
  const bundle = /resource bundle ([\d.]+)/.exec(metaText)?.[1] ?? '';

  const meta: RawMeta = {
    svgVersion: svg.getAttribute('data-version') ?? '',
    gameVersion: svg.getAttribute('data-game-version') ?? '',
    gameBundle: bundle,
    updated: svg.getAttribute('data-updated') ?? '',
    viewBox: [vb[0]!, vb[1]!, vb[2]!, vb[3]!],
    center: parseCenter(doc, svg),
  };

  const nodes: RawGeomNode[] = [...doc.querySelectorAll('g.node')].map(g => {
    if (g.parentNode !== svg) throw new Error(`${nodeRef(g)} 必須是 <svg> 直屬子元素，請先執行 npm run normalize`);
    assertNotHidden(g, nodeRef(g));
    const [x, y] = parseTranslate(g.getAttribute('transform') ?? '');
    // `<title>` 曾經是 `data-name` ＋ `data-description` 的完整副本，規則 1 的存在理由就是守那份
    // 副本。文案搬進 data/nodes.json 之後它沒有任何用途，而「沒用途但仍被接受」的欄位會慢慢
    // 被人填回內容，變成第二份會漂移的文案。在解析階段就擋掉，讓它不可能回來。
    if (g.querySelector('title')) {
      throw new Error(`${nodeRef(g)} 不可含 <title>——名稱與描述寫在 data/nodes.json`);
    }
    const img = g.querySelector('image');
    const href = img?.getAttribute('href') ?? '';
    const icon = /^icons\/([0-9a-f]{12})\.png$/.exec(href)?.[1] ?? '';
    const iw = Number(img?.getAttribute('width'));
    const ih = Number(img?.getAttribute('height'));
    if (!Number.isFinite(iw) || !Number.isFinite(ih) || iw <= 0 || ih <= 0) {
      throw new Error(`${nodeRef(g)} 的 <image> 缺少有效的 width/height（顯示尺寸靠它決定）`);
    }
    // `<text>` 是文案搬進 data/nodes.json 之後，正本上**唯一**剩下的人眼識別（`nodeRef()` 的
    // 退路也是它）。它同時會原封不動進 tree.json 交給 render.ts 畫在節點下方。
    // 沒有這道檢查時，把 239 個 <text> 全部清空仍然是 validate 全綠——畫面上整棵樹沒有名字，
    // 而正本用 Inkscape 打開是 239 個無名圖示，也就是「留著 <text>」這個決定的理由整個消失。
    const label = g.querySelector('text')?.textContent ?? '';
    if (!label) throw new Error(`${nodeRef(g)} 缺少 <text> 標籤（節點在畫面上的名字，也是正本唯一的人眼線索）`);
    return {
      id: attr(g, 'data-id'),
      label,
      wip: g.getAttribute('data-wip') === '1',
      // 順序很重要：shapeOf 先判斷「有沒有形狀元素」，strokeOf 才去讀該元素的 stroke。
      // 兩者的「找不到元素」條件完全重疊（都是 querySelector('rect, circle, polygon') 落空），
      // 若順序相反，缺形狀元素的節點會先被 strokeOf 攔截、shapeOf 的「缺少形狀元素」分支永遠打不到。
      x, y, shape: shapeOf(g), stroke: strokeOf(g), icon, size: [iw, ih],
    };
  });

  // 正本裡定義過的 marker id（`<marker id="arrow">`）。marker-end 只准指向這些。
  const markerIds = new Set([...doc.querySelectorAll('marker')].map(m => m.getAttribute('id') ?? ''));

  const edges: RawEdge[] = [...doc.querySelectorAll('path.edge')].map(p => {
    const dAttr = p.getAttribute('d') ?? '';
    const ref = `邊 d="${dAttr}"`;
    // 跟節點同一條規矩：邊必須是 <svg> 直屬子元素。少了這道，一條邊可以藏在 <defs> 裡或塞進
    // 某個節點的 <g> 內——querySelectorAll('path.edge') 照樣找得到、圖遍歷照樣把它算進去，
    // 但 <defs> 底下的東西瀏覽器根本不會畫出來。看正本的人不會知道那條前置存在。
    if (p.parentNode !== svg) throw new Error(`${ref} 必須是 <svg> 直屬子元素（不可放在 <defs>、圖層或節點群組裡）`);
    assertNotHidden(p, ref);
    const markerEnd = p.getAttribute('marker-end');
    if (!markerEnd) throw new Error(`邊缺少 marker-end，無法判定方向：d="${dAttr}"`);
    // 方向是靠箭頭表示的。marker-end 指向一個不存在的 id 時瀏覽器不畫箭頭也不報錯，
    // 畫面上就是一條沒有方向的線，而資料端仍然照 M→L 的順序當成有向邊。
    const markerId = /^url\(#([^)]+)\)$/.exec(markerEnd)?.[1];
    if (!markerId || !markerIds.has(markerId)) {
      throw new Error(`${ref} 的 marker-end 必須指向正本定義過的箭頭（目前定義：${[...markerIds].join('、') || '無'}），實際：${markerEnd}`);
    }
    // marker-start 會在起點也畫一個箭頭，看起來像雙向前置，但資料端只認 M→L 一個方向。
    if (p.hasAttribute('marker-start')) throw new Error(`${ref} 不可帶 marker-start（畫面上會像雙向，資料端只有單向）`);
    return parseEdgePath(dAttr);
  });

  return { meta, nodes, edges };
}
