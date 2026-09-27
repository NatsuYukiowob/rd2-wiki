// `public/currency/` 的固定檔名圖示處理器。
//
// 這批圖不走 `npm run add-icon` 的 sha256 管線；renderer 會直接引用
// `/currency/<kind>.png`。輸出規格固定為 64×64 透明 PNG，來源等比例縮放後置中。
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

export const CURRENCY_ICON_SIZE = 64;
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

export async function buildCurrencyIcon(source: Buffer): Promise<Buffer> {
  return sharp(source)
    .resize({
      width: CURRENCY_ICON_SIZE,
      height: CURRENCY_ICON_SIZE,
      fit: 'contain',
      position: 'centre',
      kernel: sharp.kernel.lanczos3,
      background: TRANSPARENT,
    })
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const [kind, sourceArg] = process.argv.slice(2);
  if (!kind || !sourceArg || !/^[a-z][A-Za-z0-9]*$/.test(kind)) {
    throw new Error('用法：npm run add-currency-icon -- <kind> <來源 PNG>');
  }

  const sourcePath = resolve(sourceArg);
  const outputPath = resolve('public', 'currency', `${kind}.png`);
  if (await exists(outputPath)) {
    throw new Error(`${outputPath} 已存在；避免無意覆寫，請先確認並手動移除舊檔。`);
  }

  const source = await readFile(sourcePath);
  const output = await buildCurrencyIcon(source);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, output);
  console.log(`${sourcePath} → ${outputPath}（${CURRENCY_ICON_SIZE}×${CURRENCY_ICON_SIZE}，等比例置中）`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
