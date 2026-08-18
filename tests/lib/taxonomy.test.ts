import { describe, it, expect } from 'vitest';
import { branchOfId, elementOfStroke, typeOfZh, sizeOfType } from '../../src/lib/taxonomy';

describe('taxonomy', () => {
  it('分支由 id 首碼決定', () => {
    expect(branchOfId('1001')).toBe('nature');
    expect(branchOfId('5114')).toBe('chaos');
  });
  it('支援節點的分支跟著 id 首碼，不是 support', () => {
    expect(branchOfId('1114')).toBe('nature');
  });
  it('element 由 stroke 決定，支援為 support', () => {
    expect(elementOfStroke('#ef625e')).toBe('nature');
    expect(elementOfStroke('#f3c5ff')).toBe('support');
  });
  it('未知 stroke 拋錯', () => {
    expect(() => elementOfStroke('#123456')).toThrow();
  });
  it('中文類型對照', () => {
    expect(typeOfZh('骰子符文')).toBe('rune');
    expect(typeOfZh('玩家被動')).toBe('passive');
  });
  it('顯示尺寸依類型', () => {
    expect(sizeOfType('dice')).toEqual([48, 52]);
    expect(sizeOfType('passive')).toEqual([20, 20]);
  });
});
