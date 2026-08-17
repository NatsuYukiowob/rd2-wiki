const MIN = 0.2;
// 縮放上限（spec §6.2 修正版）：2× 只是「素材銳利度」的門檻（高解析圖切換點，見
// tree-canvas.ts），不該拿來限制使用者能放多大——手機小螢幕要看清楚一顆骰子圖示，
// 需要放大到遠超過 2×（實測：viewBox 3400 寬映射到 390px 手機螢幕時，2× 縮放下一顆
// 48 單位寬的骰子圖示只有約 11px，完全無法辨識）。放大到超過素材解析度只是圖示稍微
// 模糊，不影響可用性，所以上限訂為 8×。
const MAX = 8;

/**
 * 預設視角的「最小可讀縮放」下限（task-17 裁決，spec §6.2 補充；task-18 E2E 第二輪修正
 * 擴大適用範圍，見下方「桌機也會中招」的說明）。
 *
 * 手機版預設聚焦單一分支，直接套 `fitTo(meta.bounds[branch])` 算出來的縮放比例是拿分支
 * 包圍盒去塞滿整個 viewBox 算的——分支包圍盒本身就不小（790～1400 使用者單位寬），塞進
 * 3400 寬的 viewBox 也只能放大到 2.17～2.36 倍。但這個「使用者座標系內的倍率」跟畫面上
 * 實際看起來多大是兩件事：根 svg 的 `viewBox` 還會再被瀏覽器用 `preserveAspectRatio`
 * 預設值 `xMidYMid meet` 等比映射到容器目前的 CSS 顯示尺寸——`meet` 是「整個 viewBox 都要
 * 塞進容器，取寬高兩個縮放比中較小的那個」，容器與 viewBox 的長寬比不一樣時，到底是寬還是
 * 高在限制縮放，要看兩者的實際尺寸，不能只看寬度就假設一定是寬度：
 *
 *   pxPerUnit = min(containerWidthPx / viewBoxWidth, containerHeightPx / viewBoxHeight)
 *
 * **桌機也會中招**（task-18 E2E 第二輪找到的真實 bug）：這個函式最初只算
 * `containerWidthPx / viewBoxWidth`，因為手機直向容器（窄且高，例如 390x800）的寬高比
 * 遠小於 viewBox（3400x2850，寬高比≈1.19）的寬高比，永遠是寬度在限制縮放，掩蓋了「其實
 * 應該取兩者較小值」這件事沒做的問題。桌機容器是橫向（寬且扁，例如 1280x610，寬高比
 * ≈2.10，比 viewBox 更扁），變成改由**高度**限制縮放（610/2850≈0.214，遠小於用寬度算的
 * 1280/3400≈0.376）——舊公式只用寬度算，把每使用者單位的 CSS px 數高估了將近 76%，算出
 * 來的縮放下限也就低估了同樣的比例，桌機初始視角（整棵樹塞進 viewBox，`fitTo` 固定給
 * 0.9x）的圖示因此只有約 9 CSS px，跟手機修正前一樣不可讀。
 *
 * 這個函式反過來算：要讓寬度 `iconWidthUnits`（使用者座標）的圖示在容器裡至少有
 * `targetPx` 個 CSS px，`#viewport` 的內部縮放至少要多少——
 *
 *   s ≥ targetPx / (iconWidthUnits * pxPerUnit)
 *
 * 呼叫端（tree-canvas.ts 的 `applyReadabilityFloor()`，桌機／手機、初始視角／分支跳轉都會
 * 呼叫，task-18 第二輪裁決不再是手機專屬）在 `fitTo(bounds)` 之後，若算出來的 `vp.scale`
 * 比這裡回傳的下限還小，就再疊一次縮放拉到這個下限——允許內容因此超出可視範圍、需要使用者
 * 自己平移，這是刻意的取捨（task-17 裁決原文：「手機本來就不可能整個分支塞進去還看得
 * 清」；task-18 裁決把同一套邏輯套用到桌機：桌機容器夠扁時，「整棵樹塞進去」一樣不可能
 * 同時看得清，優先保證看得清，捲動交給使用者），不是 bug。呼叫端仍會用 `Viewport` 既有的
 * 0.2～8 倍上下限做最終夾制，這裡不重複夾一次。
 *
 * 純函式、不碰 DOM，可以直接單元測試（不需要瀏覽器版面引擎）。
 */
export function minReadableScale(
  containerWidthPx: number,
  containerHeightPx: number,
  viewBoxWidth: number,
  viewBoxHeight: number,
  iconWidthUnits: number,
  targetPx: number,
): number {
  const pxPerUnit = Math.min(containerWidthPx / viewBoxWidth, containerHeightPx / viewBoxHeight);
  return targetPx / (iconWidthUnits * pxPerUnit);
}

/**
 * 骰子樹畫布的平移縮放狀態機。
 *
 * `pan()`／`zoomAt()` 收的參數是「螢幕座標」（CSS px，例如 pointer 事件的
 * movementX/clientX、wheel 事件的 clientX/clientY），但實際套用 transform 的對象
 * `#viewport` 是根 `<svg viewBox="0 0 3400 2850">` 底下的 `<g>`：它的 transform
 * 運作在根 svg 的 viewBox 使用者座標系裡，而不是螢幕像素。根 svg 的 viewBox 尺寸固定
 * 不變，會被瀏覽器等比例映射到容器目前的實際渲染尺寸，兩個座標系的比例通常不是 1:1
 * （且會隨視窗大小改變），所以螢幕座標必須先用 `svg.getScreenCTM()`
 * 換算成使用者座標，才能疊到 transform 上——直接把 movementX/clientX 當成使用者座標
 * 位移量會讓拖曳/縮放的視覺效果跟游標對不上（差一個倍率）。
 *
 * 測試環境（linkedom）沒有實作 `getScreenCTM`，呼叫會是 `undefined`；
 * 這裡在取不到 CTM、或取到但分量為 0（退化矩陣）時，退化為 1:1 換算，
 * 讓既有以「使用者座標＝螢幕座標」為前提寫的測試不必更動。
 */
export class Viewport {
  private x = 0;
  private y = 0;
  private s = 1;

  constructor(
    private svg: SVGSVGElement,
    private layer: SVGGElement,
  ) {}

  get scale(): number {
    return this.s;
  }

  get transform(): string {
    return `translate(${this.x},${this.y}) scale(${this.s})`;
  }

  private apply(): void {
    this.layer.setAttribute('transform', this.transform);
  }

  /**
   * 取得目前「螢幕座標 → 使用者座標」CTM 的四個分量：a／d 是縮放（根 svg 預設維持
   * 等比例縮放，理論上 a 與 d 量值相同，但仍分開換算以涵蓋兩者不同的極端狀況），
   * e／f 是位移——也就是 svg 元素左上角在頁面上的螢幕座標。完整反解是
   * `使用者座標 = (螢幕座標 - e/f) / a/d`，**不能只除以 a/d 而漏掉 e/f**：
   * 畫布不是貼齊頁面原點的（側欄＋畫布＋詳情面板的版面下，e/f 幾乎必然非零），漏掉
   * 這一步會讓 `zoomAt()` 的錨點換算整體平移錯位，錨點不變性不成立，實際現象是
   * 縮放時畫面會朝畫布在頁面上的偏移方向飄走。
   *
   * `pan()` 用的是螢幕座標的「差值」（movementX/Y），差值運算會讓 e/f 這個常數項自動
   * 抵消（`(s2-e)/a - (s1-e)/a = (s2-s1)/a`），所以 `pan()` 不需要、也不該再減 e/f，
   * 只有 `zoomAt()` 這種用「絕對座標」當錨點的呼叫才需要完整反解。
   *
   * 測試環境（linkedom）沒有實作 `getScreenCTM`，呼叫會是 `undefined`；
   * 這裡在取不到 CTM、或取到但 a/d 分量為 0（退化矩陣）時，縮放退化為 1:1、
   * 位移退化為 0，讓既有以「使用者座標＝螢幕座標」為前提寫的測試不必更動。
   */
  private screenToUserCtm(): { kx: number; ky: number; ex: number; ey: number } {
    const ctm = this.svg.getScreenCTM?.();
    const kx = ctm && ctm.a !== 0 ? ctm.a : 1;
    const ky = ctm && ctm.d !== 0 ? ctm.d : 1;
    const ex = ctm?.e ?? 0;
    const ey = ctm?.f ?? 0;
    return { kx, ky, ex, ey };
  }

  /** 依螢幕座標位移（CSS px）平移畫布，內部換算成使用者座標後累加。 */
  pan(dx: number, dy: number): void {
    const { kx, ky } = this.screenToUserCtm();
    this.x += dx / kx;
    this.y += dy / ky;
    this.apply();
  }

  /** 以螢幕座標 (cx, cy) 為錨點縮放，縮放後錨點下方的內容座標維持不變。 */
  zoomAt(factor: number, cx: number, cy: number): void {
    const { kx, ky, ex, ey } = this.screenToUserCtm();
    const ux = (cx - ex) / kx;
    const uy = (cy - ey) / ky;

    const next = Math.min(MAX, Math.max(MIN, this.s * factor));
    const k = next / this.s;
    this.x = ux - (ux - this.x) * k;
    this.y = uy - (uy - this.y) * k;
    this.s = next;
    this.apply();
  }

  /**
   * 從根 svg 的 `viewBox` 屬性讀出使用者座標系的寬高。
   *
   * `render.ts` 在建立 svg 時一定會設好 `viewBox`（且之後不會再變動），所以這裡讀不到
   * 有效值視為呼叫方用法錯誤（例如傳進一個沒設 viewBox 的 svg），直接丟錯而不是悄悄退化
   * 成某個猜測值——後者只會讓 `fitTo()` 算出來的縮放比例看似合理、實則跟畫面對不上，
   * 而且很難在事後除錯時想到要查這裡。
   */
  private viewBoxSize(): [number, number] {
    const raw = this.svg.getAttribute('viewBox');
    const parts = raw?.trim().split(/\s+/).map(Number) ?? [];
    const [, , w, h] = parts;
    if (w === undefined || h === undefined || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
      throw new Error(`svg 缺少有效的 viewBox 屬性，fitTo() 需要它才能算出縮放比例：${String(raw)}`);
    }
    return [w, h];
  }

  /**
   * 把 bounds（使用者座標系範圍，例如某分支的包圍盒）縮放置中到整個 viewBox 可視範圍內。
   *
   * 縮放比例與置中位移都用「根 svg 的 viewBox 尺寸」（使用者座標）計算，**不是**
   * `getBoundingClientRect()`（螢幕 CSS px）。根 svg 的 viewBox 尺寸固定不變，瀏覽器已經
   * 用 `preserveAspectRatio` 預設值 `xMidYMid meet` 把整個 viewBox 等比例映射到容器目前
   * 的實際渲染尺寸——這一層縮放是 SVG 內建的，`#viewport` 這層 transform 只是在「viewBox
   * 這個固定大小的畫布」裡面再平移縮放一次，跟容器實際多少 CSS px 完全無關。若改用容器
   * 的像素尺寸來算，等於把兩層縮放疊在一起、算出來的比例會跟畫面對不上（例如容器
   * 1200px 寬、viewBox 3400 寬時，會把「塞滿整個 viewBox」誤算成 1200/3400≈0.35，
   * 而不是正確答案 1）。用固定的 viewBox 尺寸取代易變的容器像素尺寸，也讓這個函式在
   * 沒有瀏覽器版面資訊的測試環境（linkedom）下一樣能算出確定、可斷言的結果。
   */
  fitTo(bounds: [number, number, number, number], pad = 0.9): void {
    const [vbw, vbh] = this.viewBoxSize();
    const [bx, by, bw, bh] = bounds;
    const next = Math.min(MAX, Math.max(MIN, Math.min(vbw / bw, vbh / bh) * pad));
    this.s = next;
    this.x = vbw / 2 - (bx + bw / 2) * next;
    this.y = vbh / 2 - (by + bh / 2) * next;
    this.apply();
  }

  /**
   * 重新綁定到新一輪渲染出的 `<svg>`／`<g id="viewport">`，套用目前既有的 x/y/s（完全不
   * 重新計算，也不夾制範圍）。
   *
   * 用途（task-12 對 task-11 留下的已知取捨的修正）：`src/scripts/edit-canvas.ts` 的
   * `rerender()` 每次成功渲染都用 `replaceChildren()` 整批換掉畫布內容，舊的
   * `<svg>`／`<g id="viewport">` 元素被丟棄。task-11 的做法是每次都重新 `fitTo()`，
   * 代價是玩家每改一個欄位、畫面就跳回整棵樹視角——他好不容易縮放到想改的節點，
   * 一打字就彈開，對非開發者是很挫折的體驗。玩家的平移縮放屬於「這次編輯 session」的
   * 操作狀態，不該因為底下 DOM 被換掉就被重置。
   *
   * 跟 `fitTo()` 的差異：`fitTo()` 會依 `bounds` 重新算出 x/y/s；`rebind()` 完全不碰這
   * 三個值，只是把既有的值 `apply()` 到新的 `layer` 上——語意上仍是「同一個 viewport」，
   * 只是它畫在哪個 `<svg>` 元素上換了。`this.svg` 也要一併換掉：後續 `pan()`／`zoomAt()`
   * 讀的 `getScreenCTM()` 必須是新 `<svg>` 的，舊 `<svg>` 已經從文件裡被拔掉，
   * `getScreenCTM()` 在分離的元素上不保證能拿到正確（甚至任何）版面資訊。
   *
   * 呼叫端（`rerender()`）只在「這個分頁第一次成功畫出東西」（`currentViewport` 還是
   * `null`）才建新 `Viewport` 並呼叫 `fitTo()`；之後每一輪成功渲染都呼叫這個方法，
   * 不再呼叫 `fitTo()`。
   */
  rebind(svg: SVGSVGElement, layer: SVGGElement): void {
    this.svg = svg;
    this.layer = layer;
    this.apply();
  }
}
