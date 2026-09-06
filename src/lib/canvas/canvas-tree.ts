/**
 * 骰子樹畫布的 controller：把 Task 1–7 的純函式層（scene／view／state／theme／assets／
 * cache／hit／painter／a11y／debug-api）組成一個可以掛在任何 host 元素上的 `TreeHandle`，
 * 給 `/tree` 與 `/sim` 共用。這一層是唯一碰 DOM 事件、rAF 與 ResizeObserver 的地方。
 *
 * **為什麼是兩張 canvas**：靜態層（樞紐、邊、241 顆節點圖、常駐標籤、/sim 等級牌）畫一次要跑
 * 幾百次 drawImage，而它在「只是移動滑鼠」時內容一個像素都不會變；互動層（鏈上光暈、hover／
 * focus 標籤、焦點框）則每次移動指標都要重畫。兩者疊在同一張畫布上的話，滑過一顆節點就得把
 * 241 顆重畫一遍。拆成兩張之後，hover 只重畫互動層那幾個東西，靜態層甚至連重畫都不必——它被
 * `StaticCache` 存成離屏位圖，平移時只是把同一張位圖 blit 到新位置。
 *
 * **為什麼位圖與 canvas 元素都比視口大一圈**：位圖只有視口那麼大的話，一平移就會有一條沒畫過
 * 的區域被拉進畫面，露出底色而且不會自己補（2026-09-06 使用者實測：往左拖 600 px 之後只剩原本
 * 那塊有東西）。所以離屏位圖每邊外擴 `PAN_MARGIN`（見 cache.ts）＝1.5×1.5 視口：邊距內的平移
 * 完全不必重畫，超出邊距 `frame()` 會當場 invalidate 並在同一幀補畫，拖曳／程式化平移結束時也
 * 補一次把邊距重新置中。
 *
 * 頁面上那兩張 canvas **元素**也是同一個尺寸、用 `translate(−邊距)` 定位（`measure()`），
 * 否則下面那條「拖曳中只位移元素」的捷徑會把元素邊緣拖進視口、露出一條最多 25% 視口寬的底色
 * （Task 12c 第一版就是那樣，controller Ruling U 裁定改成現在這樣）。代價是三張貼圖（位圖、
 * 靜態層、互動層）的像素數都變 2.25 倍。
 *
 * **為什麼縮放中先拉伸、150 ms 後才補畫**：`view.scale` 一變，快取 key 就變了，照理每一格滾輪
 * 都要重畫整層。但滾輪與雙指縮放會在一秒內送進幾十個事件，每個都重畫 241 顆節點會直接掉幀。
 * 所以縮放進行中（距上次 `zoomAt` < 150 ms）**刻意不重繪任何一張 canvas**（唯一例外：縮小到拉伸
 * 過的貼圖蓋不滿視口時當幀真的重畫，否則畫面會露出一半底色），改成對兩張元素設
 * `transform: translate(...) scale(k)`（`transform-origin: 0 0`）讓 compositor 去拉伸現成的
 * 貼圖——畫質暫時糊，但手感是即時的；手勢停下 150 ms 後 `setTimeout` 再 invalidate 補畫一次
 * 清晰版並把 transform 清回基準。⚠️ Pixel 7（4× 節流）實測：改成 CSS 之前，縮放每一格滾輪都
 * 重新提交兩張 2.25× 貼圖，只有 22–47 FPS（Commit 600–938 ms／1.4 s）；平移早就走 compositor
 * 所以一直是 54–60。光暈與焦點框在這 150 ms 內跟著一起被拉伸，是這條取捨的一部分。
 *
 * **為什麼 pointer 事件全掛在互動層**：互動層是 DOM 順序最後、疊在最上面的那張 canvas，指標事件
 * 本來就會落在它身上。掛在 host 上的話，落在 a11y 按鈕清單（同樣是 host 的子節點）上的事件會先
 * 冒泡到 host，平移與點選會跟鍵盤按鈕互相打架。⚠️ 而且 `setPointerCapture` 生效後，後續 pointer
 * 事件的 `target` 全部被改標成捕捉的那個元素（`/sim` 踩過的坑），所以「按到哪一顆」一律在
 * pointerdown 當下用 `hitAt()` 記下來，不從 `e.target` 反推。
 *
 * **為什麼 hover 用 hitTest 而不是 DOM**：canvas 裡畫的節點不是元素，沒有 `mouseover`，也沒有
 * `:hover`。唯一能知道「指標在哪一顆上面」的辦法就是拿座標回頭問幾何——`hit.ts` 的網格索引
 * 讓這件事是 O(格子裡的幾顆) 而不是 O(241)，才禁得起每一次 pointermove 都問一次。
 */
import type { TreeData } from '../types.js';
import { buildScene, type Scene } from './scene.js';
import {
  CanvasView, HIRES_DOWNGRADE_AT, HIRES_UPGRADE_AT, SHADOW_OFF_AT_ICON_PX, SHADOW_ON_AT_ICON_PX,
  effectiveDevicePx, shiftedView,
} from './view.js';
import { emptyPaintState, type PaintState } from './state.js';
import { readTheme } from './theme.js';
import { AssetStore } from './assets.js';
import { marginPx, StaticCache } from './cache.js';
import { buildHitIndex, hitTest } from './hit.js';
import { drawOverlay, drawStatic, type Ctx2D } from './painter.js';
import { mountNodeButtons, type NodeButtons } from './a11y.js';
import { installTreeDebug, type TreeDebugApi } from './debug-api.js';

/** 超過這個 CSS px 的位移才算平移，以內算點選（手指按下時一定會抖幾個 px）。 */
const DRAG_PX = 5;
/** 縮放停止多久算「手勢結束」，該補畫一張清晰的靜態層。 */
const ZOOM_SETTLE_MS = 150;
/** 鍵盤焦點跑到視口外時，把它帶回畫面內留的邊界（CSS px）。 */
const FOCUS_MARGIN_PX = 40;

export interface ScreenRect { left: number; top: number; width: number; height: number }

export interface TreeHandle {
  readonly view: CanvasView;
  readonly scene: Scene;
  readonly buttons: NodeButtons;
  /** 合併進目前狀態並排一次重畫（不是取代整份狀態）。 */
  setState(patch: Partial<PaintState>): void;
  getState(): PaintState;
  /** 相對 viewport 的節點矩形（含 host 的 offset）；量不到版面時回 null。 */
  nodeScreenRect(id: string): ScreenRect | null;
  hitAt(clientX: number, clientY: number): string | null;
  requestRedraw(): void;
  /**
   * 程式化平移（鍵盤方向鍵、置中動畫的最後一幀）。跟拖曳收尾一樣會作廢靜態層位圖並排一幀，
   * 把位圖邊距重新置中——**動畫中間那些幀請直接用 `view.pan()` ＋ `requestRedraw()`**，
   * 每一幀都作廢等於每一幀重畫 241 顆節點，正好是分層快取要避免的事。
   */
  pan(dxPx: number, dyPx: number): void;
  fitAll(pad?: number): void;
  fitBounds(b: [number, number, number, number]): void;
  onSelect(cb: (id: string | null, source: 'pointer' | 'keyboard') => void): void;
  /** 平移縮放後（每幀）呼叫，讓呼叫端跟著移動浮在畫布上的東西（詳情卡片）。 */
  onViewChange(cb: () => void): void;
  destroy(): void;
}

/**
 * ⚠️ 這裡**沒有** `sim` 旗標，而且不要再加回來（2026-09-06 最終審查 I2）。
 * `/tree` 與 `/sim` 走的是同一支 `mountCanvasTree(host, data)`：模擬器的差異全部由
 * `setState({ sim })` 表達（state.ts 的 `SimPaint`），controller 裡沒有第二條繪圖路徑；
 * `/tree` 專屬的詳情卡片置中平移與篩選器接線住在 `src/scripts/tree-canvas.ts`，`/sim`
 * 只是不載那支腳本。舊版留過一個 `sim?: boolean`，controller 從頭到尾沒有讀過它——
 * 一個什麼都不關的旗標比沒有旗標貴：它會讓下一個人去 controller 裡找那條不存在的分支。
 */
export interface MountOptions {
  hiresBase?: string;
}

export function mountCanvasTree(host: HTMLElement, data: TreeData, opts: MountOptions = {}): TreeHandle {
  const doc = host.ownerDocument;
  const scene = buildScene(data);
  const view = new CanvasView(scene.viewBox);
  const hit = buildHitIndex(scene);
  // 主題只在掛載時讀一次：站台沒有主題切換，而每一幀都 getComputedStyle 會強制版面重算。
  const theme = readTheme(doc.documentElement);
  let state: PaintState = emptyPaintState();

  const staticEl = doc.createElement('canvas');
  staticEl.className = 'tree-static';
  staticEl.setAttribute('aria-hidden', 'true');
  const overlayEl = doc.createElement('canvas');
  overlayEl.className = 'tree-overlay';
  overlayEl.setAttribute('aria-hidden', 'true');
  // 兩張 canvas 都 aria-hidden：畫布內容對讀屏是空的，真正的無障礙樹是下面 mountNodeButtons
  // 掛的那份按鈕清單，兩份都露出去只會讓讀屏多念一次空白容器。
  host.append(staticEl, overlayEl);

  const ctx2d = (el: HTMLCanvasElement): Ctx2D | null =>
    (typeof el.getContext === 'function' ? (el.getContext('2d') as unknown as Ctx2D | null) : null);
  const staticCtx = ctx2d(staticEl);
  const overlayCtx = ctx2d(overlayEl);

  const assets = new AssetStore(scene.sprite.url, opts.hiresBase ?? '/assets/icons', () => requestRedraw());
  const cache = new StaticCache((w, h) => {
    // OffscreenCanvas 在目標瀏覽器都有，但 Safari 較舊版與測試環境沒有 → 退回一般 canvas 元素。
    const c: CanvasImageSource & { width: number; height: number; getContext(id: '2d'): unknown } =
      typeof OffscreenCanvas === 'function'
        ? new OffscreenCanvas(w, h)
        : Object.assign(doc.createElement('canvas'), { width: w, height: h });
    return { canvas: c, ctx: c.getContext('2d') as Ctx2D };
  });

  let cssW = 1, cssH = 1, dpr = 1;
  let useHires = false;
  let raf = 0;
  // ⚠️ `-Infinity` 不是 0：`frame()` 用 `now() - lastZoomAt < ZOOM_SETTLE_MS` 判斷「縮放
  // 手勢進行中，先別重畫」，而 `now()` 在頁面剛載入時就是 performance.now()＝幾十毫秒。
  // 初值 0 會讓**首屏最初 150 ms 內的每一幀**都被誤判成手勢中而跳過 cache.ensure()——
  // 而首屏的重畫請求（measure、sprite 載好）全部落在那段時間裡，之後沒有任何東西會再排一幀。
  // 症狀是畫布全空、零錯誤訊息，要等使用者拖一下或視窗變一次大小才突然出現（2026-09-06
  // Task 9 接 /tree 時實測到：初次載入 stroke／drawImage 呼叫數都是 0）。
  let lastZoomAt = -Infinity;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  // 上一次**真的重繪**時的 world→螢幕平移量與 pxPerUnit。拖曳／縮放中的 CSS transform 全部
  // 相對這一組換算：畫面上的貼圖就是那一刻畫的，要位移多少、拉伸多少都由「現在 vs 那時」決定。
  // 真的重繪之後位圖的 scale 一定等於 `view.pxPerUnit`（scale 在快取 key 裡，變了就會重畫），
  // 所以這一份同時也是位圖的 scale。
  let paintedAt: [number, number] = [0, 0];
  let paintedScale = 1;
  // 兩張 canvas 元素每邊比 host 多出來的 CSS px（＝位圖邊距），也是 transform 的基準偏移。
  let marginCss: [number, number] = [0, 0];
  let appliedTransform = '';
  // 有「內容變更」等著畫（初次掛載當然算）。拖曳中只有這個為 false 才准走 transform 捷徑。
  let needsPaint = true;
  let destroyed = false;
  let initialised = false;
  const selectCbs: ((id: string | null, source: 'pointer' | 'keyboard') => void)[] = [];
  const viewCbs: (() => void)[] = [];

  const now = (): number => (typeof performance === 'object' && performance ? performance.now() : Date.now());

  /**
   * `contentChanged` ＝「畫面內容真的變了」（狀態、容器尺寸、圖載好、縮放…），預設為真。
   * 只有拖曳平移那條路傳 false——平移不改任何一個像素的內容，只是位置變了，`frame()` 因此
   * 可以走 CSS transform 的捷徑而不重繪；內容真的變了就不能走捷徑，非畫不可。
   */
  function requestRedraw(contentChanged = true): void {
    if (contentChanged) needsPaint = true;
    // 沒有 rAF（linkedom／SSR）就不排——那個環境不會畫東西，硬排只會拿到 undefined。
    if (raf || destroyed || typeof requestAnimationFrame !== 'function') return;
    raf = requestAnimationFrame(frame);
  }

  /**
   * 拖曳中把兩張 canvas **元素**整個位移，讓 compositor 拿現成的貼圖去移，不重繪也不重新
   * 上傳貼圖。⚠️ Pixel 7（4× 節流）實測：每幀重繪兩張 1081×2402 全視口貼圖時 raster／paint／
   * layout 全是 0，時間幾乎全在 Commit（2.2 s 裡 1.4–2.3 s），平移只有 37–49 FPS（SVG 版
   * 57–60）——瓶頸不是畫得慢，是每幀交出兩張全視口貼圖。
   */
  function shiftLayers(x: number, y: number, s: number): void {
    // (x, y) 是元素左上角要落在 host 座標的哪裡，s 是拉伸比；`transform-origin: 0 0` 讓支點
    // 就是元素左上角，所以 translate 之後直接乘 scale 即可。基準是 (−邊距, −邊距, 1)：元素比
    // host 大一圈，要往左上推回去才對齊 host 的左上角。
    // s 完全等於 1 時不寫 scale()，字串才跟純平移時一模一樣（浮點誤差用 1e-9 濾掉）。
    const t = Math.abs(s - 1) < 1e-9
      ? `translate(${x}px, ${y}px)`
      : `translate(${x}px, ${y}px) scale(${s})`;
    if (t === appliedTransform) return;
    appliedTransform = t;
    staticEl.style.transform = t; overlayEl.style.transform = t;
  }

  /** 回到基準：元素左上角對齊 host 左上角、不拉伸。 */
  function resetLayers(): void {
    shiftLayers(-marginCss[0], -marginCss[1], 1);
  }

  /** 目前的 transform 下，兩張元素（連同上面畫過的內容）還蓋不蓋得滿整個視口。 */
  function layersCover(x: number, y: number, s: number): boolean {
    return x <= 0 && y <= 0
      && x + s * (staticEl.width / dpr) >= cssW && y + s * (staticEl.height / dpr) >= cssH;
  }

  function measure(): void {
    if (typeof host.getBoundingClientRect !== 'function') return;
    const r = host.getBoundingClientRect();
    if (!r || r.width === 0 || r.height === 0) return;   // 還沒有版面：等 ResizeObserver 再叫一次
    cssW = r.width; cssH = r.height;
    // dpr 夾在 1–3：4K 手機的 dpr 可以到 4，位圖面積是平方成長，超過 3 之後畫質提升肉眼看不出來
    // 但記憶體與每次重畫的成本會多一倍。
    dpr = Math.max(1, Math.min(3, globalThis.devicePixelRatio || 1));
    // 兩張 canvas **元素**也做成 1.5×1.5 視口（跟離屏位圖同尺寸、同一份 marginPx）並用
    // `translate(−邊距)` 定位：拖曳中位移元素時，邊距那一圈本來就畫好了，不會露出底色。
    // `#canvas-host` 是 `overflow: hidden`，撐出去的部分會被裁掉，也不會撐出頁面捲軸。
    const [mxDev, myDev] = marginPx(cssW, cssH, dpr);
    marginCss = [mxDev / dpr, myDev / dpr];
    for (const el of [staticEl, overlayEl]) {
      el.width = Math.round(cssW * dpr) + 2 * mxDev;
      el.height = Math.round(cssH * dpr) + 2 * myDev;
      // CSS 尺寸嚴格等於「裝置像素 ÷ dpr」，不是 cssW+2·邊距——round 的 0.5 像素誤差跑進
      // CSS 尺寸的話，瀏覽器會把整張位圖縮放貼上，畫面糊掉。
      el.style.width = `${el.width / dpr}px`;
      el.style.height = `${el.height / dpr}px`;
      el.style.transformOrigin = '0 0';   // 縮放捷徑的支點要是元素左上角，不是預設的中心
    }
    resetLayers();   // 邊距變了 → 基準 transform 也要當場跟上，不等下一幀
    // 設過 el.width 的 canvas 是全空的，這一幀非重繪不可：縮放中的 CSS 捷徑不能再走
    // （它會拿「上次重繪的貼圖」當現成的，而那張已經被清掉了）。
    lastZoomAt = -Infinity;
    view.resize(cssW, cssH);
    if (!initialised) {
      // 第一次量到版面才決定初始鏡頭。CanvasView 剛建好時 cssW/cssH 都是 1，而 `resize()` 的職責是
      // 「保持螢幕中心對到同一個 world 點」——那個點是 (1000,1000)，不是 viewBox 中心 (1000,850)，
      // 所以光靠 resize 會讓整棵樹偏心（1280×900 下 viewBox 上緣落在 y=−79）。pad 傳 1＝剛好塞滿，
      // scale 維持 1（全貌）。之後的 resize 不再重新對準，否則使用者拉動視窗就會被拉回全貌。
      initialised = true;
      view.fitTo(scene.viewBox, 1);
    }
    cache.invalidate();   // 位圖尺寸＝(視口＋邊距)×dpr，容器一變整張作廢
    requestRedraw();
  }

  function updateLod(): void {
    const devicePx = effectiveDevicePx(cssW, cssH, scene.viewBox[2], scene.viewBox[3], view.scale, dpr);
    const wantHires = devicePx > HIRES_UPGRADE_AT ? true : devicePx < HIRES_DOWNGRADE_AT ? false : useHires;
    if (wantHires) {
      // 只預載看得到的那幾十顆：整棵樹 240 張 2× WebP 一次抓完是好幾 MB，而放大到觸發升級的
      // 那一刻畫面上通常只有十幾顆。
      // ⚠️ **視錐刻意只用純視口，不含位圖的那一圈邊距**（Ruling X，2026-09-06）：位圖畫的
      // 確實是「視口外擴 `PAN_MARGIN`」那一塊，所以邊距那一圈的節點會被畫進位圖卻停在 1×
      // sprite——但把視錐改成含邊距，Pixel 7 首屏實測從 70 張／358 KB 漲到 120 張／479 KB
      // （離 500 KB 的預算只剩 20 KB）。首屏位元組是使用者可感的指標，而邊距那一圈的低解析
      // 會自癒：拖進視野、手勢結束補畫那一幀就會請求並升級。這筆帳不划算，不要「順手修好」。
      const r = view.visibleWorldRect();
      assets.wantHires(
        scene.nodes.filter(n => n.x >= r.x && n.x <= r.x + r.w && n.y >= r.y && n.y <= r.y + r.h).map(n => n.icon),
      );
    }
    if (wantHires !== useHires) {
      useHires = wantHires;
      // useHires 不在快取 key 裡（它不是狀態、也不是 assets.version 的一部分），翻面時要自己作廢。
      cache.invalidate();
    }
    // 陰影：圖示小到一定程度時 239 個 drop-shadow 只是白花錢（手機平移從 40 掉回 20 FPS 那條
    // 實測，見 CLAUDE.md 的 SHADOW_ON/OFF_AT_ICON_PX）。門檻做成兩個值＝遲滯，避免剛好卡在
    // 邊界上時每一格滾輪都開關一次、每次都讓整層重畫。
    const iconCssPx = view.pxPerUnit * scene.diceIconWidth;
    if (iconCssPx > SHADOW_ON_AT_ICON_PX && !state.shadows) state = { ...state, shadows: true };
    else if (iconCssPx < SHADOW_OFF_AT_ICON_PX && state.shadows) state = { ...state, shadows: false };
  }

  function frame(): void {
    raf = 0;
    if (!staticCtx || !overlayCtx) return;
    const [tx, ty] = view.worldToScreen(0, 0);
    const zooming = now() - lastZoomAt < ZOOM_SETTLE_MS;
    // 單指拖曳中（已超過 DRAG_PX 門檻；雙指縮放時 down 是 null，走 zooming 那半邊）或縮放中：
    // 兩張 canvas 一個像素都不重繪，改用 CSS transform 位移＋拉伸現成的貼圖。位移與拉伸都相對
    // 「上次真的重繪那一刻」換算——跟原本那條拉伸 blit 是同一組數學，只是搬到 compositor 上做。
    const s = view.pxPerUnit / paintedScale;
    const lx = tx - s * (paintedAt[0] + marginCss[0]), ly = ty - s * (paintedAt[1] + marginCss[1]);
    // ⚠️ 縮放中刻意連 `needsPaint` 都不理（拖曳中則不行）：滾輪那 150 ms 內圖集載好、選取改變
    // 之類的事照樣會來，每來一次就重繪 241 顆節點正是要避免的掉幀。改動不會遺失——`needsPaint`
    // 留著，settle timer 到（或覆蓋不足）那一幀一定會畫，最多延遲 150 ms。這也跟舊版一致：
    // 舊版縮放中同樣不呼叫 `cache.ensure()`（只是那時還會每幀重繪兩張貼圖）。
    //
    // ⚠️ 門檻是**兩個條件的 AND**，只守一邊就會露白（兩種洞互為鏡像，2026-09-06 複審 I2）：
    //   (1) **位圖**要蓋滿視口 → `cache.covers()`，相對**位圖 origin**；
    //   (2) **元素**要蓋滿視口 → 元素是照 `paintedAt` 對齊、再被 translate 推的，所以要
    //       `|tx − paintedAt| ≤ 邊距`。
    // 兩者只有在 δ ＝ `paintedAt − 位圖 origin` ＝ 0 時等價。δ≠0 的來源：任何「ensure 回
    // reused、但 view 已經平移過」的幀都會推進 paintedAt 而不動 origin——實際路徑是
    // `animatePan()` 的中間幀（只 `vp.pan()`＋排一幀），而 `cancelCenterPan()` 掛在 host 的
    // pointerdown 上，所以「點一顆節點觸發置中緩動 → 還沒跑完就按下去拖」每次都會造出 δ≠0。
    // 只守 (2) 會在同方向拖出位圖邊界時露白；只守 (1) 會在**反方向**拖時讓元素邊緣進畫面
    // （複審實測 δ=−200 再往反方向拖 400 px：`transform = translate(80px, …)`、左邊白 80 px）。
    // 另外 δ≠0 時位圖在元素裡本身就偏了 δ，超出元素的那一截會被 canvas 裁掉，所以 (2) 不能
    // 靠位圖的餘裕代償。
    if ((zooming || (down !== null && dragged)) && cache.bitmap && (zooming || !needsPaint)
        && layersCover(lx, ly, s) && cache.covers(view, cssW, cssH, s)) {
      shiftLayers(lx, ly, s);
      for (const cb of viewCbs) cb();   // 詳情卡片仍然每幀跟著畫布走
      return;
    }
    resetLayers();
    needsPaint = false;
    paintedAt = [tx, ty];
    // 這一幀之後，畫面上的貼圖就是照現在的鏡頭畫的：位圖若沿用，key 相同代表 scale 也相同，
    // 所以 `view.pxPerUnit` 同時是位圖的 scale，下面的 blit 一律 1:1（k 恆為 1）。
    paintedScale = view.pxPerUnit;
    updateLod();
    const paint = (): 'reused' | 'redrawn' =>
      cache.ensure(view, state, dpr, cssW, cssH, assets.version,
        (ctx, v) => drawStatic(ctx, scene, v, theme, state, assets, dpr, useHires));
    // 平移超出位圖邊距＝視口裡有一塊位圖蓋不到，會露出底色（2026-09-06 使用者實測：往左拖之後
    // 只剩原本位圖那一塊有東西）。等下一幀才補會先閃一格空白，所以在**同一幀**作廢重畫。
    if (paint() === 'reused' && !cache.covers(view, cssW, cssH)) {
      cache.invalidate();
      paint();
    }
    const bmp = cache.bitmap;
    staticCtx.setTransform(1, 0, 0, 1, 0, 0);
    staticCtx.clearRect(0, 0, staticEl.width, staticEl.height);
    if (bmp) {
      // dx,dy＝現在的 origin − world 原點在位圖裡的位置，乘 dpr 換成裝置像素；
      // ＋marginCss 是因為目的座標是**元素**的座標系，而元素左上角在 host 左上角的左上方
      // 一份邊距。剛畫好的位圖 ox＝tx＋邊距，整條式子化簡成 (0, 0)＝1:1 整數搬移、不會糊。
      const [ox, oy] = cache.originPx;
      staticCtx.drawImage(bmp, dpr * (tx + marginCss[0] - ox), dpr * (ty + marginCss[1] - oy));
    }
    // 互動層也要吃同一份邊距偏移：餵真的 view 的話 (a) painter 的 clear() 只清左上角 host 大小
    // 那一塊，邊距那一圈會留上一幀的光暈／標籤殘影，(b) 內容會相對靜態層整體偏移一份邊距。
    drawOverlay(overlayCtx, scene, shiftedView(view, marginCss[0], marginCss[1],
      overlayEl.width / dpr, overlayEl.height / dpr), theme, state, assets, dpr, useHires);
    for (const cb of viewCbs) cb();
  }

  /** 縮放之後：記時間讓 frame() 走 CSS 拉伸那條路，並排一個 150 ms 的補畫。 */
  function afterZoom(): void {
    lastZoomAt = now();
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      // ⚠️ 這裡要自己把 `lastZoomAt` 清掉，不能只靠 `now() - lastZoomAt < ZOOM_SETTLE_MS` 過期：
      // setTimeout 與 performance.now() 不是同一個時鐘，計時器早到零點幾毫秒的話那一幀又會被
      // 判成「縮放中」而走捷徑，於是永遠沒有人補畫，畫面就卡在拉伸糊掉的狀態。
      lastZoomAt = -Infinity;
      cache.invalidate();
      requestRedraw();
    }, ZOOM_SETTLE_MS);
    requestRedraw(false);   // 縮放也不改內容，只是位置與拉伸比變了：讓 frame() 走 compositor
  }

  function clientToLocal(x: number, y: number): [number, number] {
    if (typeof host.getBoundingClientRect !== 'function') return [x, y];
    const r = host.getBoundingClientRect();
    return [x - r.left, y - r.top];
  }

  const hitAt = (clientX: number, clientY: number): string | null => {
    const [lx, ly] = clientToLocal(clientX, clientY);
    const [wx, wy] = view.screenToWorld(lx, ly);
    return hitTest(hit, wx, wy);
  };

  // ── pointer：拖曳 vs 點選、雙指縮放、hover ──────────────────────────────────
  // down.id 是 pointerdown「當下」命中的節點：pointerup 時畫面可能已經平移過，再問一次會答錯，
  // 而 setPointerCapture 之後 e.target 一律是 overlayEl，也問不出來。
  let down: { x: number; y: number; id: string | null } | null = null;
  let dragged = false;
  let last: { x: number; y: number } | null = null;
  const touches = new Map<number, { x: number; y: number }>();
  let lastDist = 0;

  /**
   * 單指拖曳手勢的收尾，**每一條會結束拖曳的路都要走這裡**：pointerup／pointercancel、
   * 第二指落下（改成縮放手勢）、瀏覽器單方面收回指標捕捉。
   *
   * ⚠️ 為什麼一定要集中：拖曳中兩張 canvas 掛著 CSS transform 而且沒有任何 rAF 排著，收尾
   * 少走一條就是「畫面永久卡在位移過的舊貼圖上」——最多 25% 視口的底色留在畫面上，要等下一次
   * 不相干的重繪（選節點、篩選、縮放、改視窗大小）才消失；而且卡住期間 `hitAt()` 量的是 host
   * 與真的 view、完全不知道元素被位移過，使用者點他看到的節點會點到別顆（2026-09-06 審查 I1：
   * 「單指拖曳中第二指落下、兩指再放開」就會走到，觸控上不難重現）。
   */
  function endDrag(): void {
    const was = dragged;
    down = null; last = null; dragged = false;
    // 有拖過才要補畫：把 transform 歸零、位圖邊距重新置中，下一次平移才又有滿滿 25% 餘裕。
    if (was) { cache.invalidate(); requestRedraw(); }
  }

  /** hover 只畫在互動層，清掉它只是重畫一張幾乎空的畫布——很便宜，可以放心多叫幾次。 */
  function clearHover(): void {
    if (state.hover === null) return;
    state = { ...state, hover: null };
    overlayEl.style.cursor = '';
    requestRedraw();
  }

  overlayEl.addEventListener('pointerdown', (e: PointerEvent) => {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size >= 2) { endDrag(); return; }   // 第二指落下＝縮放手勢，不是點選
    down = { x: e.clientX, y: e.clientY, id: hitAt(e.clientX, e.clientY) };
    dragged = false;
    last = { x: e.clientX, y: e.clientY };
    try { overlayEl.setPointerCapture?.(e.pointerId); } catch { /* 沒有捕捉能力就算了，不影響平移 */ }
  });

  overlayEl.addEventListener('pointermove', (e: PointerEvent) => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) {
      const [a, b] = [...touches.values()];
      if (!a || !b) return;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (lastDist > 0) {
        const [mx, my] = clientToLocal((a.x + b.x) / 2, (a.y + b.y) / 2);
        view.zoomAt(dist / lastDist, mx, my);
        afterZoom();
      }
      lastDist = dist;
      return;
    }
    if (down && last) {
      // movementX/Y 刻意不用：Chromium 在指標捕捉與高更新率滑鼠下會給出跟 clientX 差值不一致的
      // 值（SVG 版一路都是自己算差值），換過去會讓平移速度在部分裝置上不對。
      if (!dragged && Math.hypot(e.clientX - down.x, e.clientY - down.y) > DRAG_PX) dragged = true;
      if (dragged) {
        view.pan(e.clientX - last.x, e.clientY - last.y);
        last = { x: e.clientX, y: e.clientY };
        requestRedraw(false);   // 平移不改內容：讓 frame() 走 CSS transform 那條捷徑
      }
      return;
    }
    // 還有指頭壓在畫布上（例如雙指縮放鬆掉一指、剩下那指還在動）就不是 hover：那是手勢殘留，
    // 而觸控裝置本來就沒有 hover 這回事，點亮了也不會有 pointerleave 來清掉它。
    if (touches.size > 0) { clearHover(); return; }
    const h = hitAt(e.clientX, e.clientY);
    if (h !== state.hover) {
      state = { ...state, hover: h };
      overlayEl.style.cursor = h ? 'pointer' : '';
      requestRedraw();
    }
  });

  const endPointer = (e: PointerEvent, isCancel: boolean): void => {
    touches.delete(e.pointerId);
    if (touches.size < 2) lastDist = 0;
    // ⚠️ 先把要用的東西抄下來再 endDrag()：`releasePointerCapture()` 之後會派發
    // `lostpointercapture`，那個監聽器也走 endDrag()。規範說它是**非同步**派發的（下一次
    // process pending pointer capture，也就是 pointerup 之後），所以今天三大引擎都安全；
    // 但抄一份快照＋把 release 挪到收尾之後，就算哪個引擎同步派發也不會把點選吃掉。
    const id = down?.id ?? null, wasDown = down !== null, wasDragged = dragged;
    endDrag();
    try { overlayEl.releasePointerCapture?.(e.pointerId); } catch { /* 沒捕捉過就沒得放 */ }
    if (!wasDown) return;
    // 沒超過門檻＝點選；空白處回 null（呼叫端用它清掉選取）。
    if (!isCancel && !wasDragged && touches.size === 0) for (const cb of selectCbs) cb(id, 'pointer');
  };
  overlayEl.addEventListener('pointerup', (e: PointerEvent) => endPointer(e, false));
  overlayEl.addEventListener('pointercancel', (e: PointerEvent) => { endPointer(e, true); clearHover(); });
  // 指標離開畫布（滑到工具列、切出視窗）之後 canvas 再也收不到 pointermove，hover 會留在最後
  // 那顆節點上——符文的標籤是靠 hover 才畫的，不清就變成畫面上一個擦不掉的字。
  overlayEl.addEventListener('pointerleave', () => clearHover());
  // 瀏覽器單方面收回指標捕捉（觸控被系統手勢接管、元素被移除）時 pointerup/pointercancel 不保證
  // 會送到，這裡補收拾 touches，否則它永遠非空，雙指縮放與 hover 都會卡死。
  overlayEl.addEventListener('lostpointercapture', (e: PointerEvent) => {
    if (typeof e.pointerId === 'number') touches.delete(e.pointerId); else touches.clear();
    if (touches.size < 2) lastDist = 0;
    // 拖曳中被收回捕捉：也要當成手勢結束收尾（pointerup 之後那次是無害的重入，endDrag()
    // 冪等，down 已經是 null、dragged 已經是 false）。
    endDrag();
  });

  // passive:false：要 preventDefault 擋掉整頁捲動，否則在畫布上滾滾輪會把頁面捲走。
  overlayEl.addEventListener('wheel', (e: WheelEvent) => {
    e.preventDefault();
    const [lx, ly] = clientToLocal(e.clientX, e.clientY);
    view.zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, lx, ly);
    afterZoom();
  }, { passive: false });

  // ── 鍵盤焦點：a11y 按鈕拿到焦點時把節點帶進畫面 ─────────────────────────────
  function ensureVisible(id: string): void {
    const n = scene.byId.get(id);
    if (!n) return;
    const [sx, sy] = view.worldToScreen(n.x, n.y);
    const m = FOCUS_MARGIN_PX;
    const dx = sx < m ? m - sx : sx > cssW - m ? cssW - m - sx : 0;
    const dy = sy < m ? m - sy : sy > cssH - m ? cssH - m - sy : 0;
    if (dx || dy) { view.pan(dx, dy); cache.invalidate(); }   // 程式化平移一樣要補畫（呼叫端會排一幀）
  }

  const buttons: NodeButtons = mountNodeButtons(doc, host, scene, {
    onFocus: id => { state = { ...state, focus: id }; ensureVisible(id); requestRedraw(); },
    onBlur: () => { state = { ...state, focus: null }; requestRedraw(); },
    onActivate: id => { for (const cb of selectCbs) cb(id, 'keyboard'); },
  });

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => measure()) : null;
  ro?.observe(host);
  measure();

  const nodeScreenRect = (id: string): ScreenRect | null => {
    const n = scene.byId.get(id);
    if (!n || typeof host.getBoundingClientRect !== 'function') return null;
    const r = host.getBoundingClientRect();
    if (!r || r.width === 0) return null;   // 沒有版面（linkedom／還沒掛進文件）：回 null 不要丟
    const k = view.pxPerUnit;
    const [sx, sy] = view.worldToScreen(n.x, n.y);
    return { left: r.left + sx - (n.w * k) / 2, top: r.top + sy - (n.h * k) / 2, width: n.w * k, height: n.h * k };
  };

  const debugApi: TreeDebugApi = {
    count: () => ({ nodes: scene.nodes.length, edges: scene.edges.length }),
    scale: () => view.scale,
    nodeScreenRect,
    state: () => ({
      selected: state.selected, chain: [...state.chain], filteredOut: [...state.filteredOut], focus: state.focus,
      bypassEdges: scene.edges.filter(e => e.bypassable).map(e => [e.from, e.to] as [string, string]),
      sim: state.sim ? {
        owned: [...state.sim.owned], available: [...state.sim.available],
        linked: [...state.sim.linked].map(k => k.split('>') as [string, string]),
        active: [...state.sim.active].map(k => k.split('>') as [string, string]),
      } : undefined,
    }),
    hitAt,
  };
  // 裝在 globalThis（瀏覽器＝window）：E2E 與正式版走同一份渲染路徑，不必為偵錯介面多一個 build flag。
  const debugHost = globalThis as unknown as { __tree?: TreeDebugApi };

  const handle: TreeHandle = {
    view, scene, buttons,
    setState(patch) { state = { ...state, ...patch }; requestRedraw(); },
    getState: () => state,
    nodeScreenRect,
    hitAt,
    requestRedraw,
    pan(dxPx, dyPx) { view.pan(dxPx, dyPx); cache.invalidate(); requestRedraw(); },
    fitAll(pad) { view.fitTo(scene.viewBox, pad); cache.invalidate(); requestRedraw(); },
    fitBounds(b) { view.fitTo(b); cache.invalidate(); requestRedraw(); },
    onSelect(cb) { selectCbs.push(cb); },
    onViewChange(cb) { viewCbs.push(cb); },
    destroy() {
      destroyed = true;
      ro?.disconnect();
      clearTimeout(settleTimer);
      if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
      raf = 0;
      clearHover();
      // 只移除自己掛上去的三個元素，不清空整個 host——host 是頁面的，可能還有別的東西。
      for (const el of [staticEl, overlayEl, buttons.list]) el.remove();
      // 偵錯介面是全域單例：只有在它還指著「這一份」時才收掉，免得把後掛上去的那棵樹刪掉。
      if (debugHost.__tree === debugApi) delete debugHost.__tree;
    },
  };

  installTreeDebug(debugHost, debugApi);

  return handle;
}
