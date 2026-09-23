import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildSimContext, initialSimState, pathTo, unlockMany, maxSelectableLevel } from '../../src/lib/sim';
import { simPaintFor } from '../../src/lib/sim-paint';
import type { PassiveUpgradeCost, TreeData } from '../../src/lib/types';
import { readTree } from '../helpers/read-tree';

const data = readTree() as TreeData;
const tables: PassiveUpgradeCost = JSON.parse(readFileSync('data/passive-upgrade-cost.json', 'utf8'));
const ctx = buildSimContext(data, tables);

describe('simPaintFor', () => {
  it('畫面與匯出共用：active ⊆ linked、只帶已取得的等級、selected 原樣傳遞', () => {
    let s = initialSimState(ctx);
    s = unlockMany(s, ctx, pathTo('1301', s, ctx));
    const p = simPaintFor(s, ctx, data, '1301');
    expect(p.selected).toBe('1301');
    expect(p.active.size).toBeGreaterThan(0);
    for (const k of p.active) expect(p.linked.has(k)).toBe(true);
    expect([...p.levels.keys()].every(id => p.owned.has(id))).toBe(true);
    expect(p.maxLevels.size).toBe(data.nodes.length);
    expect(p.maxLevels.get('1201')).toBe(maxSelectableLevel(ctx.byId.get('1201')!, ctx));
  });

  it('ready 邊的起點都已取得、終點都在 available 裡', () => {
    const s = initialSimState(ctx);
    const p = simPaintFor(s, ctx, data, null);
    expect(p.ready.size).toBeGreaterThan(0);
    for (const k of p.ready) {
      const [from, to] = k.split('>');
      expect(p.owned.has(from!)).toBe(true);
      expect(p.available.has(to!)).toBe(true);
    }
  });
});
