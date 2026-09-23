import { describe, it, expect } from 'vitest';
import { parseHTML } from 'linkedom';
import { readTheme, DEFAULT_THEME } from '../../../src/lib/canvas/theme';
import { readFileSync } from 'node:fs';

/** 讀 tokens.css 縮排兩格的自訂屬性（跟 tests/styles/tokens.test.ts 同一套規則，註解先拿掉）。 */
function tokenValues(): Map<string, string> {
  const src = readFileSync('src/styles/tokens.css', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
  return new Map([...src.matchAll(/^\s{2}(--[a-z0-9-]+):\s*([^;]+);/gm)].map(m => [m[1]!, m[2]!.trim()]));
}

describe('readTheme', () => {
  it('沒有 root（測試環境）退回預設值，而且預設值跟 tokens.css 的正本一致', () => {
    expect(readTheme(null)).toEqual(DEFAULT_THEME);
    expect(DEFAULT_THEME.gold).toBe('#ffd66f');
    expect(DEFAULT_THEME.edge).toBe('#a89ad3');
  });

  it('linkedom 的 getComputedStyle 給不出 token 時也退回預設值（不丟例外）', () => {
    const { document } = parseHTML('<html><body></body></html>');
    expect(() => readTheme(document.documentElement)).not.toThrow();
    // linkedom 沒有真的樣式引擎，getPropertyValue() 一律回空字串——這裡驗的是「回到預設值」
    // 而不是「拿到某個隨機值」，兩者都不丟例外但只有前者是正確行為。
    expect(readTheme(document.documentElement)).toEqual(DEFAULT_THEME);
  });

  it('DEFAULT_THEME 的每個色值都跟 tokens.css 一字不差（預設值只在沒有樣式引擎時用到，漂了沒人會發現）', () => {
    const t = tokenValues();
    const pairs: [keyof typeof DEFAULT_THEME, string][] = [
      ['bg', '--bg'], ['fg', '--fg'], ['edge', '--edge'], ['gold', '--gold'],
      ['surface1', '--surface-1'], ['borderStrong', '--border-strong'],
      ['font', '--font'], ['fontNum', '--font-num'],
    ];
    for (const [key, token] of pairs) {
      expect(t.has(token), `tokens.css 沒有 ${token}`).toBe(true);
      expect(DEFAULT_THEME[key], `DEFAULT_THEME.${key} ≠ tokens.css 的 ${token}`).toBe(t.get(token));
    }
  });
});
