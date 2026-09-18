import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  addCost, costFromJson, cumulativeUpgradeCost, mythicAmount, mythicEntries, parseCost, subCost, upgradeTableApplies, zeroCost,
} from '../../src/lib/cost';
import { MYTHIC_CORES } from '../../src/lib/currency';
import type { UpgradeCostTable } from '../../src/lib/types';

describe('parseCost', () => {
  it('核心單一貨幣', () => {
    expect(parseCost('核心 5')).toEqual({ cost: { core: 5, gold: 0 } });
  });
  it('金幣單一貨幣含千分位', () => {
    expect(parseCost('金幣 8,000')).toEqual({ cost: { core: 0, gold: 8000 } });
  });
  it('複合成本，全形斜線', () => {
    expect(parseCost('金幣 100,000／核心 10')).toEqual({ cost: { core: 10, gold: 100000 } });
  });
  // 2026-08-22（#21）之前 `data-cost` 的第二行寫著「最高 N 級」，等級上限現在是
  // `data/nodes.json` 的 `maxLevel` 欄位。parseCost 跟著拒絕第二行，而不是留著「還讀得懂
  // 但沒人用」的能力——validate 的規則 4 拒絕的輸入，`npm run build:data` 必須也拒絕，
  // 否則同一份輸入兩邊給不同答案。
  it('第二行「最高 N 級」被拒絕（等級上限改走 nodes.json 的 maxLevel）', () => {
    expect(() => parseCost('金幣 2,000\n最高 50 級')).toThrow(/不可換行.*maxLevel/);
    expect(() => parseCost('金幣 20,000／核心 4\n最高 3 級')).toThrow(/不可換行.*maxLevel/);
  });
  it('半形斜線視為錯誤', () => {
    expect(() => parseCost('金幣 100,000/核心 10')).toThrow(/全形/);
  });
  it('核心不使用千分位', () => {
    expect(() => parseCost('核心 1,000')).toThrow();
  });
  it('完全無法辨識的字串拋錯', () => {
    expect(() => parseCost('免費')).toThrow();
  });
  it('欄位順序顛倒（核心在金幣之前）', () => {
    expect(() => parseCost('核心 10／金幣 100,000')).toThrow(/必須在|順序/);
  });
  it('金幣不帶千分位（4位以上）', () => {
    expect(() => parseCost('金幣 8000')).toThrow(/千分位|逗號|格式/);
  });
  it('重複金幣欄位', () => {
    expect(() => parseCost('金幣 100,000／金幣 200,000')).toThrow(/重複|多次|無法解析/);
  });
});

// 太陽核心（遊戲 GoodsType `CORE_SOLAR`）是 v1.1.0 太陽骰子帶進來的第三種貨幣。
// 順序固定 金幣→核心→太陽核心，禁反序、禁重複——跟金幣／核心那一組同一套規則。
describe('parseCost 的太陽核心', () => {
  it('金幣搭太陽核心（太陽骰子 1501 的寫法）', () => {
    expect(parseCost('金幣 100,000／太陽核心 2,000')).toEqual({ cost: { core: 0, gold: 100000, mythic: { solar: 2000 } } });
  });

  it('三種貨幣一起出現', () => {
    expect(parseCost('金幣 50,000／核心 12／太陽核心 100'))
      .toEqual({ cost: { core: 12, gold: 50000, mythic: { solar: 100 } } });
  });

  // 金幣一律要千分位（四位數起跳，逗號是唯一讀得懂的寫法），太陽核心兩種都收——
  // 官方資料表這一欄兩種寫法都出現過，而它的現實值只有三、四位數。
  it('太陽核心的千分位逗號可有可無', () => {
    expect(parseCost('金幣 50,000／太陽核心 2000').cost.mythic?.['solar']).toBe(2000);
    expect(parseCost('金幣 50,000／太陽核心 2,000').cost.mythic?.['solar']).toBe(2000);
    expect(parseCost('金幣 50,000／太陽核心 100').cost.mythic?.['solar']).toBe(100);
  });

  it('顛倒順序被拒（太陽核心必須排最後）', () => {
    expect(() => parseCost('太陽核心 1／金幣 2')).toThrow(/必須|順序/);
    expect(() => parseCost('金幣 50,000／太陽核心 100／核心 12')).toThrow(/必須|順序/);
  });

  // ⚠️ 斷言指名「重複」這句話，不接受「無法解析」：`太陽核心 ` 的後綴是 `核心 `，重複計數
  // 少扣一次的話這個字串仍然會被正則擋下來，只是換一句看不懂的錯誤訊息——放行 /無法解析/
  // 等於這條測試永遠不會紅。
  it('重複的太陽核心欄位被拒', () => {
    expect(() => parseCost('金幣 50,000／太陽核心 100／太陽核心 200')).toThrow(/重複/);
  });

  // 「核心開頭不可搭配其他」是既有規則，不因為多了一種貨幣而放寬：遊戲裡沒有這個組合，
  // 放行等於憑空多出一種沒有資料撐腰的合法寫法。
  it('核心開頭仍然不可搭配太陽核心', () => {
    expect(() => parseCost('核心 5／太陽核心 100')).toThrow(/必須|順序/);
  });

  it('太陽核心超過上限會被擋', () => {
    expect(() => parseCost('金幣 50,000／太陽核心 999,999')).toThrow(/上限/);
  });

  // 沒有超越核心的節點**不帶 mythic 欄位**（不是空物件、也不是 `solar: 0`）：tree.json 裡
  // 241 顆有 239 顆是這個形狀，多一個欄位就是白佔 gzip 預算（見 Cost 的說明）。
  it('沒有超越核心的字串不帶 mythic 欄位', () => {
    expect(parseCost('金幣 100,000／核心 10').cost).not.toHaveProperty('mythic');
    expect(parseCost('核心 5').cost).not.toHaveProperty('mythic');
    expect(mythicAmount(parseCost('核心 5').cost, 'solar')).toBe(0);
  });

  // 寫成 0 的超越核心跟沒寫一樣——mythic 的正規形是「裡面的值都 > 0」。
  it('太陽核心 0 等於沒寫', () => {
    expect(parseCost('金幣 1,000／太陽核心 0').cost).toEqual({ core: 0, gold: 1000 });
  });

  it('沒登記的超越核心名稱整串拒絕，不會變成 0', () => {
    expect(() => parseCost('金幣 1,000／月亮核心 5')).toThrow(/未登記的超越核心「月亮核心」/);
  });
});

describe('parseCost 的數值上限', () => {
  it('核心超過上限會被擋', () => {
    expect(() => parseCost('核心 99999')).toThrow(/上限/);
  });

  it('金幣超過上限會被擋', () => {
    expect(() => parseCost('金幣 999,999,999')).toThrow(/上限/);
  });

  it('大到失去精度的數字會被擋——不然全樹成本會安靜地算錯', () => {
    expect(() => parseCost('核心 99999999999999999999')).toThrow(/安全整數|上限/);
  });

  it('正常範圍照常通過', () => {
    expect(parseCost('核心 66').cost).toEqual({ core: 66, gold: 0 });
    expect(parseCost('金幣 23,000／核心 5').cost).toEqual({ core: 5, gold: 23000 });
  });
});

describe('cumulativeUpgradeCost / upgradeTableApplies', () => {
  const table: UpgradeCostTable = JSON.parse(readFileSync('data/upgrade-cost.json', 'utf8'));

  it('練滿 50 級的累計花費與資料表的累計欄一致', () => {
    // RD2 資料表「技能升級花費」分頁第 53 列：累計金幣 465,700／累計核心 99
    expect(cumulativeUpgradeCost(table, 50)).toEqual({ gold: 465700, core: 99 });
  });
  it('1 級就是解鎖那一次，金額等於符文 data-cost 的首級金幣', () => {
    expect(cumulativeUpgradeCost(table, 1)).toEqual({ gold: 2000, core: 0 });
  });
  it('中途等級照樣累加（第 6 級開始才吃核心）', () => {
    expect(cumulativeUpgradeCost(table, 5)).toEqual({ gold: 5200, core: 0 });
    expect(cumulativeUpgradeCost(table, 6)).toEqual({ gold: 6800, core: 1 });
  });
  it('表格涵蓋不到的等級回 null，不是回一個看起來很合理的部分和', () => {
    expect(cumulativeUpgradeCost(table, 51)).toBeNull();
    expect(cumulativeUpgradeCost(table, 0)).toBeNull();
    expect(cumulativeUpgradeCost(table, 1.5)).toBeNull();
  });
  it('只適用骰子符文的 50 級節點——玩家被動套不上', () => {
    expect(upgradeTableApplies(table, { type: 'rune', maxLevel: 50 })).toBe(true);
    // 玩家被動 1102「所有骰子傷害」也是 50 級，但單價是金幣 8,000 不是 2,000
    expect(upgradeTableApplies(table, { type: 'passive', maxLevel: 50 })).toBe(false);
    expect(upgradeTableApplies(table, { type: 'rune', maxLevel: 1 })).toBe(false);
    expect(upgradeTableApplies(null, { type: 'rune', maxLevel: 50 })).toBe(false);
  });
  // 表格的第 1 級就是解鎖那一次，所以判準是「玩家有沒有付這筆錢」而不是 unlockVia 的字面值。
  // 成就開門但仍要付費的節點（unlockPaid）付了，套得上；純成就／任務解鎖的沒付，套不上。
  it('unlockVia 不是 cost 時看 unlockPaid：有付錢就套得上，沒付錢就套不上', () => {
    expect(upgradeTableApplies(table, { type: 'rune', maxLevel: 50, unlockVia: 'achievement' })).toBe(false);
    expect(upgradeTableApplies(table, { type: 'rune', maxLevel: 50, unlockVia: 'achievement', unlockPaid: true })).toBe(true);
  });
});

// 超越核心的加減一律走 addCost／subCost（Cost.mythic 是選填的，直接相加編譯不過）。
// 正規形：mythic 裡的值都 > 0、鍵照 MYTHIC_CORES 的順序、一個都不剩就不帶欄位。
describe('addCost／subCost／costFromJson', () => {
  it('逐種相加，沒有超越核心的一方不影響結果', () => {
    expect(addCost({ core: 1, gold: 2 }, { core: 3, gold: 4 })).toEqual({ core: 4, gold: 6 });
    expect(addCost({ core: 0, gold: 1, mythic: { solar: 100 } }, { core: 1, gold: 0 }))
      .toEqual({ core: 1, gold: 1, mythic: { solar: 100 } });
    expect(addCost({ core: 0, gold: 0, mythic: { solar: 100 } }, { core: 0, gold: 0, mythic: { solar: 2000 } }))
      .toEqual({ core: 0, gold: 0, mythic: { solar: 2100 } });
  });

  it('相減歸零的超越核心整個拿掉，不留 0', () => {
    const r = subCost({ core: 5, gold: 10, mythic: { solar: 300 } }, { core: 1, gold: 5, mythic: { solar: 300 } });
    expect(r).toEqual({ core: 4, gold: 5 });
    expect(r).not.toHaveProperty('mythic');
  });

  it('zeroCost 每次回新物件', () => {
    expect(zeroCost()).toEqual({ core: 0, gold: 0 });
    expect(zeroCost()).not.toBe(zeroCost());
  });

  // CI 差異摘要拿 base 分支建出來的 tree.json 來比，改版當下 base 還是 1.1.0 的 `{core, gold, solar}`。
  it('costFromJson 讀得懂 1.1.0 的舊形狀，數字一律過濾', () => {
    const toInt = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0);
    expect(costFromJson({ core: 1842, gold: 7056000, solar: 2100 }, toInt)).toEqual({ core: 1842, gold: 7056000, mythic: { solar: 2100 } });
    expect(costFromJson({ core: 1, gold: 2, solar: 0 }, toInt)).toEqual({ core: 1, gold: 2 });
    expect(costFromJson({ core: 1, gold: 2, mythic: { solar: 5 } }, toInt)).toEqual({ core: 1, gold: 2, mythic: { solar: 5 } });
    expect(costFromJson({ core: '1', gold: -2, mythic: { solar: 'x' } }, toInt)).toEqual({ core: 0, gold: 0 });
    expect(costFromJson(null, toInt)).toEqual({ core: 0, gold: 0 });
  });

  it('mythicEntries 照登記順序、只列 > 0', () => {
    expect(mythicEntries({ core: 0, gold: 0, mythic: { solar: 5 } }).map(([d, n]) => [d.kind, n])).toEqual([['solar', 5]]);
    expect(mythicEntries({ core: 0, gold: 0 })).toEqual([]);
  });
});

// 每一種登記過的超越核心都要有圖（`costHtml()` 會引用 `/currency/<kind>.png`），
// 名稱要以「核心」結尾（`parseCost` 靠這個後綴做重複計數，見 cost.ts）。
describe('MYTHIC_CORES 登記表', () => {
  it('每一種都有貨幣圖、名稱以「核心」結尾、kind 與名稱都不撞號', () => {
    for (const d of MYTHIC_CORES) {
      expect(existsSync(`public/currency/${d.kind}.png`), d.kind).toBe(true);
      expect(d.label.endsWith('核心'), d.label).toBe(true);
      expect(d.kind).toMatch(/^[a-z][A-Za-z0-9]*$/);
    }
    expect(new Set(MYTHIC_CORES.map(d => d.kind)).size).toBe(MYTHIC_CORES.length);
    expect(new Set(MYTHIC_CORES.map(d => d.label)).size).toBe(MYTHIC_CORES.length);
  });
});

// 1.1.2 齒輪二階骰子帶進第二種超越核心：走的是同一條路，不是另寫一份。
describe('parseCost 的齒輪二階核心', () => {
  it('金幣搭齒輪二階核心（2503／2603 的寫法）', () => {
    expect(parseCost('金幣 100,000／齒輪二階核心 2,000').cost).toEqual({ core: 0, gold: 100000, mythic: { gearSecond: 2000 } });
    expect(parseCost('金幣 50,000／齒輪二階核心 100').cost).toEqual({ core: 0, gold: 50000, mythic: { gearSecond: 100 } });
  });

  // 遊戲一個節點只有一種 RankUpGoodsType：兩種超越核心同時出現不是合法成本。
  it('兩種超越核心不可同時出現', () => {
    expect(() => parseCost('金幣 1,000／太陽核心 1／齒輪二階核心 1')).toThrow(/重複/);
  });

  it('兩種加總時各自保留、照登記順序排', () => {
    const sum = addCost(parseCost('金幣 50,000／齒輪二階核心 100').cost, parseCost('金幣 50,000／太陽核心 100').cost);
    expect(Object.keys(sum.mythic!)).toEqual(['solar', 'gearSecond']);
    expect(sum).toEqual({ core: 0, gold: 100000, mythic: { solar: 100, gearSecond: 100 } });
  });
});
