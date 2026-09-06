/**
 * 畫布的平移／縮放座標數學。取代 SVG 時期的 `Viewport`：那支靠 `getScreenCTM()` 把 CSS px
 * 換算成使用者單位，canvas 沒有這回事——這裡自己記 base（整張 viewBox 剛好塞進容器的
 * px/unit）與 scale（相對 base 的乘數，1＝全貌），所有門檻常數的語意才能原值沿用。
 */
export const MIN_SCALE = 0.2;
export const MAX_SCALE = 8;
export const DESKTOP_ICON_TARGET_PX = 26;
export const MOBILE_ICON_TARGET_PX = 35;
export const HIRES_UPGRADE_AT = 1.2;
export const HIRES_DOWNGRADE_AT = 0.9;
export const SHADOW_ON_AT_ICON_PX = 50;
export const SHADOW_OFF_AT_ICON_PX = 40;

export function effectiveDevicePx(w: number, h: number, vbw: number, vbh: number, scale: number, dpr: number): number {
  if (vbw <= 0 || vbh <= 0) return 0;
  return Math.min(w / vbw, h / vbh) * scale * dpr;
}
export function minReadableScale(w: number, h: number, vbw: number, vbh: number, iconUnits: number, targetPx: number): number {
  const pxPerUnit = Math.min(w / vbw, h / vbh);
  return targetPx / (iconUnits * pxPerUnit);
}

/**
 * 座標層對外的**唯讀幾何面**：painter 與 StaticCache 只需要「現在的縮放是多少、world 的
 * 某一點畫在螢幕哪裡、看得到哪一塊 world」，不需要（也不該拿到）改變鏡頭的手把。
 *
 * 為什麼要這個介面（2026-09-06 最終審查 I3）：`shiftedView()` 回的是一個結構替身，而
 * `CanvasView` 有私有欄位、結構上湊不出同一個型別，舊版只好 `as unknown as CanvasView`。
 * 那個斷言的實際作用是**把型別檢查關掉**：日後在 `CanvasView` 上加一個公開成員並在
 * painter／cache 裡用它，兩邊 typecheck 都會過，而離屏位圖與互動層那條路會在執行期
 * `view.xxx is not a function`。改成「消費端只依賴這個介面」之後，替身湊不齊就是編譯錯誤。
 */
export interface ViewGeometry {
  readonly scale: number;
  readonly base: number;
  readonly pxPerUnit: number;
  readonly version: number;
  readonly cssSize: [number, number];
  worldToScreen(x: number, y: number): [number, number];
  screenToWorld(px: number, py: number): [number, number];
  visibleWorldRect(): { x: number; y: number; w: number; h: number };
}

export class CanvasView implements ViewGeometry {
  private cssW = 1; private cssH = 1;
  private tx = 0; private ty = 0;   // world 原點在螢幕上的 CSS px 位置
  private s = 1;
  private ver = 0;
  constructor(private readonly viewBox: [number, number, number, number]) {}
  get scale(): number { return this.s; }
  get base(): number { return Math.min(this.cssW / this.viewBox[2], this.cssH / this.viewBox[3]); }
  get pxPerUnit(): number { return this.base * this.s; }
  get version(): number { return this.ver; }
  // painter 清畫布（clearRect／設定 canvas 寬高）需要目前的容器 CSS px 尺寸。
  get cssSize(): [number, number] { return [this.cssW, this.cssH]; }
  resize(cssW: number, cssH: number): void {
    // 容器尺寸變了：保持畫面中心對到同一個 world 點，base 換算後 tx/ty 跟著調。
    const [cx, cy] = this.screenToWorld(this.cssW / 2, this.cssH / 2);
    this.cssW = Math.max(1, cssW); this.cssH = Math.max(1, cssH);
    const k = this.pxPerUnit;
    this.tx = this.cssW / 2 - cx * k; this.ty = this.cssH / 2 - cy * k;
    this.ver++;
  }
  pan(dxPx: number, dyPx: number): void { this.tx += dxPx; this.ty += dyPx; this.ver++; }
  zoomAt(factor: number, cxPx: number, cyPx: number): void {
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.s * factor));
    const k = next / this.s;
    // 錨點 (cxPx, cyPx) 底下的 world 點縮放後仍在同一個螢幕位置
    this.tx = cxPx - (cxPx - this.tx) * k;
    this.ty = cyPx - (cyPx - this.ty) * k;
    this.s = next; this.ver++;
  }
  fitTo(bounds: [number, number, number, number], pad = 0.9): void {
    const [bx, by, bw, bh] = bounds;
    const fit = Math.min(this.cssW / bw, this.cssH / bh) * pad;
    this.s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, fit / this.base));
    const k = this.pxPerUnit;
    this.tx = this.cssW / 2 - (bx + bw / 2) * k;
    this.ty = this.cssH / 2 - (by + bh / 2) * k;
    this.ver++;
  }
  worldToScreen(x: number, y: number): [number, number] { const k = this.pxPerUnit; return [this.tx + x * k, this.ty + y * k]; }
  screenToWorld(px: number, py: number): [number, number] { const k = this.pxPerUnit; return [(px - this.tx) / k, (py - this.ty) / k]; }
  visibleWorldRect(): { x: number; y: number; w: number; h: number } {
    const [x0, y0] = this.screenToWorld(0, 0); const [x1, y1] = this.screenToWorld(this.cssW, this.cssH);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
}

/**
 * 「位圖／畫布元素座標系」的視圖：縮放跟真的 view 一模一樣，但螢幕原點在**元素左上角**
 * （world→screen 多加一份邊距），視口尺寸是整張元素的 CSS px 尺寸。
 *
 * 兩個地方要它：`StaticCache` 畫離屏位圖時，以及 `frame()` 畫互動層時——兩張 canvas 元素都比
 * `#canvas-host` 大一圈（每邊 `PAN_MARGIN`）並用 `translate(−邊距)` 定位，畫的時候當然也要
 * 整體往右下推一份邊距，否則內容會相對 host 偏移一個邊距。painter 的 `clear()` 讀 `cssSize`，
 * 所以這裡回整張元素的尺寸，邊距那一圈才會被清掉（不清的話互動層會留上一幀的殘影）。
 *
 * ⚠️ 不能改成「畫之前先 `ctx.translate` 一下」：`drawStatic()`／`drawOverlay()` 自己會
 * `setTransform()`（絕對變換、不是相對的），外面先平移的量會被它蓋掉。把偏移包進 view 是不動
 * `painter.ts` 的唯一做法。
 *
 * 收與回都是 `ViewGeometry`（唯讀幾何）而不是 `CanvasView`：這裡本來就只能提供幾何，
 * `resize`／`pan`／`zoomAt`／`fitTo` 轉發下去會改到**底層那個真的 view**，語意可疑而且
 * 沒有任何呼叫端需要——舊版只是為了湊齊 `CanvasView` 的型別才附上它們（見 I3）。
 */
export function shiftedView(v: ViewGeometry, mx: number, my: number, w: number, h: number): ViewGeometry {
  const shifted: ViewGeometry = {
    get scale(): number { return v.scale; },
    get base(): number { return v.base; },
    get pxPerUnit(): number { return v.pxPerUnit; },
    get version(): number { return v.version; },
    get cssSize(): [number, number] { return [w, h]; },
    worldToScreen(x: number, y: number): [number, number] {
      const [sx, sy] = v.worldToScreen(x, y);
      return [sx + mx, sy + my];
    },
    screenToWorld(px: number, py: number): [number, number] {
      return v.screenToWorld(px - mx, py - my);
    },
    visibleWorldRect(): { x: number; y: number; w: number; h: number } {
      const [x0, y0] = shifted.screenToWorld(0, 0), [x1, y1] = shifted.screenToWorld(w, h);
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    },
  };
  return shifted;
}
