import { describe, it, expect } from 'vitest';
import { emptyPaintState, nodeAlpha, edgeAlpha, edgeColor, labelVisible, stateSignature } from '../../../src/lib/canvas/state';
import type { SceneNode, SceneEdge } from '../../../src/lib/canvas/scene';
const node = (id: string, type: SceneNode['type'] = 'rune'): SceneNode =>
  ({ id, x: 0, y: 0, w: 26, h: 26, shape: 'diamond', type, branch: 'nature', icon: 'x', cell: null, label: id, labelAlways: type === 'dice' || type === 'support', ariaLabel: '', bypassPrereq: false });
const edge = (from: string, to: string, bypassable = false): SceneEdge => ({ from, to, x1: 0, y1: 0, x2: 1, y2: 1, bypassable });

describe('nodeAlpha：canvas.css 那幾條 class 規則的程式版', () => {
  it('沒選取沒篩選＝1', () => expect(nodeAlpha(emptyPaintState(), 'a')).toBe(1));
  it('有選取：鏈上 1、鏈外 .25', () => {
    const s = { ...emptyPaintState(), selected: 'a', chain: new Set(['a', 'b']) };
    expect(nodeAlpha(s, 'a')).toBe(1); expect(nodeAlpha(s, 'z')).toBe(0.25);
  });
  it('被篩掉 .1，但鏈上的即使被篩掉也是 1（前置鏈蓋過篩選淡出）', () => {
    const s = { ...emptyPaintState(), selected: 'a', chain: new Set(['a', 'b']), filteredOut: new Set(['b', 'z']) };
    expect(nodeAlpha(s, 'b')).toBe(1); expect(nodeAlpha(s, 'z')).toBe(0.1);
  });
  it('sim：locked .28、selected 一律 1', () => {
    const sim = { owned: new Set(['o']), available: new Set(['v']), selected: 'l2', linked: new Set<string>(), active: new Set<string>(), ready: new Set<string>(), levels: new Map<string, number>(), maxLevels: new Map<string, number>() };
    const s = { ...emptyPaintState(), sim };
    expect(nodeAlpha(s, 'o')).toBe(1); expect(nodeAlpha(s, 'l')).toBe(0.28); expect(nodeAlpha(s, 'l2')).toBe(1);
  });
  // /sim 的搜尋（Task 11）：舊版是 `#tree.sim .node.sim-dimmed { opacity: .08 }`，具體度
  // (1,3,0) 壓過 `.sim-selected`／`.sim-locked` (1,2,0)——所以連被選取的節點也要跟著淡，
  // 而已取得的節點也不例外。邊刻意不跟著淡（舊版那條只掛在 .node 上）。
  it('sim：被搜尋淡出的節點 .08，連 selected 與 owned 都蓋得過；邊不受影響', () => {
    const sim = { owned: new Set(['o']), available: new Set(['v']), selected: 's', linked: new Set(['o>v']), active: new Set<string>(), ready: new Set<string>(), levels: new Map<string, number>(), maxLevels: new Map<string, number>() };
    const s = { ...emptyPaintState(), sim, filteredOut: new Set(['o', 's', 'v']) };
    expect(nodeAlpha(s, 's')).toBe(0.08); expect(nodeAlpha(s, 'o')).toBe(0.08);
    expect(nodeAlpha(s, 'other')).toBe(0.28);
    expect(edgeAlpha(s, edge('o', 'v'))).toBe(1);
  });
});
describe('edge 樣式', () => {
  it('鏈上邊金色、alpha 1；有選取時鏈外邊 .12；被篩掉 .1', () => {
    const s = { ...emptyPaintState(), selected: 'a', chain: new Set(['a', 'b']), filteredOut: new Set(['x', 'y']) };
    expect(edgeColor(s, edge('a', 'b'))).toBe('gold'); expect(edgeAlpha(s, edge('a', 'b'))).toBe(1);
    expect(edgeAlpha(s, edge('a', 'z'))).toBe(0.12);
    expect(edgeAlpha({ ...emptyPaintState(), filteredOut: new Set(['x', 'y']) }, edge('x', 'y'))).toBe(0.1);
  });
  it('sim 三階：沒到手 .25、兩端在手上 1、走過的金色', () => {
    const sim = { owned: new Set(['a', 'b']), available: new Set<string>(), selected: null, linked: new Set(['a>b']), active: new Set(['a>b']), ready: new Set<string>(), levels: new Map<string, number>(), maxLevels: new Map<string, number>() };
    const s = { ...emptyPaintState(), sim };
    expect(edgeAlpha(s, edge('a', 'b'))).toBe(1); expect(edgeColor(s, edge('a', 'b'))).toBe('gold');
    expect(edgeAlpha(s, edge('a', 'c'))).toBe(0.25);
  });
});
describe('labelVisible', () => {
  it('骰子常駐；符文只在 hover／focus／鏈上', () => {
    expect(labelVisible(emptyPaintState(), node('d', 'dice'))).toBe(true);
    expect(labelVisible(emptyPaintState(), node('r'))).toBe(false);
    expect(labelVisible({ ...emptyPaintState(), hover: 'r' }, node('r'))).toBe(true);
    expect(labelVisible({ ...emptyPaintState(), focus: 'r' }, node('r'))).toBe(true);
    expect(labelVisible({ ...emptyPaintState(), selected: 'r', chain: new Set(['r']) }, node('r'))).toBe(true);
  });
});
it('stateSignature 不含 hover／focus（那兩個只影響互動層）', () => {
  const a = stateSignature({ ...emptyPaintState(), hover: 'x', focus: 'y' });
  expect(a).toBe(stateSignature(emptyPaintState()));
});
