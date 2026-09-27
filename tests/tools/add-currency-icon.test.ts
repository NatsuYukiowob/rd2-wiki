import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { buildCurrencyIcon, CURRENCY_ICON_SIZE } from '../../tools/add-currency-icon';

const REWARD_ICONS = [
  'treeSeed.png',
  'coopTicket.png',
  'arenaTicket.png',
  'skinCoin.png',
  'luckyDiceTicket.png',
] as const;

async function alphaBounds(png: Buffer): Promise<[number, number, number, number]> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return [minX, minY, maxX - minX + 1, maxY - minY + 1];
}

describe('add-currency-icon', () => {
  it('輸出固定 64×64 透明 PNG，保留比例並置中', async () => {
    const source = await sharp({
      create: { width: 100, height: 50, channels: 4, background: '#ff0000ff' },
    }).png().toBuffer();
    const output = await buildCurrencyIcon(source);
    const meta = await sharp(output).metadata();
    expect(meta).toMatchObject({ width: 64, height: 64, format: 'png', hasAlpha: true });
    expect(await alphaBounds(output)).toEqual([0, 16, 64, 32]);
  });

  it('五張正式 reward icons 都是同規格輸出', async () => {
    for (const file of REWARD_ICONS) {
      const png = await readFile(`public/currency/${file}`);
      const meta = await sharp(png).metadata();
      expect(meta, file).toMatchObject({ width: CURRENCY_ICON_SIZE, height: CURRENCY_ICON_SIZE, format: 'png' });
    }
  });
});
