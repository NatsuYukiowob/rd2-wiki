import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import {
  buildSimContext, initialSimState, maxSelectableLevel, pathTo, setInitialDice, setNodeLevel, unlockMany,
} from '../../src/lib/sim';
import { deserializeSim, serializeSim } from '../../src/lib/sim-io';
import { decodeSaveContext, encodeSaveContext } from '../../src/lib/sim-save-lite';
import type { PassiveUpgradeCost, TreeData } from '../../src/lib/types';
import { readTree } from '../helpers/read-tree';

const tables: PassiveUpgradeCost = JSON.parse(readFileSync('data/passive-upgrade-cost.json', 'utf8'));
const data = readTree() as TreeData;
const ctx = buildSimContext(data, tables);
// 走一趟 JSON：/board 是從頁面上的文字讀回來的，不是拿記憶體裡的物件。
const lite = decodeSaveContext(JSON.parse(JSON.stringify(encodeSaveContext(ctx))));

/** 同一份存檔，精簡 context 讀出來的狀態必須跟完整 context 一模一樣。 */
const same = (text: string | null) => expect(deserializeSim(text, lite)).toEqual(deserializeSim(text, ctx));

describe('精簡 context（/board 讀 /sim 存檔用）', () => {
  it('沒有存檔、壞 JSON、版本不符：兩邊都是 null', () => {
    same(null);
    same('{oops');
    same(JSON.stringify({ v: 2, unlocked: [], levels: {}, initial: [] }));
  });

  it('真實規劃：一路點到太陽骰子（含「1201 要練到 Lv.50」的等級條件）＋勾一顆初始骰子＋一顆被動練到 Lv.37', () => {
    let s = setInitialDice(initialSimState(ctx), ctx, '5006', true)!;
    s = unlockMany(s, ctx, pathTo('1501', s, ctx));
    s = unlockMany(s, ctx, pathTo('1102', s, ctx));
    s = setNodeLevel(s, ctx, '1102', 37)!;
    same(serializeSim(s));
  });

  it('改版漂移：不存在的節點、超過上限的等級、前置不齊、等級條件沒滿足——兩邊修補的結果相同', () => {
    same(JSON.stringify({
      v: 1, unlocked: ['9999', '1201', '1301', '1401', '1501'], levels: { '1201': 99, '1501': 1 }, initial: ['5006', '1001'],
    }));
    same(JSON.stringify({ v: 1, unlocked: ['1102'], levels: { '1102': 50 }, initial: [] }));
  });

  it('全樹：每一顆都解開、全部練滿', () => {
    same(JSON.stringify({
      v: 1,
      unlocked: data.nodes.map(n => n.id),
      levels: Object.fromEntries(data.nodes.map(n => [n.id, n.maxLevel])),
      initial: [...ctx.optional],
    }));
  });

  it('maxSelectableLevel 在兩種 context 上一致（精簡版只靠 caps）', () => {
    for (const n of data.nodes) expect(maxSelectableLevel(n, lite), n.id).toBe(maxSelectableLevel(n, ctx));
  });

  it('編碼後夠小：嵌進 /board 的 gzip 不到 2.5 KB（整份 tree.json 約 18 KB）', () => {
    expect(gzipSync(JSON.stringify(encodeSaveContext(ctx))).length).toBeLessThan(2500);
  });
});
