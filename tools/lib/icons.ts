import sharp from 'sharp';
import { sizeOfType } from '../../src/lib/taxonomy.js';
import type { NodeType } from '../../src/lib/types.js';

/** 一張待打包圖示：雜湊檔名、原始 PNG 位元組、所屬節點類型。 */
export interface IconEntry {
  hash: string;
  buf: Buffer;
  type: NodeType;
}

const COLS = 16;
const QUALITY = 80;

/**
 * 把所有圖示依「類型」分區打包成一張 WebP sprite。
 *
 * 圖示在畫面上有四種顯示尺寸（骰子/符文/被動/支援），若全部塞進同一格會讓正方形圖被拉伸、
 * 或讓小尺寸類型浪費版面。因此依類型分組、各自用自己的格子尺寸排版（每組固定 16 欄），
 * 縮放一律 `fit: 'inside'` 保留長寬比，回傳的 `index` 記錄每張圖在畫布上的 `[x, y, w, h]`。
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
    const [w, h] = sizeOfType(e.type);
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
      const tile = await sharp(e.buf).resize({ width: w, height: h, fit: 'inside' }).png().toBuffer();
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
    const [w, h] = sizeOfType(e.type);
    out.set(
      e.hash,
      await sharp(e.buf)
        .resize({ width: w * 2, height: h * 2, fit: 'inside' })
        .webp({ quality: QUALITY })
        .toBuffer()
    );
  }
  return out;
}
