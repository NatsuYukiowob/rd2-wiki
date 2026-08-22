import sharp from 'sharp';

/** 一張待打包圖示：雜湊檔名、原始 PNG 位元組、在畫面上的顯示尺寸 [寬, 高]。 */
export interface IconEntry {
  hash: string;
  buf: Buffer;
  /**
   * 顯示尺寸來自引用這張圖的節點（正本 `<image>` 的 width/height），不再由「節點類型」推導：
   * 2026-08-18 換成遊戲原圖的畫法之後，同一種類型底下也會有不同尺寸（玩家被動有大小兩種）。
   */
  size: [number, number];
}

const COLS = 16;
const QUALITY = 80;
/**
 * 每張 tile 四周留的透明邊（像素）。
 *
 * 圖示是用 `<pattern>` 填進 `<rect class="icon">` 的（見 src/lib/render.ts）。pattern 的
 * tile 尺寸剛好等於那個 rect，畫面上只鋪一格、看不出重複——但**取樣器在 tile 邊界是繞回的**：
 * 瀏覽器把 tile 放大時，最底那一列會被當成最頂那一列的鄰居取樣進去。骰子與角色的圖底部
 * 是不透明的底板邊，於是 rect 的**上緣**多出一條極淡的橫線；平常看不出來，但前置鏈的金色
 * 光暈是描 alpha 輪廓的，一描就把那條線放大成一條淡金色的橫槓（Yuki 2026-08-22 回報）。
 *
 * 修法是標準的 sprite gutter：把圖縮 2px 置中，四周就一定有一圈全透明的像素，繞回取樣
 * 取到的是透明。sprite 那邊順便也解掉相鄰格子互相滲色的問題。
 * ⚠️ 不要改成「把最外一圈的 alpha 清成 0」——那是硬切，圖本身若有內容就會被削掉一圈。
 */
const GUTTER = 1;

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

/**
 * 把一張圖縮進 `w×h` 的透明畫布中央，四周留 `gutter` 像素的透明邊。
 *
 * ⚠️ `gutter` 必須**跟著輸出解析度縮放**：sprite 是 1× 的格子、高解析圖是 2×，兩者被貼到
 * 畫面上同一個 `<rect>`。若兩邊都留 1px，圖在兩張素材裡佔的比例就不一樣——實測符文
 * sprite 佔 92.31%、高解析佔 96.15%，放大到觸發高解析切換的那一刻，每顆符文會突然大 4.2%
 * （2026-08-22 review 抓到）。所以 1× 傳 GUTTER、2× 傳 GUTTER*2。
 *
 * 實作只走一條 sharp 管線：`fit: 'contain'` 已經包含「保長寬比縮放 ＋ 置中補透明」，
 * 補完再 `extend` 出四周的透明邊。舊版拆成三段（縮放→編碼 PNG→再解碼讀 metadata→合成），
 * 每張圖每種尺寸多兩次編解碼，整個 build:data 多出約 1,400 次（同一份 review 指出）。
 */
function withGutter(buf: Buffer, w: number, h: number, gutter: number): sharp.Sharp {
  return sharp(buf)
    .resize({
      width: w - gutter * 2,
      height: h - gutter * 2,
      fit: 'contain',
      background: TRANSPARENT,
    })
    .extend({ top: gutter, bottom: gutter, left: gutter, right: gutter, background: TRANSPARENT });
}

/**
 * 把所有圖示依「顯示尺寸」分區打包成一張 WebP sprite。
 *
 * 圖示在畫面上有好幾種顯示尺寸，若全部塞進同一格會讓正方形圖被拉伸、或讓小尺寸的浪費版面。
 * 因此依尺寸分組、各自用自己的格子尺寸排版（每組固定 16 欄），縮放一律 `fit: 'inside'`
 * 保留長寬比，回傳的 `index` 記錄每張圖在畫布上的 `[x, y, w, h]`。
 */
export async function buildSprite(
  entries: IconEntry[]
): Promise<{
  sprite: Buffer;
  index: Record<string, [number, number, number, number]>;
  /** 圖集畫布的實際像素尺寸 [寬, 高]，等同組成 sprite 時 `create` 用的畫布大小。 */
  size: [number, number];
}> {
  const groups = new Map<string, IconEntry[]>();
  for (const e of entries) {
    const [w, h] = e.size;
    const key = `${w}x${h}`;
    const group = groups.get(key);
    if (group) {
      group.push(e);
    } else {
      groups.set(key, [e]);
    }
  }

  const index: Record<string, [number, number, number, number]> = {};
  const composites: sharp.OverlayOptions[] = [];
  let top = 0;
  let canvasWidth = 0;

  for (const [key, group] of groups) {
    const [w, h] = key.split('x').map(Number) as [number, number];
    const rows = Math.ceil(group.length / COLS);
    canvasWidth = Math.max(canvasWidth, COLS * w);
    for (let i = 0; i < group.length; i++) {
      const e = group[i]!;
      const x = (i % COLS) * w;
      const y = top + Math.floor(i / COLS) * h;
      const tile = await withGutter(e.buf, w, h, GUTTER).png().toBuffer();
      composites.push({ input: tile, left: x, top: y });
      index[e.hash] = [x, y, w, h];
    }
    top += rows * h;
  }

  const sprite = await sharp({
    create: { width: canvasWidth, height: top, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(composites)
    .webp({ quality: QUALITY })
    .toBuffer();

  return { sprite, index, size: [canvasWidth, top] };
}

/**
 * 把每張圖示輸出成該類型顯示尺寸「兩倍」的高解析 WebP（供高 DPI 螢幕使用）。
 * 縮放同樣保留長寬比，回傳雜湊到 WebP 位元組的對照表。
 */
export async function buildHiRes(entries: IconEntry[]): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>();
  for (const e of entries) {
    const [w, h] = e.size;
    // 2× 素材的透明邊也要 2×，否則圖在 sprite 與高解析圖裡佔的比例不同，切換時會跳一下。
    out.set(e.hash, await withGutter(e.buf, w * 2, h * 2, GUTTER * 2).webp({ quality: QUALITY }).toBuffer());
  }
  return out;
}

/**
 * 每張「純骰子圖」的縮放**上限**（像素）——不是實際的縮放目標。
 *
 * ⚠️ **這個常數目前一次都不會觸發。** 實測 `data/board-icons/` 的 41 張來源全部是
 * 寬 147–174、高 171–186（最長邊最大值 186），**41/41 沒有一張任何一邊 ≥ 240**；配上
 * `withoutEnlargement`，`resize()` 對現有素材完完全全是 no-op，41 張 WebP 只是原尺寸重新
 * 編碼。把 240 改成任何 ≥ 187 的值，輸出一個位元組都不會變（2026-08-23 review F4-1）。
 *
 * 所以它是「未來換上更大素材時的封頂」，不是現在畫質的決定者——**要提高 /board 的畫質請換
 * 來源圖，調這個數字調不到**。它只會在有人放進一張長邊 ≥ 240px 的來源時才開始作用，那時它
 * 才會把圖等比縮到最長邊 240（`fit: 'inside'`）。
 *
 * 240 這個值的由來：`/board` 骰盤格在桌機約 96px、手機更大，跟 `buildHiRes()` 的高 DPI
 * 原則一樣抓 2 倍顯示尺寸左右。順帶一提，目前的解析度其實剛好夠（桌機格 ≈ 99px × 78%
 * ≈ 77px，DPR 2 需要 154px，來源 149–174 卡在邊緣）——**那是來源圖本身的巧合，不是這個
 * 常數在保證的**。
 */
const BOARD_ICON_TARGET_PX = 240;

/**
 * 把一張「純骰子圖」（`data/board-icons/` 底下的來源 PNG）轉成 `/board` 用的 WebP。
 *
 * 跟 `buildSprite`／`buildHiRes` 是平行的一條資產路徑：這批圖完全不經正本 SVG 引用，是
 * `/board` 骰盤編輯器專用的一批來源。**刻意不套 `withGutter()`**——gutter 存在的理由是
 * `<pattern>` 在 tile 邊界的繞回取樣（見上面 `GUTTER` 的說明），`/board` 用的是普通 `<img>`，
 * 沒有這個問題，加了只會讓圖在方框裡顯得更小。
 *
 * 這批來源圖尺寸與長寬比都不統一（寬 147–174、高 171–186，不像節點圖示是逐節點裁到統一
 * 尺寸），所以用 `fit: 'inside'` 保留原始長寬比而不強制拉伸，`withoutEnlargement` 讓已經
 * 夠大的來源不會被無意義放大出鋸齒。畫面與分享圖兩端都要各自對這個不統一的長寬比做等比
 * 縮放置中（見 `src/lib/board-image.ts` 的 `iconRect`），不能假設它是正方形。
 */
export async function buildBoardIcon(buf: Buffer): Promise<Buffer> {
  return sharp(buf)
    .resize({ width: BOARD_ICON_TARGET_PX, height: BOARD_ICON_TARGET_PX, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 90 })
    .toBuffer();
}
