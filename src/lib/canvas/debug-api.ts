// E2E 的查詢介面（window.__tree）。
// 改成 Canvas 之後，測試沒辦法再靠量 DOM 幾何（getBoundingClientRect／querySelector）
// 認節點——canvas 裡什麼都不是元素。所以渲染器主動把「數多少、縮放多少、節點在螢幕上的
// 矩形、內部狀態、某個座標點中了誰」這幾件事包成一個小介面，測試改問它而不是量畫面。
export interface TreeDebugApi {
  count(): { nodes: number; edges: number };
  scale(): number;
  nodeScreenRect(id: string): { left: number; top: number; width: number; height: number } | null;
  state(): unknown;
  hitAt(clientX: number, clientY: number): string | null;
}

/**
 * 把 api 裝到 target.__tree（正式環境是 window）。
 * 永遠安裝、不判斷環境——體積是幾個函式參考，可以忽略；換來的是 E2E 與正式版走同一份
 * 渲染路徑，不必為了「有沒有裝偵錯介面」多維護一份 build flag 或條件分支。
 */
export function installTreeDebug(target: { __tree?: TreeDebugApi }, api: TreeDebugApi): void {
  target.__tree = api;
}
