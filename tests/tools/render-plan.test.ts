import { describe, it, expect } from 'vitest';
import { KEEP_ICON_IDS, mustReplace, planRender } from '../../tools/lib/render-plan';

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

describe('mustReplace', () => {
  it('比對不到就丟錯並指名節點與部位（String.replace 原樣回傳不會報錯）', () => {
    expect(() => mustReplace('<rect x="0"', /<circle r="[\d.]+"/, '<circle r="9"', '形狀元素', '1001'))
      .toThrow(/節點 1001 的形狀元素沒有被改到/);
  });

  it('替換結果跟原文相同也算成功（重跑時值本來就一樣）', () => {
    expect(mustReplace('<circle r="9"', /<circle r="[\d.]+"/, '<circle r="9"', '形狀元素', '1001')).toBe('<circle r="9"');
  });

  it('替換字串用了 $1 但正則沒有捕捉群組 → 丟錯，不把比對位置寫進正本', () => {
    expect(() => mustReplace('<circle r="9"', /<circle r="[\d.]+"/, '<circle $1r="8"', '形狀元素', '1001'))
      .toThrow(/沒有捕捉群組/);
  });

  it('$1 換成第一個捕捉群組', () => {
    expect(mustReplace('<a id="1">', /(<a )id="1"/, '$1id="2"', 'w', 'x')).toBe('<a id="2">');
  });
});
