import { describe, it, expect } from 'vitest';
import { parseHTML } from 'linkedom';
import { readTheme, DEFAULT_THEME } from '../../../src/lib/canvas/theme';

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
});
