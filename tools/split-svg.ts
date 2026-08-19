import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { loadSvg } from './lib/dom.js';

export interface SplitResult { svg: string; icons: Map<string, Buffer> }

export function splitSvg(svgText: string): SplitResult {
  const doc = loadSvg(svgText);
  const icons = new Map<string, Buffer>();
  for (const img of [...doc.querySelectorAll('image')]) {
    const href = img.getAttribute('href') ?? '';
    const m = /^data:image\/png;base64,(.+)$/s.exec(href);
    if (!m) continue;
    const buf = Buffer.from(m[1]!, 'base64');
    const hash = createHash('sha256').update(buf).digest('hex').slice(0, 12);
    icons.set(hash, buf);
    img.setAttribute('href', `icons/${hash}.png`);
  }
  return { svg: doc.toString(), icons };
}

// CLI: npm run split -- <來源檔路徑>
//
// 來源檔是遊戲原圖，**不在版控內**（各自放在自己機器上）。以前這裡有一個指向維護者本機的
// 預設路徑：對別人來說那只會變成一個看不懂的 ENOENT，而且那條路徑不該出現在公開 repo 裡。
if (import.meta.url === `file://${process.argv[1]}`) {
  const SRC = process.argv[2];
  if (!SRC) {
    console.error('用法：npm run split -- <遊戲原圖 SVG 的路徑>');
    process.exit(1);
  }
  const r = splitSvg(readFileSync(SRC, 'utf8'));
  mkdirSync('data/icons', { recursive: true });
  writeFileSync('data/dice-tree.svg', r.svg);
  for (const [hash, buf] of r.icons) writeFileSync(`data/icons/${hash}.png`, buf);
  console.log(`svg ${(Buffer.byteLength(r.svg) / 1024).toFixed(1)} KB, icons ${r.icons.size}`);
}
