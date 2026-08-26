import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { msFromCss } from '../../src/lib/css-ms.js';

describe('msFromCss', () => {
  it('ms 與 s 兩種單位都認得', () => {
    expect(msFromCss('440ms', 1)).toBe(440);
    // ⚠️ 這一條是整支檔案存在的理由：Astro 的 CSS 壓縮把 `440ms` 改寫成 `.44s`，
    // 裸的 parseFloat 會拿到 0.44。2026-08-26 實際咬到進場動畫（見 src/lib/css-ms.ts）。
    expect(msFromCss('.44s', 1)).toBe(440);
    expect(msFromCss('0.28s', 1)).toBe(280);
    // ⚠️ `440ms` 也是 endsWith('s')，先判 ms 才不會變成 440 秒。
    expect(msFromCss('80ms', 1)).toBe(80);
  });

  it('讀不出正數時退回 fallback，不要靜靜地回 NaN 或 0', () => {
    // 無單位的時間值在 CSS 裡是無效的；讀到它代表變數名打錯或值寫錯。
    for (const raw of ['', '440', 'auto', '0ms', '-5s', 'var(--x)']) {
      expect(msFromCss(raw, 7), `${raw} 應該退回 fallback`).toBe(7);
    }
  });
});

/**
 * 「JS 不寫第二份」這條規則要有東西守著。
 *
 * 2026-08-26 之前 `cssMs` 有三份複本（tree-canvas.ts、dice.astro、Base.astro），而**第三份
 * 漏了 `s` 的分支**——三份都在、三份都看起來對，只有壓縮過的產物會露餡。現在實作收在
 * `src/lib/css-ms.ts` 一份，這條擋下一次複製。
 */
describe('時間類 CSS 變數只有一個解析器', () => {
  const walk = (dir: string): string[] =>
    (readdirSync(dir, { recursive: true }) as string[])
      .map(f => `${dir}/${f.replace(/\\/g, '/')}`)
      .filter(f => /\.(ts|astro)$/.test(f));
  const FILES = [...walk('src'), ...walk('tools')]
    .filter(f => !f.endsWith('src/lib/css-ms.ts'));

  it('沒有第二個地方自己 parseFloat 一個時間變數', () => {
    const bad: string[] = [];
    let scanned = 0;
    for (const file of FILES) {
      const src = readFileSync(file, 'utf8');
      scanned++;
      // 抓「parseFloat(… getPropertyValue(…) …)」這個形狀，跨不跨行都算。
      for (const m of src.matchAll(/parseFloat\([^;]{0,200}?getPropertyValue\(\s*'(--[a-z0-9-]+)'/gs)) {
        const name = m[1]!;
        // --nav-h／--chips-h 是長度不是時間，走不走 cssMs 都一樣；只擋時間類。
        if (/^--(t-|slide-ms|p-stagger$)/.test(name)) bad.push(`${file} ${name}`);
      }
    }
    expect(scanned, '一個檔都沒掃到——列舉失效了').toBeGreaterThan(20);
    expect(bad, '這些地方自己解析時間變數，改用 src/lib/css-ms.ts 的 cssMs()').toEqual([]);
  });
});
