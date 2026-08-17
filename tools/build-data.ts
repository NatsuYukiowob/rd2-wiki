import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { parseTree } from './lib/svg-parse.js';
import { buildSprite, buildHiRes, type IconEntry } from './lib/icons.js';
import { loadSvg } from './lib/dom.js';
import { buildTreeDataWith, type BuildOpts } from '../src/lib/build-tree.js';
import { typeOfZh } from '../src/lib/taxonomy.js';
import type { TreeData } from '../src/lib/types.js';

export type { BuildOpts };

/** Node 端入口：注入 linkedom 版 DOM。簽章維持 2 個參數，既有測試與 CLI 區塊都不必改。 */
export function buildTreeData(svgText: string, opts: BuildOpts): TreeData {
  return buildTreeDataWith(svgText, opts, loadSvg);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const svgText = readFileSync('data/dice-tree.svg', 'utf8');
  const keywords = JSON.parse(readFileSync('data/keywords.json', 'utf8'));
  const unlockExceptions = JSON.parse(readFileSync('data/unlock-exceptions.json', 'utf8'));

  const { nodes: rawNodes } = parseTree(svgText);
  const typeByHash = new Map(rawNodes.map(n => [n.icon, typeOfZh(n.typeZh)]));
  const entries: IconEntry[] = readdirSync('data/icons')
    .filter(f => f.endsWith('.png'))
    .map(f => {
      const hash = f.replace('.png', '');
      return { hash, buf: readFileSync(`data/icons/${f}`), type: typeByHash.get(hash) ?? 'dice' };
    });

  const { sprite, index, size } = await buildSprite(entries);
  const hiRes = await buildHiRes(entries);

  mkdirSync('public/assets/icons', { recursive: true });
  mkdirSync('src/generated', { recursive: true });
  writeFileSync('public/assets/sprite.webp', sprite);
  for (const [hash, buf] of hiRes) writeFileSync(`public/assets/icons/${hash}.webp`, buf);

  const data = buildTreeData(svgText, { keywords, unlockExceptions, spriteIndex: index, spriteSize: size });
  const json = JSON.stringify(data);
  writeFileSync('src/generated/tree.json', json);

  console.log(`tree.json ${(Buffer.byteLength(json) / 1024).toFixed(1)} KB, sprite ${(sprite.length / 1024).toFixed(0)} KB`);

  // spec §11 效能預算：正式產物（真實 sprite index，不是測試用的替身資料）
  // 必須量 CLI 實際寫出的 tree.json 與 sprite.webp，測試套件裡的 spriteIndex 是 202 筆全同值
  // [0,0,48,52] 的替身，壓縮率會偏樂觀，量不出真正的邊際。
  //
  // 兩項預算都印出「用了多少 / 預算多少 / 還剩多少」而非只在超標時才報錯：實測值離門檻只有
  // 個位數 KB 的餘裕（tree.json 約 2–3 KB、sprite 約 300 KB），遊戲改版加一整個新分支就可能
  // 一口氣吃掉大半餘裕，提前印出來才有機會在真的撞線前注意到，而不是等紅燈才發現。
  const GZIP_BUDGET_BYTES = 20 * 1024;
  const SPRITE_BUDGET_BYTES = 400 * 1024;
  const gzipBytes = gzipSync(Buffer.from(json)).length;
  const gzipMarginBytes = GZIP_BUDGET_BYTES - gzipBytes;
  const spriteMarginBytes = SPRITE_BUDGET_BYTES - sprite.length;
  console.log(
    `tree.json gzip ${(gzipBytes / 1024).toFixed(1)} KB / ${(GZIP_BUDGET_BYTES / 1024).toFixed(0)} KB，餘裕 ${(gzipMarginBytes / 1024).toFixed(1)} KB`
  );
  console.log(
    `sprite.webp ${(sprite.length / 1024).toFixed(1)} KB / ${(SPRITE_BUDGET_BYTES / 1024).toFixed(0)} KB，餘裕 ${(spriteMarginBytes / 1024).toFixed(1)} KB`
  );
  let budgetExceeded = false;
  if (gzipBytes > GZIP_BUDGET_BYTES) {
    console.error(
      `❌ tree.json gzip 後 ${(gzipBytes / 1024).toFixed(1)} KB 超過效能預算 ${(GZIP_BUDGET_BYTES / 1024).toFixed(0)} KB`
    );
    budgetExceeded = true;
  }
  if (sprite.length > SPRITE_BUDGET_BYTES) {
    console.error(
      `❌ sprite.webp ${(sprite.length / 1024).toFixed(1)} KB 超過效能預算 ${(SPRITE_BUDGET_BYTES / 1024).toFixed(0)} KB`
    );
    budgetExceeded = true;
  }
  if (budgetExceeded) process.exit(1);
}
