// tree.json 的「傳輸形狀」與站台用的 TreeData 之間的轉換（issue #63）。
//
// 建置產物是兩個檔（方案 B）：
//   - `tree.json`：畫樹、搜尋、計算要的全部欄位，瀏覽器一進頁面就要有，20 KB gzip 預算守的是它。
//   - `tree-text.json`：只有打開詳情卡片才看得到的文字（每顆節點的 description／awakening、
//     meta.glossary），瀏覽器端另外載（見 src/lib/tree-client.ts）。
//
// 傳輸形狀另外去掉兩塊純重複（方案 A）：
//
// tree.json 的 gzip 硬上限是 20 KB（build-data.test.ts），而原本的形狀有兩塊純重複：
//   1. `label`：241 顆裡 181 顆跟 `name` 一字不差（-0.8 KB gzip）→ 只在不同時才寫，讀回來退回 name。
//   2. `icon`：12 碼雜湊在節點上寫一次、在 meta.sprite.index 的鍵上又寫一次；雜湊是亂數，gzip 壓不動
//      （-1.2 KB gzip）→ 雜湊只留在 meta.sprite.icons 陣列裡一次，節點改帶陣列索引。
//
// ⚠️ 所有讀 tree.json 的地方都必須經過 decodeTree（建置期頁面走 src/lib/tree-data.ts，瀏覽器腳本走
// src/lib/tree-client.ts，測試與工具直接呼叫）。直接 `JSON.parse` 拿到的是傳輸形狀，`n.label` 會是
// undefined、`n.icon` 會是數字、`n.description` 不存在——型別擋得住 `import`，擋不住
// `JSON.parse(...) as TreeData`。
//
// decodeTree 也吃舊形狀（icon 是字串、有 sprite.index；或文字還沒拆出去的單檔）：CI 的 diff-summary
// 拿 base 分支建出來的 tree.json 跟 head 比，改版當下 base 還是舊形狀。
import type { TreeData, TreeMeta, TreeNode } from './types.js';

type Cell = [number, number, number, number];
export type TreeNodeWire = Omit<TreeNode, 'label' | 'icon' | 'description' | 'awakening'> & { label?: string; icon: number };
export type TreeMetaWire = Omit<TreeMeta, 'sprite' | 'glossary'> & {
  sprite: { url: string; size: [number, number]; icons: string[]; cells: Cell[] };
};
export interface TreeWire { meta: TreeMetaWire; nodes: TreeNodeWire[]; edges: TreeData['edges'] }
/** tree-text.json 的形狀。`description` 與 tree.json 的 `nodes` 同序；`awakening` 只有骰子有，用 id 當鍵。 */
export interface TreeTextWire {
  glossary: TreeMeta['glossary'];
  description: string[];
  awakening: Record<string, string>;
}

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
      if (k === 'description' || k === 'awakening') continue;
      if (k === 'label') { if (v !== n.name) out.label = v; continue; }
      out[k] = k === 'icon' ? i : v;
    }
    return out as TreeNodeWire;
  });
  const { glossary: _g, ...meta } = data.meta;
  return { meta: { ...meta, sprite: { ...sprite, icons, cells: icons.map(h => index[h]!) } }, nodes, edges: data.edges };
}

export function encodeTreeText(data: TreeData): TreeTextWire {
  return {
    glossary: data.meta.glossary,
    description: data.nodes.map(n => n.description),
    awakening: Object.fromEntries(data.nodes.flatMap(n => (n.awakening ? [[n.id, n.awakening]] : []))),
  };
}

function assertSameBuild(text: TreeTextWire, nodeCount: number): void {
  if (text.description.length !== nodeCount) {
    throw new Error(`tree-text.json 有 ${text.description.length} 筆描述，tree.json 有 ${nodeCount} 顆節點，不是同一次建置的產物`);
  }
}

/**
 * 把文字包就地補進「只用 tree.json 還原」的 TreeData（瀏覽器端文字包晚到時用）。
 * 節點數對不上代表兩個檔不是同一次建置的產物，補進去只會把描述貼到別顆節點上。
 */
export function applyTreeText(data: TreeData, text: TreeTextWire): void {
  assertSameBuild(text, data.nodes.length);
  data.nodes.forEach((n, i) => {
    n.description = text.description[i]!;
    const a = text.awakening[n.id];
    if (a) n.awakening = a;
  });
  data.meta.glossary = text.glossary;
}

/**
 * 傳輸形狀（或舊形狀）→ TreeData。欄位順序還原成 buildTreeData 的順序，JSON.stringify 比對才不會誤報。
 *
 * `text` 是 tree-text.json 的內容。不給的話 description 是空字串、沒有 awakening、glossary 是空物件
 * （瀏覽器端文字包還沒到的樣子，之後用 applyTreeText 補）；tree.json 自己就帶文字的舊單檔形狀不受影響。
 */
export function decodeTree(raw: unknown, text?: TreeTextWire): TreeData {
  const w = raw as { meta: { sprite: Record<string, unknown> } & Record<string, unknown>; nodes: Record<string, unknown>[]; edges: TreeData['edges'] };
  // 認不出是傳輸形狀（舊形狀，或缺 meta／sprite／nodes 的任何東西）就原樣交回：
  // 判斷「這還是不是一棵樹」是呼叫端的事（diff-summary 的 looksLikeTree → schemaChanged），
  // 這裡丟錯會把那層防護整個跳過（code review #68）。
  const s = w?.meta?.sprite;
  if (!s || !Array.isArray(s.icons) || !Array.isArray(s.cells) || !Array.isArray(w.nodes)) return raw as TreeData;
  const icons = s.icons as string[];
  const cells = s.cells as Cell[];
  const { icons: _i, cells: _c, ...sprite } = s;
  if (text) assertSameBuild(text, w.nodes.length);
  const nodes = w.nodes.map((n, at) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(n)) {
      if (k === 'label') continue;
      if (k === 'icon') {
        const h = icons[v as number];
        if (h === undefined) throw new Error(`節點 ${String(n.id)} 的圖示索引 ${String(v)} 超出範圍`);
        out.icon = h;
      } else out[k] = v;
      if (k === 'name') out.label = (n.label as string | undefined) ?? v;
      // buildTreeData 把 description／awakening 排在 upgradeCost 後面；文字拆出去之後在同一個位置補回來。
      if (k === 'upgradeCost' && !('description' in n)) {
        out.description = text?.description[at] ?? '';
        const a = text?.awakening[n.id as string];
        if (a) out.awakening = a;
      }
    }
    return out as unknown as TreeNode;
  });
  const index = Object.fromEntries(icons.map((h, i) => [h, cells[i]!]));
  const meta: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(w.meta)) {
    meta[k] = k === 'sprite' ? { ...sprite, index } : v;
    // 同理：glossary 在 buildTreeData 的 meta 裡排在 totalUnlockCost 後面。
    if (k === 'totalUnlockCost' && !('glossary' in w.meta)) meta.glossary = text?.glossary ?? {};
  }
  return { meta: meta as unknown as TreeMeta, nodes, edges: w.edges };
}
