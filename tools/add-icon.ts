import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { readPngSize } from './lib/png.js';

export interface AddIconResult {
  /** sha256 前 12 碼，同時也是不含副檔名的檔名。 */
  hash: string;
  /** 例如 `a1b2c3d4e5f6.png`。 */
  fileName: string;
  /** 完整目的路徑。 */
  destPath: string;
  /** 目的路徑先前就存在同名檔案（代表這張圖示先前已加過），此次呼叫不會覆寫。 */
  alreadyExists: boolean;
}

/**
 * 把來源圖片依內容雜湊命名、複製進 `iconsDir`，符合 CI 規則 7(b) 的「檔名＝內容 sha256 前 12 碼」要求。
 *
 * 貢獻者不需要自己手算雜湊、也不會因為手動命名而導致「改了內容卻沒改檔名」的快取污染問題
 * ——命名永遠由內容決定。驗證邏輯（有效 PNG + 最長邊 ≥ 96px）刻意與 `tools/validate.ts`
 * 規則 7(c) 共用同一支 `readPngSize`，避免兩處各自實作出不一致的判定。
 */
export function addIcon(srcPath: string, iconsDir: string): AddIconResult {
  if (!existsSync(srcPath)) throw new Error(`找不到來源檔案: ${srcPath}`);
  const buf = readFileSync(srcPath);

  const size = readPngSize(buf);
  if (!size) throw new Error(`來源檔案不是有效的 PNG: ${srcPath}`);
  const longest = Math.max(size.width, size.height);
  if (longest < 96) throw new Error(`圖示最長邊 ${longest}px，小於最低要求 96px: ${srcPath}`);

  const hash = createHash('sha256').update(buf).digest('hex').slice(0, 12);
  const fileName = `${hash}.png`;
  const destPath = join(iconsDir, fileName);
  const alreadyExists = existsSync(destPath);
  if (!alreadyExists) writeFileSync(destPath, buf);

  return { hash, fileName, destPath, alreadyExists };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const src = process.argv[2];
  if (!src) {
    console.error('用法: npm run add-icon -- <圖片路徑>');
    process.exit(1);
  }
  try {
    const result = addIcon(src, 'data/icons');
    if (result.alreadyExists) {
      console.log(`圖示已存在，未重複寫入：icons/${result.fileName}`);
    } else {
      console.log(`已新增圖示：icons/${result.fileName}`);
    }
    console.log(`請在 SVG 中使用：href="icons/${result.fileName}"`);
  } catch (e) {
    console.error(`❌ ${(e as Error).message}`);
    process.exit(1);
  }
}
