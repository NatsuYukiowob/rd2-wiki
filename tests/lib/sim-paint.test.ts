import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildSimContext, initialSimState, pathTo, unlockMany, maxSelectableLevel, setInitialDice,
  isAvailable, edgeIsLinked, edgeWasUsed, ownedIds,
} from '../../src/lib/sim';
import type { SimState } from '../../src/lib/sim';
import { edgeKey } from '../../src/lib/canvas/state';
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

  /**
   * simPaintFor 只建一份 owned、傳給每一個判斷（2026-09-24 review sim-9）。這條拿「每次都自己重建」
   * 的逐一呼叫版本當對照，三種狀態（空、半套＋等級條件沒滿、全樹點滿）逐集合比對——最佳化不准改掉語意。
   */
  it('跟逐一呼叫（每次重建 owned）的版本逐集合相同', () => {
    const naive = (s: SimState) => {
      const owned = ownedIds(s, ctx);
      const available = new Set(data.nodes.filter(n => !owned.has(n.id) && isAvailable(n.id, s, ctx)).map(n => n.id));
      const linked = new Set<string>(), active = new Set<string>(), ready = new Set<string>();
      for (const [from, to] of data.edges) {
        if (edgeIsLinked(from, to, s, ctx)) linked.add(edgeKey(from, to));
        if (edgeWasUsed(from, to, s, ctx)) active.add(edgeKey(from, to));
        if (owned.has(from) && !owned.has(to) && isAvailable(to, s, ctx)) ready.add(edgeKey(from, to));
      }
      return { owned, available, linked, active, ready };
    };
    const empty = initialSimState(ctx);
    // 1201 已取得但停在 Lv.1、1301／1401 也在手上：1501 的前置齊了、等級條件沒滿（prereqRanks 那條路）。
    let partial = unlockMany(empty, ctx, pathTo('1301', empty, ctx))!;
    partial = unlockMany(partial, ctx, pathTo('1401', partial, ctx))!;
    let full = empty;
    for (const id of ctx.optional) full = setInitialDice(full, ctx, id, true)!;
    for (const n of data.nodes) {
      const plan = pathTo(n.id, full, ctx);
      if (plan.blocked.length === 0 && (plan.need.length > 0 || plan.levels.length > 0)) full = unlockMany(full, ctx, plan) ?? full;
    }
    expect(ownedIds(full, ctx).size).toBe(data.nodes.length);
    expect(isAvailable('1501', partial, ctx)).toBe(false);
    for (const s of [empty, partial, full]) {
      const p = simPaintFor(s, ctx, data, null);
      const want = naive(s);
      for (const k of ['owned', 'available', 'linked', 'active', 'ready'] as const) {
        expect([...p[k]].sort(), k).toEqual([...want[k]].sort());
      }
    }
  });
});
