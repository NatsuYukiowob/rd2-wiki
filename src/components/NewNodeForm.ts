// 新增節點表單：畫出「分支／類型／id 字首／名稱／畫面標籤／解鎖成本／效果說明／等級上限」
// 欄位＋「建立」「取消」兩個按鈕，寫進呼叫端傳入的 host（跟 EditForm.ts／NodeDetail.ts
// 同一種分工：純 DOM 寫入，讀欄位、送出、真正動 editorState/svgText 都是呼叫端
// src/scripts/edit-canvas.ts 的工作）。
//
// 這裡在讀欄位值、真正建立節點這件事上完全遵守上面那條分工，但有一個刻意的例外——見下面
// `wireReactivePrefixOptions()` 的說明。
import { prefixesFor, allocateId } from '../lib/id-alloc.js';
import type { Branch, NodeType } from '../lib/types.js';

const BRANCH_ZH: Record<Branch, string> = {
  nature: '自然', engineering: '工學', magic: '魔法', order: '秩序', chaos: '渾沌',
};
const TYPE_ZH: Record<NodeType, string> = {
  dice: '骰子', rune: '骰子符文', passive: '玩家被動', support: '支援',
};
const BRANCHES = Object.keys(BRANCH_ZH) as Branch[];
const TYPES = Object.keys(TYPE_ZH) as NodeType[];

function isBranch(v: string): v is Branch {
  return (BRANCHES as string[]).includes(v);
}
function isNodeType(v: string): v is NodeType {
  return (TYPES as string[]).includes(v);
}

/**
 * 重新計算「id 字首」下拉選單的選項：依目前選的分支＋類型透過 `prefixesFor()` 算出候選字首，
 * 每個選項標出「已用幾個、下一個會配到哪個 id」（`allocateId()` 算出來的預覽值）。
 *
 * 骰子／被動／支援每次都只有一個候選字首（沒有真正的選擇），但符文有三個（次碼 2/3/4）
 * ——id-alloc.ts 的 `prefixesFor()` 註解說得很清楚：這是遊戲自己的子分類，沒有規則能從
 * 分支＋類型推導出來，只能讓玩家自己挑，這正是這個下拉選單存在的理由。
 */
function refreshPrefixOptions(
  select: HTMLSelectElement,
  branch: Branch,
  type: NodeType,
  existingIds: readonly string[],
): void {
  const used = new Set(existingIds);
  select.innerHTML = prefixesFor(branch, type)
    .map(prefix => {
      const count = existingIds.filter(id => id.startsWith(prefix)).length;
      // allocateId 在 01–99 全部用完時會 throw（見 id-alloc.ts）；239 個節點分佈在約
      // 20 個字首下，實務上不可能撞到，但顯示層沒有理由假設這個上限永遠不會被觸及，
      // 一旦真的撞到也要有話可說，而不是讓整個表單因為一個 throw 而畫不出來。
      let preview = '已無可用編號';
      try {
        preview = `下一個 id：${allocateId(used, prefix)}`;
      } catch {
        // 上面的預設值已經涵蓋這個情況。
      }
      return `<option value="${prefix}">${prefix}（已用 ${count} 個，${preview}）</option>`;
    })
    .join('');
}

/**
 * ⚠️ 這是這個檔案唯一掛事件監聽器的地方，刻意跟 EditForm.ts／NodeDetail.ts「元件只管畫、
 * 事件委派留給呼叫端 edit-canvas.ts」的分工慣例不一樣——那條慣例的目的是把「會改動
 * editorState.svgText」的動作集中在一個地方，不是禁止元件處理「純畫面、零副作用」的互動。
 *
 * 「id 字首」的候選清單天生同時依賴分支與類型（`prefixesFor(branch, type)`），若照慣例把
 * 這段反應式邏輯搬到呼叫端，唯一能用的介面只有整個重繪的 `renderNewNodeForm(ctx, host)`
 * ——玩家選好分支、再選類型時，中間那一次重繪會把他可能已經打進名稱／標籤／成本／說明的
 * 文字全部清空，對非開發者是很挫折的體驗，而且完全沒必要：這裡只是重新算「id 字首」選單要
 * 顯示哪些選項，不碰 editorState.svgText，呼叫端不需要、也不應該介入。
 */
function wireReactivePrefixOptions(
  host: HTMLElement,
  ctx: { existingIds: string[] },
): void {
  const branchSelect = host.querySelector<HTMLSelectElement>('[data-field="branch"]')!;
  const typeSelect = host.querySelector<HTMLSelectElement>('[data-field="type"]')!;
  const prefixSelect = host.querySelector<HTMLSelectElement>('[data-field="prefix"]')!;

  const refresh = (): void => {
    const branch = branchSelect.value;
    const type = typeSelect.value;
    // <select> 的選項就是下面模板自己產生的，值域固定是 BRANCHES/TYPES，這兩個守衛
    // 理論上不會擋下任何東西——寫出來純粹是讓 TS 把 branch/type 收斂成字面量型別，
    // 不必再用不安全的 `as` 斷言。
    if (!isBranch(branch) || !isNodeType(type)) return;
    refreshPrefixOptions(prefixSelect, branch, type, ctx.existingIds);
  };
  refresh();
  branchSelect.addEventListener('change', refresh);
  typeSelect.addEventListener('change', refresh);
}

/**
 * 畫出新增節點表單。`ctx.x`/`ctx.y` 是呼叫端已經換算好的 SVG 使用者座標（新增模式點畫布時
 * 用 `#viewport` 的 `getScreenCTM().inverse()` 算出來，見 edit-canvas.ts 的說明），這裡純粹
 * 顯示，不做任何座標運算。`ctx.existingIds` 是開表單當下的節點 id 快照，供「id 字首」選單
 * 算「已用幾個」用；真正建立節點時呼叫端會重新讀一次當下的 id 集合再配號（避免玩家在同一次
 * 開啟表單期間，畫面外用其他方式新增了節點，讓這份快照過期而配出重複 id）。
 */
export function renderNewNodeForm(
  ctx: { x: number; y: number; existingIds: string[] },
  host: HTMLElement,
): void {
  host.innerHTML = `
    <h2>新增節點</h2>
    <p class="meta">位置：(${ctx.x}, ${ctx.y})</p>
    <label>屬性分支
      <select data-field="branch">
        ${BRANCHES.map(b => `<option value="${b}">${BRANCH_ZH[b]}</option>`).join('')}
      </select>
    </label>
    <label>節點類型
      <select data-field="type">
        ${TYPES.map(t => `<option value="${t}">${TYPE_ZH[t]}</option>`).join('')}
      </select>
    </label>
    <label>id 字首
      <select data-field="prefix"></select>
    </label>
    <label>名稱
      <input type="text" data-field="name">
    </label>
    <label>畫面標籤
      <input type="text" data-field="label">
    </label>
    <label>解鎖成本
      <textarea data-field="cost" rows="2"></textarea>
    </label>
    <label>效果說明
      <textarea data-field="description" rows="4"></textarea>
    </label>
    <label>等級上限（留白代表無）
      <input type="number" data-field="maxLevel" min="1" step="1">
    </label>
    <div class="actions">
      <button type="button" data-action="create">建立節點</button>
      <button type="button" data-action="cancel">取消</button>
    </div>
  `;

  wireReactivePrefixOptions(host, ctx);
}
