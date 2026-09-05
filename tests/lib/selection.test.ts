import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { computeSelection } from '../../src/lib/selection';
import type { PassiveUpgradeCost, TreeData } from '../../src/lib/types';

const data: TreeData = JSON.parse(readFileSync('src/generated/tree.json', 'utf8'));
const tables: PassiveUpgradeCost = JSON.parse(readFileSync('data/passive-upgrade-cost.json', 'utf8'));

describe('computeSelection', () => {
  it('根節點的前置鏈只有自己', () => {
    expect([...computeSelection('1001', data, tables).chain]).toEqual(['1001']);
  });
  it('多重前置節點的前置鏈包含兩條路徑的聯集', () => {
    const chain = computeSelection('1002', data, tables).chain;
    expect(chain.size).toBeGreaterThan(2);
    expect(chain.has('1002')).toBe(true);
  });
  it('成本合計等於前置鏈上各節點成本之和（去重）', () => {
    const sel = computeSelection('1002', data, tables);
    const byId = new Map(data.nodes.map(n => [n.id, n]));
    const manual = [...sel.chain]
      .map(id => byId.get(id)!)
      .filter(n => n.unlockVia === 'cost')
      .reduce((acc, n) => ({
        core: acc.core + n.unlockCost.core,
        gold: acc.gold + n.unlockCost.gold,
        solar: acc.solar + n.unlockCost.solar,
      }), { core: 0, gold: 0, solar: 0 });
    expect(sel.cost).toEqual(manual);
  });
  it('非成本解鎖的節點被排除並列入 skipped', () => {
    const sel = computeSelection('4008', data, tables);
    expect(sel.skipped).toContain('4008');
  });

  // 貪婪骰子（5006）與空虛骰子（5008）官方寫明「無視骰子樹前置」，走到它就不必再往上追。
  it('可跳過前置的節點自己：鏈只剩自身，被跳掉的祖先數記在 bypassed', () => {
    const sel = computeSelection('5006', data, tables);
    expect([...sel.chain]).toEqual(['5006']);
    // 原本的鏈是 5002 → 5007 → 5006，跳掉 5007 與 5002 兩個
    expect(sel.bypassed).toBe(2);
    expect(sel.cost).toEqual({ core: 0, gold: 0, solar: 0 });
  });

  it('可跳過前置的下游節點：鏈停在那顆，成本不含被跳過的祖先', () => {
    const sel = computeSelection('5206', data, tables);
    expect([...sel.chain].sort()).toEqual(['5006', '5206']);
    expect(sel.bypassed).toBe(2);
    expect(sel.cost).toEqual({ core: 0, gold: 2000, solar: 0 });
  });

  it('沒有可跳過前置時 bypassed 為 0', () => {
    expect(computeSelection('1002', data, tables).bypassed).toBe(0);
  });

  // ⚠️ `bypassed > 0` 不等於「鏈上有可直接領的骰子」。5005 變異骰子的前置是 5006 與 5103，
  // 而 5103 的祖先鏈是 5002 → 5007 → 5103——跳過 5006 的祖先一個都沒省到（5007／5002 從
  // 另一條路回來），所以 bypassed 是 0，但鏈上確實有 5006、畫面上那條虛線也確實被高亮成金色。
  // 面板的說明必須由「鏈上有沒有」驅動，不是由「省了幾個」驅動。
  it('bypassNodes 數的是鏈上可直接領的骰子，跟省了幾個前置是兩件事', () => {
    const s5005 = computeSelection('5005', data, tables);
    expect(s5005.chain.has('5006')).toBe(true);
    expect(s5005.chain.has('5007')).toBe(true);   // 從 5103 那條路回來
    expect(s5005.bypassed).toBe(0);
    expect(s5005.bypassNodes).toBe(1);

    const s5206 = computeSelection('5206', data, tables);
    expect(s5206.bypassed).toBe(2);
    expect(s5206.bypassNodes).toBe(1);

    expect(computeSelection('1002', data, tables).bypassNodes).toBe(0);
  });

  // 恐懼骰子（5002）是成就開門＋仍要 8 核心：它自己就是根，鏈只有自身，但成本不是 0。
  it('unlockPaid 的節點成本要算進去，且不列進 skipped', () => {
    const sel = computeSelection('5002', data, tables);
    expect([...sel.chain]).toEqual(['5002']);
    expect(sel.cost).toEqual({ core: 8, gold: 0, solar: 0 });
    expect(sel.skipped).toEqual([]);
  });

  // 這是全站最常被引用的那組不變量。5109（金幣 3,000）原本靠 5008 的前置鏈被算進來，
  // 5008 改成可直接領之後就不該再算了；核心不變是因為拿掉 5007 的 8 核與加回 5002 的 8 核抵消。
  it('5201 的前置鏈成本＝核心 42 ／金幣 20,000', () => {
    expect(computeSelection('5201', data, tables).cost).toEqual({ core: 42, gold: 20000, solar: 0 });
  });

  // 沒有等級條件的節點：三個欄位要維持「什麼都沒發生」的樣子，總計＝解鎖費用。
  it('沒有前置等級條件時 totalCost 就是 cost', () => {
    const sel = computeSelection('5201', data, tables);
    expect(sel.prereqRanks).toEqual([]);
    expect(sel.prereqRankCost).toEqual({ core: 0, gold: 0, solar: 0 });
    expect(sel.totalCost).toEqual(sel.cost);
  });

  // 太陽骰子（1501）除了 1301／1401 兩條入邊，還要求 1201 子彈傷害%增加練滿 Lv.50
  //（客戶端 DiceTreeNodeTable 的 NeedNode／NeedNodeRank）。算式逐項寫在這裡：
  //   解鎖：1201 金幣 2,000 ＋ 1301 核心 10／金幣 10,000 ＋ 1401 核心 20／金幣 20,000
  //         ＋ 1501 金幣 100,000／太陽核心 2,000
  //         ＝ 核心 30 ／金幣 132,000 ／太陽核心 2,000（1001 是起始骰子，不計）
  //   練等：1201 Lv.1 → Lv.50 追加（data/upgrade-cost.json 的 2–50 級）＝ 金幣 463,700 ／核心 99
  //   總計：核心 129 ／金幣 595,700 ／太陽核心 2,000
  it('1501 太陽骰子：前置鏈成本要含 1201 練到 Lv.50 的追加費用', () => {
    const sel = computeSelection('1501', data, tables);
    expect([...sel.chain].sort()).toEqual(['1001', '1201', '1301', '1401', '1501']);
    expect(sel.cost).toEqual({ core: 30, gold: 132000, solar: 2000 });
    expect(sel.prereqRanks).toEqual([
      { id: '1201', name: '子彈傷害%增加', rank: 50, cost: { core: 99, gold: 463700, solar: 0 } },
    ]);
    expect(sel.prereqRankCost).toEqual({ core: 99, gold: 463700, solar: 0 });
    expect(sel.totalCost).toEqual({ core: 129, gold: 595700, solar: 2000 });
  });

  // 條件掛在 1501 身上，不是掛在 1201／1301／1401 身上——選到那三顆自己時完全不受影響。
  it('選到 1201／1301／1401 自己時不受等級條件影響', () => {
    for (const id of ['1201', '1301', '1401']) {
      const sel = computeSelection(id, data, tables);
      expect(sel.prereqRanks).toEqual([]);
      expect(sel.totalCost).toEqual(sel.cost);
    }
  });

  // 1601 太陽強化是 1501 的後續，鏈上經過 1501 → 那段練等費用照樣要算進來，
  // 判準是「整條鏈上誰有條件」而不是「選到的那一顆有沒有條件」。
  it('1601 的前置鏈經過 1501，所以一樣要算 1201 的練等費用', () => {
    const sel = computeSelection('1601', data, tables);
    expect(sel.prereqRanks.map(r => r.id)).toEqual(['1201']);
    expect(sel.totalCost.gold).toBe(sel.cost.gold + 463700);
  });

  // 查不到費用表時要回 null 讓面板寫「成本未確認」，**不可以安靜地當 0**
  //（同 cumulativeUpgradeCost() 回 null 的理由）。
  it('查不到升級費用表時該筆成本是 null，不是 0', () => {
    const noRuneTable = { ...data, meta: { ...data.meta, upgradeCostTable: null } };
    const sel = computeSelection('1501', noRuneTable, tables);
    expect(sel.prereqRanks).toEqual([{ id: '1201', name: '子彈傷害%增加', rank: 50, cost: null }]);
    expect(sel.prereqRankCost).toEqual({ core: 0, gold: 0, solar: 0 });
    expect(sel.totalCost).toEqual(sel.cost);
  });
});
