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
