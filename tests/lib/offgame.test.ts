import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  HIDDEN_TARGETS, OFFGAME_TARGETS, effectValue, effectValue2, namedEffects, plainDescription, scopeApplies,
  type OffgameFile,
} from '../../src/lib/offgame';

const file = JSON.parse(readFileSync('data/offgame-effects.json', 'utf8')) as OffgameFile;
const nodes = JSON.parse(readFileSync('data/nodes.json', 'utf8')) as Record<string, { name: string; description: string }>;
const e = (id: string) => {
  const x = file.effects[id];
  if (!x) throw new Error(`語意表沒有 ${id}`);
  return x;
};

describe('effectValue／effectValue2', () => {
  it('value + rankAdd × (等級 − 1)，收掉浮點雜訊', () => {
    expect(effectValue(e('1201'), 1)).toBe(20);
    expect(effectValue(e('1201'), 50)).toBe(216);
    expect(effectValue(e('1102'), 50)).toBe(68.8); // 10 + 1.2 × 49，不收的話是 68.80000000000001
    expect(effectValue(e('1204'), 50)).toBe(-10.3); // 負成長照算
  });
  it('第二個值；沒有 value2 的節點回 0', () => {
    expect(effectValue2(e('1202'), 50)).toBe(14.8);
    expect(effectValue2(e('1201'), 50)).toBe(0);
  });
});

describe('scopeApplies', () => {
  it('all／faction／dice 三種', () => {
    expect(scopeApplies('all', '1001', 'nature')).toBe(true);
    expect(scopeApplies('faction:nature', '1001', 'nature')).toBe(true);
    expect(scopeApplies('faction:magic', '1001', 'nature')).toBe(false);
    expect(scopeApplies('dice:1001', '1001', 'nature')).toBe(true);
    expect(scopeApplies('dice:1005', '1001', 'nature')).toBe(false);
    expect(scopeApplies('nonsense', '1001', 'nature')).toBe(false);
  });
});

describe('plainDescription', () => {
  it('去掉 # 標記；接在「，」後面的換行直接接上，其餘換行換成空白', () => {
    expect(plainDescription('基本攻擊擊中時，賦予#燙傷\n7骰點為2倍的#燙傷傷害'))
      .toBe('基本攻擊擊中時，賦予燙傷 7骰點為2倍的燙傷傷害');
    expect(plainDescription('每5秒根據冰骰子總骰點等比產生暴風雪，\n對#冰凍怪物造成基本攻擊力相當傷害'))
      .toBe('每5秒根據冰骰子總骰點等比產生暴風雪，對冰凍怪物造成基本攻擊力相當傷害');
  });
});

describe('namedEffects（建置期給 /board 的精簡版）', () => {
  const named = namedEffects(file, nodes);
  it('不顯示的 target 整筆拿掉；盤面增益用的符文（board）留著給 board-buffs.ts', () => {
    expect(HIDDEN_TARGETS).toEqual(['conditional', 'none']);
    expect(named['1207']).toBeUndefined(); // conditional：對冰凍
    expect(named['1112']).toBeUndefined(); // none：起始 SP
    expect(named['1306']).toMatchObject({ target: 'board', scope: 'dice:1006', name: '光增益範圍' });
    for (const x of Object.values(named)) expect(HIDDEN_TARGETS).not.toContain(x.target);
  });
  it('補上節點名；等級不會變的機制符文補上去掉標記的描述，有 template 的不補', () => {
    expect(named['1201']!.name).toBe('子彈傷害%增加');
    expect(named['1401']!.text).toBe('基本攻擊擊中時，賦予燙傷 7骰點為2倍的燙傷傷害');
    expect(named['1202']!.text).toBeUndefined();
    expect(named['1202']!.template).toBe('{V2}% 機率額外產生 {V} 個尖刺');
  });
  it('kind 不送進頁面：執行期沒人讀它（追溯用，留在 JSON、規則 28 守）；reason 只在被濾掉的那幾種上', () => {
    for (const [id, x] of Object.entries(named)) {
      expect(x, id).not.toHaveProperty('kind');
      expect(x, id).not.toHaveProperty('reason');
    }
  });
});

it('語意表每一筆的 target 都在詞彙內（完整守門是規則 28，這裡只擋型別層面的漂移）', () => {
  for (const x of Object.values(file.effects)) expect(OFFGAME_TARGETS).toContain(x.target);
});
