// /board 讀 /sim 存檔用的精簡 context。
//
// deserializeSim() 要的只有圖結構（前置、起始／可選初始骰子、等級條件）與每顆節點的等級上限，但完整的
// SimContext 要整份 tree.json（gzip 約 18 KB）＋費用表才建得出來。這裡在建置期把那幾張表壓成索引編碼
// 嵌進 /board（節點 id 只出現一次，其餘欄位用陣列索引指它），瀏覽器端還原成 SaveContext 再交給
// 同一支 deserializeSim()——改版漂移（節點移除、上限調低、前置不齊、新增等級條件）仍然只在那裡處理一次，
// /board 不另寫一份存檔解讀。
import type { SaveContext, SimContext } from './sim.js';

export interface SaveContextWire {
  /** 全部節點 id（排序過）；其餘欄位用這份陣列的索引指節點。 */
  ids: string[];
  free: number[];
  optional: number[];
  /** [節點索引, 等級上限]，只列上限 > 1 的。 */
  caps: [number, number][];
  /** [節點索引, 前置的索引[]]，只列有前置的。 */
  parents: [number, number[]][];
  /** [祖先索引, [要求它的節點索引, 等級][]]。 */
  rankHolders: [number, [number, number][]][];
}

export function encodeSaveContext(ctx: SimContext): SaveContextWire {
  const ids = [...ctx.byId.keys()].sort();
  const at = new Map(ids.map((id, i) => [id, i]));
  const ix = (id: string): number => {
    const i = at.get(id);
    if (i === undefined) throw new Error(`精簡 context：${id} 不在節點清單裡`);
    return i;
  };
  return {
    ids,
    free: [...ctx.free].map(ix).sort((a, b) => a - b),
    optional: [...ctx.optional].map(ix).sort((a, b) => a - b),
    caps: ids.flatMap((id, i): [number, number][] => {
      const c = ctx.caps.get(id) ?? 1;
      return c > 1 ? [[i, c]] : [];
    }),
    parents: ids.flatMap((id, i): [number, number[]][] => {
      const ps = ctx.parents.get(id) ?? [];
      return ps.length > 0 ? [[i, ps.map(ix)]] : [];
    }),
    rankHolders: [...ctx.rankHolders]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, hs]): [number, [number, number][]] => [ix(id), hs.map((h): [number, number] => [ix(h.id), h.rank])]),
  };
}

export function decodeSaveContext(w: SaveContextWire): SaveContext {
  const id = (i: number): string => {
    const x = w.ids[i];
    if (x === undefined) throw new Error(`精簡 context：索引 ${i} 超出節點清單`);
    return x;
  };
  return {
    byId: new Map(w.ids.map(x => [x, { id: x }])),
    free: new Set(w.free.map(id)),
    optional: new Set(w.optional.map(id)),
    caps: new Map(w.caps.map(([i, c]) => [id(i), c])),
    parents: new Map(w.parents.map(([i, ps]) => [id(i), ps.map(id)])),
    rankHolders: new Map(w.rankHolders.map(([i, hs]) => [id(i), hs.map(([h, rank]) => ({ id: id(h), rank }))])),
  };
}
