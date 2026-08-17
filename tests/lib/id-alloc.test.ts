import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { prefixesFor, allocateId } from '../../src/lib/id-alloc';

const ids = [...readFileSync('data/dice-tree.svg', 'utf8').matchAll(/data-id="(\d{4})"/g)].map(m => m[1]!);

describe('id-alloc', () => {
  it('字首對應：骰子 0、被動與支援 1、符文 2/3/4', () => {
    expect(prefixesFor('nature', 'dice')).toEqual(['10']);
    expect(prefixesFor('chaos', 'passive')).toEqual(['51']);
    expect(prefixesFor('chaos', 'support')).toEqual(['51']);
    expect(prefixesFor('magic', 'rune')).toEqual(['32', '33', '34']);
  });

  it('配出的 id 未被使用且符合 validate 規則 2 的編碼規律', () => {
    const next = allocateId(ids, '10');
    expect(ids).not.toContain(next);
    expect(next).toMatch(/^[1-5][0-4]\d\d$/);
    expect(next.startsWith('10')).toBe(true);
  });

  it('連續配號不重複', () => {
    const used = new Set(ids);
    const a = allocateId(used, '32'); used.add(a);
    const b = allocateId(used, '32');
    expect(a).not.toBe(b);
  });

  it('字首用滿時拋錯而不是回傳無效 id', () => {
    const full = Array.from({ length: 99 }, (_, i) => `10${String(i + 1).padStart(2, '0')}`);
    expect(() => allocateId(full, '10')).toThrow(/字首 10 已無可用編號/);
  });
});
