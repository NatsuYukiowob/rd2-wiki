import { readFileSync, writeFileSync } from 'node:fs';
import type { TreeData } from '../src/lib/types.js';

/**
 * 這則留言的識別標記。pr-comment.yml 靠它找出「上一次貼的那則」並就地更新，
 * 而不是每次 push 都新增一則（PR #1 曾經連貼三則一模一樣的）。改動這個字串要同步改那支 workflow。
 */
export const SUMMARY_MARKER = '<!-- rd2-diff-summary -->';

/**
 * 「資料完全沒變」的識別標記。pr-comment.yml 看到它就不貼留言——只改前端程式或文件的 PR
 * 不該被一則「新增 0｜刪除 0｜修改 0」的機器人留言洗版。
 */
export const NO_CHANGE_MARKER = '<!-- rd2-no-change -->';

/**
 * 逃逸要放進 PR 留言的資料字串（節點名稱、id）。
 *
 * 這些字串的來源是 `data/dice-tree.svg`，而**送 PR 的人改得動它**——留言又是由擁有
 * `pull-requests: write` 的 workflow 貼出去的，等於「fork 可控的內容」直接進到有寫入權限的
 * 情境裡。不逃逸的話，一個叫 `<img src=x onerror=...>` 或 `[看這裡](http://釣魚)` 的節點名稱
 * 就會在 PR 頁面上渲染成 HTML／連結，也可能用 `@someone` 去 ping 無關的人。
 *
 * 作法：`& < >` 轉成 HTML 實體（GitHub 的留言渲染器認得，顯示回原字元但不當標籤）；
 * `@` 轉成 `&#64;`（顯示是 @，但不會觸發提及）；Markdown 的行內語法字元前面加反斜線。
 * 順序不能換：`&` 必須第一個處理，否則會把後面自己插入的 `&lt;` 再逃逸一次。
 */
export function escapeMarkdown(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/@/g, '&#64;')
    .replace(/([\\`*_[\]|~])/g, '\\$1');
}

/**
 * 比較 base／head 兩份 `tree.json`，產生 PR 摘要用的 Markdown（規則 11：id 變動警告）。
 *
 * 純函式、不做檔案 I/O，方便單元測試；CLI 區塊負責讀寫檔案與印出結果。
 */
export function buildDiffSummary(base: TreeData, head: TreeData): string {
  const bIds = new Set(base.nodes.map(n => n.id));
  const hIds = new Set(head.nodes.map(n => n.id));
  const added = [...hIds].filter(i => !bIds.has(i));
  const removed = [...bIds].filter(i => !hIds.has(i));
  const bById = new Map(base.nodes.map(n => [n.id, n]));
  const changed = head.nodes.filter(n => {
    const o = bById.get(n.id);
    return o && JSON.stringify(o) !== JSON.stringify(n);
  });

  // 刻意用「整份 tree.json 逐字元相同」當作沒變動的判準，而不是「上面幾個計數都是 0」：
  // 這裡只比節點集合與逐節點內容，比不到邊的接法（改接一條前置的摘要與完全沒改一字不差，
  // 見 review 報告 P3）。用最保守的判準，才不會把「其實有改」誤判成「沒變動」而整則留言消失。
  const identical = JSON.stringify(base) === JSON.stringify(head);

  const lines = [
    SUMMARY_MARKER,
    identical ? NO_CHANGE_MARKER : '',
    '## 資料差異摘要',
    `- 節點：${base.nodes.length} → ${head.nodes.length}`,
    `- 邊：${base.edges.length} → ${head.edges.length}`,
    `- 新增 ${added.length}｜刪除 ${removed.length}｜修改 ${changed.length}`,
    `- 全樹解鎖成本：核心 ${base.meta.totalUnlockCost.core} → ${head.meta.totalUnlockCost.core}，金幣 ${base.meta.totalUnlockCost.gold.toLocaleString('en-US')} → ${head.meta.totalUnlockCost.gold.toLocaleString('en-US')}`,
    removed.length > 0 ? `\n⚠️ **有節點 id 消失**：${removed.map(escapeMarkdown).join(', ')}（分享網址會失效）` : '',
    changed.length > 0 ? `\n<details><summary>修改的節點</summary>\n\n${changed.map(n => `- ${escapeMarkdown(n.id)} ${escapeMarkdown(n.name)}`).join('\n')}\n</details>` : '',
  ].filter(Boolean);

  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [basePath, headPath] = [process.argv[2], process.argv[3]];
  if (!basePath || !headPath) {
    console.error('用法: npx tsx tools/diff-summary.ts <base.json> <head.json>');
    process.exit(1);
  }
  const base: TreeData = JSON.parse(readFileSync(basePath, 'utf8'));
  const head: TreeData = JSON.parse(readFileSync(headPath, 'utf8'));
  const summary = buildDiffSummary(base, head);
  writeFileSync('diff-summary.md', summary);
  console.log(summary);
}
