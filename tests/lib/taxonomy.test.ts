import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
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
  it('顯示尺寸依類型：跟資料正本畫的圖示框一致', () => {
    // 程式碼裡的尺寸表與正本 <image> 的 width/height 是同一件事的兩份記載，兩邊必須相等
    // （站台用前者算版面、正本用後者畫圖，不一致時正本看起來跟站台會是兩個樣子）。
    // 這裡拿正本當對照而不是寫死數字：改版面時兩份會一起變，只有「改了一邊忘了另一邊」才會紅。
    // 比對**每一個**節點，不是每種類型抽第一個：只看第一個的話，某一個節點的圖示框被改成
    // 別的尺寸（正本畫成 40x44、站台照樣用 26x29）能一路綠燈過關，而 validate 沒有任何規則
    // 在查圖示框尺寸，等於兩邊都沒人守。全掃一遍才真的把「表 ↔ 正本」釘在一起。
    const svg = readFileSync('data/dice-tree.svg', 'utf8');
    const pairs = { 骰子: 'dice', 骰子符文: 'rune', 玩家被動: 'passive', 支援: 'support' } as const;
    const blocks = [...svg.matchAll(/<g class="node"[\s\S]*?<\/g>/g)].map(m => m[0]);
    expect(blocks).toHaveLength(239);
    const mismatches: string[] = [];
    for (const block of blocks) {
      const id = /data-id="(\d+)"/.exec(block)![1]!;
      const zh = /data-type="([^"]+)"/.exec(block)![1]! as keyof typeof pairs;
      const m = /<image[^>]*width="([\d.]+)" height="([\d.]+)"/.exec(block)!;
      const [w, h] = sizeOfType(pairs[zh]);
      if (Number(m[1]) !== w || Number(m[2]) !== h) {
        mismatches.push(`${id}(${zh}) 正本 ${m[1]}x${m[2]} vs 尺寸表 ${w}x${h}`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});
