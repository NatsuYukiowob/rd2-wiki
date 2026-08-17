import { readFileSync, writeFileSync } from 'node:fs';
import type { TreeData } from '../src/lib/types.js';

/**
 * 比較 base／head 兩份 `tree.json`，產生 PR 摘要用的 Markdown（規則 10：id 變動警告）。
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

  const lines = [
    '## 資料差異摘要',
    `- 節點：${base.nodes.length} → ${head.nodes.length}`,
    `- 邊：${base.edges.length} → ${head.edges.length}`,
    `- 新增 ${added.length}｜刪除 ${removed.length}｜修改 ${changed.length}`,
    `- 全樹解鎖成本：核心 ${base.meta.totalUnlockCost.core} → ${head.meta.totalUnlockCost.core}，金幣 ${base.meta.totalUnlockCost.gold.toLocaleString('en-US')} → ${head.meta.totalUnlockCost.gold.toLocaleString('en-US')}`,
    removed.length > 0 ? `\n⚠️ **有節點 id 消失**：${removed.join(', ')}（分享網址會失效）` : '',
    changed.length > 0 ? `\n<details><summary>修改的節點</summary>\n\n${changed.map(n => `- ${n.id} ${n.name}`).join('\n')}\n</details>` : '',
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
