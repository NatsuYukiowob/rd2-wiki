export type Drawable = ImageBitmap | HTMLImageElement;

/**
 * sprite 圖集＋個別節點的 2× WebP（`public/assets/icons/<雜湊>.webp`，圖示管線既有產物）。
 * 載入是非同步的：載好只呼叫 `onReady` 要求重畫，自己不碰 canvas。失敗的圖記住不重試
 * （舊 `hires.ts` 的 `failedIcons` 同一個理由：404 一直重試等於每次縮放都打一輪網路）。
 *
 * ⚠️ 控制者裁決（2026-09-06，原訂 Task 6 的範圍併進本任務）：`AssetStore` 從一開始就多提供
 * 兩件事，不等後面才補：
 *
 * 1. `image(url)`——泛用單張圖快取。`sprite` 與 `hires()` 都只是它的特例（分別固定
 *    `spriteUrl` 與 `${hiresBase}/${icon}.webp` 這個 url），三者共用同一份 `cache`／同一套
 *    「loading 記住、failed 記住不重試」規則，不必各自維護一份幾乎一樣的載入邏輯。
 * 2. `version`——每張圖真的載好（sprite 或任何一張 hires）就 +1。**這是給靜態層的畫面快取
 *    當 key 用的**：畫布是分層畫的（靜態的節點／邊在離屏 canvas 上快取，不必每一幀重畫
 *    239 顆節點），但圖示是非同步載入的，靜態層第一次畫的時候多半有些圖還沒到——它需要一個
 *    單調遞增的數字，才知道「我上次畫的時候用的 version 跟現在不一樣，代表有新圖到了，
 *    該重畫一次」，而不必自己去比對是哪一張圖、也不必每一幀都重畫來保險。
 */
export class AssetStore {
  private readonly cache = new Map<string, Drawable | 'loading' | 'failed'>();
  private ver = 0;

  constructor(
    private readonly spriteUrl: string,
    private readonly hiresBase: string,
    private readonly onReady: () => void,
  ) {
    this.image(spriteUrl); // 一開始就搶先載入 sprite，不等第一次 get sprite() 才觸發
  }

  /** 給靜態層快取當 key：值一變，代表有圖載好了，靜態層該丟掉舊的離屏畫面重畫一次。 */
  get version(): number {
    return this.ver;
  }

  /** 載好前 null，載好呼叫 onReady 一次。 */
  get sprite(): Drawable | null {
    return this.image(this.spriteUrl);
  }

  /**
   * **只查已經載好的**（沒載過就回 null，**不會**開始載）。
   *
   * ⚠️ 這個「查」與底下的「要」刻意分成兩個方法，不是同一個懶載入口（Task 12b，Task 12
   * 報告 §5 ①）：painter 畫一幀時要對場景裡每一顆節點問一次「你的 2× 圖載好了嗎」，那條路
   * 若是懶載的，畫一幀就等於把整棵樹 240 張 2× WebP 全部要下來（Pixel 7 首屏實測 779.5KB／
   * 240 個請求），`canvas-tree.ts` 的 `updateLod()` 那段「只預載視錐內看得到的幾十顆」也就
   * 完全被架空。畫一幀不該有副作用，「要圖」只由 controller 依視錐發動。
   */
  loadedHires(icon: string): Drawable | null {
    const cur = this.cache.get(`${this.hiresBase}/${icon}.webp`);
    return cur === undefined || cur === 'loading' || cur === 'failed' ? null : cur;
  }

  /**
   * 批次要求載入（沒載過就開始載，失敗記住不重試），不等結果——載好那一刻 `version` +1、
   * `onReady()` 讓靜態層丟掉舊位圖重畫一次，那時 `loadedHires()` 就拿得到圖了。
   *
   * **唯一的呼叫者是 controller 的 `updateLod()`**（依 `visibleWorldRect()` 挑節點）。
   */
  wantHires(icons: Iterable<string>): void {
    for (const icon of icons) this.image(`${this.hiresBase}/${icon}.webp`);
  }

  /**
   * 泛用單張圖快取：第一次呼叫某個 url 會開始載（記 `'loading'`）並回傳 `null`；
   * 載入中或載入失敗（記 `'failed'`，不重試）再次呼叫也回傳 `null`；載好之後回傳圖本身，
   * 並在載好那一刻（只有那一刻）讓 `version` +1、呼叫一次 `onReady()`。
   */
  image(url: string): Drawable | null {
    const cur = this.cache.get(url);
    if (cur === undefined) {
      this.cache.set(url, 'loading');
      this.load(url).then(img => {
        this.cache.set(url, img ?? 'failed');
        if (img) {
          this.ver++;
          this.onReady();
        }
      });
      return null;
    }
    return cur === 'loading' || cur === 'failed' ? null : cur;
  }

  private async load(url: string): Promise<Drawable | null> {
    if (typeof Image !== 'function') return null; // linkedom／測試：沒有圖就沒有圖，不丟例外
    return new Promise(resolve => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }
}
