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
/**
 * `minReadableScale()` 的目標圖示尺寸（CSS px）：手機用手指、桌機用滑鼠，桌機的精準度門檻
 * 可以低一些。兩者都遠高於「完全看不清」的舊 bug 數字（約 9～13px）。
 *
 * 放在這裡而不是 tree-canvas.ts，是因為測試也要用同一組數字。2026-08-18 這兩個值照骰子
 * 顯示寬度重算過（24×50/46 ≈ 26、32×50/46 ≈ 35），當時 tree-canvas.ts 與測試各存了一份，
 * 改了一邊沒改另一邊，於是每個視角都比設計值多放大 12%——只有一份就不會再發生。
 * 骰子寬度日後再變，這兩個值要照同一個比例重算。
 */
export const DESKTOP_ICON_TARGET_PX = 26;
export const MOBILE_ICON_TARGET_PX = 35;

/**
 * 升級成高解析圖示的門檻（單位：**裝置像素 / 使用者座標單位**）。
 *
 * sprite 的格子就是節點的顯示尺寸 1×（例如骰子 50×53），個別的高解析 WebP 是 2×。
 * 所以「值不值得換」要問的是：一個使用者座標單位，現在攤到幾個**實體**裝置像素上？
 * 超過 1 才代表 sprite 的來源解析度已經不夠、需要 2× 素材。
 *
 * 兩個門檻不同（遲滯）是為了避免在門檻附近反覆縮放時，圖示在 sprite 與高解析之間來回抖動。
 */
export const HIRES_UPGRADE_AT = 1.2;
export const HIRES_DOWNGRADE_AT = 0.9;

/**
 * 畫節點投影的門檻（單位：**CSS 像素**，量的是骰子圖示的顯示寬度），配一組遲滯。
 *
 * ⚠️ 刻意**不**沿用上面高解析圖示那組門檻，兩者問的不是同一個問題：
 *
 * - 高解析圖示問「來源解析度夠不夠」→ 判準是**裝置**像素（`effectiveDevicePx`，含 dpr）。
 * - 投影問「使用者看不看得見」→ 判準是 **CSS** 像素。dpr 只影響銳利度，不影響一個東西
 *   在眼睛裡多大；`0 1px 1.5px` 是使用者座標單位，換算成 CSS px 才是實際看到的尺寸。
 *
 * 共用同一組門檻會在高 dpr 手機上判斷錯：dpr 3.25 的手機在 1.87 倍就越過 devicePx 1.2、
 * 開始畫投影，但那時畫面上還有約 120 個節點——比同倍率的 dpr1 桌機更糟，而手機正是最慢的
 * 那台。改用 CSS 像素之後這個不對稱就消失了。
 *
 * 數值取自 `applyReadabilityFloor()` 保證的下限：預設視角一定落在
 * `DESKTOP_ICON_TARGET_PX`（26）／`MOBILE_ICON_TARGET_PX`（35）上。關閉門檻必須**高於
 * 兩者**，才能保證「整棵樹都看得到」的預設視角一律不畫投影——那正是節點最多、最慢的狀態。
 * 開啟門檻 50 CSS px 大約是投影（1 單位位移、1.5 單位模糊）開始真的看得出來的尺寸，
 * 那時畫面上通常只剩幾十個節點。這組不變式有單元測試釘住。
 */
export const SHADOW_ON_AT_ICON_PX = 50;
export const SHADOW_OFF_AT_ICON_PX = 40;

/**
 * 算出「一個使用者座標單位目前攤到幾個裝置像素」。
 *
 * ⚠️ 這是 2026-08-19 review 報告 C05 的核心：舊版的判斷是 `if (vp.scale <= 1) return;`，
 * 只看 `#viewport` 的**內部倍率**，完全沒有考慮
 * ①畫布元素相對 viewBox 的基礎縮放、②裝置像素比。結果兩個方向都錯：
 *
 * - 1280×720 dpr1：實際每單位只有 0.52 裝置像素（骰子 26 CSS px），卻因為 vp.scale ≈ 1.49
 *   而升級了 213 張圖（約 500KB）——完全白抓，sprite 綽綽有餘。
 * - 2560×1440 dpr2：實際 1.41 裝置像素／單位，真的需要 2× 素材，卻因為 vp.scale 沒超過 1
 *   而一張都不升。
 *
 * 公式跟畫布實際怎麼畫是同一套：SVG 用 `preserveAspectRatio` 的 meet 行為，
 * 基礎縮放＝`min(元素寬/viewBox寬, 元素高/viewBox高)`，再乘上 `#viewport` 的 transform 倍率，
 * 最後乘裝置像素比換算成實體像素。
 */
export function effectiveDevicePx(
  svgWidth: number,
  svgHeight: number,
  viewBoxWidth: number,
  viewBoxHeight: number,
  scale: number,
  devicePixelRatio: number,
): number {
  if (viewBoxWidth <= 0 || viewBoxHeight <= 0) return 0;
  const base = Math.min(svgWidth / viewBoxWidth, svgHeight / viewBoxHeight);
  return base * scale * devicePixelRatio;
}

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

  /**
   * 快取起來的「螢幕座標 → 使用者座標」換算分量，`invalidateCtm()` 會清掉。
   *
   * ⚠️ `svg.getScreenCTM()` 是**強制同步版面計算**。2026-08-21 在真實 Chromium 上實測：
   * 連續 300 次「寫 style.transform 再讀 getScreenCTM」要 40ms，先讀一次存起來只要 0.8ms
   * （50 倍）。而拖曳時每一個 pointermove 都會走 `pan()`——等於每個輸入事件都白白 flush
   * 一次版面，那是「拖起來不跟手」的直接來源。
   *
   * 快取是安全的，因為這裡讀的是**根 svg** 的 CTM：它只描述畫布元素本身在頁面上的位置與
   * 大小，跟 `#viewport` 這層 transform 完全無關，拖曳／縮放全程都不會變。
   */
  private ctm: { kx: number; ky: number; ex: number; ey: number } | null = null;

  constructor(
    private svg: SVGSVGElement,
    private layer: SVGGElement,
  ) {}

  get scale(): number {
    return this.s;
  }

  /**
   * 狀態的字串表示，SVG `transform` attribute 的語法（無單位）。
   *
   * ⚠️ 這個值**不再被寫進 DOM**（見 `apply()`），它留下來是因為它是描述「畫布現在在哪」
   * 最好讀的一種形式，測試與除錯都靠它。真正套進 DOM 的是 `cssTransform`。
   */
  get transform(): string {
    return `translate(${this.x},${this.y}) scale(${this.s})`;
  }

  /**
   * 同一個狀態的 CSS `transform` 語法。差別只有 translate 分量要帶單位——CSS 的
   * `translate()` 不接受裸數字。
   *
   * `px` 在 SVG 內容裡就是 user unit，不是 CSS 像素：2026-08-21 實測
   * `translate(100px,50px) scale(2)` 與 attribute 的 `translate(100,50) scale(2)`
   * 產生**完全相同**的 `getScreenCTM()`（`[0.79, 0.79, 282.40, 70.46]`）與節點螢幕位置。
   * 所以 `pan()`／`zoomAt()`／`fitTo()` 的座標換算一行都不用改。
   */
  get cssTransform(): string {
    return `translate(${this.x}px,${this.y}px) scale(${this.s})`;
  }

  /**
   * 套進 DOM。**用 CSS transform，不用 SVG attribute**——這是效能修正，不是風格選擇。
   *
   * SVG 的 `transform` attribute 不會讓瀏覽器把子樹升成合成層，於是拖曳畫布時每一幀都要
   * 重新光柵化整棵樹（239 個 pattern 填充的節點＋248 條邊＋239 個 drop-shadow）。搭配
   * `#viewport { will-change: transform }`（見 src/pages/tree.astro）改用 CSS transform
   * 之後，平移退化成 GPU 對既有圖層做位移、零重繪。
   *
   * 2026-08-21 在真實 Windows 機器上用 A/B 測試頁實測（150 幀自動軌跡）：
   * 平移 0.75× 從 33 FPS／掉 63 幀 → 99 FPS／掉 1 幀；1.00× 從 50 → 100 FPS。
   * 縮放也有改善但沒有完全解決（33→50 FPS、掉幀 53→5、最長幀 90ms→40ms）——scale 一變
   * 圖層內容本來就必須重畫，`will-change` 只能讓瀏覽器先 GPU 拉伸再補畫，不能免除。
   * 要把縮放也推到 100 FPS 得做「停止縮放後才重新光柵化」，代價是縮放過程中畫面會糊，
   * 那是獨立的一件事，不在這裡處理。
   *
   * ⚠️ **兩者不能並存**：實測 CSS transform 存在時 attribute 會被完全忽略（不是疊加），
   * 所以這裡刻意不留 attribute——留著只會讓後人以為它還有作用。
   */
  private apply(): void {
    this.layer.style.transform = this.cssTransform;
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
    if (this.ctm) return this.ctm;
    const ctm = this.svg.getScreenCTM?.();
    const kx = ctm && ctm.a !== 0 ? ctm.a : 1;
    const ky = ctm && ctm.d !== 0 ? ctm.d : 1;
    const ex = ctm?.e ?? 0;
    const ey = ctm?.f ?? 0;
    // 量不到（沒有版面引擎的測試環境、或畫布還沒排版）時退化的 1:1／位移 0 **不進快取**：
    // 那是暫時狀態，存起來會讓之後真的量得到時仍沿用錯的比例，而且沒有任何事件會通知我們
    // 「現在量得到了」。每次重問的成本只發生在這個本來就不正常的狀態下。
    if (!ctm) return { kx, ky, ex, ey };
    this.ctm = { kx, ky, ex, ey };
    return this.ctm;
  }

  /**
   * 丟掉 CTM 快取，下一次 `pan()`／`zoomAt()` 會重新問一次 `getScreenCTM()`。
   *
   * 呼叫端（src/scripts/tree-canvas.ts）負責在「畫布元素在頁面上的位置或大小真的可能變了」
   * 的時候呼叫：ResizeObserver（涵蓋任何原因造成的尺寸變化，不只視窗縮放）、`resize`、
   * 捕獲階段的 `scroll`（位移變了但尺寸沒變，ResizeObserver 收不到），以及每一次
   * `pointerdown`——後者是廉價的保險，讓每個手勢至少重新量一次，代價是整個手勢一次強制
   * 版面計算，而不是每個 pointermove 一次。
   */
  invalidateCtm(): void {
    this.ctm = null;
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
}
