import { describe, expect, it } from 'vitest';
import { iconHashOf } from '../../src/lib/dice-icon';

describe('iconHashOf', () => {
  it('查得到就回雜湊', () => {
    expect(iconHashOf({ '1001': 'abc' }, '1001', 'board')).toBe('abc');
  });

  // 2026-09-24 review gap-board-data-2：/board 原本直接 `boardIcons[d.id]`，少一筆時印出
  // `undefined.webp` 而 build 回 0。
  it.each(['board', 'dice3'] as const)('少一筆就 throw，訊息帶節點 id 與 --%s 補圖指令', flag => {
    expect(() => iconHashOf({ '1001': 'abc' }, '1002', flag))
      .toThrow(`npm run add-icon -- --${flag} 1002 <png>`);
  });
});
