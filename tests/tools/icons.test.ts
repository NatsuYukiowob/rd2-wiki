import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { buildSprite, buildHiRes } from '../../tools/lib/icons';

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
});
