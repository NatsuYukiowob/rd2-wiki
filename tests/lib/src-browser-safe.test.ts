import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

// src/lib/ 底下的程式碼會被 Astro 打包進瀏覽器（線上編輯器 /edit 會用它們），
// 因此不得依賴任何 Node 專屬模組。這條掃描是瀏覽器相容性的守門員——
// 它會隨著 Task 4（build-tree）、Task 5（validate-rules、png）把更多程式搬進 src/lib/
// 而自動擴大保護範圍，不必每個任務各寫一次自己的 not.toContain 斷言。
describe('src/lib 必須是瀏覽器安全的', () => {
  it('沒有任何檔案 import node: 內建模組或 linkedom', () => {
    const offenders: string[] = [];
    for (const f of readdirSync('src/lib').filter(n => n.endsWith('.ts'))) {
      const src = readFileSync(`src/lib/${f}`, 'utf8');
      // 只看 import/export 的來源字串，註解裡提到 linkedom 是允許的（會說明為什麼要注入）
      for (const m of src.matchAll(/^\s*(?:import|export)[^'"]*from\s*['"]([^'"]+)['"]/gm)) {
        const spec = m[1]!;
        if (spec.startsWith('node:') || spec === 'linkedom') offenders.push(`src/lib/${f} → ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
