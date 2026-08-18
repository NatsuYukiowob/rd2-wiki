// 把「編輯前後兩份 TreeData」變成一段人看得懂的 PR 標題與內文。
//
// 這個檔案要解決的問題：維護者不可能逐行 review SVG 的 diff（CI 是唯一防線），
// 但 CI 之後還是要有人判斷「這個 PR 到底在做什麼、該不該合」。審查訊號因此有兩層——
// 最小 diff（Task 7 的行區塊外科手術：一個 PR 動三個節點，diff 就只有三個區塊）
// 與這份自動摘要。摘要的品質標準不是「資訊完整」，是「一眼看得出要不要細看」。
//
// 跟 svg-edit.ts／svg-emit.ts 一樣刻意不 import linkedom／node:*：這個檔案會被 Astro
// 打包進瀏覽器（Task 21 的線上編輯器要在送出 PR 前，用玩家editor session 裡的
// before/after TreeData 現算摘要），不能有任何 Node 專屬依賴。
import type { Cost, TreeData } from './types.js';

/** 摘要單一次編輯的完整結果；`diffTrees` 只算得出前 7 個欄位，`newIcons`／`newKeywords` 由呼叫端（線上編輯器，追蹤玩家本次上傳的圖示與新增的關鍵字）另外補上。 */
export interface EditSummary {
  added: string[]; removed: string[]; modified: string[];
  edgesBefore: number; edgesAfter: number;
  costBefore: Cost;
  costAfter: Cost;
  newIcons: string[]; newKeywords: string[];
}

/** 超過此數量的 id 清單只列前 N 個，其餘註明「等 N 個」——避免玩家一次調整版面座標動到
 *  大量節點時，PR 內文被 id 清單洗版，反而蓋掉真正該注意的變動（id 消失警示、成本變化）。 */
const MAX_LISTED_IDS = 20;

/**
 * 比對 before／after 兩份 `TreeData.nodes`，以 id 為鍵分成三類：
 * 只在 before 出現＝刪除、只在 after 出現＝新增、兩邊都有但內容不同＝修改。
 * 「內容不同」用 `JSON.stringify` 比對整個 TreeNode——跟 CI 端 `tools/diff-summary.ts` 的
 * `buildDiffSummary` 同一套判定方式，兩邊算出的「有沒有變」不會因為各自維護一套比對邏輯而漂移。
 *
 * 三個清單都排序（id 固定 4 碼數字字串，字典序＝數值序），讓輸出穩定——同一組編輯不管節點在
 * SVG 裡的物理順序如何，產生的 PR 摘要都逐字相同，這對「PR 內容可預期」跟「diff 最小化」的
 * 精神是同一件事的延伸。
 *
 * 不含 edgesBefore／edgesAfter／costBefore／costAfter 以外的成本欄位計算：邊數與全樹解鎖成本
 * 已經是 `buildTreeData` 算好的 meta 欄位，這裡只是原樣讀出兩邊的值，不重新推導。
 */
export function diffTrees(
  before: TreeData,
  after: TreeData
): Pick<EditSummary, 'added' | 'removed' | 'modified' | 'edgesBefore' | 'edgesAfter' | 'costBefore' | 'costAfter'> {
  const beforeById = new Map(before.nodes.map(n => [n.id, n]));
  const afterById = new Map(after.nodes.map(n => [n.id, n]));

  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];

  for (const id of afterById.keys()) {
    if (!beforeById.has(id)) added.push(id);
  }
  for (const [id, b] of beforeById) {
    const a = afterById.get(id);
    if (!a) { removed.push(id); continue; }
    if (JSON.stringify(a) !== JSON.stringify(b)) modified.push(id);
  }

  added.sort();
  removed.sort();
  modified.sort();

  return {
    added, removed, modified,
    edgesBefore: before.edges.length,
    edgesAfter: after.edges.length,
    costBefore: before.meta.totalUnlockCost,
    costAfter: after.meta.totalUnlockCost,
  };
}

/**
 * 依「新增 A 個／修改 M 個／刪除 D 個節點」組合出 PR 標題，只列非零項，用頓號連接，
 * 前綴 `data: `——這個前綴不是裝飾，是讓維護者在 PR 列表裡一眼分辨「這是資料變更」
 * （相對於未來可能出現的 `feat:`／`fix:` 之類的站台程式碼變更）。
 *
 * 三個計數都是 0（例如玩家只改了圖示或關鍵字、沒有動節點本身的欄位）目前不會發生——
 * icon／keyword 的變更一定伴隨著它所屬節點的欄位跟著變、因而落在 modified 裡——但仍給一個
 * 保底文案，不讓標題開天窗。
 */
export function renderPrTitle(s: Pick<EditSummary, 'added' | 'removed' | 'modified'>): string {
  const parts: string[] = [];
  if (s.added.length > 0) parts.push(`新增 ${s.added.length} 個`);
  if (s.modified.length > 0) parts.push(`修改 ${s.modified.length} 個`);
  if (s.removed.length > 0) parts.push(`刪除 ${s.removed.length} 個`);
  return `data: ${parts.length > 0 ? `${parts.join('、')}節點` : '編輯資料'}`;
}

/** 千分位數字格式，跟 `format.ts` 的 `formatCost` 用同一種 locale，維持全站數字顯示一致。 */
function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

/** 成本差值格式：正值加 `+` 號，負值靠 `toLocaleString` 自帶的 `-` 號，0 顯示 `+0`（沒有變化本身也是訊號，不省略）。 */
function fmtDelta(n: number): string {
  return n >= 0 ? `+${fmt(n)}` : fmt(n);
}

/** id 清單顯示：超過 `MAX_LISTED_IDS` 只列前 N 個，其餘摺成「等 N 個」。 */
function fmtIdList(ids: string[]): string {
  if (ids.length <= MAX_LISTED_IDS) return ids.join('、');
  const shown = ids.slice(0, MAX_LISTED_IDS).join('、');
  return `${shown}（等 ${ids.length - MAX_LISTED_IDS} 個）`;
}

/**
 * 產生 PR 內文（Markdown）。順序刻意把「id 有沒有消失」的警示放在成本變化之後、
 * 而不是清單第一行——維護者掃過表格就會先看到 removed 欄裡列了哪些 id，warning 段落
 * 是「再確認一次、別漏看」的第二道保險，兩者互補不重複。
 *
 * `> ⚠️ …` 這段警示文字延續既有 CI 規則 10（`tools/diff-summary.ts`）已經在用的措辭
 * ——「分享網址」「刻意變更」——維護者不必學兩套說法：手動 PR 收到 CI 貼的警告、
 * 線上編輯器送出的 PR 收到這裡產生的警告，讀起來是同一件事。
 */
export function renderPrBody(s: EditSummary, editorUrl: string): string {
  const lines: string[] = [];
  lines.push(`本 PR 由[線上編輯器](${editorUrl})產生。`);
  lines.push('');

  lines.push('## 節點變動');
  lines.push('');
  const rows: Array<[string, string[]]> = [
    ['新增', s.added],
    ['修改', s.modified],
    ['刪除', s.removed],
  ];
  const changedRows = rows.filter(([, ids]) => ids.length > 0);
  if (changedRows.length > 0) {
    lines.push('| 變動 | 數量 | id |');
    lines.push('| --- | --- | --- |');
    for (const [label, ids] of changedRows) lines.push(`| ${label} | ${ids.length} | ${fmtIdList(ids)} |`);
  } else {
    lines.push('（無節點新增／修改／刪除）');
  }
  lines.push('');

  lines.push('## 邊');
  lines.push('');
  lines.push(`${s.edgesBefore} → ${s.edgesAfter}`);
  lines.push('');

  lines.push('## 全樹解鎖成本');
  lines.push('');
  const coreDelta = s.costAfter.core - s.costBefore.core;
  const goldDelta = s.costAfter.gold - s.costBefore.gold;
  lines.push(
    `核心 ${fmt(s.costBefore.core)} → ${fmt(s.costAfter.core)}（${fmtDelta(coreDelta)}）` +
    `／金幣 ${fmt(s.costBefore.gold)} → ${fmt(s.costAfter.gold)}（${fmtDelta(goldDelta)}）`
  );

  if (s.removed.length > 0) {
    lines.push('');
    // 骰子樹的分享連結是用 id 組出來的（見 CLAUDE.md／規則 10），id 一旦消失，
    // 舊的分享連結就打不開了——這不是裝飾用的警告，是真實的破壞性後果，措辭沿用
    // tools/diff-summary.ts 既有的「分享網址」「刻意變更」用字。
    lines.push(`> ⚠️ 有 ${s.removed.length} 個節點 id 消失，使用這些 id 的分享網址將會失效，請確認是刻意變更。`);
  }

  if (s.newIcons.length > 0) {
    lines.push('');
    lines.push('## 新增圖示');
    lines.push('');
    for (const icon of s.newIcons) lines.push(`- ${icon}`);
  }

  if (s.newKeywords.length > 0) {
    lines.push('');
    lines.push('## 新增關鍵字');
    lines.push('');
    for (const kw of s.newKeywords) lines.push(`- ${kw}`);
  }

  return lines.join('\n');
}
