import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { COMPARE_PAGES } from '../../tools/lib/compare-pages';

/** `src/pages` 下的 .astro 檔 → 它的路由（`[id]` 換成任意一段）。 */
function routeOf(file: string): RegExp {
  const path = ('/' + file.replace(/\.astro$/, '')).replace(/\/index$/, '') || '/';
  return new RegExp(`^${path.replace(/\[[^\]]+\]/g, '[^/]+')}$`);
}

describe('COMPARE_PAGES', () => {
  it('每個被頁面 import 的樣式檔，至少有一個消費頁在 compare 的清單裡', () => {
    const pages = COMPARE_PAGES;
    const consumers = new Map<string, string[]>();
    for (const f of readdirSync('src/pages', { recursive: true }) as string[]) {
      if (!f.endsWith('.astro')) continue;
      const src = readFileSync(`src/pages/${f}`, 'utf8');
      for (const m of src.matchAll(/import ['"](?:\.\.\/)+styles\/([\w-]+\.css)['"]/g)) {
        consumers.set(m[1]!, [...(consumers.get(m[1]!) ?? []), f]);
      }
    }
    expect(consumers.size, '前提：掃得到頁面層的 CSS import').toBeGreaterThan(0);
    for (const [css, files] of consumers) {
      expect(
        files.some(f => pages.some(p => routeOf(f).test(p))),
        `${css} 的消費頁（${files.join('、')}）都不在 COMPARE_PAGES，改它時 compare 會回報 0 差異`,
      ).toBe(true);
    }
  });
});
