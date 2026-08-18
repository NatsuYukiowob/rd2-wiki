// 節點欄位表單：把一個 NodeBlock 畫成可編輯的表單（renderEditForm），以及把表單欄位的
// 改動套進 NodeBlock（applyFieldEdits）。兩者刻意分開——後者是純函式，不碰 DOM，方便單元
// 測試；DOM 組裝與事件監聽（讀哪個欄位改了、送出後怎麼重繪）是呼叫端
// src/scripts/edit-canvas.ts 的工作，這裡不處理，跟 NodeDetail.ts／tree-canvas.ts 的分工
// 原則一致。
import { setLabelText, type NodeBlock } from '../lib/svg-emit.js';

/**
 * 表單欄位的改動集合，全部是可選欄位（只送真的被改過的那幾個）。
 *
 * `maxLevel` 用 `number | null`（不是 `number | undefined`）：`null` 是有意義的輸入，
 * 代表「玩家把等級上限欄位清空，要移除 `<title>` 的『最高等級：N』那一行」，跟「這個欄位
 * 根本沒有出現在這次的編輯裡」（key 不存在）是兩件不同的事。`applyFieldEdits` 必須用
 * `'maxLevel' in edits` 才能正確分辨這兩種情況，見該函式的說明。
 */
export interface FieldEdits {
  name?: string;
  label?: string;
  cost?: string;
  description?: string;
  maxLevel?: number | null;
}

/**
 * 把表單欄位改動套進 `NodeBlock`，回傳新物件（不可變更新，`{ ...block, ... }`，不就地
 * 修改）。純函式：吃 block 跟 edits，只回傳新 block，不碰 DOM，方便單元測試。
 *
 * 欄位對應（任務簡報表格）：
 * - `name`／`cost`／`description` 直接覆寫 NodeBlock 同名欄位。`<title>` 不用在這裡手動
 *   同步——`emitNodeBlock` 是依 `typeZh`／`name`／`description`／`titleMaxLevel` 重新組出
 *   `<title>` 的純函式（見 svg-emit.ts 檔頭），改了這幾個欄位、`<title>` 自然跟著對。
 * - `label` 是獨立欄位，不可跟 `name` 綁定：實測有 60 個節點的畫面標籤刻意不等於
 *   `data-name`（例如「所有骰子傷害」顯示為「全骰傷害」），套用時只透過 `setLabelText`
 *   動 `labelXml` 的文字內容，完全不碰 `name`。
 * - `maxLevel` 對應到 `titleMaxLevel`——表單欄位名跟區塊欄位名不同，是簡報特別點名的
 *   對應關係，容易被想成「同名直接覆寫」而漏掉。
 *
 * ⚠️ `maxLevel` 必須用 `'maxLevel' in edits` 判斷「有沒有要改」，不能用
 * `edits.maxLevel !== undefined`：`{ maxLevel: null }` 這種輸入下 `!== undefined` 仍然
 * 成立，看似沒問題，但下一步如果貪快寫成 `edits.maxLevel ?? block.titleMaxLevel`
 * （用 `??` 在「沒改」跟「改成 null」之間選一個），`null ?? block.titleMaxLevel` 會直接
 * 選中舊值，讓「玩家把等級上限清空」這個操作靜默失效——這正是本檔對應測試第四案例在守的
 * 行為。這裡改用顯式的三元判斷（而不是 `??`），刻意避免寫出任何跟這個地雷長得像的寫法。
 */
export function applyFieldEdits(block: NodeBlock, edits: FieldEdits): NodeBlock {
  return {
    ...block,
    ...(edits.name !== undefined ? { name: edits.name } : {}),
    ...(edits.cost !== undefined ? { cost: edits.cost } : {}),
    ...(edits.description !== undefined ? { description: edits.description } : {}),
    ...(edits.label !== undefined ? { labelXml: setLabelText(block.labelXml, edits.label) } : {}),
    ...('maxLevel' in edits ? { titleMaxLevel: edits.maxLevel === undefined ? null : edits.maxLevel } : {}),
  };
}

const HTML_ESCAPE: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};
/** 跟 NodeDetail.ts 的同名函式一樣：插進 innerHTML 模板的文字一律先過這道逃逸。 */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => HTML_ESCAPE[ch] ?? ch);
}

const LABEL_CONTENT_RE = /<text\b[^]*?>([^]*?)<\/text>/;

/**
 * 從 `labelXml`（svg-emit.ts 保留的原始 `<text ...>…</text>` 字串）取出目前的畫面標籤
 * 文字，供表單欄位的初始值顯示。內容是用 `escapeXmlContent`（svg-emit.ts）逃逸過的 XML
 * 元素內容——那個函式逃逸的字元集合是「linkedom 序列化器實測會轉什麼」（`&``<``>``U+00A0`），
 * 不是從 XML 規範推導的最小需求（見該函式檔頭關於 Critical fix 的說明），這裡要反向解碼回
 * 人類看得懂的文字給玩家看，必須跟 `escapeXmlContent` 逃逸的字元集合逐一對稱，否則玩家編輯
 * 過含 `>`／NBSP 的標籤後，表單顯示的初始值會殘留沒解開的實體字面量。
 *
 * 順序（`&amp;` 放最後解）跟 svg-emit.ts 的 `decodeAttr` 同一個理由：`&lt;`／`&gt;` 字面上都
 * 含 `&`，若先解 `&amp;`，這兩個實體會被解壞成單獨的 `<`／`>` 再被後面的規則誤傷。
 */
function labelTextOf(labelXml: string): string {
  const content = LABEL_CONTENT_RE.exec(labelXml)?.[1] ?? '';
  return content
    .replace(/&#160;/g, ' ')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

/**
 * 把節點的欄位畫成表單，寫進 `host`（純 DOM 寫入，不掛事件——事件委派是呼叫端
 * edit-canvas.ts 的工作，理由同 NodeDetail.ts）。每個可編輯欄位掛 `data-field` 屬性，
 * 值跟 `FieldEdits` 的 key 同名，供呼叫端的事件委派讀取。
 *
 * 「解鎖成本」刻意用 `<textarea>` 而不是單行 `<input>`（跟簡報條列的字面順序不同，這裡
 * 記錄理由）：`data/dice-tree.svg` 裡有 163 個節點的 `data-cost` 是兩行——「金幣／核心
 * 金額」＋「最高 N 級」（等級上限內嵌在成本字串裡，這是骰子／符文類節點的等級上限存放
 * 位置，跟玩家被動用 `<title>` 最後一行『最高等級：N』是兩套不同機制，見 svg-parse.ts／
 * cost.ts）。HTML 的 `<input type="text">` 有內建的 value sanitization：無論是解析
 * `value="..."` 屬性還是用 JS 設 `.value`，只要字串裡含字面換行，瀏覽器都會把換行整個
 * 吃掉（不是轉空白，是直接消失）。若這裡用 `<input>` 顯示這 163 個節點的成本，欄位會
 * 顯示成兩行黏在一起、沒有分隔的錯字（例如「金幣 2,000最高 50 級」），玩家沒改過這欄也會
 * 看到跑掉的資料——`<textarea>` 的內容是元素文字節點，不受這條 value sanitization
 * 規則影響，換行原封不動保留。
 *
 * 「類型」是唯讀顯示（不掛 `data-field`，`FieldEdits` 本來就沒有這個欄位）：改類型代表
 * shape／image／label 樣板都要換一輪，屬於 Task 13 的節點重建流程，不是欄位編輯。
 */
export function renderEditForm(block: NodeBlock, host: HTMLElement): void {
  const label = labelTextOf(block.labelXml);
  const maxLevelValue = block.titleMaxLevel === null ? '' : String(block.titleMaxLevel);

  host.innerHTML = `
    <h2>${escapeHtml(block.name)}</h2>
    <label>名稱
      <input type="text" data-field="name" value="${escapeHtml(block.name)}">
    </label>
    <label>畫面標籤
      <input type="text" data-field="label" value="${escapeHtml(label)}">
    </label>
    <p class="meta">類型：${escapeHtml(block.typeZh)}</p>
    <label>解鎖成本
      <textarea data-field="cost" rows="2">${escapeHtml(block.cost)}</textarea>
    </label>
    <label>效果說明
      <textarea data-field="description" rows="4">${escapeHtml(block.description)}</textarea>
    </label>
    <label>等級上限（留白代表無）
      <input type="number" data-field="maxLevel" min="1" step="1" value="${escapeHtml(maxLevelValue)}">
    </label>
    <div class="icon-field">
      <label>圖示（PNG，最長邊 ≥ 96px）
        <input type="file" accept="image/png" data-field="icon">
      </label>
      <!-- 選檔案後的狀態訊息，由 edit-canvas.ts 的 change 委派寫入（這個元件不掛事件，
           理由見檔頭）。成功時只在這個元素掛 data-icon-hash 屬性（給自動化測試掛鉤用），
           不把雜湊值印成看得見的文字——玩家從頭到尾不需要知道「雜湊」是什麼（任務簡報的
           設計要點）。失敗時原樣顯示 checkIcon() 回傳的 reason，不自己改寫措辭（那句話
           刻意跟 CI 規則 7(c) 用語逐字一致，有 tests/lib/icon-hash.test.ts 守著）。
           用 div.icon-field 包住這組欄位，不讓 label 直接掛在 #edit-form 底下：
           tests/e2e/edit.spec.ts「表單六個欄位縱向堆疊」那支測試用「#edit-form 直接子元素
           的 label／p.meta」數固定 6 列，若圖示欄位的 label 也是 #edit-form 的直接子元素，
           數量會變 7 把那支既有測試考壞——包一層 div 讓它變成孫層級，CSS 的 #edit-form
           label 選擇器沒有用子代限定，樣式不受影響，但那支計數測試的直接子元素選擇器不會
           多算到它。 -->
      <p class="icon-status" data-icon-status></p>
    </div>
  `;
}
