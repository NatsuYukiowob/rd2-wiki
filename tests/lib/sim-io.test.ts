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
  s = unlockMany(s, ctx, pathTo(rune.id, s, ctx));
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

  // 等級條件是 1.1.0 才有的（太陽骰子要求 1201 練滿 Lv.50），所以 1.1.0 上線那幾天存下來的
  // 檔案可能是「1501 已取得、1201 停在 Lv.1」——遊戲裡不存在的局面，而且總資源少算 46 萬金幣。
  it('把被等級條件卡住的祖先補到門檻（舊存檔沒有那段升級費用）', () => {
    const stale = JSON.stringify({
      v: 1,
      unlocked: ['1201', '1301', '1401', '1501'],
      levels: { '1201': 1 },
      initial: [],
    });
    const back = deserializeSim(stale, ctx)!;
    expect(back.unlocked.has('1501')).toBe(true);
    expect(back.levels.get('1201')).toBe(50);
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

  // 太陽核心（v1.1.0）只在這份規劃真的用得到時才進報告——用不到就一個字都不多印，
  // 既有格式逐位元組不變。⚠️ 正本目前 239 顆的 solar 全是 0，所以這裡得合成一份資料：
  // 拿真實資料驗只會驗到「沒有多印」那一半。
  it('用得到太陽核心時三行都多一段，用不到時一個字都不提', () => {
    expect(simReport(sampleState().s, ctx)).not.toContain('太陽核心');

    const clone = structuredClone(data) as TreeData;
    const rune = clone.nodes.find(x => x.type === 'rune' && x.maxLevel === 50)!;
    rune.unlockCost = { ...rune.unlockCost, solar: 2000 };
    const solarCtx = buildSimContext(clone, tables);
    const s0 = initialSimState(solarCtx);
    const s = unlockMany(s0, solarCtx, pathTo(rune.id, s0, solarCtx));

    const text = simReport(s, solarCtx);
    // 三行是同一個區塊：只有其中一行多一段的話，讀報告的人得自己去推另外兩行是 0 還是不適用。
    expect(text).toMatch(/總資源：核心 [\d,]+ ／金幣 [\d,]+ ／太陽核心 2,000/);
    expect(text).toMatch(/解鎖：核心 [\d,]+ ／金幣 [\d,]+ ／太陽核心 2,000/);
    expect(text).toMatch(/升級：核心 [\d,]+ ／金幣 [\d,]+ ／太陽核心 0/);
  });

  // 起始骰子不該出現在「取得節點」清單裡——玩家沒有為它們做過任何選擇。
  it('不列起始骰子', () => {
    const { s } = sampleState();
    expect(simReport(s, ctx)).not.toMatch(/^1001 /m);
  });
});
