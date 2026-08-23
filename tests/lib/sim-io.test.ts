import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildSimContext, initialSimState, unlockMany, setInitialDice, setNodeLevel, pathTo } from '../../src/lib/sim';
import { serializeSim, deserializeSim, simReport, SIM_STORAGE_KEY } from '../../src/lib/sim-io';
import type { PassiveUpgradeCost, TreeData } from '../../src/lib/types';

const tables: PassiveUpgradeCost = JSON.parse(readFileSync('data/passive-upgrade-cost.json', 'utf8'));
const data = JSON.parse(readFileSync('src/generated/tree.json', 'utf8')) as TreeData;
const ctx = buildSimContext(data, tables);

/** 解到某顆 50 級符文並練到 Lv.3，外加勾一顆初始骰子——三種狀態都覆蓋到。 */
function sampleState() {
  const rune = data.nodes.find(x => x.type === 'rune' && x.maxLevel === 50)!;
  let s = setInitialDice(initialSimState(ctx), ctx, '5006', true)!;
  s = unlockMany(s, ctx, pathTo(rune.id, s, ctx).need);
  s = setNodeLevel(s, ctx, rune.id, 3)!;
  return { s, runeId: rune.id };
}

describe('存檔', () => {
  it('鍵名帶版本號', () => {
    expect(SIM_STORAGE_KEY).toBe('rd2-sim-v1');
  });

  it('存了再讀回來是同一份狀態', () => {
    const { s, runeId } = sampleState();
    const back = deserializeSim(serializeSim(s), ctx)!;
    expect([...back.unlocked].sort()).toEqual([...s.unlocked].sort());
    expect([...back.initial]).toEqual([...s.initial]);
    expect(back.levels.get(runeId)).toBe(3);
  });

  it('沒有存檔、不是 JSON、或格式版本不符時回 null（由呼叫端退回初始狀態）', () => {
    expect(deserializeSim(null, ctx)).toBeNull();
    expect(deserializeSim('{oops', ctx)).toBeNull();
    expect(deserializeSim('[]', ctx)).toBeNull();
    expect(deserializeSim(JSON.stringify({ v: 99, unlocked: [], levels: {}, initial: [] }), ctx)).toBeNull();
  });

  // 存檔是使用者瀏覽器裡的舊資料，而骰子樹會改版：節點被移除、等級上限被調低、
  // 某條邊被拿掉。三種都不該讓頁面壞掉，也不該讓玩家看到一份算錯的資源總額。
  it('丟掉已經不存在的節點', () => {
    const back = deserializeSim(JSON.stringify({ v: 1, unlocked: ['9999'], levels: {}, initial: [] }), ctx)!;
    expect(back.unlocked.has('9999')).toBe(false);
  });

  it('丟掉不該出現在 unlocked 裡的起始骰子與可選初始骰子', () => {
    const back = deserializeSim(JSON.stringify({ v: 1, unlocked: ['1001', '5006'], levels: {}, initial: [] }), ctx)!;
    expect(back.unlocked.has('1001')).toBe(false);
    expect(back.unlocked.has('5006')).toBe(false);
  });

  it('把超出上限的等級夾回上限', () => {
    const { s, runeId } = sampleState();
    const raw = JSON.parse(serializeSim(s));
    raw.levels[runeId] = 999;
    expect(deserializeSim(JSON.stringify(raw), ctx)!.levels.get(runeId)).toBe(50);
  });

  it('前置不齊的節點會被連帶清掉，而不是留在畫面上繼續算錢', () => {
    // 1002 的前置是 1001（起始骰子，一定有），2002 的前置是 2001…改用一顆前置沒被存進來的節點
    const deep = data.nodes.find(x => (ctx.parents.get(x.id) ?? []).length > 0
      && !ctx.free.has((ctx.parents.get(x.id) ?? [])[0]!))!;
    const back = deserializeSim(JSON.stringify({ v: 1, unlocked: [deep.id], levels: {}, initial: [] }), ctx)!;
    expect(back.unlocked.has(deep.id)).toBe(false);
  });

  it('欄位型別不對時當成沒有存檔', () => {
    expect(deserializeSim(JSON.stringify({ v: 1, unlocked: 'x', levels: {}, initial: [] }), ctx)).toBeNull();
    expect(deserializeSim(JSON.stringify({ v: 1, unlocked: [], levels: [], initial: [] }), ctx)).toBeNull();
  });
});

describe('文字報告', () => {
  it('含總資源、解鎖與升級的拆分、已取得節點數', () => {
    const { s, runeId } = sampleState();
    const text = simReport(s, ctx);
    expect(text).toContain('Random Dice 2 骰子樹模擬');
    expect(text).toMatch(/總資源：核心 [\d,]+ ／金幣 [\d,]+/);
    expect(text).toMatch(/解鎖：核心 [\d,]+ ／金幣 [\d,]+/);
    expect(text).toMatch(/升級：核心 [\d,]+ ／金幣 [\d,]+/);
    expect(text).toMatch(new RegExp(`${runeId} .* Lv\\.3/50`));
  });

  it('列出勾選的初始骰子，沒勾時明講', () => {
    const withNone = simReport(initialSimState(ctx), ctx);
    expect(withNone).toMatch(/初始骰子：.*無/);
    const { s } = sampleState();
    expect(simReport(s, ctx)).toContain('貪婪骰子');
  });

  // 起始骰子不該出現在「取得節點」清單裡——玩家沒有為它們做過任何選擇。
  it('不列起始骰子', () => {
    const { s } = sampleState();
    expect(simReport(s, ctx)).not.toMatch(/^1001 /m);
  });
});
