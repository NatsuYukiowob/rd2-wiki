import { shiftedView, type ViewGeometry } from './view.js';
import { stateSignature, type PaintState } from './state.js';
import type { Ctx2D } from './painter.js';

type Backing = { canvas: CanvasImageSource & { width: number; height: number }; ctx: Ctx2D };

/** 位圖比視口每邊多畫出去的比例（0.25＝1.5×1.5 視口，像素數是純視口的 2.25 倍）。 */
export const PAN_MARGIN = 0.25;

/**
 * 位圖／canvas 元素的面積上限。canvas 超過瀏覽器上限時**不會丟例外**，只會拿到一張畫不出東西
 * 的 canvas——症狀是「畫面全空、零錯誤訊息」，跟 `canvas-tree.ts` 裡 `lastZoomAt = -Infinity`
 * 那個註解記著的失敗長相一模一樣。邊距把三張貼圖的面積都乘了 2.25，所以要自己夾制。
 * 取 8192／16.7M px（≈4096²）是 Chromium／WebKit／Firefox 都吃得下的保守值：Chromium 桌機
 * 實際上到 16384 邊長／268M 面積，但 iOS Safari 在低記憶體裝置上只有 4096²，而本站只在
 * Chromium 驗過（CLAUDE.md），這裡照最小公分母走。
 */
export const MAX_SIDE = 8192, MAX_AREA = 16_777_216;

/**
 * 每邊的邊距，**取整數裝置像素**。離屏位圖與頁面上那兩張 canvas 元素都用這一份，兩邊差半個
 * 像素的話 blit 就會被重新取樣糊掉（四張桌機快照會整張紅）。
 *
 * 超過面積上限時邊距**逐次減半**降級（不是一步歸零）：大螢幕上還是留得住一小圈邊距，
 * 「拖曳中不露白」只是餘裕變小、補畫變頻繁，不會退化成完全沒有。
 *
 * ⚠️ **連裸視口自己都超標時只能回 `[0, 0]`，而 `ensure()` 照樣配那個尺寸**（`cache.test.ts`
 * 把這個行為釘住了）——元素至少要跟視口一樣大，那已經超出這一層能處理的範圍，這裡不假裝
 * 擋得住（2026-09-06 最終審查 m3：舊註解寫「不會靜默配到一張壞掉的 canvas」，比程式做得到的
 * 事強）。實務上要 5K／6K 螢幕（CSS 3008×1692 @dpr2 → 20.4M px）才碰得到，而 Chromium 真實
 * 上限是 268M px，所以那不是畫面錯誤；真正的代價是邊距 0 之後平移捷徑幾乎全程失效
 * （`layersCover()` 只在位移剛好為 0 時成立＝每一幀都真的重畫），是一道安靜的效能懸崖。
 */
export function marginPx(cssW: number, cssH: number, dpr: number): [number, number] {
  const w0 = Math.max(1, Math.round(cssW * dpr)), h0 = Math.max(1, Math.round(cssH * dpr));
  for (let m = PAN_MARGIN; m > 0.001; m /= 2) {
    const mx = Math.round(cssW * m * dpr), my = Math.round(cssH * m * dpr);
    const w = w0 + 2 * mx, h = h0 + 2 * my;
    if (w <= MAX_SIDE && h <= MAX_SIDE && w * h <= MAX_AREA) return [mx, my];
  }
  return [0, 0];
}

/**
 * 靜態層的位圖快取。平移時整張畫布只是把這張位圖 blit 到新位置——241 顆節點一顆都不重畫；
 * 縮放、選取、篩選、dpr、視口尺寸、圖集載好（assetsVersion）才重畫。
 *
 * 位圖畫的不是整棵樹（放大 8× 時整棵樹是 16000×13600，記憶體撐不住，而且畫面外的部分沒人看），
 * 而是**視口每邊外擴 `PAN_MARGIN` 的那一塊**（頁面上那兩張 canvas **元素**也是同一個尺寸，
 * 見 `canvas-tree.ts` 的 `measure()`，所以拖曳中位移元素不會露出底色）。平移量還在邊距內時，
 * 被平移露出來的區域早就畫在位圖上了，一顆節點都不必重畫；超出邊距才會露出底色。
 *
 * 呼叫端要問 `covers()` 的時機：**每一幀真的重繪的路徑上**，回 false 就 `invalidate()` 並在
 * 同一幀重畫（等下一幀會閃一格空白）；拖曳中的 CSS transform 捷徑也用同一個 `covers()` 當
 * 「還能不能繼續只位移」的門檻（`canvas-tree.ts` 的 `frame()`），而且要跟 `layersCover()`（元素
 * 蓋滿視口）AND 起來——只問其一各有一個鏡像的露白洞。縮放中也問（帶目前的拉伸倍率 s）：拉伸過的
 * 貼圖蓋不滿視口（縮小太多）就當幀真的重畫，不等 150 ms；蓋得滿才走「整張拉伸、停 150 ms 再補畫」。另外在手勢結束（pointerup、程式化平移收尾、縮放停
 * 150 ms）時也 invalidate 一次，把邊距重新置中，下一次平移才又有滿滿 25% 的餘裕。
 *
 * `originPx` 是 world 原點**在位圖裡**的位置（CSS px，已含邊距偏移）：blit 時位圖左上角要擺在
 * 元素座標的 (tx + 邊距 − originPx.x·k, ty + 邊距 − originPx.y·k)，k 是「現在的 pxPerUnit ÷
 * 畫位圖那一刻的」；剛畫好且 k＝1 時這個式子剛好化簡成 (0, 0)。邊距取整數裝置像素（`marginPx`）
 * 才不會有半像素、被重新取樣糊掉。
 */
export class StaticCache {
  private backing: Backing | null = null;
  private key = '';
  private origin: [number, number] = [0, 0];
  private sizeCss: [number, number] = [0, 0];

  constructor(private createCanvas: (w: number, h: number) => Backing) {}

  get bitmap(): (CanvasImageSource & { width: number; height: number }) | null {
    return this.backing?.canvas ?? null;
  }

  /** world 原點在位圖裡的位置（CSS px，含邊距偏移）；呼叫端 blit 時用來換算目前該畫在哪。 */
  get originPx(): [number, number] {
    return this.origin;
  }

  /** 強制下一次 ensure 一定重畫（例如圖示以外的東西也可能要求整層重來時）。 */
  invalidate(): void {
    this.key = '';
  }

  /**
   * 目前的平移量下，位圖是否還蓋滿整個視口。false ＝ 有一塊會露出底色，呼叫端該
   * `invalidate()` 並在同一幀重畫。
   *
   * `k` ＝「現在的 pxPerUnit ÷ 畫位圖那一刻的」：縮放中畫面上的位圖是被 CSS `scale(k)` 拉伸的，
   * 蓋得到的範圍跟著乘 k（放大時變寬、縮小時變窄，縮太多就蓋不滿了）。純平移時 k＝1。
   */
  covers(view: ViewGeometry, cssW: number, cssH: number, k = 1): boolean {
    if (!this.backing) return false;
    const [ox, oy] = this.origin;
    const [tx, ty] = view.worldToScreen(0, 0);
    const left = tx - ox * k, top = ty - oy * k;   // 位圖左上角現在落在螢幕的哪裡（CSS px）
    return left <= 0 && top <= 0
      && left + this.sizeCss[0] * k >= cssW && top + this.sizeCss[1] * k >= cssH;
  }

  ensure(
    view: ViewGeometry,
    state: PaintState,
    dpr: number,
    cssW: number,
    cssH: number,
    assetsVersion: number,
    draw: (ctx: Ctx2D, view: ViewGeometry) => void,
  ): 'reused' | 'redrawn' {
    // key 只放「只平移不影響畫面內容」以外的一切——scale／dpr／視口尺寸／狀態簽名／圖集版本
    // 任一變都代表位圖內容該變了；tx/ty（平移量）刻意不進 key，因為那只是 blit 位置，不是內容。
    // 平移到位圖邊距外的情況由呼叫端問 covers() 後 invalidate，不靠 key。
    const key = `${view.scale}|${dpr}|${cssW}x${cssH}|${assetsVersion}|${stateSignature(state)}`;
    if (this.backing && key === this.key) return 'reused';
    const [mx, my] = marginPx(cssW, cssH, dpr);
    const w = Math.max(1, Math.round(cssW * dpr) + 2 * mx), h = Math.max(1, Math.round(cssH * dpr) + 2 * my);
    if (!this.backing || this.backing.canvas.width !== w || this.backing.canvas.height !== h) {
      this.backing = this.createCanvas(w, h);
    }
    this.sizeCss = [w / dpr, h / dpr];
    draw(this.backing.ctx, shiftedView(view, mx / dpr, my / dpr, w / dpr, h / dpr));
    const [tx, ty] = view.worldToScreen(0, 0);
    this.origin = [tx + mx / dpr, ty + my / dpr];
    this.key = key;
    return 'redrawn';
  }
}
