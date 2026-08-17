// 驗證結果面板：把 validateWith() 的結果與 tree.json 的 gzip 體積預估畫進呼叫端傳入的
// host（純 DOM 寫入，不掛事件，理由同 NodeDetail.ts）。故意不在這裡碰
// `editorState.newIcons`（「本次新增了 N 張圖示」那行提示）或直接讀 `#edit-download`
// 以外的按鈕狀態決策細節：這個函式的簽章（result／gzipBytes／host 三個參數）是任務簡報
// 定死的介面，加一個 icons 參數等於改介面；圖示提示、下載按鈕啟停都是呼叫端
// src/scripts/edit-canvas.ts 的 runValidation() 在協調，見該函式的說明。
import { GZIP_BUDGET_BYTES } from '../lib/budget.js';

const HTML_ESCAPE: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => HTML_ESCAPE[ch] ?? ch);
}

/** 餘裕低於這個門檻時，體積列轉成警示樣式（class `budget-low`）。 */
const LOW_MARGIN_BYTES = 2 * 1024;

/** 跟 tools/build-data.ts 的 CLI 輸出用同一種捨入方式（KB，取一位小數），兩邊看到的數字才對得上。 */
function formatKb(bytes: number): string {
  return (bytes / 1024).toFixed(1);
}

/**
 * 顯示三區：紅色的 errors、黃色的 warnings、tree.json 體積列。
 *
 * `gzipBytes` 傳 `NaN` 代表呼叫端算不出來——`buildTreeDataWith` 在某些規則違反下
 * （例如成本或描述被改成不合法格式）會直接 throw，這時候連 tree.json 的資料都建不出來，
 * 更別提估 gzip 大小。與其顯示一個誤導人的「0.0 KB／餘裕 20.0 KB」（看起來完全沒問題），
 * 這裡直接跳過整個體積列——`errors` 陣列本身已經帶著更精確的規則訊息，不需要體積列
 * 幫腔。
 */
export function renderValidation(
  result: { errors: string[]; warnings: string[] },
  gzipBytes: number,
  host: HTMLElement,
): void {
  const errorsHtml = result.errors.length > 0
    ? `<div class="errors">${result.errors.map(e => `<p class="error">${escapeHtml(e)}</p>`).join('')}</div>`
    : '';
  const warningsHtml = result.warnings.length > 0
    ? `<div class="warnings">${result.warnings.map(w => `<p class="warning">${escapeHtml(w)}</p>`).join('')}</div>`
    : '';

  let budgetHtml = '';
  if (Number.isFinite(gzipBytes)) {
    const marginBytes = GZIP_BUDGET_BYTES - gzipBytes;
    const lowClass = marginBytes < LOW_MARGIN_BYTES ? ' budget-low' : '';
    budgetHtml = `<p class="budget${lowClass}">tree.json gzip ${formatKb(gzipBytes)} KB / ${(GZIP_BUDGET_BYTES / 1024).toFixed(0)} KB，餘裕 ${formatKb(marginBytes)} KB</p>`;
  }

  host.innerHTML = `${errorsHtml}${warningsHtml}${budgetHtml}`;
}
