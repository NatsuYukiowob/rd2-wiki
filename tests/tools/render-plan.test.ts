import { describe, it, expect } from 'vitest';
import { KEEP_ICON_IDS, planRender } from '../../tools/lib/render-plan';

describe('planRender', () => {
  it('原圖少了保留清單裡的節點照樣放行，只渲染其餘的', () => {
    expect(planRender(['1001', '1002'], ['1001', '1002', '1501', '1601', '2503', '2603'])).toEqual(['1001', '1002']);
  });

  it('原圖有保留清單裡的節點也不渲染（手工圖不被蓋掉）', () => {
    expect(planRender(['1001', '1501'], ['1001', '1501'])).toEqual(['1001']);
  });

  it('原圖少了不在保留清單的節點 → 丟例外並列出 id', () => {
    expect(() => planRender(['1001'], ['1001', '1002'])).toThrow(/原圖沒有正本的節點 1002/);
  });

  it('原圖多出正本沒有的節點 → 丟例外並列出 id', () => {
    expect(() => planRender(['1001', '9999'], ['1001'])).toThrow(/原圖多出正本沒有的節點 9999/);
  });

  it('保留清單是那四顆超越節點', () => {
    expect([...KEEP_ICON_IDS].sort()).toEqual(['1501', '1601', '2503', '2603']);
  });
});
