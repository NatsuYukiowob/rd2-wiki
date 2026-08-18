import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { loadSvg } from './lib/dom.js';
import { validateWith, type IconSource, type ValidateResult } from '../src/lib/validate-rules.js';

export interface ValidateOpts {
  keywords: string[];
  /** 圖示所在目錄；此包裝負責把目錄內容讀成 IconSource 再交給共用規則層。 */
  iconsDir: string;
}
export type { ValidateResult };

/** 從磁碟目錄建出規則層要的 IconSource（讀檔與算雜湊留在 Node 端，規則層維持同步、環境無關）。 */
function iconSourceFromDir(iconsDir: string): IconSource {
  const known = new Set<string>();
  const toVerify = new Map<string, { bytes: Uint8Array; actualHash: string }>();
  for (const f of readdirSync(iconsDir).filter(n => n.endsWith('.png'))) {
    const hash = f.slice(0, -'.png'.length);
    const bytes = readFileSync(join(iconsDir, f));
    known.add(hash);
    // CI 端一律全驗：規則 7(b) 的用途正是抓「內容換了、檔名沒換」，只驗新檔就漏掉了。
    toVerify.set(hash, { bytes, actualHash: createHash('sha256').update(bytes).digest('hex').slice(0, 12) });
  }
  return { known, toVerify };
}

/** CI 資料守門員（Node 入口）。簽章與行為維持不變，規則本體見 src/lib/validate-rules.ts。 */
export function validate(svgText: string, opts: ValidateOpts): ValidateResult {
  return validateWith(svgText, { keywords: opts.keywords, icons: iconSourceFromDir(opts.iconsDir) }, loadSvg);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { errors, warnings } = validate(readFileSync('data/dice-tree.svg', 'utf8'), {
    keywords: JSON.parse(readFileSync('data/keywords.json', 'utf8')),
    iconsDir: 'data/icons',
  });
  warnings.forEach(w => console.warn(`⚠️  ${w}`));
  errors.forEach(e => console.error(e));
  console.log(errors.length === 0 ? '✅ 驗證通過' : `❌ ${errors.length} 個問題`);
  process.exit(errors.length === 0 ? 0 : 1);
}
