import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildSimContext, initialSimState, ownedIds, isAvailable, missingParents,
  unlockNode, removeNode, setNodeLevel, setInitialDice, pathTo, unlockMany,
  simTotals, maxSelectableLevel, summarizeAbilities, exceedsLimit, edgeWasUsed, edgeIsLinked,
} from '../../src/lib/sim';
import type { Edge, PassiveUpgradeCost, TreeData, TreeNode } from '../../src/lib/types';

const realTables: PassiveUpgradeCost = JSON.parse(readFileSync('data/passive-upgrade-cost.json', 'utf8'));
const realData = JSON.parse(readFileSync('src/generated/tree.json', 'utf8')) as TreeData;

/** 小假圖：A（default）→ B → D，A → C → D，另加一顆 E 是「可選初始骰子」、F 要 E 當前置。 */
const n = (id: string, over: Partial<TreeNode> = {}): TreeNode => ({
  id, branch: 'nature', element: 'nature', type: 'passive', name: `n${id}`, label: id,
  shape: 'circle', size: [1, 1], x: 0, y: 0,
  unlockCost: { core: 1, gold: 1000 }, unlockVia: 'cost',
  maxLevel: 1, prereqMode: null, upgradeCost: null, description: '',
  keywords: [], growth: null, dataIssue: null, icon: 'x', ...over,
} as TreeNode);

const edges: Edge[] = [['A', 'B'], ['A', 'C'], ['B', 'D'], ['C', 'D'], ['E', 'F']];
const fakeData = {
  meta: { upgradeCostTable: null },
  nodes: [
    // default 的那 5 顆在真實資料裡都是骰子；設成 passive 的話「初始狀態沒有任何能力」那條
    // 測試會被自己的假圖推翻。
    n('A', { type: 'dice', unlockVia: 'default', unlockCost: { core: 5, gold: 0 } }),
    n('B'), n('C'), n('D'),
    n('E', { type: 'dice', unlockVia: 'achievement', bypassPrereq: true, unlockCost: { core: 8, gold: 0 } }),
    n('F'),
    // 可升級的玩家被動：maxLevel 10 ＋ 解鎖金幣 12000 ＝ tier A
    n('G', { maxLevel: 10, unlockCost: { core: 0, gold: 12000 }, growth: { base: 10, perLevel: 2, unit: '%' } }),
  ],
  edges,
} as unknown as TreeData;

const ctx = buildSimContext(fakeData, realTables);

describe('buildSimContext', () => {
  it('default 節點是一開始就有的，可選初始骰子是「不用付錢也不必解前置」那幾顆', () => {
    expect([...ctx.free]).toEqual(['A']);
    expect([...ctx.optional]).toEqual(['E']);
  });

  // 這兩組刻意從資料推導而不是硬編碼 id：官方哪天多送一顆初始骰子，只要 unlock-exceptions
  // 改一行，/sim 就跟著對——寫死清單的話它會安靜地停在舊資料上。
  it('真實資料：5 顆初始骰子、3 顆可選初始骰子', () => {
    const real = buildSimContext(realData, realTables);
    expect([...real.free].sort()).toEqual(['1001', '1005', '1007', '2001', '3001']);
    expect([...real.optional].sort()).toEqual(['4008', '5006', '5008']);
  });

  // 恐懼骰子是成就開門但仍要付 8 核心（unlockPaid），所以它走的是一般解鎖流程，
  // 不是「勾一下就有」——混進 optional 的話玩家會免費拿到它。
  it('真實資料：5002 恐懼骰子不算可選初始骰子', () => {
    expect(buildSimContext(realData, realTables).optional.has('5002')).toBe(false);
  });
});

describe('初始狀態', () => {
  const s0 = initialSimState(ctx);

  it('只有 default 節點是已取得的，可選初始骰子預設不勾', () => {
    expect([...ownedIds(s0, ctx)]).toEqual(['A']);
    expect(s0.initial.size).toBe(0);
  });

  it('總資源是 0（default 節點玩家沒付過那筆錢）', () => {
    expect(simTotals(s0, ctx).total).toEqual({ core: 0, gold: 0 });
  });

  it('真實資料：初始狀態 5 顆已取得、234 顆未取得、資源 0', () => {
    const real = buildSimContext(realData, realTables);
    const s = initialSimState(real);
    expect(ownedIds(s, real).size).toBe(5);
    expect(realData.nodes.length - ownedIds(s, real).size).toBe(234);
    expect(simTotals(s, real).total).toEqual({ core: 0, gold: 0 });
  });
});

describe('解鎖與取消', () => {
  const s0 = initialSimState(ctx);

  it('前置齊了才可解鎖', () => {
    expect(isAvailable('B', s0, ctx)).toBe(true);
    expect(isAvailable('D', s0, ctx)).toBe(false);
    expect(missingParents('D', s0, ctx).sort()).toEqual(['B', 'C']);
  });

  it('解鎖會把成本加進總資源', () => {
    const s = unlockNode(s0, ctx, 'B')!;
    expect(ownedIds(s, ctx).has('B')).toBe(true);
    expect(simTotals(s, ctx).total).toEqual({ core: 1, gold: 1000 });
  });

  it('前置沒齊的節點解不開', () => {
    expect(unlockNode(s0, ctx, 'D')).toBeNull();
  });

  // 可選初始骰子只能用勾的——它們不花錢，讓玩家在樹上點一下就拿到等於送。
  it('可選初始骰子不能用點的解鎖', () => {
    expect(unlockNode(s0, ctx, 'E')).toBeNull();
    expect(isAvailable('E', s0, ctx)).toBe(false);
  });

  it('取消一顆會連帶取消所有直接或間接依賴它的節點，成本一併扣掉', () => {
    let s = unlockNode(s0, ctx, 'B')!;
    s = unlockNode(s, ctx, 'C')!;
    s = unlockNode(s, ctx, 'D')!;
    expect(simTotals(s, ctx).total).toEqual({ core: 3, gold: 3000 });
    const after = removeNode(s, ctx, 'B')!;
    expect([...ownedIds(after, ctx)].sort()).toEqual(['A', 'C']);
    expect(simTotals(after, ctx).total).toEqual({ core: 1, gold: 1000 });
  });

  it('取消時連帶清掉被取消節點的等級', () => {
    let s = unlockNode(s0, ctx, 'G')!;
    s = setNodeLevel(s, ctx, 'G', 6)!;
    expect(s.levels.get('G')).toBe(6);
    expect(removeNode(s, ctx, 'G')!.levels.has('G')).toBe(false);
  });

  it('default 節點不可取消', () => {
    expect(removeNode(s0, ctx, 'A')).toBeNull();
  });

  // 純函式：每個操作回一份新狀態，undo 才能直接把舊狀態推回去。就地改的話 undo 堆疊
  // 裡每一筆都指向同一個 Set，退回去會發現「上一步」跟現在長得一模一樣。
  it('操作不會就地改動舊狀態', () => {
    const before = new Set(s0.unlocked);
    unlockNode(s0, ctx, 'B');
    expect(s0.unlocked).toEqual(before);
  });
});

describe('初始骰子勾選', () => {
  const s0 = initialSimState(ctx);

  it('勾了就取得，而且不花錢', () => {
    const s = setInitialDice(s0, ctx, 'E', true)!;
    expect(ownedIds(s, ctx).has('E')).toBe(true);
    expect(simTotals(s, ctx).total).toEqual({ core: 0, gold: 0 });
  });

  it('勾掉會連帶取消依賴它的節點', () => {
    let s = setInitialDice(s0, ctx, 'E', true)!;
    s = unlockNode(s, ctx, 'F')!;
    expect(ownedIds(s, ctx).has('F')).toBe(true);
    const after = setInitialDice(s, ctx, 'E', false)!;
    expect(ownedIds(after, ctx).has('E')).toBe(false);
    expect(ownedIds(after, ctx).has('F')).toBe(false);
  });

  it('不是可選初始骰子的節點不能用勾的', () => {
    expect(setInitialDice(s0, ctx, 'B', true)).toBeNull();
  });
});

describe('一鍵點亮到這裡', () => {
  const s0 = initialSimState(ctx);

  it('回傳整條還沒解的前置鏈，父節點排在子節點前面', () => {
    const { need, blocked } = pathTo('D', s0, ctx);
    expect(blocked).toEqual([]);
    expect(need).toContain('D');
    expect(need.indexOf('B')).toBeLessThan(need.indexOf('D'));
    expect(need.indexOf('C')).toBeLessThan(need.indexOf('D'));
    expect(need).not.toContain('A');   // 已經有了
  });

  it('鏈上有沒勾的初始骰子時列進 blocked', () => {
    const { need, blocked } = pathTo('F', s0, ctx);
    expect(blocked).toEqual(['E']);
    expect(need).toEqual([]);   // 一顆都不解，不做半套
  });

  it('unlockMany 一次解完並累加成本', () => {
    const { need } = pathTo('D', s0, ctx);
    const s = unlockMany(s0, ctx, need);
    expect([...ownedIds(s, ctx)].sort()).toEqual(['A', 'B', 'C', 'D']);
    expect(simTotals(s, ctx).total).toEqual({ core: 3, gold: 3000 });
  });

  // 這是 /tree 已經在算的同一件事，兩邊算出不同答案就代表其中一邊錯了。
  it('真實資料：5201 的前置鏈成本＝核心 42 ／金幣 20,000', () => {
    const real = buildSimContext(realData, realTables);
    const s0r = initialSimState(real);
    // 5201 的鏈**同時**經過 5006 與 5008（兩顆都是可直接領的），兩顆都勾起來才走得通。
    // 只勾一顆會拿到 blocked: ['5006']——那是 pathTo 正確地拒絕做半套。
    const withInitial = setInitialDice(setInitialDice(s0r, real, '5008', true)!, real, '5006', true)!;
    const { need, blocked } = pathTo('5201', withInitial, real);
    expect(blocked).toEqual([]);
    const s = unlockMany(withInitial, real, need);
    expect(simTotals(s, real).unlock).toEqual({ core: 42, gold: 20000 });
  });
});

describe('等級與升級費用', () => {
  const s0 = initialSimState(ctx);

  it('只有已取得的節點能調等級', () => {
    expect(setNodeLevel(s0, ctx, 'G', 5)).toBeNull();
  });

  it('等級上限是節點自己的 maxLevel', () => {
    const g = ctx.byId.get('G')!;
    expect(maxSelectableLevel(g, ctx)).toBe(10);
    expect(maxSelectableLevel(ctx.byId.get('B')!, ctx)).toBe(1);
  });

  it('超出上限或低於 1 的等級不接受', () => {
    const s = unlockNode(s0, ctx, 'G')!;
    expect(setNodeLevel(s, ctx, 'G', 11)).toBeNull();
    expect(setNodeLevel(s, ctx, 'G', 0)).toBeNull();
  });

  // tier A：Lv.2-5 每級 8000、Lv.6 是 16000+6 核心。練到 Lv.6 ＝ 8000×4 + 16000 ＝ 48000 金幣、6 核心。
  it('升級費用按 tier 累加，核心只在區間第一級收一次', () => {
    let s = unlockNode(s0, ctx, 'G')!;
    s = setNodeLevel(s, ctx, 'G', 6)!;
    const t = simTotals(s, ctx);
    expect(t.unlock).toEqual({ core: 0, gold: 12000 });
    expect(t.upgrade).toEqual({ core: 6, gold: 48000 });
    expect(t.total).toEqual({ core: 6, gold: 60000 });
  });

  it('解鎖時等級預設是 1，不花升級費用', () => {
    const s = unlockNode(s0, ctx, 'G')!;
    expect(s.levels.get('G')).toBe(1);
    expect(simTotals(s, ctx).upgrade).toEqual({ core: 0, gold: 0 });
  });

  // 符文表自己帶著 level 1（金額＝符文的解鎖金幣），不跳過的話每顆符文的解鎖費用會被算兩次。
  it('真實資料：一顆 50 級符文練到 Lv.2 只多花第 2 級那筆', () => {
    const real = buildSimContext(realData, realTables);
    const rune = realData.nodes.find(x => x.type === 'rune' && x.maxLevel === 50)!;
    const { need } = pathTo(rune.id, initialSimState(real), real);
    let s = unlockMany(initialSimState(real), real, need);
    const before = simTotals(s, real);
    s = setNodeLevel(s, real, rune.id, 2)!;
    const after = simTotals(s, real);
    expect(after.unlock).toEqual(before.unlock);
    expect(after.upgrade.gold).toBe(realData.meta.upgradeCostTable!.levels[1]!.gold);
  });
});

describe('資源上限', () => {
  it('沒設定上限時不擋', () => {
    expect(exceedsLimit({ core: 999, gold: 999 }, { core: null, gold: null })).toEqual([]);
  });

  it('超出時回報是哪一種、差多少', () => {
    const over = exceedsLimit({ core: 10, gold: 5000 }, { core: 8, gold: null });
    expect(over).toHaveLength(1);
    expect(over[0]).toMatch(/核心.*10.*8/);
  });

  it('剛好等於上限不算超出', () => {
    expect(exceedsLimit({ core: 8, gold: 100 }, { core: 8, gold: 100 })).toEqual([]);
  });

  // ⚠️ 玩家的實際用法是「先規劃、事後才填上限」，所以填完之後**一定**處在超支狀態。
  // 這時若連「取消節點」「降等級」這些會讓成本下降的操作都一起擋掉，他除了 undo 或整份
  // 重置之外沒有出路——上限欄位反而把人鎖死在自己想改掉的那份規劃裡。
  it('傳入 previous 時，降成本的操作即使仍超上限也不算超出', () => {
    expect(exceedsLimit({ core: 5, gold: 0 }, { core: 1, gold: null }, { core: 10, gold: 0 })).toEqual([]);
  });

  it('傳入 previous 時，只有「超上限而且比之前更貴」才算超出', () => {
    expect(exceedsLimit({ core: 5, gold: 0 }, { core: 1, gold: null }, { core: 3, gold: 0 })).toHaveLength(1);
  });

  it('傳入 previous 時，逐幣別分開判斷', () => {
    // 核心變便宜、金幣變貴：只該擋金幣那一項
    const over = exceedsLimit({ core: 5, gold: 900 }, { core: 1, gold: 100 }, { core: 10, gold: 200 });
    expect(over).toHaveLength(1);
    expect(over[0]).toMatch(/金幣/);
  });
});

describe('邊的兩端在不在手上', () => {
  const s0 = initialSimState(ctx);

  it('兩端都取得就算連通，跟是誰解開的無關', () => {
    const real = buildSimContext(realData, realTables);
    const s = initialSimState(real);
    // 火骰子連著風與冰，三顆都是遊戲一開始就送的——這條路是通的，畫面上不該把它畫得跟
    // 「還沒走到的路」一樣暗（Yuki 2026-08-23 回報）。它只是沒有被「走過」，所以不上金色。
    expect(edgeIsLinked('1001', '1005', s, real)).toBe(true);
    expect(edgeIsLinked('1001', '1007', s, real)).toBe(true);
    expect(edgeWasUsed('1001', '1005', s, real)).toBe(false);
  });

  it('有一端還沒取得就不算連通', () => {
    expect(edgeIsLinked('A', 'B', s0, ctx)).toBe(false);
    expect(edgeIsLinked('B', 'D', s0, ctx)).toBe(false);
  });

  // 金色（走過）是亮色（連通）的子集：CSS 靠這個包含關係把兩件事拆成互不搶屬性的兩條規則，
  // `.sim-active` 只設 stroke、`.sim-linked` 只設 opacity。倒過來的話金線會變半透明。
  it('「走過」一定也是「連通」——真實資料全邊掃描', () => {
    const real = buildSimContext(realData, realTables);
    let s = initialSimState(real);
    s = unlockMany(s, real, pathTo('5201', setInitialDice(setInitialDice(s, real, '5006', true)!, real, '5008', true)!, real).need);
    const broken = realData.edges.filter(([f, t]) => edgeWasUsed(f, t, s, real) && !edgeIsLinked(f, t, s, real));
    expect(broken).toEqual([]);
  });
});

describe('邊有沒有被「走過」', () => {
  const s0 = initialSimState(ctx);

  it('兩端都取得、而且終點是玩家自己解開的，才算走過', () => {
    const s = unlockNode(s0, ctx, 'B')!;
    expect(edgeWasUsed('A', 'B', s, ctx)).toBe(true);
  });

  it('起點還沒取得就不算', () => {
    expect(edgeWasUsed('B', 'D', s0, ctx)).toBe(false);
  });

  // 真實資料裡 1001 火骰子 → 1005 風骰子與 → 1007 冰骰子這兩條，兩端都是遊戲一開始就送的，
  // 玩家從來沒有「靠火骰子解開風骰子」。只看「兩端都取得」的話，一進頁面就有兩條金線亮著，
  // 玩家會以為自己已經解了什麼。全站只有這兩條。
  it('終點是起始骰子時不算走過（玩家沒有靠這條邊解開它）', () => {
    const real = buildSimContext(realData, realTables);
    const s = initialSimState(real);
    expect(edgeWasUsed('1001', '1005', s, real)).toBe(false);
    expect(edgeWasUsed('1001', '1007', s, real)).toBe(false);
  });

  it('終點是勾選的初始骰子時也不算（那是從骰子樹外面領的）', () => {
    const s = setInitialDice(s0, ctx, 'E', true)!;
    expect(ownedIds(s, ctx).has('E')).toBe(true);
    expect(edgeWasUsed('A', 'E', s, ctx)).toBe(false);
  });

  it('真實資料：初始狀態一條「走過的邊」都沒有', () => {
    const real = buildSimContext(realData, realTables);
    const s = initialSimState(real);
    const used = realData.edges.filter(([f, t]) => edgeWasUsed(f, t, s, real));
    expect(used).toEqual([]);
  });
});

describe('能力彙總', () => {
  it('同名節點的成長值依當前等級相加', () => {
    const s0 = initialSimState(ctx);
    let s = unlockNode(s0, ctx, 'G')!;
    s = setNodeLevel(s, ctx, 'G', 3)!;   // 10 + 2×2 = 14%
    const groups = summarizeAbilities(s, ctx);
    const entry = groups.flatMap(g => g.entries).find(e => e.name === 'nG')!;
    expect(entry.total).toEqual({ value: 14, unit: '%' });
    expect(entry.count).toBe(1);
  });

  it('沒有成長值的節點不硬湊數字，照描述分組計數', () => {
    const s = unlockNode(initialSimState(ctx), ctx, 'B')!;
    const entry = summarizeAbilities(s, ctx).flatMap(g => g.entries).find(e => e.name === 'nB')!;
    expect(entry.total).toBeNull();
    expect(entry.fixed).toEqual([{ description: '', count: 1 }]);
  });

  it('只列已取得的節點', () => {
    expect(summarizeAbilities(initialSimState(ctx), ctx).flatMap(g => g.entries)).toEqual([]);
  });

  // 「所有骰子傷害」在五個系各有節點，玩家要看的是總和而不是五筆分開的加成。
  // 判準是「這個名稱在**整份資料**裡跨不跨系」，不是「玩家現在解了哪幾顆」——用後者的話
  // 同一個效果會隨解鎖進度在分組之間跳來跳去。
  it('真實資料：跨系別的同名效果歸到「全部骰子」', () => {
    const real = buildSimContext(realData, realTables);
    expect(real.globalNames.has('所有骰子傷害')).toBe(true);
    let s = initialSimState(real);
    const { need } = pathTo('1102', s, real);
    s = unlockMany(s, real, need);
    const g = summarizeAbilities(s, real).find(x => x.group === 'global')!;
    expect(g.entries.some(e => e.name === '所有骰子傷害')).toBe(true);
  });
});
