import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

/**
 * 找出一份 TS 原始碼裡「被寫成引號字面量的禁用模組名」。
 *
 * 刻意**不解析 import 語法**。試過用一組各自針對一種語法的正則（`from '…'`、純副作用
 * `import '…'`、動態 `import('…')`、`require('…')`），結果是每多一種寫法就多一個破口：
 * 其中不帶錨點的 `\bfrom\s*['"]…` 會被本 repo 既有的 `line.setAttribute('data-from', from)`
 * （`src/lib/render.ts:157`）誤命中，貪婪吃掉後面整段、連同真正的 `import fs from 'node:fs'`
 * 一起吞掉——製造出正是這條守門員要防的「靜默假陰性」。
 *
 * 改用的性質是：**任何載入語法都必須把模組名寫成引號包住的字面量**。所以只要掃所有字面量、
 * 比對模組名即可，不管未來出現哪一種寫法都漏不掉。代價是「註解裡把模組名加引號寫出來」
 * 會被誤報——那是 fail-closed（測試大聲失敗、改個措辭就好），方向正確；
 * 前一版的破口是 fail-open（靜默放行），方向錯誤。
 *
 * 唯一漏得掉的是動態拼接（`import('node' + ':fs')`），那是病態寫法，不在防守範圍。
 *
 * 正則用**反向參照** `\1` 要求開頭與結尾是同一種引號，這一點不能省：若允許不同種引號配對，
 * 同一行裡一個含撇號的字串（`const s = "don't";`）會讓開頭的 `"` 跟撇號錯誤配對，
 * 吃掉後面整段、連同真正的 `'node:fs'` 一起吞掉——又是一個 fail-open 的靜默假陰性。
 * 排除 `\n` 則讓註解裡的單引號（`// Bob's note`）因同行找不到配對而不會跨行吞掉下一行的 import。
 */
function forbiddenModuleLiterals(src: string): string[] {
  const hits: string[] = [];
  for (const m of src.matchAll(/(['"`])((?:(?!\1)[^\n])+)\1/g)) {
    const spec = m[2]!;      // ← 注意捕捉群組編號從 1 變 2（第 1 組現在是引號字元本身）
    if (spec.startsWith('node:') || spec === 'linkedom') hits.push(spec);
  }
  return hits;
}

// src/lib/ 底下的程式碼會被 Astro 打包進瀏覽器（線上編輯器 /edit 會用它們），
// 因此不得依賴任何 Node 專屬模組。這條掃描是瀏覽器相容性的守門員——
// 它會隨著 Task 4（build-tree）、Task 5（validate-rules、png）把更多程式搬進 src/lib/
// 而自動擴大保護範圍，不必每個任務各寫一次自己的 not.toContain 斷言。
describe('src/lib 必須是瀏覽器安全的', () => {
  it('沒有任何檔案以任何語法載入 node: 內建模組或 linkedom', () => {
    const offenders: string[] = [];
    for (const f of readdirSync('src/lib').filter(n => n.endsWith('.ts'))) {
      for (const spec of forbiddenModuleLiterals(readFileSync(`src/lib/${f}`, 'utf8'))) {
        offenders.push(`src/lib/${f} → ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('五種載入語法都抓得到，且不誤傷散文註解（守門員的鑑別力）', () => {
    const sample = [
      `import { a } from 'node:fs';`,
      `import 'node:path';`,
      `const b = await import('node:crypto');`,
      `import c = require('linkedom');`,
      'const d = await import(`node:os`);',            // 樣板字面量
      `import { ok } from './types.js';`,               // 合法相對匯入，不該被抓
      `// Node 端用 linkedom、瀏覽器端用 DOMParser`,     // 散文提到但沒加引號，不該被抓
      `line.setAttribute('data-from', from);`,          // render.ts:157 的真實寫法，不該被抓
    ].join('\n');
    expect(forbiddenModuleLiterals(sample))
      .toEqual(['node:fs', 'node:path', 'node:crypto', 'linkedom', 'node:os']);
  });

  it('前一版正則的假陰性不會再發生（回歸測試）', () => {
    // 舊實作用不帶錨點的 /\bfrom\s*['"]…/ 掃描，會被 'data-from' 的結尾 from 誤命中、
    // 貪婪吃掉後面整段，導致下一行真正的 node:fs import 被整個吞掉、靜默放行。
    const sample = `line.setAttribute('data-from', from);\nimport fs from 'node:fs';`;
    expect(forbiddenModuleLiterals(sample)).toEqual(['node:fs']);
  });

  it('同一行的不成對引號不會吞掉後面的真 import（回歸測試）', () => {
    // 沒有反向參照的版本會讓 "don't" 的開頭雙引號跟撇號錯誤配對，
    // 吃掉 `t"; import fs from ` 這一整段，使後面真正的 'node:fs' 永遠不會被單獨捕捉到。
    const sample = `const s = "don't"; import fs from 'node:fs';`;
    expect(forbiddenModuleLiterals(sample)).toEqual(['node:fs']);
  });

  it('同一行兩個成對引號都抓得到', () => {
    const sample = `import a from 'node:fs'; import b from "node:path";`;
    expect(forbiddenModuleLiterals(sample)).toEqual(['node:fs', 'node:path']);
  });
});
