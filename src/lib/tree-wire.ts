// tree.json 的「傳輸形狀」與站台用的 TreeData 之間的轉換（issue #63 方案 A）。
//
// tree.json 的 gzip 硬上限是 20 KB（build-data.test.ts），而原本的形狀有兩塊純重複：
//   1. `label`：241 顆裡 181 顆跟 `name` 一字不差（-0.8 KB gzip）→ 只在不同時才寫，讀回來退回 name。
//   2. `icon`：12 碼雜湊在節點上寫一次、在 meta.sprite.index 的鍵上又寫一次；雜湊是亂數，gzip 壓不動
//      （-1.2 KB gzip）→ 雜湊只留在 meta.sprite.icons 陣列裡一次，節點改帶陣列索引。
//
// ⚠️ 所有讀 tree.json 的地方都必須經過 decodeTree（站台走 src/lib/tree-data.ts，測試與工具直接呼叫）。
// 直接 `JSON.parse` 拿到的是傳輸形狀，`n.label` 會是 undefined、`n.icon` 會是數字——型別擋得住
// `import`，擋不住 `JSON.parse(...) as TreeData`。
//
// decodeTree 也吃舊形狀（icon 是字串、有 sprite.index）：CI 的 diff-summary 拿 base 分支建出來的
// tree.json 跟 head 比，改版當下 base 還是舊形狀。
import type { TreeData, TreeMeta, TreeNode } from './types.js';

type Cell = [number, number, number, number];
export type TreeNodeWire = Omit<TreeNode, 'label' | 'icon'> & { label?: string; icon: number };
export type TreeMetaWire = Omit<TreeMeta, 'sprite'> & {
  sprite: { url: string; size: [number, number]; icons: string[]; cells: Cell[] };
};
export interface TreeWire { meta: TreeMetaWire; nodes: TreeNodeWire[]; edges: TreeData['edges'] }

export function encodeTree(data: TreeData): TreeWire {
  const { index, ...sprite } = data.meta.sprite;
  // 排序讓索引與 index 物件的插入順序無關，同一份資料永遠產出同樣的位元組（CI 比 sha256）。
  const icons = Object.keys(index).sort();
  const pos = new Map(icons.map((h, i) => [h, i]));
  const nodes = data.nodes.map(n => {
    const i = pos.get(n.icon);
    if (i === undefined) throw new Error(`節點 ${n.id} 的圖示 ${n.icon} 不在 sprite 裡`);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(n)) {
      if (k === 'label') { if (v !== n.name) out.label = v; continue; }
      out[k] = k === 'icon' ? i : v;
    }
    return out as TreeNodeWire;
  });
  return { meta: { ...data.meta, sprite: { ...sprite, icons, cells: icons.map(h => index[h]!) } }, nodes, edges: data.edges };
}

/** 傳輸形狀（或舊形狀）→ TreeData。欄位順序還原成 buildTreeData 的順序，JSON.stringify 比對才不會誤報。 */
export function decodeTree(raw: unknown): TreeData {
  const w = raw as { meta: { sprite: Record<string, unknown> } & Record<string, unknown>; nodes: Record<string, unknown>[]; edges: TreeData['edges'] };
  const s = w.meta.sprite;
  if (!Array.isArray(s.icons)) return raw as TreeData; // 舊形狀：本來就是 TreeData
  const icons = s.icons as string[];
  const cells = s.cells as Cell[];
  const { icons: _i, cells: _c, ...sprite } = s;
  const nodes = w.nodes.map(n => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(n)) {
      if (k === 'label') continue;
      if (k === 'icon') {
        const h = icons[v as number];
        if (h === undefined) throw new Error(`節點 ${String(n.id)} 的圖示索引 ${String(v)} 超出範圍`);
        out.icon = h;
      } else out[k] = v;
      if (k === 'name') out.label = (n.label as string | undefined) ?? v;
    }
    return out as unknown as TreeNode;
  });
  const index = Object.fromEntries(icons.map((h, i) => [h, cells[i]!]));
  return { meta: { ...w.meta, sprite: { ...sprite, index } } as TreeMeta, nodes, edges: w.edges };
}
