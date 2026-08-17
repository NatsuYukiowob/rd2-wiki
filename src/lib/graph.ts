import type { Cost, Edge, TreeNode } from './types.js';

/**
 * 從邊清單建構雙向鄰接表。
 *
 * 邊的方向語意：`edges[i] = [前置節點, 被解鎖節點]`
 * - `children.get(id)` 回傳解了這個節點之後能直接解的節點列表（後繼）
 * - `parents.get(id)` 回傳要解這個節點之前必須先解的節點列表（前置）
 *
 * @param edges 有向邊陣列，格式 `[from, to]` 其中 `from` 是前置、`to` 是被解鎖的節點
 * @returns 物件包含兩個鄰接表：`parents`（前置節點對映）與 `children`（後繼節點對映）
 */
export function buildAdjacency(edges: Edge[]): { parents: Map<string, string[]>; children: Map<string, string[]> } {
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  for (const [from, to] of edges) {
    if (!children.has(from)) children.set(from, []);
    children.get(from)!.push(to);
    if (!parents.has(to)) parents.set(to, []);
    parents.get(to)!.push(from);
  }
  return { parents, children };
}

/**
 * 在給定的節點集合中尋找入度為 0 的根節點。
 *
 * @param ids 節點 id 陣列
 * @param parents 前置節點對映（由 `buildAdjacency` 產生）
 * @returns 入度為 0 的節點 id 陣列
 */
export function findRoots(ids: string[], parents: Map<string, string[]>): string[] {
  return ids.filter(id => (parents.get(id) ?? []).length === 0);
}

/**
 * 取得某節點的前置鏈（所有祖先的聯集，含節點本身）。
 *
 * 前置鏈的定義：目標節點在 DAG 上所有祖先的聯集，**包含目標節點自己**、去重。
 * 多重前置一律視為 AND（全部都要解）。
 * 使用 visited 集合防環，即使圖資料損壞包含環，遍歷也會在 O(V) 時間內終止。
 *
 * @param id 目標節點 id
 * @param parents 前置節點對映（由 `buildAdjacency` 產生）
 * @returns 包含目標節點及所有祖先的 Set（去重）
 */
export function prerequisiteChain(id: string, parents: Map<string, string[]>): Set<string> {
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const p of parents.get(cur) ?? []) stack.push(p);
  }
  return seen;
}

/**
 * 在圖中偵測環。
 *
 * 使用 DFS 搭配狀態機（0＝未訪、1＝訪中、2＝已完），可在 O(V+E) 時間內完成。
 * 若發現環，回傳環上的節點序列；否則回傳 null。
 *
 * @param ids 要檢查的節點 id 陣列
 * @param children 後繼節點對映（由 `buildAdjacency` 產生）
 * @returns 若無環回傳 null；若有環回傳環上節點的有序序列（含起點重複）
 */
export function detectCycle(ids: string[], children: Map<string, string[]>): string[] | null {
  const state = new Map<string, 0 | 1 | 2>();
  const path: string[] = [];
  const visit = (id: string): string[] | null => {
    const s = state.get(id) ?? 0;
    if (s === 1) return [...path.slice(path.indexOf(id)), id];
    if (s === 2) return null;
    state.set(id, 1);
    path.push(id);
    for (const c of children.get(id) ?? []) {
      const found = visit(c);
      if (found) return found;
    }
    path.pop();
    state.set(id, 2);
    return null;
  };
  for (const id of ids) {
    const found = visit(id);
    if (found) return found;
  }
  return null;
}

/**
 * 找出無法從任何根節點到達的孤兒節點。
 *
 * @param roots 根節點 id 陣列
 * @param ids 待檢查的節點 id 陣列
 * @param children 後繼節點對映（由 `buildAdjacency` 產生）
 * @returns 無法從 roots 任何一個到達的節點 id 陣列
 */
export function unreachableFrom(roots: string[], ids: string[], children: Map<string, string[]>): string[] {
  const seen = new Set<string>();
  const stack = [...roots];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const c of children.get(cur) ?? []) stack.push(c);
  }
  return ids.filter(id => !seen.has(id));
}

/**
 * 對前置鏈中的節點加總解鎖成本。
 *
 * 只計入 `unlockVia === 'cost'` 的節點（即玩家需要花錢解鎖的）。
 * 任務獎勵或預設解鎖的節點會被排除，並在 `skipped` 陣列中回報。
 *
 * @param ids 待加總的節點 id 迭代器
 * @param byId 節點 id 對映到節點資料的 Map
 * @returns 物件包含：`cost` 為聚合成本、`skipped` 為被排除的節點 id 陣列
 */
export function sumUnlockCost(ids: Iterable<string>, byId: Map<string, TreeNode>): { cost: Cost; skipped: string[] } {
  const cost: Cost = { core: 0, gold: 0 };
  const skipped: string[] = [];
  for (const id of ids) {
    const n = byId.get(id);
    if (!n) continue;
    if (n.unlockVia !== 'cost') { skipped.push(id); continue; }
    cost.core += n.unlockCost.core;
    cost.gold += n.unlockCost.gold;
  }
  return { cost, skipped };
}
