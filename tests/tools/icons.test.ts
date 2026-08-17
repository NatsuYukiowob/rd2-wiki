import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { buildSprite, buildHiRes } from '../../tools/lib/icons';
import type { NodeType } from '../../src/lib/types';

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
    expect(index['cccccccccccc']![2]).toBe(48);
    expect(index['cccccccccccc']![3]).toBe(52);
    expect(index['bbbbbbbbbbbb']![2]).toBe(20);
    const meta = await sharp(sprite).metadata();
    expect(meta.format).toBe('webp');
    // size 必須等於實際輸出的 webp 像素尺寸，渲染時巢狀 <image> 的 width/height 就是靠這組數字。
    expect(size).toEqual([meta.width, meta.height]);
  });

  it('高解析輸出為各類型的 2 倍尺寸', async () => {
    const m = await buildHiRes([{ hash: 'dddddddddddd', buf: await png(167, 208), type: 'dice' as NodeType }]);
    const meta = await sharp(m.get('dddddddddddd')!).metadata();
    expect(meta.width).toBeLessThanOrEqual(96);
    expect(meta.height).toBeLessThanOrEqual(104);
  });
});
