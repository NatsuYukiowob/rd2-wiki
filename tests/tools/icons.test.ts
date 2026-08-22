import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { buildSprite, buildHiRes, buildBoardIcon } from '../../tools/lib/icons';

const png = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } })
    .png().toBuffer();

describe('icons', () => {
  it('sprite 依類型使用各自格子尺寸，index 對得上每張圖', async () => {
    const entries = [
      { hash: 'aaaaaaaaaaaa', buf: await png(132, 146), size: [26, 26] as [number, number] },
      { hash: 'bbbbbbbbbbbb', buf: await png(206, 206), size: [34, 34] as [number, number] },
      { hash: 'cccccccccccc', buf: await png(167, 208), size: [56, 56] as [number, number] },
    ];
    const { sprite, index, size } = await buildSprite(entries);
    expect(Object.keys(index)).toHaveLength(3);
    // 格子尺寸就是 entry 自己帶的顯示尺寸。這條要守的是「打包時用的格子＝渲染時用的尺寸」，
    // 兩邊一旦脫鉤，pattern 的 tile 會跟 <rect> 對不齊、圖示從中間裂開。
    for (const e of entries) expect(index[e.hash]!.slice(2)).toEqual(e.size);
    const meta = await sharp(sprite).metadata();
    expect(meta.format).toBe('webp');
    // size 必須等於實際輸出的 webp 像素尺寸，渲染時巢狀 <image> 的 width/height 就是靠這組數字。
    expect(size).toEqual([meta.width, meta.height]);
  });

  it('高解析輸出為顯示尺寸的 2 倍', async () => {
    const size: [number, number] = [56, 56];
    const m = await buildHiRes([{ hash: 'dddddddddddd', buf: await png(167, 208), size }]);
    const meta = await sharp(m.get('dddddddddddd')!).metadata();
    const [w, h] = size;
    expect(meta.width).toBeLessThanOrEqual(w * 2);
    expect(meta.height).toBeLessThanOrEqual(h * 2);
    // fit: 'inside' 保長寬比，兩邊都可能小於上限，但至少要有一邊真的撐到 2 倍——
    // 否則「輸出被縮到很小」也能通過上面兩條上限斷言。
    expect(meta.width === w * 2 || meta.height === h * 2).toBe(true);
  });

  /**
   * 圖示是 `<pattern>` 填進 `<rect class="icon">` 的，tile 尺寸剛好等於那個 rect。畫面上
   * 只鋪一格、看不出重複，但**取樣器在 tile 邊界是繞回的**：放大時最底那一列會被當成最頂
   * 那一列的鄰居取樣進去。骰子與角色的圖底部是不透明的底板邊，於是 rect 的上緣多出一條
   * 極淡的橫線——平常看不見，但前置鏈的金色光暈描的是 alpha 輪廓，一描就放大成一條淡金色
   * 橫槓（Yuki 2026-08-22 回報，換舊圖／改用 sprite 填色都一樣，證明跟圖檔內容無關）。
   *
   * 所以每張 tile 四周都必須留一圈全透明的像素，繞回取樣取到的才是透明。
   */
  it('每張 tile 四周都留一圈透明像素（pattern 邊界繞回取樣的護欄）', async () => {
    const size: [number, number] = [51, 47];
    const hash = 'eeeeeeeeeeee';
    // 來源刻意是整張不透明的紅色方塊：沒有 gutter 的話最外一圈一定是 alpha 255。
    const entries = [{ hash, buf: await png(204, 188), size }];

    const border = async (buf: Buffer, label: string) => {
      const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const { width: w, height: h, channels: c } = info;
      const a = (x: number, y: number) => data[(y * w + x) * c + 3]!;
      let maxEdge = 0;
      for (let x = 0; x < w; x++) maxEdge = Math.max(maxEdge, a(x, 0), a(x, h - 1));
      for (let y = 0; y < h; y++) maxEdge = Math.max(maxEdge, a(0, y), a(w - 1, y));
      // WebP 是有損的，alpha 0 不保證原封不動回來，留一點容差。
      expect(maxEdge, `${label} 最外一圈不是透明的`).toBeLessThanOrEqual(8);
      // 反向守門：整張都透明的話上面那條也會過。中心必須還是不透明的圖。
      expect(a(Math.floor(w / 2), Math.floor(h / 2)), `${label} 中心是空的`).toBeGreaterThan(200);
    };

    await border((await buildHiRes(entries)).get(hash)!, '高解析圖');

    const { sprite, index } = await buildSprite(entries);
    const [x, y, w, h] = index[hash]!;
    await border(
      await sharp(sprite).extract({ left: x, top: y, width: w, height: h }).png().toBuffer(),
      'sprite 格子',
    );
  });

  /**
   * 透明邊要**跟著輸出解析度縮放**。
   *
   * sprite 是 1× 的格子、高解析圖是 2×，兩者被貼到畫面上同一個 `<rect>`。兩邊都留 1px 的話，
   * 圖在兩張素材裡佔的比例不一樣——實測符文 sprite 佔 92.31%、高解析佔 96.15%，
   * 放大到觸發高解析切換的那一刻每顆符文突然大 4.2%（2026-08-22 review 抓到）。
   */
  it('圖在 sprite 與高解析圖裡佔的比例一致（切換時不會跳大小）', async () => {
    const size: [number, number] = [26, 26]; // 符文格子，2px 的邊佔比最大、最容易露餡
    const hash = 'ffffffffffff';
    const entries = [{ hash, buf: await png(104, 104), size }];

    const fill = async (buf: Buffer) => {
      const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const { width: w, height: h, channels: c } = info;
      let top = -1;
      let bottom = -1;
      for (let y = 0; y < h; y++) {
        let any = false;
        for (let x = 0; x < w; x++) if (data[(y * w + x) * c + 3]! > 32) { any = true; break; }
        if (any) { if (top < 0) top = y; bottom = y; }
      }
      return ((bottom - top + 1) / h) * 100;
    };

    const hi = await fill((await buildHiRes(entries)).get(hash)!);
    const { sprite, index } = await buildSprite(entries);
    const [x, y, w, h] = index[hash]!;
    const lo = await fill(await sharp(sprite).extract({ left: x, top: y, width: w, height: h }).png().toBuffer());

    // 1× 的整數像素本來就會有一點捨入誤差，留 1.5 個百分點；沒縮放 gutter 的舊版差 3.8。
    expect(Math.abs(hi - lo), `sprite 佔 ${lo.toFixed(2)}%、高解析佔 ${hi.toFixed(2)}%，切換時會跳大小`)
      .toBeLessThan(1.5);
  });
});

describe('buildBoardIcon', () => {
  // /board 骰盤編輯器的純骰子圖用普通 <img> 顯示，不是 <pattern> 填色，沒有繞回取樣的問題
  // （見 GUTTER 的說明）。加了 gutter 只會讓圖在方框裡顯得更小，所以這裡刻意驗「沒有」。
  it('不套用 withGutter：來源本身滿版不透明時，輸出的四個角也是不透明的', async () => {
    const buf = await png(150, 175);
    const out = await buildBoardIcon(buf);
    const { data, info } = await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width: w, height: h, channels: c } = info;
    const alphaAt = (x: number, y: number) => data[(y * w + x) * c + 3]!;
    for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]] as const) {
      expect(alphaAt(x, y), `角落 (${x},${y}) 不該是透明的——不該套用 gutter`).toBeGreaterThan(200);
    }
  });

  // 這批來源圖尺寸與長寬比都不統一（寬 147–174、高 171–186），跟節點圖示不一樣，不能假設
  // 正方形；用 fit: 'inside' 保留長寬比，不能被拉伸或裁切。
  //
  // ⚠️ 這條擋得到的只有 fit: 'contain'（它會把小圖補成 240×240 的正方形）。來源兩邊都小於
  // 上限、`withoutEnlargement` 之下 inside／fill／cover／outside 全都原尺寸輸出，四種給的
  // 答案一模一樣——真正把 fill／cover 擋下來的是下面那條「會被縮小」的測試裡的長寬比斷言
  // （2026-08-23 review F7-1：在補那條之前，把 'inside' 改成 'fill'／'cover' 這個 describe
  // 四條全綠）。兩條要一起看才是完整的守門。
  it('保留來源長寬比，不強制補邊成正方形', async () => {
    const buf = await png(147, 174);
    const out = await buildBoardIcon(buf);
    const meta = await sharp(out).metadata();
    expect(meta.width! / meta.height!).toBeCloseTo(147 / 174, 2);
  });

  // withoutEnlargement：這批來源圖只有 147–186px，全部小於「2 倍顯示尺寸」的上限，
  // 不該被無意義放大出鋸齒。
  it('withoutEnlargement：小於目標尺寸的來源維持原尺寸，不被放大', async () => {
    const buf = await png(150, 175);
    const out = await buildBoardIcon(buf);
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(150);
    expect(meta.height).toBe(175);
    expect(meta.format).toBe('webp');
  });

  // fit: 'inside' 保留長寬比縮小；來源明顯超過目標尺寸時應該真的被縮小，不是原樣輸出。
  //
  // ⚠️ 這是整個 describe 裡唯一真的走進 resize 的案例，所以「fit 模式有沒有退化」只能在這裡
  // 驗。只斷言「≤240 且變小」是不夠的——`fill`／`cover` 給的 240×240 兩個條件都滿足，
  // 四條測試會一起變成假綠（2026-08-23 review F7-1 實測）。長寬比那條才是真正的守門：
  // inside → 203/240 ≈ 0.846，fill／cover → 1.0，改壞就會紅。
  it('大於目標尺寸的來源會被等比縮小到目標尺寸內（長寬比不變）', async () => {
    const buf = await png(1470, 1740); // 跟真實素材同比例，但放大 10 倍
    const out = await buildBoardIcon(buf);
    const meta = await sharp(out).metadata();
    expect(meta.width!).toBeLessThanOrEqual(240);
    expect(meta.height!).toBeLessThanOrEqual(240);
    expect(meta.width! < 1470 && meta.height! < 1740).toBe(true);
    expect(
      meta.width! / meta.height!,
      `輸出 ${meta.width}×${meta.height} 的長寬比與來源 1470×1740 不符——fit 模式被改成拉伸或裁切了`,
    ).toBeCloseTo(1470 / 1740, 2);
  });
});
