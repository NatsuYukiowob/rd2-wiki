import { readFileSync, writeFileSync } from 'node:fs';
import { renderDiffComment } from './diff-summary.js';

/**
 * 把 CI 產出的 `diff-summary.json` 渲染成要貼到 PR 上的 Markdown。
 *
 * ⚠️ 這支**只從 default branch 執行**（`pr-comment.yml` 會先 checkout 預設分支再跑），
 * 因為它的輸入來自 fork PR 的 CI 產物、輸出會被有 `pull-requests: write` 的 workflow 貼出去。
 * 真正的防護在 `renderDiffComment()`，這裡只負責讀檔／寫檔，並確保「連 JSON 都解析不了」
 * 也不會讓那支 workflow 掛掉——掛掉的話 workflow_run 的紅叉會標在 main 的最新 commit 上。
 *
 * 用法：npx tsx tools/render-pr-comment.ts <diff-summary.json> <out.md>
 */
const [inPath, outPath] = [process.argv[2], process.argv[3]];
if (!inPath || !outPath) {
  console.error('用法: npx tsx tools/render-pr-comment.ts <diff-summary.json> <out.md>');
  process.exit(1);
}

let data: unknown = null;
try {
  data = JSON.parse(readFileSync(inPath, 'utf8'));
} catch (e) {
  // 刻意不把錯誤訊息帶進留言：那段文字裡會夾著輸入內容的片段，等於把逃逸破口重新打開。
  console.error(`無法解析 ${inPath}：${e instanceof Error ? e.name : 'unknown'}`);
}

const body = renderDiffComment(data);
writeFileSync(outPath, body);
console.log(body);
