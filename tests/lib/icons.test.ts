import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { ICONS } from '../../src/lib/icons';

/**
 * 圖示是裝飾：旁邊一定有文字（連結名、按鈕名），所以每一個都必須對輔助技術隱形，
 * 顏色一律吃 currentColor——高對比模式下系統會改寫文字色，寫死色碼的圖示會消失或刺眼。
 */
describe('ICONS', () => {
  const entries = Object.entries(ICONS);

  it('至少有 brand（正向控制：清單空了底下的迴圈一次都不跑）', () => {
    expect(Object.keys(ICONS)).toContain('brand');
  });

  for (const [name, markup] of entries) {
    it(`${name}：單一 <svg class="icon">、aria-hidden、不可聚焦`, () => {
      const { document } = parseHTML(`<div>${markup}</div>`);
      const root = document.querySelector('div')!;
      expect(root.children.length).toBe(1);
      const svg = root.firstElementChild!;
      expect(svg.tagName.toLowerCase()).toBe('svg');
      expect(svg.getAttribute('class')).toBe('icon');
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.getAttribute('focusable')).toBe('false');
      expect(svg.getAttribute('viewBox')).toMatch(/^0 0 \d+ \d+$/);
    });

    it(`${name}：fill／stroke 只准 currentColor 或 none`, () => {
      const colors = [...markup.matchAll(/(?:fill|stroke)="([^"]+)"/g)].map(m => m[1]);
      expect(colors.length, `${name} 一個 fill／stroke 都沒有，畫不出東西`).toBeGreaterThan(0);
      expect(colors.filter(c => c !== 'currentColor' && c !== 'none')).toEqual([]);
    });
  }
});
