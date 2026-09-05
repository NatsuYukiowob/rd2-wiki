// 選取一個節點後，算出它的前置鏈與對應的成本合計，供詳情面板（NodeDetail.ts）顯示。
// 前置鏈的定義、AND 語意、防環、排除非 cost 解鎖節點都已經在 graph.ts 做完（見 spec §6.4），
// 這裡不重寫任何圖遍歷邏輯，只是把兩者組成畫面需要的形狀。
import { buildAdjacency, prerequisiteChain, requiredPrereqRanks, sumUnlockCost } from './graph.js';
import { levelTableFor, upgradeExtraCost } from './upgrade-tiers.js';
import type { Cost, PassiveUpgradeCost, TreeData } from './types.js';

/**
 * 前置鏈上一條「某個祖先要先練到某等級」的條件，以及達成它要多花的錢。
 *
 * `cost` 是 Lv.1 → `rank` 的**追加**費用（不含那顆節點自己的解鎖費，那一筆已經在
 * `Selection.cost` 裡）。查不到費用表時是 `null`——**不可以當 0**：面板要寫「成本未確認」，
 * 「這一段免費」跟「這一段算不出來」在畫面上必須是兩件事（同 `cumulativeUpgradeCost()`
 * 回 null 的理由）。
 */
export interface PrereqRankCost {
  /** 要被練起來的那顆前置節點的 id。 */
  id: string;
  /** 它的名稱。面板印的是名字——玩家看不懂 `1201`。 */
  name: string;
  /** 要達到的等級。 */
  rank: number;
  /** Lv.1 → `rank` 的追加費用；查不到費用表時是 null。 */
  cost: Cost | null;
}

export interface Selection {
  /** 目標節點在 DAG 上所有祖先的聯集，含目標節點本身、去重（spec §6.4）。 */
  chain: Set<string>;
  /** 前置鏈上各節點解鎖成本的加總（已排除玩家不必付錢的節點）。 */
  cost: Cost;
  /** 前置鏈中被排除在成本合計外的節點 id（任務解鎖或預設解鎖）。 */
  skipped: string[];
  /**
   * 因為鏈上有「可直接領、無視骰子樹前置」的節點（`bypassPrereq`）而整條不必解的祖先數。
   *
   * 面板拿它印「已跳過 N 個前置」。**不是** `skipped` 的同義詞：`skipped` 講的是「這顆在鏈上
   * 但不用付錢」，這個講的是「這幾顆根本不在鏈上了」——少了這一行，玩家只會看到前置鏈莫名其妙
   * 從 4 個節點變成 2 個，畫面上沒有任何地方解釋為什麼。
   */
  bypassed: number;
  /**
   * 前置鏈上「可直接領」（`bypassPrereq`）的節點數——也就是畫面上有幾條虛線邊通往鏈裡。
   *
   * ⚠️ **跟 `bypassed` 是兩回事，不可以互相代用。** 跳過的祖先常常從另一條路回到鏈上：
   * 5005 變異骰子的前置是 5006 與 5103，而 5103 的祖先鏈就是 5002 → 5007 → 5103，
   * 所以 `bypassed` 是 0（一個都沒省到）而 `bypassNodes` 是 1（虛線邊仍在鏈上、仍被高亮成金色）。
   * 全站有 11 個節點落在這個狀態，虛線的說明綁在 `bypassed` 上的話它們會出現「一條金色虛線，
   * 畫面上沒有任何地方解釋它」。
   */
  bypassNodes: number;
  /**
   * 前置鏈中「符合前置鏈但被目前篩選條件隱藏」的節點數。
   * 本函式只讀 tree.json 的資料，不知道畫面上的篩選狀態（分支／類型／搜尋，見後續任務），
   * 一律回傳 0；呼叫端（tree-canvas.ts）比對 DOM 上的篩選 class 後自行覆寫這個欄位。
   */
  hiddenByFilter: number;
  /**
   * 前置鏈上的「必要練等」：某顆祖先要先練到某等級，這條鏈才走得通（`TreeNode.prereqRanks`）。
   * 依 id 排序，沒有條件時是空陣列——現況全站只有太陽骰子（1501）要求 1201 練滿 Lv.50。
   */
  prereqRanks: PrereqRankCost[];
  /** 上面那些練等費用的加總。**成本未確認（`cost === null`）的那幾筆不計入**。 */
  prereqRankCost: Cost;
  /**
   * `cost` ＋ `prereqRankCost`＝這條鏈真正的總價。面板上那個大數字用的是它。
   *
   * 刻意跟 `cost` 分開兩個欄位而不是把練等併進 `cost`：面板要把「解鎖前置」與「前置練等」
   * 分開講（46 萬金幣裡有 78% 是拿去練 1201 的，混成一個數字玩家看不出來），而
   * `cost` 的語意「鏈上各節點解鎖成本的加總」在別處還有人用。
   */
  totalCost: Cost;
}

/**
 * 算出選取節點的前置鏈、成本合計與被排除的節點清單。
 *
 * @param tables 玩家被動／支援與特例節點的升級費用表（`data/passive-upgrade-cost.json`）。
 *   只有「前置練等」那一段用得到，但**刻意必填**：傳一份空表進來的話 `levelTableFor()` 會讓
 *   1601 這種「在 special 裡的 50 級符文」掉回通用符文表，算出一個看起來很專業的錯數字，
 *   而畫面上完全沒有東西說話（同 NodeDetail 那段「練滿累計」的理由）。
 */
export function computeSelection(id: string, data: TreeData, tables: PassiveUpgradeCost): Selection {
  const { parents } = buildAdjacency(data.edges);
  const byId = new Map(data.nodes.map(n => [n.id, n]));
  const bypass = new Set(data.nodes.filter(n => n.bypassPrereq).map(n => n.id));
  const chain = prerequisiteChain(id, parents, bypass);
  const { cost, skipped } = sumUnlockCost(chain, byId);
  // 「被跳掉幾個」用兩次遍歷相減算，而不是在 prerequisiteChain 裡順便數：那條函式的祖先是
  // 圖遍歷的結果，同一個祖先可能從兩條路徑走到，邊走邊數會重複計算。集合大小的差是去重後的。
  const bypassed = bypass.size > 0 ? prerequisiteChain(id, parents).size - chain.size : 0;
  const bypassNodes = [...chain].filter(x => bypass.has(x)).length;

  // 必要練等。⚠️ 掃的是整條鏈而不是選到的那一顆，見 requiredPrereqRanks() 的說明。
  const prereqRankCost: Cost = { core: 0, gold: 0, solar: 0 };
  const prereqRanks: PrereqRankCost[] = [...requiredPrereqRanks(chain, byId)]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([prereqId, rank]) => {
      const node = byId.get(prereqId);
      if (!node) return [];
      const table = levelTableFor(node, tables, data.meta.upgradeCostTable);
      const extra = table ? upgradeExtraCost(table, rank) : null;
      if (extra) {
        prereqRankCost.core += extra.core;
        prereqRankCost.gold += extra.gold;
        prereqRankCost.solar += extra.solar;
      }
      return [{ id: prereqId, name: node.name, rank, cost: extra }];
    });

  return {
    chain, cost, skipped, bypassed, bypassNodes, hiddenByFilter: 0,
    prereqRanks,
    prereqRankCost,
    totalCost: {
      core: cost.core + prereqRankCost.core,
      gold: cost.gold + prereqRankCost.gold,
      solar: cost.solar + prereqRankCost.solar,
    },
  };
}
