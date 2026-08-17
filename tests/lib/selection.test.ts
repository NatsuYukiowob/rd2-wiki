import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { computeSelection } from '../../src/lib/selection';
import type { TreeData } from '../../src/lib/types';

const data: TreeData = JSON.parse(readFileSync('src/generated/tree.json', 'utf8'));

describe('computeSelection', () => {
  it('根節點的前置鏈只有自己', () => {
    expect([...computeSelection('1001', data).chain]).toEqual(['1001']);
  });
  it('多重前置節點的前置鏈包含兩條路徑的聯集', () => {
    const chain = computeSelection('1002', data).chain;
    expect(chain.size).toBeGreaterThan(2);
    expect(chain.has('1002')).toBe(true);
  });
  it('成本合計等於前置鏈上各節點成本之和（去重）', () => {
    const sel = computeSelection('1002', data);
    const byId = new Map(data.nodes.map(n => [n.id, n]));
    const manual = [...sel.chain]
      .map(id => byId.get(id)!)
      .filter(n => n.unlockVia === 'cost')
      .reduce((acc, n) => ({ core: acc.core + n.unlockCost.core, gold: acc.gold + n.unlockCost.gold }), { core: 0, gold: 0 });
    expect(sel.cost).toEqual(manual);
  });
  it('任務／預設解鎖的節點被排除並列入 skipped', () => {
    const sel = computeSelection('4008', data);
    expect(sel.skipped).toContain('4008');
  });
});
