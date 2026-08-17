import { describe, it, expect } from 'vitest';
import { extractKeywords } from '../../src/lib/keywords';

const WL = ['巨型尖刺', '尖刺', '冰凍', '首領怪物'];

describe('extractKeywords', () => {
  it('最長優先：巨型尖刺 不會被切成 尖刺', () => {
    expect(extractKeywords('召喚#巨型尖刺', WL)).toEqual(['巨型尖刺']);
  });
  it('關鍵字後面黏著整句時只取白名單的詞', () => {
    expect(extractKeywords('#冰凍狀態怪物造成的傷害增加20%', WL)).toEqual(['冰凍']);
  });
  it('一段描述有多個標記', () => {
    expect(extractKeywords('對#首領怪物造成傷害，並賦予#冰凍', WL)).toEqual(['首領怪物', '冰凍']);
  });
  it('沒有標記時回傳空陣列', () => {
    expect(extractKeywords('進行快速攻擊', WL)).toEqual([]);
  });
  it('標記比不到白名單時拋錯', () => {
    expect(() => extractKeywords('賦予#不存在的詞', WL)).toThrow(/白名單/);
  });
});
