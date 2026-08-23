// 玩家被動／支援的升級費用查表。
//
// 三種來源在這裡收斂成同一個形狀（逐級表）：骰子符文 50 級走 tree.json 的 meta.upgradeCostTable、
// 4303 走特例表、玩家被動與支援走 6 個 tier。呼叫端只要 levelTableFor() ＋ upgradeExtraCost()
// 兩步，不必知道這顆節點的費用是從哪一張表來的。
import type { Cost, LevelCost, NodeType, PassiveUpgradeCost, UnlockVia, UpgradeCostTable, UpgradeTier } from './types.js';

/** tierKeyOf 與 levelTableFor 需要的節點欄位，刻意收窄成這幾個好讓測試不必造整顆 TreeNode。 */
type CostNode = {
  id: string;
  type: NodeType;
  maxLevel: number;
  unlockCost: Cost;
  unlockVia?: UnlockVia;
  unlockPaid?: true;
};

/**
 * 把區間展開成逐級表（Lv.2 ~ maxLevel）。
 *
 * 缺級與重疊都當場丟錯，不做寬容處理：這張表是社群改得到的 JSON，而少一段 band 的後果是
 * 那幾級在累加時被安靜跳過——畫面上「這一級免費」跟「這一級的資料不見了」長得一模一樣。
 */
export function expandTier(tier: UpgradeTier): LevelCost[] {
  const rows: LevelCost[] = [];
  let expect = 2;
  for (const b of [...tier.bands].sort((x, y) => x.from - y.from)) {
    if (b.from !== expect) throw new Error(`升級區間必須連續：Lv.${expect} 之後接到的是 Lv.${b.from}`);
    if (b.to < b.from) throw new Error(`升級區間的 to 不可小於 from：${b.from}~${b.to}`);
    for (let lv = b.from; lv <= b.to; lv++) rows.push({ level: lv, gold: b.gold, core: lv === b.from ? b.core : 0 });
    expect = b.to + 1;
  }
  if (expect !== tier.maxLevel + 1) {
    throw new Error(`升級區間必須涵蓋到 Lv.${tier.maxLevel}，實際只到 Lv.${expect - 1}`);
  }
  return rows;
}

/**
 * 這顆節點屬於哪個 tier？找不到回 null。
 *
 * 判準是 `(maxLevel, 解鎖金幣)`——官方表格自己就是用這兩個值把 75 個共通節點分成 6 類的，
 * 拿去對 tree.json 是 40/40 全中、零遺漏零多餘（2026-08-23 驗過）。
 *
 * 兩道護欄，理由跟 `upgradeTableApplies()` 那兩道一樣：
 * (1) 只認 passive／support——一顆剛好也是 `(10, 12000)` 的符文套上去會算出一個看起來很專業的錯數字；
 * (2) 只認真的付過解鎖費用的節點——表格的解鎖那一格就是玩家付的那筆錢，預設／任務解鎖的節點
 *     根本沒付過，拿它的 `unlockCost.gold` 當 key 在語意上就不成立。
 */
export function tierKeyOf(node: CostNode, tables: PassiveUpgradeCost): string | null {
  if (node.type !== 'passive' && node.type !== 'support') return null;
  if (node.unlockVia !== undefined && node.unlockVia !== 'cost' && !node.unlockPaid) return null;
  for (const [key, tier] of Object.entries(tables.tiers)) {
    if (tier.maxLevel === node.maxLevel && tier.unlockGold === node.unlockCost.gold) return key;
  }
  return null;
}

/**
 * 找出這顆節點適用的逐級升級表；不可升級或查不到表時回 null。
 *
 * 回 null 而不是空陣列或 0：「這顆練不了」跟「練到頂是免費的」在畫面上必須是兩件事
 * （同 `cumulativeUpgradeCost()` 的取捨）。
 */
export function levelTableFor(
  node: CostNode,
  tables: PassiveUpgradeCost,
  runeTable: UpgradeCostTable | null,
): LevelCost[] | null {
  if (node.maxLevel <= 1) return null;

  const special = tables.special[node.id];
  // 特例表以 id 為鍵，所以要多驗一次等級上限：那顆節點的 maxLevel 哪天被官方改了，
  // 靜靜沿用舊表會讓超出的那幾級花費憑空消失。
  if (special) return special.maxLevel === node.maxLevel ? special.levels : null;

  if (runeTable && runeTable.appliesTo.type === node.type && runeTable.appliesTo.maxLevel === node.maxLevel) {
    return runeTable.levels;
  }

  const key = tierKeyOf(node, tables);
  return key ? expandTier(tables.tiers[key]!) : null;
}

/**
 * Lv.1 → `toLevel` 的**追加**花費（不含解鎖那一筆）。表格涵蓋不到 `toLevel` 時回 null。
 *
 * ⚠️ 一律跳過 `level 1`：符文表自己帶著它（金額與符文節點的 `unlockCost` 相同，規則 15 對過的
 * 就是這兩者），不跳過的話每顆符文的解鎖費用會被算兩次。
 */
export function upgradeExtraCost(levels: LevelCost[], toLevel: number): Cost | null {
  if (!Number.isInteger(toLevel) || toLevel < 1) return null;
  const cost: Cost = { core: 0, gold: 0 };
  for (let lv = 2; lv <= toLevel; lv++) {
    const row = levels.find(r => r.level === lv);
    if (!row) return null;
    cost.core += row.core;
    cost.gold += row.gold;
  }
  return cost;
}
