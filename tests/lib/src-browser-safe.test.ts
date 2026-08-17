import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

/**
 * 抽出一份 TS 原始碼裡「所有模組指定字串」。
 *
 * 刻意用四條各自針對一種語法的正則，而不是一條想涵蓋全部的萬用正則——只認 `from '...'`
 * 的寫法會漏掉三種真實可能出現的形式，其中 `await import('node:...')`（程式碼分割時很自然
 * 會寫出來的延遲載入）漏掉的代價最大：守門員會靜默失效。
 */
function moduleSpecifiers(src: string): string[] {
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/g,              // import … from '…' / export … from '…'（含多行）
    /^\s*import\s+['"]([^'"]+)['"]/gm,          // 純副作用 import '…'
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,   // 動態 import('…')、await import('…')
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,  // require('…')、import x = require('…')
  ];
  return patterns.flatMap(re => [...src.matchAll(re)].map(m => m[1]!));
}

// src/lib/ 底下的程式碼會被 Astro 打包進瀏覽器（線上編輯器 /edit 會用它們），
// 因此不得依賴任何 Node 專屬模組。這條掃描是瀏覽器相容性的守門員——
// 它會隨著 Task 4（build-tree）、Task 5（validate-rules、png）把更多程式搬進 src/lib/
// 而自動擴大保護範圍，不必每個任務各寫一次自己的 not.toContain 斷言。
describe('src/lib 必須是瀏覽器安全的', () => {
  it('沒有任何檔案 import node: 內建模組或 linkedom', () => {
    const offenders: string[] = [];
    for (const f of readdirSync('src/lib').filter(n => n.endsWith('.ts'))) {
      const src = readFileSync(`src/lib/${f}`, 'utf8');
      // moduleSpecifiers 只看實際的模組指定字串（import/export/require 的目標），
      // 所以註解裡用文字提到 linkedom 是允許的（例如 src/lib/dom.ts 的註解本來就要
      // 說明「Node 端用 linkedom、瀏覽器端用 DOMParser」，不能被自己的守門員擋下來）。
      for (const spec of moduleSpecifiers(src)) {
        if (spec.startsWith('node:') || spec === 'linkedom') offenders.push(`src/lib/${f} → ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('掃描本身抓得到四種載入語法（守門員的鑑別力）', () => {
    // 一個抓不到東西的掃描等於沒有掃描：這支測試直接驗證 moduleSpecifiers 對四種
    // 語法都有反應，不只是驗證「目前 src/lib/ 是乾淨的」（那個條件在掃描壞掉時也會通過）。
    const sample = [
      `import { a } from 'node:fs';`,
      `import 'node:path';`,
      `const b = await import('node:crypto');`,
      `import c = require('linkedom');`,
      `import { ok } from './types.js';`,
    ].join('\n');
    expect(moduleSpecifiers(sample).filter(s => s.startsWith('node:') || s === 'linkedom'))
      .toEqual(['node:fs', 'node:path', 'node:crypto', 'linkedom']);
  });
});
