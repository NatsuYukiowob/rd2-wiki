// 搜尋、篩選狀態與網址狀態同步（spec §6.3）。
//
// 這支檔案只算「純邏輯」——一個節點在給定的篩選狀態下算不算符合、狀態怎麼序列化成
// query string——不碰任何 DOM。真正把結果套到畫面上（切 .filtered-out class、
// 讀寫 checkbox/搜尋框、呼叫 history.replaceState）是呼叫端（src/scripts/tree-canvas.ts）
// 的事，理由跟 selection.ts 一樣：邏輯與 DOM 分離，這支檔案才能在沒有瀏覽器的環境下
// 用單元測試完整驗證。
import type { Branch, NodeType, TreeNode } from './types.js';

export interface FilterState {
  /** 選取的分支集合，空集合＝不篩（全部通過）。 */
  branches: Set<Branch>;
  /** 選取的類型集合，空集合＝不篩（全部通過）。 */
  types: Set<NodeType>;
  /** 搜尋字串，空字串＝不篩。比對前會先過 normalizeQuery()。 */
  query: string;
}

export function emptyState(): FilterState {
  return { branches: new Set(), types: new Set(), query: '' };
}

/**
 * 正規化搜尋字串：去頭尾空白，並把玩家常打的「混沌」轉成遊戲資料實際使用的「渾沌」
 * （兩字同音、遊戲內文案一律寫「渾沌」，但玩家很可能照現實世界的慣用詞打「混沌」，
 * 打不到會以為站台壞掉或資料不全，所以在比對前就正規化，不要求玩家打對字）。
 */
export function normalizeQuery(q: string): string {
  return q.trim().replaceAll('混沌', '渾沌');
}

/**
 * 判斷一個節點在目前篩選狀態下是否可見。
 *
 * 疊加規則（spec §6.3）：分支 AND 類型 AND 搜尋，三者任一為空條件視為通過。
 * 支援節點沒有特殊處理——它們的 `branch` 欄位本來就是所屬分支（不是 'support'，
 * 'support' 只出現在 `element`），分支篩選天然就會把它們當自己人，不需要額外白名單。
 *
 * 這個函式不知道「前置鏈高亮覆寫可見度」這條規則——那是獨立圖層，由呼叫端
 * （tree-canvas.ts 的 select()）在套用完這裡的結果之後，另外幫前置鏈上的節點/邊
 * 蓋上 .in-chain 達成，不歸這支檔案管。
 */
export function matchesFilter(node: TreeNode, state: FilterState): boolean {
  if (state.branches.size > 0 && !state.branches.has(node.branch)) return false;
  if (state.types.size > 0 && !state.types.has(node.type)) return false;
  const q = normalizeQuery(state.query);
  if (q === '') return true;
  // 覺醒文字也算——它跟描述一樣顯示在面板上，「搜尋看得到的字卻搜不到」是使用者最難自己
  // 想通的那種失敗（例如搜「冰柱」只有冰骰子的覺醒提到）。
  return node.name.includes(q) || node.description.includes(q)
    || (node.awakening ?? '').includes(q)
    || node.keywords.some(k => k.includes(q));
}

/**
 * 把篩選狀態＋目前選取的節點序列化成網址 query string（不含開頭的 `?`）。
 * 空狀態、無選取時回傳空字串，讓呼叫端可以判斷要不要把網址還原成乾淨的 pathname。
 */
export function stateToQueryString(state: FilterState, selected: string | null): string {
  const p = new URLSearchParams();
  if (selected) p.set('node', selected);
  if (state.branches.size > 0) p.set('branch', [...state.branches].join(','));
  if (state.types.size > 0) p.set('type', [...state.types].join(','));
  if (state.query !== '') p.set('q', state.query);
  return p.toString();
}

/** stateToQueryString() 的反函式，供頁面載入時從網址還原篩選狀態與選取節點。 */
export function queryStringToState(search: string): { state: FilterState; selected: string | null } {
  const p = new URLSearchParams(search);
  const split = <T>(key: string) => new Set((p.get(key)?.split(',').filter(Boolean) ?? []) as T[]);
  return {
    state: { branches: split<Branch>('branch'), types: split<NodeType>('type'), query: p.get('q') ?? '' },
    selected: p.get('node'),
  };
}

/**
 * 目前鍵盤焦點是否落在會接收文字/選項輸入的表單元件上（搜尋框、篩選核取方塊）。
 *
 * 用途：畫布的方向鍵／`+`／`-` 平移縮放快捷鍵掛在 window 上、不看事件冒泡路徑
 * （見 tree-canvas.ts 開頭說明），加了搜尋框之後如果不做這個判斷，使用者在 #search
 * 打字按方向鍵移動游標會被誤判成平移畫布。呼叫端在 window keydown handler 一開頭用
 * `isTypingTarget(document.activeElement?.tagName)` 判斷，是就直接 return，讓按鍵
 * 正常送進輸入框。
 *
 * 只認 tagName、不用 instanceof：呼叫端傳的是 `document.activeElement?.tagName`
 * （字串或 undefined），這樣這支函式維持「不碰 DOM 型別」的純函式，可以直接單元測試。
 */
export function isTypingTarget(tagName: string | null | undefined): boolean {
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
}
