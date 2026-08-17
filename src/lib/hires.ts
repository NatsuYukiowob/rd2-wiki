// 高解析圖示 lazy load：縮放超過 1× 之後，把目前視窗內看得到的節點圖示從共用 sprite
// 換成個別的 2 倍 WebP（見 public/assets/icons/<雜湊>.webp，由圖示管線產生，Task 9）。
// 平常維持用 sprite（單一 HTTP 請求、239 個節點共用），只有放大到看得出細節時才逐張換成
// 高解析版本，避免一開始就對 202 張圖各發一個請求拖慢首屏。
import type { TreeData } from './types.js';

const NS = 'http://www.w3.org/2000/svg';

/**
 * 回傳「中心點」落在給定矩形（使用者座標系，例如目前可視範圍換算後的畫布座標）內的節點
 * id 清單。呼叫端（tree-canvas.ts）用 `#viewport` 的 CTM 反解目前螢幕可視範圍換算成這組
 * 使用者座標矩形，再拿來篩要升級哪些節點的圖示——縮放時只處理看得到的節點，不必一次把
 * 239 個節點的圖示全部升級。
 */
export function visibleNodeIds(data: TreeData, rect: { x: number; y: number; w: number; h: number }): string[] {
  return data.nodes
    .filter(n => n.x >= rect.x && n.x <= rect.x + rect.w && n.y >= rect.y && n.y <= rect.y + rect.h)
    .map(n => n.id);
}

/** 每個圖示（依 icon 雜湊）升級成高解析版本後用的 pattern id，跟 render.ts 的
 *  `patternId()`（sprite 版本用的）刻意分開命名，兩者不會衝突、也方便從 id 一眼看出
 *  目前是哪個模式。 */
function hiresPatternId(icon: string): string {
  return `icon-hires-${icon}`;
}

/**
 * 把指定節點的圖示從 sprite 換成個別的高解析 WebP。
 *
 * DOM 結構（見 src/lib/render.ts，task-18 bug 修正後的版本——第二輪從「巢狀 svg +
 * viewBox」先改成「`<g clip-path>`」，兩者都被 E2E 實測抓到 `getBoundingClientRect()`
 * 不會考慮任何裁剪機制，仍然回傳整張未裁切 sprite 的幾何框；第三輪改用
 * `<rect fill="url(#pattern)">`，`<rect>` 的幾何只看自己的 x/y/width/height，不受 fill
 * 裡貼的圖案影響，才是真的修好）：`g.node[data-id] > rect.icon` 是一個貼了 sprite pattern
 * 的 `<rect>`，`data-icon` 屬性記著這是哪張圖。
 *
 * 要換成單張高解析圖，不是直接改這個 `<rect>` 的 `fill`（那樣多個節點共用同一張圖示時，
 * 每個節點各自的高解析 pattern 都要重新產生一次，浪費）——而是幫每個「圖示雜湊」建立一個
 * **共用**的高解析 pattern（`hiresPatternId()`），內容是單張已經裁好的 `${base}/${hash}.webp`
 * （`width`/`height` 直接用節點顯示尺寸，圖本身已經是那個尺寸，不需要再位移/裁切）；同一個
 * 雜湊的 pattern 只建立一次（用 `svg.querySelector` 檢查是否已存在），之後任何其他節點
 * 升級同一張圖示時直接重用，不重複建立。最後把 `<rect>` 的 `fill` 指到這個高解析 pattern，
 * 完成升級——`<rect>` 本身的 `x`/`y`/`width`/`height` 完全不用動，這正是這個設計相對「巢狀
 * svg」／「clip-path」兩個舊版本的關鍵優勢：bbox 正確性從一開始就跟 fill 內容無關，升級
 * 高解析圖示不需要、也不會影響 bbox。
 *
 * 用 `icon.dataset.hires === '1'` 記錄「已經升級過」，避免同一個節點被重複處理（例如使用者
 * 反覆縮放、同一個節點多次落在可視範圍內）時重複改寫 DOM。
 */
export function upgradeIcons(ids: string[], svg: SVGSVGElement, base = '/assets/icons'): void {
  const doc = svg.ownerDocument;
  // render.ts 現在一定會建立 <defs>（不管有沒有圖示都會），這裡直接假設它存在、找不到就是
  // 呼叫端傳了一個不是 renderTree() 產生的 svg，用法錯誤，不需要再防禦性地自己建一個。
  const defs = svg.querySelector('defs');
  if (!defs) throw new Error('svg 缺少 <defs>：upgradeIcons() 只能操作 renderTree() 產生的 svg');

  // 同一批 ids 裡，多個節點很常共用同一張圖示（render.ts 的說明：202 種不重複圖示服務
  // 239 個節點）——用這個 Set 記錄「這次呼叫已經處理過的雜湊」，重複的雜湊不用再對 DOM
  // 查一次 pattern 存不存在，直接跳過建立步驟。
  const patternedThisCall = new Set<string>();

  for (const id of ids) {
    const icon = svg.querySelector<SVGRectElement>(`g.node[data-id="${id}"] > rect.icon`);
    if (!icon || icon.dataset.hires === '1') continue;

    const hash = icon.getAttribute('data-icon');
    if (!hash) continue; // render.ts 一定會寫入 data-icon，這裡只是防禦性判斷，不代表正常路徑

    const patId = hiresPatternId(hash);
    if (!patternedThisCall.has(hash) && !svg.querySelector(`#${patId}`)) {
      const w = icon.getAttribute('width');
      const h = icon.getAttribute('height');
      // render.ts 一定會在 rect.icon 上寫 width/height（節點的顯示尺寸），這裡讀不到代表
      // 呼叫端傳了一個不正常的 DOM（例如自己手刻、漏寫了這兩個屬性）——直接丟錯而不是悄悄
      // 用空字串頂著繼續跑，空字串會讓 pattern／image 的寬高變成 0，圖示整個消失卻不會有
      // 任何錯誤訊息，比丟錯更難除錯（跟 viewport.ts 的 fitTo() 對缺 viewBox 屬性的處理
      // 原則一致）。
      if (!w || !h) throw new Error(`節點 ${id} 的 rect.icon 缺少 width/height，無法升級成高解析圖示`);

      const pattern = doc.createElementNS(NS, 'pattern');
      pattern.setAttribute('id', patId);
      pattern.setAttribute('patternUnits', 'userSpaceOnUse');
      // pattern 的 x/y 要跟 <rect> 自己的 x/y（render.ts 寫的 `-w/2, -h/2`）對齊，
      // tile 邊界才會卡在 rect 的邊緣上，不會落在圖示中間——理由跟 render.ts 的 sprite
      // pattern 完全一樣（見該檔案的說明：pattern 預設從 0 開始鋪 tile，跟 rect 實際位置
      // 差半個 tile，圖示會從正中央被切開、跟旁邊的 tile 鏡射拼接）。這裡直接讀 rect 現有
      // 的 x/y 屬性而不是重算 -w/2，避免跟 render.ts 兩處各自硬編一次算式、日後改了一邊
      // 忘記改另一邊。
      pattern.setAttribute('x', icon.getAttribute('x') ?? '0');
      pattern.setAttribute('y', icon.getAttribute('y') ?? '0');
      pattern.setAttribute('width', w);
      pattern.setAttribute('height', h);

      const img = doc.createElementNS(NS, 'image');
      img.setAttribute('href', `${base}/${hash}.webp`);
      img.setAttribute('width', w);
      img.setAttribute('height', h);
      pattern.appendChild(img);
      defs.appendChild(pattern);
    }
    patternedThisCall.add(hash);

    icon.setAttribute('fill', `url(#${patId})`);
    icon.dataset.hires = '1';
  }
}
