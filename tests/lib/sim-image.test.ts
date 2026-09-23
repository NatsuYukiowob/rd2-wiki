import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildSimContext, initialSimState, pathTo, unlockMany, setInitialDice, setNodeLevel, maxSelectableLevel, simTotals } from '../../src/lib/sim';
import { simPaintFor } from '../../src/lib/sim-paint';
import {
  COMPACT, FULL, IOS_MAX_CANVAS_AREA, compactLayout, compactSections, exportPaintState,
  fitText, fixedView, fullImageSize, headerTotalLine,
} from '../../src/lib/sim-image';
import type { PassiveUpgradeCost, TreeData } from '../../src/lib/types';
import { readTree } from '../helpers/read-tree';

const data = readTree() as TreeData;
const tables: PassiveUpgradeCost = JSON.parse(readFileSync('data/passive-upgrade-cost.json', 'utf8'));
const ctx = buildSimContext(data, tables);
const all = () => {
  let s = initialSimState(ctx);
  for (const id of ctx.optional) s = setInitialDice(s, ctx, id, true) ?? s;
  for (const id of ctx.byId.keys()) { const p = pathTo(id, s, ctx); if (p.need.length) s = unlockMany(s, ctx, p); }
  return s;
};

describe('compactSections', () => {
  it('空規劃回空陣列', () => {
    expect(compactSections(initialSimState(ctx), ctx)).toEqual([]);
  });

  it('只勾初始骰子也算：那一顆出現在它的系', () => {
    const id = [...ctx.optional][0]!;
    const s = setInitialDice(initialSimState(ctx), ctx, id, true)!;
    const secs = compactSections(s, ctx);
    expect(secs.flatMap(x => x.entries.map(e => e.id))).toEqual([id]);
  });

  it('列入範圍＝unlocked ∪ initial，不含起始送的節點；分子分母口徑一致', () => {
    const s = all();
    const secs = compactSections(s, ctx);
    const ids = new Set(secs.flatMap(x => x.entries.map(e => e.id)));
    expect(ids).toEqual(new Set([...s.unlocked, ...s.initial]));
    for (const id of ctx.free) expect(ids.has(id)).toBe(false);
    for (const sec of secs) {
      const pool = [...ctx.byId.values()].filter(n => n.branch === sec.branch && !ctx.free.has(n.id)).length;
      expect(sec.title).toMatch(new RegExp(` ${sec.entries.length}/${pool}$`));
    }
  });

  it('可升級的節點帶 Lv.x/max（max 用 maxSelectableLevel），不可升級的是 null；區內 id 升冪', () => {
    let s = initialSimState(ctx);
    s = unlockMany(s, ctx, pathTo('1201', s, ctx));
    s = setNodeLevel(s, ctx, '1201', 7)!;
    const e = compactSections(s, ctx).flatMap(x => x.entries).find(x => x.id === '1201')!;
    expect(e.level).toBe(`Lv.7/${maxSelectableLevel(ctx.byId.get('1201')!, ctx)}`);
    for (const sec of compactSections(all(), ctx)) {
      const ids = sec.entries.map(x => x.id);
      expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
    }
  });
});

describe('headerTotalLine', () => {
  it('空規劃只有核心與金幣', () => {
    expect(headerTotalLine(initialSimState(ctx), ctx)).toBe('總計  核心 0 ／金幣 0');
  });
  it('全樹點滿時帶出超越核心，數字與 simTotals 一致', () => {
    const s = all();
    const t = simTotals(s, ctx).total;
    const line = headerTotalLine(s, ctx);
    expect(line).toContain(`核心 ${t.core.toLocaleString('en-US')}`);
    expect(line).toContain('太陽核心');
    expect(line).toContain('齒輪二階核心');
  });
});

describe('compactLayout', () => {
  it('空規劃：標題列＋一行空白提示', () => {
    const l = compactLayout([]);
    expect(l.sections).toEqual([]);
    expect(l.height).toBe(COMPACT.headerH + COMPACT.emptyH + COMPACT.pad);
  });
  it('格子不超出寬度、彼此不重疊、高度隨顆數成長', () => {
    const secs = compactSections(all(), ctx);
    const l = compactLayout(secs);
    const cells = l.sections.flatMap(s => s.cells);
    expect(cells.length).toBe(secs.reduce((a, s) => a + s.entries.length, 0));
    for (const c of cells) {
      expect(c.x).toBeGreaterThanOrEqual(COMPACT.pad);
      expect(c.x + c.w).toBeLessThanOrEqual(COMPACT.width - COMPACT.pad + 1e-6);
      expect(c.y + c.h).toBeLessThanOrEqual(l.height);
    }
    for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) {
      const a = cells[i]!, b = cells[j]!;
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      expect(overlap).toBe(false);
    }
    const fewer = compactLayout([{ ...secs[0]!, entries: secs[0]!.entries.slice(0, 1) }]);
    expect(l.height).toBeGreaterThan(fewer.height);
  });
});

describe('精簡版格子放得下名稱', () => {
  // 3 欄是 Yuki 2026-09-24 看過全樹點滿的圖後定的：4 欄時大半名稱被截成「…」。
  // 以全形字寬（＝字級）估上界，所以對全站最長的名稱都要放得下，不必靠截斷。
  it('全站最長的名稱以 namePx 全形字寬計也放得進文字區', () => {
    const longest = Math.max(...data.nodes.map(n => [...n.name].length));
    const [cell] = compactLayout([{ branch: 'nature', title: 'x', entries: [{ id: 'x', name: 'x', level: null }] }]).sections[0]!.cells;
    const textW = cell!.w - COMPACT.cellPad * 3 - COMPACT.icon;
    expect(COMPACT.cols).toBe(3);
    expect(textW).toBeGreaterThanOrEqual(longest * COMPACT.namePx);
  });
});

describe('fitText', () => {
  const measure = (s: string) => [...s].length * 10;
  it('放得下就原樣', () => { expect(fitText('火骰子', 100, measure)).toBe('火骰子'); });
  it('放不下就截斷並加 …，結果寬度 ≤ 上限', () => {
    const out = fitText('所有骰子暴擊傷害增加', 55, measure);
    expect(out.endsWith('…')).toBe(true);
    expect(measure(out)).toBeLessThanOrEqual(55);
  });
});

describe('完整版幾何', () => {
  it('2× 整張不超過 iOS canvas 面積上限', () => {
    const [w, h] = fullImageSize(data.meta.viewBox);
    expect(w).toBe(data.meta.viewBox[2] * FULL.scale);
    expect(h).toBe((data.meta.viewBox[3] + FULL.headerH) * FULL.scale);
    expect(w * h).toBeLessThan(IOS_MAX_CANVAS_AREA);
  });
  it('fixedView 把 viewBox 的左上／右下角映到樹區的兩角', () => {
    const vb = data.meta.viewBox;
    const size = fullImageSize(vb);
    const v = fixedView(vb, FULL.scale, FULL.headerH * FULL.scale, size);
    expect(v.worldToScreen(vb[0], vb[1])).toEqual([0, FULL.headerH * FULL.scale]);
    expect(v.worldToScreen(vb[0] + vb[2], vb[1] + vb[3])).toEqual(size);
    expect(v.screenToWorld(...v.worldToScreen(123, 456))).toEqual([123, 456]);
    expect(v.pxPerUnit).toBe(FULL.scale);
    expect(v.cssSize).toEqual(size);
  });
});

describe('exportPaintState', () => {
  it('清掉互動狀態：無選取、無淡出、無焦點；等級牌與三階邊照舊', () => {
    let s = initialSimState(ctx);
    s = unlockMany(s, ctx, pathTo('1301', s, ctx));
    const sim = simPaintFor(s, ctx, data, '1301');
    const ps = exportPaintState(sim);
    expect(ps.selected).toBeNull();
    expect(ps.sim!.selected).toBeNull();
    expect(ps.filteredOut.size).toBe(0);
    expect(ps.chain.size).toBe(0);
    expect(ps.focus).toBeNull();
    expect(ps.hover).toBeNull();
    expect(ps.sim!.owned).toBe(sim.owned);
    expect(ps.sim!.active).toBe(sim.active);
  });
});
