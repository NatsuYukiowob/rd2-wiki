// 單一節點區塊（`<g class="node">…</g>`）的解析與產生：線上編輯器的寫回機制不重新序列化
// 整份 SVG，只對原始字串做「行區塊替換」（定位與替換是 Task 7 `svg-edit.ts` 的工作，這裡只管
// 一個區塊本身）。理由：整檔 diff 會讓維護者失去審查能力——這個專案明確假設「維護者不可能
// 逐行 review SVG 的 diff、CI 是唯一防線」，但 CI 之後還是要有人看得懂「這個 PR 到底動了什麼」。
// 一個 PR 動三個節點，diff 就該只有三個區塊，而不是因為 DOM 重新序列化把全檔的屬性順序、
// 空白都洗過一輪。
//
// `NodeBlock` 刻意把 `shapeXml` / `imageXml` / `labelXml` 保留成原始字串，不拆成結構化欄位再
// 重組。原因是資料裡有無法從類型推導的東西：
// - 符文標籤有 inline `style="font-size:7px|6px|5.5px"`，長度與是否加樣式沒有對應關係
//   （是產出來源的人工調整，不是規則），推導不出來。
// - 玩家被動的 `<circle>` 帶 `class=""`（linkedom 序列化產物，來自曾用 GUI 工具存過檔的節點）。
// 若拆解重組，這些會在「玩家只是改個錯字」時被靜默抹掉——保留原字串才能保證「沒動到的部分
// 位元組不變」，這正是「diff 只有動到的區塊」這個承諾的實作方式。
//
// `<title>` 反過來完全不保留原字串：它是 typeZh／name／description／titleMaxLevel 四個欄位的
// 純函式（已對 239 個真實節點逐一驗證過這個還原關係成立），拆開存這四個欄位、emit 時重新組出
// `<title>`，才能讓「改名字」這種操作同步更新 <title>，不必另外維護一份會漂移的原始字串。
//
// 這個檔案刻意不 import linkedom／node:* ——`src/lib/` 會被 Astro 打包進瀏覽器（線上編輯器
// `/edit` 會用），純字串正則操作也剛好呼應「不重新序列化」的設計目標：DOM 解析再序列化，
// 本身就無法保證位元組不變。
import type { NodeType } from './types.js';

/** 一個節點區塊的解析結果；`shapeXml`/`imageXml`/`labelXml` 見檔頭「為什麼保留原始字串」。 */
export interface NodeBlock {
  x: number; y: number;
  id: string; typeZh: string; name: string; cost: string; description: string;
  wip: boolean;
  /** `<title>` 末行的「最高等級：N」；null 代表沒有這一行。 */
  titleMaxLevel: number | null;
  /** 原樣保留的 `<rect>` / `<circle>` / `<polygon>` 字串。 */
  shapeXml: string;
  /** 原樣保留的 `<image>` 字串。 */
  imageXml: string;
  /** 原樣保留的 `<text>` 字串（含 class / y / 可能的 inline font-size）。 */
  labelXml: string;
}

const TRANSFORM_RE = /transform="translate\((-?[\d.]+),(-?[\d.]+)\)"/;
const ID_RE = /data-id="([^"]*)"/;
const TYPE_RE = /data-type="([^"]*)"/;
const NAME_RE = /data-name="([^"]*)"/;
const COST_RE = /data-cost="([^"]*)"/;
const DESC_RE = /data-description="([^"]*)"/;
const WIP_RE = /data-wip="1"/;
const TITLE_RE = /<title>([^]*?)<\/title>/;
// [^] 是「任何字元含換行」的寫法（等同 dotAll 的 .），刻意不用 /s 旗標——這三個子元素標籤
// 都是單行自閉合／單行內容，用哪種寫法沒有行為差異，選 [^] 純粹是跟同檔案的 TITLE_RE 一致。
const SHAPE_RE = /<(?:rect|circle|polygon)\b[^]*?\/>/;
const IMAGE_RE = /<image\b[^]*?\/>/;
const LABEL_RE = /<text\b[^]*?<\/text>/;
const TITLE_LEVEL_LINE_RE = /^最高等級：(\d+)$/;

/** 把 `block` 開頭一段截給錯誤訊息用，避免整個區塊（可能好幾百字）洗版終端機輸出。 */
function preview(block: string): string {
  return block.length > 80 ? `${block.slice(0, 80)}…` : block;
}

function requireMatch(re: RegExp, block: string, label: string): RegExpExecArray {
  const m = re.exec(block);
  if (!m) throw new Error(`節點區塊缺少 ${label}: ${preview(block)}`);
  return m;
}

/**
 * ⚠️ 這個檔案的逃逸／解碼規格是「linkedom 的序列化器實際會產生什麼」，**不是 XML 規範允許
 * 什麼**（見 CLAUDE.md「emitter 的輸出必須逐字等於 linkedom 序列化器」）。這兩者不是同一件
 * 事：CI 的守門條件是 `normalizeSvg(檔案) === 檔案`（`.github/workflows/ci.yml` 的「正規化
 * 定點檢查」），`normalizeSvg` 內部用 linkedom 解析、重新序列化、再跑 `encodeAttributeNewlines`
 * 後處理（見 `tools/normalize-svg.ts`）——只要 emitter 產出的東西丟進這條管線後不是它自己的
 * 定點，CI 就會失敗，不管那個輸出符不符合 XML 規範的最小要求。舊版本的 `encodeAttr`／
 * `escapeXmlContent` 是照 XML 規範第一原理寫的（「屬性值要處理 `&``<``"`，內容只需要處理
 * `&``<`」），實測（見任務報告）發現 linkedom 的序列化器額外還會轉 `>` 與 `U+00A0`（不換行
 * 空白），屬性值另外還多轉 `\r`（`\n`／`\r` 是 `encodeAttributeNewlines` 這層後處理做的，
 * 不是 linkedom 自己），這幾個字元在真實資料裡出現次數是 0，239 節點的往返測試因此完全遮蔽
 * 不到這個落差——玩家在欄位打進 `>` 或貼上一個 NBSP，emitter 產出的檔案就不再是 CI 期待的
 * 定點，PR 送出後 CI 才會失敗，玩家在編輯器裡完全看不出原因、也無法用任何操作修正。
 *
 * 下次要改這裡的逃逸規則時：先用 `tests/lib/svg-emit.test.ts` 的 property test（拿一組對抗性
 * 字元跑 `normalizeSvg(out) === out`）驗證，不要只憑 XML 規範推導字元清單——那正是這個 bug
 * 的根因，而且字元清單本來就可能隨 linkedom 版本漂移。
 *
 * XML 屬性值實體解碼。順序刻意把 `&amp;` 放最後：若先解 `&amp;`，原始資料裡字面的 `&#10;`
 * （不是實體、是使用者真的打了這四個字元，理論上不該發生但不該假設不會發生）會先被
 * `&amp;` 那條規則動到一半、變成 `&#10;` 的殘缺形式，再被下一條 `&#10;` 規則誤解成換行。
 * 反過來——`&#10;` 先解——不會有這個問題：一個貨真價實的實體只會被對應的規則命中一次。
 * 同一個理由套用到這裡新補的 `&#13;`／`&#160;`／`&gt;`：只要它們全部排在 `&amp;` 之前解碼，
 * 都不會有這個問題。
 */
function decodeAttr(value: string): string {
  return value
    .replace(/&#13;/g, '\r')
    .replace(/&#10;/g, '\n')
    .replace(/&#160;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

/**
 * XML 屬性值實體編碼，`decodeAttr` 的反函式。順序（`&` 最先）避免把編碼過程新產生的 `&`
 * 二次編碼。`>`／`U+00A0`／`\r` 是這次 Critical fix 補上的（見檔頭說明）：linkedom 的
 * 序列化器對屬性值會轉 `&``<``>``"``U+00A0`，`\r`／`\n` 則是 `normalizeSvg()` 的
 * `encodeAttributeNewlines()` 後處理層轉的——四者合起來才是 CI 實際期待的定點。
 */
export function encodeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/ /g, '&#160;')
    .replace(/\r/g, '&#13;')
    .replace(/\n/g, '&#10;');
}

/**
 * XML **元素內容**用的逃逸（`<title>` 與 `<text>` 寫入的文字），跟屬性值用的 `encodeAttr`
 * 規則不同：linkedom 對元素內容只轉 `&``<``>``U+00A0`（`"`／`'` 不轉，換行也維持字面換行，
 * 屬性值那邊的換行才會被 `encodeAttributeNewlines` 轉成 `&#10;`／`&#13;`）——這是 linkedom
 * 序列化器實測出來的行為（見檔頭說明），不是從 XML 規範「內容只需要處理 `&`／`<`」推導的
 * 最小需求：舊版本正是照那個推導寫的，漏了 `>`／`U+00A0`，兩者在檔頭說的 Critical bug 裡都是
 * 真正出過事的字元。
 *
 * 現行 239 個節點的 typeZh／name／description／標籤文字裡沒有 `&`／`<`／`>`／NBSP，所以這個
 * 函式對現有資料是全恆等（往返測試不會被影響）；但玩家會在表單自由打字，沒有這道逃逸的話，
 * 玩家打「A & B」「傷害 < 100」「傷害 > 100」或貼上一個 NBSP，會讓 emitter 產出的檔案不再是
 * `normalizeSvg` 的定點（`>`／NBSP 沒逃逸的那個版本甚至可能整份 SVG 解析失敗）。
 *
 * 順序（`&` 必須先換）跟 `decodeAttr` 的 `&amp;` 必須最後解是同一個坑的另一面：
 * 若先把 `<` 換成 `&lt;` 再處理 `&`，`&lt;` 裡的 `&` 會被二次逃逸成 `&amp;lt;`。
 */
export function escapeXmlContent(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/ /g, '&#160;');
}

/** 解析單一 `<g class="node">…</g>` 區塊。輸入必須是完整區塊（含頭尾標籤），不做寬容修復。 */
export function parseNodeBlock(block: string): NodeBlock {
  const [, xStr, yStr] = requireMatch(TRANSFORM_RE, block, 'transform="translate(x,y)"');
  const id = decodeAttr(requireMatch(ID_RE, block, 'data-id')[1]!);
  const typeZh = decodeAttr(requireMatch(TYPE_RE, block, 'data-type')[1]!);
  const name = decodeAttr(requireMatch(NAME_RE, block, 'data-name')[1]!);
  const cost = decodeAttr(requireMatch(COST_RE, block, 'data-cost')[1]!);
  const description = decodeAttr(requireMatch(DESC_RE, block, 'data-description')[1]!);
  // WIP_RE 只需要裸的 `data-wip="1"` 就命中，不像 SHAPE_RE/IMAGE_RE/LABEL_RE/TITLE_RE 那樣要求
  // 字面 `<`（`<` 一定會被 escapeXmlContent 逃逸成 &lt;，所以那幾條不受這裡的問題影響）。
  // `escapeXmlContent` 不逃逸 `"`（linkedom 的序列化器對元素內容也不轉 `"`，見該函式說明），
  // 所以玩家若在名稱或描述裡打出字面 `data-wip="1"`，這段文字會原樣進到 <title> 元素內容裡；
  // 對整個 block 做無錨點比對的話，這段使用者輸入就會被誤判成真的屬性，把節點從 validate
  // 規則 6 的可達性檢查豁免掉——公開投稿工具上這是對抗性輸入的洞。
  //
  // 比對範圍要切在開頭標籤內，用「位置 0 之後第一個字面 `<`」而不是第一個 `>`：`<` 出現在
  // 屬性值裡時一定會被 `encodeAttr` 逃逸成 `&lt;`，所以這個位置必定是第一個子元素
  // （`<title>`）的開頭，也就是開頭標籤真正的結束點，不會被屬性值內容誤導。
  // ⚠️ 這裡刻意不依賴「`encodeAttr` 現在也會逃逸 `>`」這件事（Critical fix 之後 `encodeAttr`
  // 確實會把屬性值裡的字面 `>` 轉成 `&gt;`，見該函式）：用 `<` 定界的防線不需要這個前提就
  // 成立，對「不是這個 emitter 產生、可能沒有逃逸 `>`」的既有／手動編輯資料一樣安全
  // ——之前選 `<` 而不是 `>` 正是因為 `encodeAttr` 曾經不逃逸 `>`（假陰性回歸測試，見下面
  // `svg-emit.test.ts` 的 `data-wip` 測試群組），這裡不因為那個舊坑已經補上就把防線退化成
  // 依賴這項新事實，屬於防禦性設計，多一層保險不吃虧。
  const wip = WIP_RE.test(block.slice(0, block.indexOf('<', 1)));

  const titleContent = requireMatch(TITLE_RE, block, '<title>')[1]!;
  // 等級行必須取「最後一行」而非固定的「第二行」：跟 src/lib/svg-parse.ts 的 parseTreeWith
  // 用同一套判定方式（那裡有更完整的踩坑說明——多行描述會把「第二行」判斷變成靜默算錯）。
  const titleLines = titleContent.split('\n');
  const lastLine = titleLines.length > 1 ? titleLines[titleLines.length - 1] : undefined;
  const levelMatch = lastLine ? TITLE_LEVEL_LINE_RE.exec(lastLine) : null;
  const titleMaxLevel = levelMatch ? Number(levelMatch[1]) : null;

  const shapeXml = requireMatch(SHAPE_RE, block, '<rect>/<circle>/<polygon>')[0];
  const imageXml = requireMatch(IMAGE_RE, block, '<image>')[0];
  const labelXml = requireMatch(LABEL_RE, block, '<text>')[0];

  return {
    x: Number(xStr), y: Number(yStr),
    id, typeZh, name, cost, description, wip, titleMaxLevel,
    shapeXml, imageXml, labelXml,
  };
}

/**
 * 組回 `<title>` 的內容（不含頭尾標籤）：`{typeZh}｜{name}｜{description}`，換行用字面換行字元。
 * 三個動態欄位各自過 `escapeXmlContent`（分隔符 `｜` 與「最高等級：」是固定字面量，不需要逃逸）。
 */
function titleContentOf(n: NodeBlock): string {
  const head = `${escapeXmlContent(n.typeZh)}｜${escapeXmlContent(n.name)}｜${escapeXmlContent(n.description)}`;
  return n.titleMaxLevel === null ? head : `${head}\n最高等級：${n.titleMaxLevel}`;
}

/** 把 `NodeBlock` 產生回 `<g class="node">…</g>` 字串。對沒被觸碰欄位的節點，輸出與原字串逐位元組相同。 */
export function emitNodeBlock(n: NodeBlock): string {
  const open =
    `<g class="node" transform="translate(${n.x.toFixed(2)},${n.y.toFixed(2)})" ` +
    `data-id="${encodeAttr(n.id)}" data-type="${encodeAttr(n.typeZh)}" ` +
    `data-name="${encodeAttr(n.name)}" data-cost="${encodeAttr(n.cost)}" ` +
    `data-description="${encodeAttr(n.description)}"` +
    (n.wip ? ' data-wip="1"' : '') +
    '>';
  const title = `<title>${titleContentOf(n)}</title>`;
  return `${open}${title}${n.shapeXml}${n.imageXml}${n.labelXml}</g>`;
}

/** 產生一條 `<path class="edge">` 字串，格式與既有資料逐字相符（含自閉合前的空格）。 */
export function emitEdgeLine(from: [number, number], to: [number, number]): string {
  return `<path class="edge" marker-end="url(#arrow)" d="M ${from[0].toFixed(2)} ${from[1].toFixed(2)} L ${to[0].toFixed(2)} ${to[1].toFixed(2)}" />`;
}

/**
 * 四種節點類型的樣板，逐字抄自 `data/dice-tree.svg` 實測結果（見任務簡報）。
 * 支援節點的 stroke 固定為 `#f3c5ff`，不吃呼叫端傳入的 `stroke`——支援節點的顏色本來就不隨
 * 分支變化，這是資料裡的既有事實，不是這裡新發明的規則。
 * 新節點的標籤一律不加 inline font-size（沿用 class 預設大小）；符文標籤的 inline font-size
 * 是既有資料人工調整過的產物，新建節點沒有這個歷史包袱可繼承。
 */
const TEMPLATES: Record<NodeType, {
  shape: (stroke: string) => string;
  image: (hash: string) => string;
  label: (text: string) => string;
}> = {
  dice: {
    shape: stroke => `<rect x="-36" y="-28" width="72" height="56" rx="11" fill="#322b4b" stroke="${stroke}" stroke-width="2" />`,
    image: hash => `<image href="icons/${hash}.png" x="-24" y="-26" width="48" height="52" preserveAspectRatio="xMidYMid meet" />`,
    label: text => `<text class="dice-label" y="39">${escapeXmlContent(text)}</text>`,
  },
  rune: {
    shape: stroke => `<polygon points="0,-17 17,0 0,17 -17,0" fill="#405276" stroke="${stroke}" stroke-width="2" />`,
    image: hash => `<image href="icons/${hash}.png" x="-12" y="-13" width="24" height="26" preserveAspectRatio="xMidYMid meet" />`,
    label: text => `<text class="mini-label" y="26">${escapeXmlContent(text)}</text>`,
  },
  passive: {
    shape: stroke => `<circle r="12" fill="#55506d" stroke="${stroke}" stroke-width="2" />`,
    image: hash => `<image href="icons/${hash}.png" x="-10" y="-10" width="20" height="20" preserveAspectRatio="xMidYMid meet" />`,
    label: text => `<text class="mini-label" y="23">${escapeXmlContent(text)}</text>`,
  },
  support: {
    shape: () => `<polygon points="0,-22 19,-11 19,11 0,22 -19,11 -19,-11" fill="#7d4cb1" stroke="#f3c5ff" stroke-width="2" />`,
    image: hash => `<image href="icons/${hash}.png" x="-15" y="-17" width="30" height="34" preserveAspectRatio="xMidYMid meet" />`,
    label: text => `<text class="mini-label" y="29">${escapeXmlContent(text)}</text>`,
  },
};

/** 依類型套用固定樣板，建出一個全新節點的 `NodeBlock`（尚未 emit 成字串，需再呼叫 `emitNodeBlock`）。 */
export function newNodeBlock(input: {
  x: number; y: number; id: string; type: NodeType; typeZh: string;
  name: string; label: string; cost: string; description: string;
  maxLevel: number | null; stroke: string; iconHash: string;
}): NodeBlock {
  const t = TEMPLATES[input.type];
  return {
    x: input.x, y: input.y,
    id: input.id, typeZh: input.typeZh, name: input.name,
    cost: input.cost, description: input.description,
    wip: false,
    titleMaxLevel: input.maxLevel,
    shapeXml: t.shape(input.stroke),
    imageXml: t.image(input.iconHash),
    labelXml: t.label(input.label),
  };
}

const LABEL_STRUCTURE_RE = /^(<text\b[^]*?>)[^]*?(<\/text>)$/;

/**
 * 替換 `labelXml` 的文字內容，保留原本的開頭標籤（class／y／可能的 inline style）不變。
 * `text` 是元素內容，過 `escapeXmlContent`（不是 `encodeAttr`）——玩家改標籤打進 `&`／`<`
 * 時，沒逃逸會讓輸出的 `<text>` 變成不合法 XML。
 */
export function setLabelText(labelXml: string, text: string): string {
  const m = LABEL_STRUCTURE_RE.exec(labelXml);
  if (!m) throw new Error(`labelXml 不是預期的 <text ...>…</text> 結構: ${preview(labelXml)}`);
  return `${m[1]}${escapeXmlContent(text)}${m[2]}`;
}

const IMAGE_HREF_RE = /href="icons\/[0-9a-f]{12}\.png"/;

/** 替換 `imageXml` 的圖示雜湊，保留其餘屬性（x／y／width／height／preserveAspectRatio）不變。 */
export function setImageHref(imageXml: string, iconHash: string): string {
  if (!IMAGE_HREF_RE.test(imageXml)) {
    throw new Error(`imageXml 缺少可辨識的 href="icons/<12碼hex>.png": ${preview(imageXml)}`);
  }
  return imageXml.replace(IMAGE_HREF_RE, `href="icons/${iconHash}.png"`);
}
