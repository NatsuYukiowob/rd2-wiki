import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  matchesFilter, normalizeQuery, stateToQueryString, queryStringToState, emptyState, isTypingTarget,
} from '../../src/lib/filter';
import { computeSelection } from '../../src/lib/selection';
import type { TreeNode, TreeData } from '../../src/lib/types';
import type { FilterState } from '../../src/lib/filter';

const n = (p: Partial<TreeNode>) =>
  ({ branch: 'nature', type: 'dice', name: '火骰子', description: '造成傷害', keywords: [], ...p } as TreeNode);

describe('filter', () => {
  it('空條件全部通過', () => {
    expect(matchesFilter(n({}), emptyState())).toBe(true);
  });
  it('分支與類型是 AND', () => {
    const s = { ...emptyState(), branches: new Set(['nature'] as const), types: new Set(['rune'] as const) };
    expect(matchesFilter(n({ branch: 'nature', type: 'dice' }), s as any)).toBe(false);
    expect(matchesFilter(n({ branch: 'nature', type: 'rune' }), s as any)).toBe(true);
  });
  it('搜尋與篩選也是 AND', () => {
    const s = { ...emptyState(), branches: new Set(['engineering'] as const), query: '火' };
    expect(matchesFilter(n({ branch: 'nature', name: '火骰子' }), s as any)).toBe(false);
  });
  it('搜尋同時比對名稱與效果說明', () => {
    expect(matchesFilter(n({ description: '賦予#冰凍' }), { ...emptyState(), query: '冰凍' })).toBe(true);
  });
  it('搜尋也吃骰子覺醒的文字', () => {
    // 「冰柱」只出現在冰骰子的覺醒裡，描述與名稱都沒有——搜不到的話，玩家在面板上看得到
    // 那兩個字、搜尋卻回 0 筆
    const dice = n({ name: '冰骰子', description: '賦予#冰凍', awakening: '每10秒對最多7個#冰凍狀態怪物發射冰柱' });
    expect(matchesFilter(dice, { ...emptyState(), query: '冰柱' })).toBe(true);
    expect(matchesFilter(n({ name: '冰骰子', description: '賦予#冰凍' }), { ...emptyState(), query: '冰柱' })).toBe(false);
  });
  it('混沌正規化為渾沌', () => {
    expect(normalizeQuery('混沌')).toBe('渾沌');
    expect(matchesFilter(n({ name: '渾沌骰子傷害' }), { ...emptyState(), query: '混沌' })).toBe(true);
  });
  it('支援節點依 branch 歸屬，不會被分支篩選排除', () => {
    const s = { ...emptyState(), branches: new Set(['nature'] as const) };
    expect(matchesFilter(n({ branch: 'nature', type: 'support' }), s as any)).toBe(true);
  });
  it('狀態可往返網址字串', () => {
    const s = { branches: new Set(['nature', 'chaos'] as const), types: new Set(['dice'] as const), query: '冰凍' };
    const qs = stateToQueryString(s as any, '1001');
    const back = queryStringToState(qs);
    expect(back.selected).toBe('1001');
    expect([...back.state.branches].sort()).toEqual(['chaos', 'nature']);
    expect([...back.state.types]).toEqual(['dice']);
    expect(back.state.query).toBe('冰凍');
  });

  // 以下為 brief 7 個驗收測試之外，補的邊界案例與真實資料回歸測試。

  it('搜尋也比對 keywords 陣列', () => {
    expect(matchesFilter(n({ keywords: ['流血'] }), { ...emptyState(), query: '流血' })).toBe(true);
  });

  it('查詢字串前後空白會被裁掉，不影響比對', () => {
    expect(matchesFilter(n({ name: '火骰子' }), { ...emptyState(), query: '  火  ' })).toBe(true);
    expect(normalizeQuery('  火  ')).toBe('火');
  });

  it('分支與類型皆為空集合時視為全部通過（僅搜尋生效）', () => {
    const s = { ...emptyState(), query: '火' };
    expect(matchesFilter(n({ name: '火骰子' }), s)).toBe(true);
    expect(matchesFilter(n({ name: '冰骰子' }), s)).toBe(false);
  });

  it('stateToQueryString 在無任何條件與無選取時回傳空字串', () => {
    expect(stateToQueryString(emptyState(), null)).toBe('');
  });

  it('queryStringToState 對空字串回傳空狀態、selected 為 null', () => {
    const back = queryStringToState('');
    expect(back.selected).toBeNull();
    expect(back.state.branches.size).toBe(0);
    expect(back.state.types.size).toBe(0);
    expect(back.state.query).toBe('');
  });
});

describe('isTypingTarget（搜尋框/篩選核取方塊 focus 時，畫布方向鍵/+/- 快捷鍵要讓路）', () => {
  it('INPUT/TEXTAREA/SELECT 視為輸入目標', () => {
    expect(isTypingTarget('INPUT')).toBe(true);
    expect(isTypingTarget('TEXTAREA')).toBe(true);
    expect(isTypingTarget('SELECT')).toBe(true);
  });
  it('其餘元素（含 null/undefined，代表 document.activeElement 為 body）不算輸入目標', () => {
    expect(isTypingTarget('DIV')).toBe(false);
    expect(isTypingTarget('BODY')).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(undefined)).toBe(false);
  });
});

// 真實資料回歸測試：驗算 1002 尖刺骰子只勾選類型「骰子」時的 hiddenByFilter。
// 前置鏈（computeSelection 對 src/generated/tree.json 實跑）＝
// {1001 火骰子/dice, 1002 尖刺骰子/dice, 1006 光骰子/dice, 1102 所有骰子傷害/passive,
//  1103 自然骰子攻擊速度/passive, 1109 所有骰子傷害/passive}（6 個節點，與 task-15 報告記錄
// 一致）。只勾類型=dice 時，3 個 passive 節點（1102/1103/1109）被篩掉、3 個 dice 節點
// （1001/1002/1006，含選取節點本身）仍可見，hiddenByFilter 應為 3。
describe('1002 hiddenByFilter 真實資料驗算', () => {
  const data: TreeData = JSON.parse(readFileSync('src/generated/tree.json', 'utf8'));
  const byId = new Map(data.nodes.map(nd => [nd.id, nd]));

  it('前置鏈節點清單與型別如預期', () => {
    const sel = computeSelection('1002', data);
    const chainInfo = [...sel.chain].sort().map(id => {
      const node = byId.get(id);
      return `${id}:${node?.type}`;
    });
    expect(chainInfo.sort()).toEqual(
      ['1001:dice', '1002:dice', '1006:dice', '1102:passive', '1103:passive', '1109:passive'].sort(),
    );
  });

  it('只勾類型=dice 時，hiddenByFilter 為 3（3 個 passive 前置被篩掉）', () => {
    const sel = computeSelection('1002', data);
    const state: FilterState = { ...emptyState(), types: new Set(['dice']) };
    const hidden = [...sel.chain].filter(id => {
      const node = byId.get(id);
      return node ? !matchesFilter(node, state) : false;
    });
    expect(hidden.sort()).toEqual(['1102', '1103', '1109']);
    expect(hidden.length).toBe(3);
  });
});
