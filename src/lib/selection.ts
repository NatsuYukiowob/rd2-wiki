// 選取一個節點後，算出它的前置鏈與對應的成本合計，供詳情面板（NodeDetail.ts）顯示。
// 前置鏈的定義、AND 語意、防環、排除非 cost 解鎖節點都已經在 graph.ts 做完（見 spec §6.4），
// 這裡不重寫任何圖遍歷邏輯，只是把兩者組成畫面需要的形狀。
import { buildAdjacency, prerequisiteChain, sumUnlockCost } from './graph.js';
import type { Cost, TreeData } from './types.js';

export interface Selection {
  /** 目標節點在 DAG 上所有祖先的聯集，含目標節點本身、去重（spec §6.4）。 */
  chain: Set<string>;
  /** 前置鏈上各節點解鎖成本的加總（已排除 unlockVia !== 'cost' 的節點）。 */
  cost: Cost;
  /** 前置鏈中被排除在成本合計外的節點 id（任務解鎖或預設解鎖）。 */
  skipped: string[];
  /**
   * 前置鏈中「符合前置鏈但被目前篩選條件隱藏」的節點數。
   * 本函式只讀 tree.json 的資料，不知道畫面上的篩選狀態（分支／類型／搜尋，見後續任務），
   * 一律回傳 0；呼叫端（tree-canvas.ts）比對 DOM 上的篩選 class 後自行覆寫這個欄位。
   */
  hiddenByFilter: number;
}

/** 算出選取節點的前置鏈、成本合計與被排除的節點清單。 */
export function computeSelection(id: string, data: TreeData): Selection {
  const { parents } = buildAdjacency(data.edges);
  const byId = new Map(data.nodes.map(n => [n.id, n]));
  const chain = prerequisiteChain(id, parents);
  const { cost, skipped } = sumUnlockCost(chain, byId);
  return { chain, cost, skipped, hiddenByFilter: 0 };
}
