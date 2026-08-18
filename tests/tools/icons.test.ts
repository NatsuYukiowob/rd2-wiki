import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { buildSprite, buildHiRes } from '../../tools/lib/icons';
import type { NodeType } from '../../src/lib/types';
import { sizeOfType } from '../../src/lib/taxonomy';

const png = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } })
    .png().toBuffer();

describe('icons', () => {
  it('sprite 依類型使用各自格子尺寸，index 對得上每張圖', async () => {
    const entries = [
      { hash: 'aaaaaaaaaaaa', buf: await png(132, 146), type: 'rune' as NodeType },
      { hash: 'bbbbbbbbbbbb', buf: await png(206, 206), type: 'passive' as NodeType },
      { hash: 'cccccccccccc', buf: await png(167, 208), type: 'dice' as NodeType },
    ];
    const { sprite, index, size } = await buildSprite(entries);
    expect(Object.keys(index)).toHaveLength(3);
    // 格子尺寸就是該類型的顯示尺寸——拿 sizeOfType() 當期望值，而不是抄一份數字下來：
    // 這條要守的是「打包時用的格子＝渲染時用的尺寸」，兩邊一旦脫鉤，pattern 的 tile 會跟
    // <rect> 對不齊、圖示從中間裂開。寫死數字則只會在改尺寸表時逼人回來改測試。
    expect(index['cccccccccccc']!.slice(2)).toEqual(sizeOfType('dice'));
    expect(index['bbbbbbbbbbbb']!.slice(2)).toEqual(sizeOfType('passive'));
    expect(index['aaaaaaaaaaaa']!.slice(2)).toEqual(sizeOfType('rune'));
    const meta = await sharp(sprite).metadata();
    expect(meta.format).toBe('webp');
    // size 必須等於實際輸出的 webp 像素尺寸，渲染時巢狀 <image> 的 width/height 就是靠這組數字。
    expect(size).toEqual([meta.width, meta.height]);
  });

  it('高解析輸出為各類型的 2 倍尺寸', async () => {
    const m = await buildHiRes([{ hash: 'dddddddddddd', buf: await png(167, 208), type: 'dice' as NodeType }]);
    const meta = await sharp(m.get('dddddddddddd')!).metadata();
    const [w, h] = sizeOfType('dice');
    expect(meta.width).toBeLessThanOrEqual(w * 2);
    expect(meta.height).toBeLessThanOrEqual(h * 2);
    // fit: 'inside' 保長寬比，兩邊都可能小於上限，但至少要有一邊真的撐到 2 倍——
    // 否則「輸出被縮到很小」也能通過上面兩條上限斷言。
    expect(meta.width === w * 2 || meta.height === h * 2).toBe(true);
  });
});
