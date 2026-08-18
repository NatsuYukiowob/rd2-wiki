import { formatUnlockVia } from './format.js';
import type { NodeType, TreeData, TreeNode } from './types.js';

const NS = 'http://www.w3.org/2000/svg';

// aria-label 面向螢幕閱讀器朗讀，這是中文網站，type 的英文代碼（dice/rune/passive/support）
// 若原樣塞進中文句子會被逐字母拼音唸出，體驗很差，所以顯示用文字一律轉成中文。
const TYPE_LABEL: Record<NodeType, string> = {
  dice: '骰子',
  rune: '骰子符文',
  passive: '玩家被動',
  support: '支援',
};

/** 每個圖示（依 icon 雜湊）各自的 `<pattern>` id（見 `renderTree()` 開頭的 `<defs>`）。 */
function patternId(icon: string): string {
  return `icon-pattern-${icon}`;
}

// spec §6.2 第 2 點：hover tooltip = name ＋ description 第一行（以 \n 切分），超過 24 字
// 以 … 截斷。24 字的上限是算在「name ＋ description 第一行」組合後的整串文字上，不是只算
// description 那一半——spec 原文「tooltip = name ＋ description 第一行，超過 24 字…截斷」
// 的「超過 24 字」緊接在整個等式後面，讀作對 tooltip 全長的限制。
const TOOLTIP_MAX_LEN = 24;

/** 組出節點 hover tooltip 的文字內容（供 `<title>` 子元素使用，見 renderTree() 節點迴圈）。 */
function tooltipText(n: Pick<TreeNode, 'name' | 'description'>): string {
  const firstLine = n.description.split('\n')[0] ?? '';
  const combined = `${n.name}${firstLine}`;
  return combined.length > TOOLTIP_MAX_LEN ? `${combined.slice(0, TOOLTIP_MAX_LEN)}…` : combined;
}

/**
 * 把骰子樹資料畫成一份完整、可直接掛進頁面的 SVG DOM。
 *
 * - 所有節點與邊都放在單一 `<g id="viewport">` 之下：之後的平移縮放（下一個任務）只需要
 *   改這個元素的 `transform`，不必逐一碰節點或邊。
 * - 節點圖示用「`<rect fill="url(#pattern)">`」從共用 sprite 裁出對應格子：`<defs>` 底下
 *   每個用到的圖示（依 icon 雜湊，可能有多個節點共用同一張圖）各自一個 `<pattern>`，
 *   pattern 內容是整張 sprite `<image>`（自然尺寸），位移到讓目標格子的左上角對齊 pattern
 *   自己座標系的原點；pattern 本身的 `width`/`height` 設成該格子的尺寸（＝該圖示的顯示
 *   尺寸），讓 pattern 的一個 tile 剛好只露出那一格。節點本體是一個 `<rect>`，`width`/
 *   `height` 就是它的顯示尺寸，`fill` 指到對應的 pattern。
 *
 *   **不用**「巢狀 `<svg>` + `viewBox`」或「`<g clip-path>` 包住整張 `<image>`」
 *   （task-18 E2E 兩輪都找到的真實 bug）：不管是巢狀 svg 的 `viewBox` 裁切還是 `clip-path`，
 *   Chromium 算 `getBoundingClientRect()` 時都只看「這個元素底下實際畫了什麼幾何圖形」，
 *   不會考慮任何裁剪機制（`viewBox`／`clip-path`／`overflow`）——裁剪在 SVG 裡純粹是繪製
 *   （paint）階段的效果，不會反過來縮小幾何（geometry）階段算出來的邊界框。只要節點底下
 *   還放著一張完整、未裁切的 768x458 `<image>`，不管外面包幾層裁剪，`getBoundingClientRect()`
 *   算出來的還是那張整圖的幾何框（實測驗證過：`<g clip-path>` 版本量到的框跟完全沒有
 *   clip-path 時一模一樣）。
 *
 *   改用 `<rect fill="url(#pattern)">` 從根本避開這個問題：`<rect>` 是一個有明確、獨立
 *   幾何定義的形狀，它的 `getBoundingClientRect()` 只看自己的 `x`/`y`/`width`/`height`
 *   屬性，完全不管 `fill` 裡面貼的是什麼（純色、漸層、或這裡用的圖片紋理）——`fill` 純粹是
 *   繪製階段「填色」的資訊，從來不會、也不應該影響元素自身的幾何（這跟 HTML
 *   `background-image` 不會撐大一個 `div` 的道理一樣）。（已用最小重現案例實測驗證過：
 *   一個 `width="48" height="52"` 的 `<rect>`，`fill` 貼一張 768x458 的圖案，
 *   `getBoundingClientRect()` 量出來就是 48x52，跟同樣大小的純色 `<rect>`完全一致。）
 * - pattern 裡的 `<image>` 必須明確帶 `width`/`height`（＝ sprite 的真實像素尺寸，來自
 *   `meta.sprite.size`）。SVG2 允許省略、讓渲染器自動採用圖片內在尺寸，但部分渲染器仍走
 *   SVG1.1 語意、寬高預設為 0，省略會導致圖示整片不顯示；尺寸填錯則整張 sprite 被縮放，
 *   所有格子的裁切位置都會跟著錯位，因此這裡一律顯式帶入。
 */
export function renderTree(data: TreeData, doc: Document): SVGSVGElement {
  const svg = doc.createElementNS(NS, 'svg') as SVGSVGElement;
  svg.setAttribute('viewBox', data.meta.viewBox.join(' '));
  svg.setAttribute('id', 'tree');

  const viewport = doc.createElementNS(NS, 'g');
  viewport.setAttribute('id', 'viewport');
  svg.appendChild(viewport);

  const [spriteW, spriteH] = data.meta.sprite.size;

  // pattern 定義成文件全域 id、被 `fill="url(#...)"` 參照即可，跟它在 DOM 裡實際的巢狀位置
  // 無關（不需要放在 #viewport 底下）；`patternUnits` 預設 `objectBoundingBox`
  // 不是我們要的（會把 pattern 的 width/height 當成參照元素 bbox 的比例，不是使用者座標的
  // 絕對尺寸），這裡改用 `userSpaceOnUse`，讓 pattern 的 width/height 直接對應使用者座標
  // 單位、且跟著 `<rect>` 所在的座標系（含 `#viewport` 的平移縮放）一起動，效果跟舊版
  // 「巢狀 svg 的 viewBox 裁切」一致。每個「圖示雜湊」只需要一個 pattern（可能有多個節點
  // 共用同一張圖，例如不同分支的同名關鍵字節點），不是每個節點各自一個。
  const defs = doc.createElementNS(NS, 'defs');
  svg.appendChild(defs);

  // 鍵盤 focus 的外框。用 feMorphology 把圖示「看得見的形狀」往外膨脹一圈再填成金色，
  // 疊在原圖下面——出來的就是一圈貼著輪廓的邊：圓形節點得到圓環、圓角方塊得到圓角框、
  // 菱形得到菱形框，不必為每種形狀各寫一份。
  //
  // 為什麼不用 CSS 的 `outline`：outline 畫的永遠是元素的矩形邊界框，圓形節點會被套上一個
  // 四角外露的方框（image8 之後的回報）。SVG 也沒有 border-radius 可以救。
  //
  // in="SourceAlpha" 取的是這個 <rect> 實際算繪出來的透明度——它填的是 sprite pattern，
  // 所以拿到的是圖示本身的輪廓，不是 rect 的方形範圍。
  const focusFilter = doc.createElementNS(NS, 'filter');
  focusFilter.setAttribute('id', 'focus-ring');
  // 濾鏡區域要留得比膨脹量大，否則那圈邊會被自己的濾鏡框裁掉。
  focusFilter.setAttribute('x', '-20%');
  focusFilter.setAttribute('y', '-20%');
  focusFilter.setAttribute('width', '140%');
  focusFilter.setAttribute('height', '140%');
  focusFilter.innerHTML =
    '<feMorphology operator="dilate" radius="2" in="SourceAlpha" result="thick"/>' +
    '<feFlood flood-color="#ffd66f" result="gold"/>' +
    '<feComposite in="gold" in2="thick" operator="in" result="ring"/>' +
    '<feMerge><feMergeNode in="ring"/><feMergeNode in="SourceGraphic"/></feMerge>';
  defs.appendChild(focusFilter);
  // icon 雜湊 → 第一個用到它的節點的顯示尺寸。pattern 的 tile 尺寸用 sprite cell 的
  // 尺寸（cw/ch）而不是逐一讀每個節點的 n.size，是建立在「同一個圖示雜湊，size 一定
  // 相同」這個假設上（跟參照它的 <rect> 用同一組 -w/2,-h/2 對齊 pattern，見下面的位移
  // 說明）——這個假設目前恆成立（tools/build-data.ts 依類型分區保證同類型節點尺寸相同，
  // 且驗證過目前資料裡沒有任何圖示被不同類型的節點共用），但沒有任何建置期規則主動擋著
  // 「以後改資料時不小心讓兩個不同尺寸的節點共用同一個圖示雜湊」這件事。一旦這個假設被
  // 打破，pattern 尺寸只會照著先出現的那個節點定案，其他尺寸不同卻共用同一個 pattern
  // 的節點會裁切錯位——會重演上面 pattern 沒對齊時「圖示從中間裂開拼接」的破圖，而且是
  // 悄悄地錯，不會有任何錯誤訊息。這裡改成主動檢查、假設被打破就直接丟錯，不要讓它悄悄
  // corrupt 下去（跟 viewport.ts 的 fitTo() 對沒有 viewBox 屬性時的處理原則一致：丟出
  // 明確錯誤，而不是悄悄用一個猜測值撐過去）。
  const iconSizes = new Map<string, [number, number]>();
  for (const n of data.nodes) {
    const known = iconSizes.get(n.icon);
    if (known) {
      if (known[0] !== n.size[0] || known[1] !== n.size[1]) {
        throw new Error(
          `圖示 ${n.icon} 被不同顯示尺寸的節點共用（先前 ${known[0]}x${known[1]}，節點 ${n.id} 是 ${n.size[0]}x${n.size[1]}）：` +
            `共用同一張圖的 pattern 只能有一個尺寸，兩個節點顯示尺寸不同會導致其中一個裁切錯位。`,
        );
      }
      continue;
    }
    iconSizes.set(n.icon, n.size);

    const cell = data.meta.sprite.index[n.icon];
    if (!cell) continue; // validate.ts 已經在建置期擋掉圖示雜湊對不到 sprite 的資料，這裡只是防禦性判斷

    const [cx, cy, cw, ch] = cell;
    const pattern = doc.createElementNS(NS, 'pattern');
    pattern.setAttribute('id', patternId(n.icon));
    pattern.setAttribute('patternUnits', 'userSpaceOnUse');
    // pattern 沒有自己設 x/y 時預設是 0——但參照這個 pattern 的 <rect> 是以
    // `x=-w/2, y=-h/2` 定位（見下面節點迴圈），跟 pattern tile 的邊界差了「半個 tile」
    // （-w/2 對 tile 寬度 w 取餘數是 w/2，不是 0）。這個偏移在視覺上會讓每個圖示從正中央被
    // 攔腰切開、拼上相鄰 tile 的另一半，呈現「左右（也上下）各半張圖鏡射拼接」的破圖
    // （截圖比對時肉眼可見，統計顏色數量的自動化測試測不出來——顏色沒錯，只是空間位置錯了）。
    // 修正：讓 pattern 自己的 x/y 跟著往負方向位移半個 tile，跟 <rect> 的 x/y 對齊，
    // tile 邊界正好卡在 rect 的邊緣上，不會落在圖示中間。同一張圖示（同一個 cw/ch）不管
    // 被哪個節點參照，這個位移量都相同（因為所有共用同一張圖的節點，size 也相同，見
    // build-data.ts 依類型分區的保證），不需要為每個節點各自算一次。
    pattern.setAttribute('x', String(-cw / 2));
    pattern.setAttribute('y', String(-ch / 2));
    pattern.setAttribute('width', String(cw));
    pattern.setAttribute('height', String(ch));

    const patImg = doc.createElementNS(NS, 'image');
    patImg.setAttribute('href', data.meta.sprite.url);
    // 把整張 sprite 平移，讓要顯示的那一格（cell）左上角對齊 pattern 本地座標系的原點，
    // pattern 的 tile 尺寸（cw/ch，跟該圖示的顯示尺寸相同）再自然裁出只露出那一格。
    patImg.setAttribute('x', String(-cx));
    patImg.setAttribute('y', String(-cy));
    patImg.setAttribute('width', String(spriteW));
    patImg.setAttribute('height', String(spriteH));
    pattern.appendChild(patImg);
    defs.appendChild(pattern);
  }

  const byId = new Map(data.nodes.map(n => [n.id, n]));

  for (const [from, to] of data.edges) {
    const a = byId.get(from);
    const b = byId.get(to);
    if (!a || !b) throw new Error(`邊端點找不到對應節點：${from} -> ${to}`);

    const line = doc.createElementNS(NS, 'line');
    line.setAttribute('class', 'edge');
    line.setAttribute('x1', String(a.x));
    line.setAttribute('y1', String(a.y));
    line.setAttribute('x2', String(b.x));
    line.setAttribute('y2', String(b.y));
    line.setAttribute('data-from', from);
    line.setAttribute('data-to', to);
    viewport.appendChild(line);
  }

  // 中央樞紐（遊戲內的「骰子樹」本體）。畫在邊之後、節點之前：放射線要壓在邊上面、
  // 樞紐圖要被節點壓住，跟資料正本 SVG 的堆疊順序一致。
  //
  // 它刻意不是 <g class="node">：選取、祖先高亮、篩選、鍵盤巡覽全都以 .node 為選擇器，
  // 樞紐若混進去會變成一個點得下去卻沒有資料的節點（詳情面板讀不到 id、成本算不出來）。
  // 這裡用 class="tree-center"、不給 tabindex、不給 data-id，讓它在互動上完全隱形。
  if (data.meta.center) {
    const c = data.meta.center;
    const hub = doc.createElementNS(NS, 'g');
    hub.setAttribute('class', 'tree-center');

    for (const id of c.links) {
      const n = byId.get(id);
      // 跳過而不是丟錯：id 對不上在建置期就會被 build-data.ts 擋下來（那裡是真正的守門），
      // 走到這裡代表拿到一份不該存在的 tree.json。renderTree() 是在 tree-canvas.ts 的模組
      // 頂層呼叫的，這裡丟例外會讓整個模組掛掉、使用者看到一片空白；樞紐只是裝飾，為了它
      // 賠掉整張骰子樹不成比例。少畫一條腿的代價小得多，跟上面「sprite 格子對不到就 continue」
      // 同一個取捨。
      if (!n) continue;
      const link = doc.createElementNS(NS, 'line');
      link.setAttribute('class', 'tree-center-link');
      link.setAttribute('x1', String(c.x));
      link.setAttribute('y1', String(c.y));
      link.setAttribute('x2', String(n.x));
      link.setAttribute('y2', String(n.y));
      hub.appendChild(link);
    }

    const [cw, ch] = c.size;
    const img = doc.createElementNS(NS, 'image');
    img.setAttribute('class', 'tree-center-image');
    img.setAttribute('href', c.url);
    img.setAttribute('x', String(c.x - cw / 2));
    img.setAttribute('y', String(c.y - ch / 2));
    img.setAttribute('width', String(cw));
    img.setAttribute('height', String(ch));
    // 樞紐圖是純裝飾，語意由下面的 <text> 標籤承擔；沒有 alt 的 <image> 對螢幕閱讀器
    // 是一個無名的圖形節點，明確標成 presentation 讓它不要被念出來。
    img.setAttribute('role', 'presentation');
    hub.appendChild(img);

    if (c.label) {
      const text = doc.createElementNS(NS, 'text');
      text.setAttribute('class', 'tree-center-label');
      text.setAttribute('x', String(c.x));
      text.setAttribute('y', String(c.y + c.labelDy));
      text.textContent = c.label;
      hub.appendChild(text);
    }

    viewport.appendChild(hub);
  }

  for (const n of data.nodes) {
    const g = doc.createElementNS(NS, 'g');
    g.setAttribute('class', 'node');
    g.setAttribute('transform', `translate(${n.x},${n.y})`);
    g.setAttribute('data-id', n.id);
    g.setAttribute('data-branch', n.branch);
    g.setAttribute('data-type', n.type);
    g.setAttribute('data-element', n.element);
    g.setAttribute('tabindex', '0');
    g.setAttribute('role', 'button');
    // 成本文字改用 formatUnlockVia()（src/lib/format.ts）——不要在這裡再寫第三份格式化邏輯。
    // 這裡原本自己手寫「core>0 顯示核心，否則顯示金幣」：91 個核心＋金幣同時有值的節點，
    // 金幣會被整個吃掉螢幕閱讀器聽不到；任務／預設解鎖的兩個節點（4008、2001）雖然
    // unlockCost.core 仍有數字，但那不是玩家能花錢買到的價格，講「核心 8」等於暗示
    // 玩家可以花核心買到只能靠任務取得的節點——這正是詳情面板（NodeDetail.ts）已經修過的
    // 問題，這裡的 aria-label 是另一條沒跟著修的路徑。
    g.setAttribute('aria-label', `${n.name}，${TYPE_LABEL[n.type]}，${formatUnlockVia(n)}`);

    // Hover tooltip（spec §6.2 第 2 點）：瀏覽器原生 <title>，零 JS、零額外依賴，螢幕閱讀器
    // 也讀得到。習慣上 <title> 要是元素的第一個子節點（SVG2 / 無障礙慣例），所以在其餘子
    // 元素（icon、label）之前就先建立並塞進去。
    const title = doc.createElementNS(NS, 'title');
    title.textContent = tooltipText(n);
    g.appendChild(title);

    const [w, h] = n.size;

    // 圖示本體：一個貼了對應 pattern 的 <rect>，見 renderTree() 開頭的說明——這個 rect
    // 自己的 x/y/width/height 就是節點的真實顯示尺寸與範圍，getBoundingClientRect() 只看
    // 這幾個屬性，不受 fill 裡貼的圖案影響。data-icon 保留給 hires.ts 用（比對哪張圖、
    // 升級成高解析版本時要用的雜湊）。
    const icon = doc.createElementNS(NS, 'rect');
    icon.setAttribute('class', 'icon');
    icon.setAttribute('x', String(-w / 2));
    icon.setAttribute('y', String(-h / 2));
    icon.setAttribute('width', String(w));
    icon.setAttribute('height', String(h));
    icon.setAttribute('fill', `url(#${patternId(n.icon)})`);
    icon.setAttribute('data-icon', n.icon);
    g.appendChild(icon);

    const label = doc.createElementNS(NS, 'text');
    label.setAttribute('class', 'label');
    label.setAttribute('y', String(h / 2 + 15));
    label.textContent = n.label;
    g.appendChild(label);

    viewport.appendChild(g);
  }

  return svg;
}
