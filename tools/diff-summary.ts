import { readFileSync, writeFileSync } from 'node:fs';
import type { TreeData } from '../src/lib/types.js';

/**
 * 這則留言的識別標記。pr-comment.yml 靠它找出「上一次貼的那則」並就地更新，
 * 而不是每次 push 都新增一則（PR #1 曾經連貼三則一模一樣的）。改動這個字串要同步改那支 workflow。
 */
export const SUMMARY_MARKER = '<!-- rd2-diff-summary -->';

/**
 * 「資料完全沒變」的識別標記。pr-comment.yml 看到它就把留言收成一句話，
 * 只改前端程式或文件的 PR 不該被一則「新增 0｜刪除 0｜修改 0」的機器人留言洗版。
 */
export const NO_CHANGE_MARKER = '<!-- rd2-no-change -->';

/** 清單最多列幾條、單一名稱最多留幾個字。留言長度由**渲染端**決定，不由輸入決定。 */
const MAX_LIST = 30;
const MAX_NAME = 100;
const MAX_ESCAPED = 400;

/**
 * 送進 PR 留言的結構化資料。這份東西由 `ci.yml` 在 **PR 的程式碼**（fork 改得動）底下算出來，
 * 所以下游一律當成不可信輸入處理——見 `renderDiffComment`。
 */
export interface DiffSummaryData {
  /** 兩份 tree.json 逐字元相同。 */
  identical: boolean;
  /** base 那份的格式跟現在的程式對不起來（欄位被改名／改結構），逐項比較不算數。 */
  schemaChanged: boolean;
  nodes: [number, number];
  edges: [number, number];
  counts: { added: number; removed: number; changed: number };
  removedIds: string[];
  changed: { id: string; name: string }[];
  /**
   * 新增／刪除的邊，附兩端節點的名稱。
   *
   * 沒有這一段的話，「把一條前置改接到別的節點」產生的摘要與「完全沒改」逐字相同——
   * 節點集合沒變、逐節點內容沒變、邊的**數量**也沒變。維護者不可能逐行讀 SVG 的 diff，
   * 這則留言是唯一的替代品。
   */
  addedEdges: { from: string; to: string; fromName: string; toName: string }[];
  removedEdges: { from: string; to: string; fromName: string; toName: string }[];
  /** 邊的數量沒變、集合卻變了＝有前置被改接。這種改動最容易在摘要裡消失，單獨標一行。 */
  edgesRewired: boolean;
  /** 被加上／取消 `data-wip="1"` 的節點 id。這個標記會讓節點豁免圖結構檢查，改動它要留下痕跡。 */
  wipAdded: string[];
  wipRemoved: string[];
  cost: {
    base: { core: number; gold: number };
    head: { core: number; gold: number };
  };
}

/**
 * 逃逸要放進 PR 留言的資料字串（節點名稱、id）。
 *
 * 留言是由擁有 `pull-requests: write` 的 workflow 用 repo 自己的 bot 身分貼出去的，而這些字串
 * 來自 `data/dice-tree.svg`——**送 PR 的人改得動**。不逃逸的話，一個叫
 * `<img src=x onerror=...>`、`[看這裡](http://釣魚)` 或 `@maintainer` 的節點名稱，就會在 PR 頁面上
 * 以維護者的機器人名義渲染成 HTML、連結或提及。
 *
 * 處理順序有意義，不要換：
 * 1. **先收掉換行**。正本的屬性值裡目前有 152 處字面換行（見 CLAUDE.md），linkedom 不會把它們
 *    正規化成空白 → 名稱能跳出 `- {id} {name}` 那一行，在行首放 `#`、`-`、`>` 注入區塊語法。
 *    收成空白之後，這些字元只可能出現在行中間、沒有語法意義，也就不必逃逸（名稱才看得懂）。
 * 2. `& < >` 轉 HTML 實體（`&` 必須第一個，否則會把後面自己插入的實體再逃逸一次）。
 * 3. `@` → `&#64;`：顯示仍是 @，但不會提及到無關的人。
 * 4. `://` 與 `www.` 拆掉：GFM 的自動連結比對的是**原始文字**，拆掉就不會生成可點的釣魚連結。
 * 5. Markdown 行內語法字元加反斜線。
 * 6. 截長。
 */
export function escapeMarkdown(s: string): string {
  return s
    .slice(0, MAX_NAME)
    .replace(/[\r\n]/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/@/g, '&#64;')
    .replace(/:\/\//g, ':&#47;&#47;')
    .replace(/www\./gi, m => `${m.slice(0, 3)}&#46;`)
    .replace(/([\\`*_[\]|~])/g, '\\$1')
    .slice(0, MAX_ESCAPED);
}

/** 這份 tree.json 的形狀還是這支程式認得的樣子嗎。 */
function looksLikeTree(t: unknown): t is TreeData {
  const o = t as TreeData | undefined;
  return !!o && typeof o === 'object'
    && Array.isArray(o.nodes) && Array.isArray(o.edges)
    && !!o.meta && typeof o.meta === 'object'
    && !!o.meta.totalUnlockCost && typeof o.meta.totalUnlockCost === 'object';
}

/**
 * 比較 base／head 兩份 `tree.json`，算出摘要用的結構化資料（規則 11：id 變動警告）。
 *
 * 純函式、不做檔案 I/O。base 那份是用 **base commit 的 `build-data.ts`** 產生的，欄位可能跟現在
 * 的程式對不起來——所以先驗形狀，對不上就標 `schemaChanged`，而不是讓 `verify` 噴一個看不懂的
 * TypeError（那會讓 PR 卡在必要檢查上，而記錄檔指向這裡、不是指向真正改了結構的那個 commit）。
 */
export function computeDiff(base: unknown, head: unknown): DiffSummaryData {
  const empty: DiffSummaryData = {
    identical: false,
    schemaChanged: true,
    nodes: [0, 0],
    edges: [0, 0],
    counts: { added: 0, removed: 0, changed: 0 },
    removedIds: [],
    changed: [],
    addedEdges: [],
    removedEdges: [],
    edgesRewired: false,
    wipAdded: [],
    wipRemoved: [],
    cost: { base: { core: 0, gold: 0 }, head: { core: 0, gold: 0 } },
  };
  if (!looksLikeTree(base) || !looksLikeTree(head)) return empty;

  const bIds = new Set(base.nodes.map(n => n.id));
  const hIds = new Set(head.nodes.map(n => n.id));
  const added = [...hIds].filter(i => !bIds.has(i));
  const removed = [...bIds].filter(i => !hIds.has(i));
  const bById = new Map(base.nodes.map(n => [n.id, n]));
  const changed = head.nodes.filter(n => {
    const o = bById.get(n.id);
    return o && JSON.stringify(o) !== JSON.stringify(n);
  });

  // 邊以 `from>to` 當索引鍵比集合，不是比數量。名稱優先取 head 的（新增的邊只有 head 有），
  // 取不到再退回 base（刪除的邊只有 base 有）。
  const nameOf = (id: string) =>
    head.nodes.find(n => n.id === id)?.name ?? base.nodes.find(n => n.id === id)?.name ?? '';
  const key = (e: readonly [string, string]) => `${e[0]}>${e[1]}`;
  const bEdges = new Set(base.edges.map(key));
  const hEdges = new Set(head.edges.map(key));
  const toEntry = (k: string) => {
    const [from = '', to = ''] = k.split('>');
    return { from, to, fromName: nameOf(from), toName: nameOf(to) };
  };
  const addedEdges = [...hEdges].filter(k => !bEdges.has(k)).map(toEntry);
  const removedEdges = [...bEdges].filter(k => !hEdges.has(k)).map(toEntry);

  const wipOf = (t: TreeData) => new Set(t.nodes.filter(n => n.wip).map(n => n.id));
  const bWip = wipOf(base);
  const hWip = wipOf(head);

  return {
    addedEdges,
    removedEdges,
    // 數量一樣、集合不一樣＝有前置被改接。這正是舊摘要完全看不見的那種改動。
    edgesRewired: base.edges.length === head.edges.length && (addedEdges.length > 0 || removedEdges.length > 0),
    wipAdded: [...hWip].filter(id => !bWip.has(id)),
    wipRemoved: [...bWip].filter(id => !hWip.has(id)),
    // 「沒變動」用「整份 tree.json 逐字元相同」判斷，而不是「上面幾個計數都是 0」：
    // 計數只涵蓋看得見的那幾個維度，而輸入是貢獻者寫的，總會有沒想到的第 N 個維度。
    // 用最保守的判準，才不會把「其實有改」誤判成「沒變動」而讓留言整則消失。
    identical: JSON.stringify(base) === JSON.stringify(head),
    schemaChanged: false,
    nodes: [base.nodes.length, head.nodes.length],
    edges: [base.edges.length, head.edges.length],
    counts: { added: added.length, removed: removed.length, changed: changed.length },
    removedIds: removed,
    changed: changed.map(n => ({ id: n.id, name: n.name })),
    cost: { base: base.meta.totalUnlockCost, head: head.meta.totalUnlockCost },
  };
}

/** 只收「真的是非負整數」的值，其餘一律當 0——這些數字是輸入端填的。 */
function safeInt(v: unknown): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 1e12 ? v : 0;
}

function safeText(v: unknown): string {
  return escapeMarkdown(typeof v === 'string' ? v : '');
}

/** 截成最多 MAX_LIST 條，並回報被截掉幾條。 */
function clampList<T>(v: unknown): { items: T[]; rest: number } {
  const arr = Array.isArray(v) ? v : [];
  return { items: arr.slice(0, MAX_LIST) as T[], rest: Math.max(0, arr.length - MAX_LIST) };
}

/**
 * 把差異資料渲染成要貼到 PR 上的 Markdown。
 *
 * ⚠️ **這是信任邊界。** 參數型別刻意是 `unknown`：這份 JSON 由 fork PR 的 CI 產生，內容、欄位、
 * 型別全部是送 PR 的人說了算，連「上游有沒有逃逸過」都不能假設——`computeDiff` 就在他改得動的
 * 檔案裡，整支刪掉換成 `writeFileSync(...)` 寫任意內容也沒人擋得住。
 *
 * 所以留言的安全性完全由這個函式負責：欄位形狀自己驗、數字自己收斂、字串自己逃逸、長度自己夾。
 * 對應的 workflow（`pr-comment.yml`）會先 checkout **default branch** 再呼叫這裡，fork 改不到這份程式。
 */
export function renderDiffComment(raw: unknown): string {
  const d = raw as Partial<DiffSummaryData> | null | undefined;
  const shapeOk = !!d && typeof d === 'object' && !Array.isArray(d)
    && !!d.counts && typeof d.counts === 'object'
    && Array.isArray(d.nodes) && Array.isArray(d.edges)
    && !!d.cost && typeof d.cost === 'object'
    && !!d.cost.base && !!d.cost.head;

  if (!shapeOk) {
    return [
      SUMMARY_MARKER,
      '## 資料差異摘要',
      '',
      '⚠️ 這次的差異資料無法解讀（格式不符預期），請直接看 CI 記錄檔。',
    ].join('\n');
  }

  const counts = {
    added: safeInt(d.counts!.added),
    removed: safeInt(d.counts!.removed),
    changed: safeInt(d.counts!.changed),
  };
  const cost = {
    base: { core: safeInt(d.cost!.base.core), gold: safeInt(d.cost!.base.gold) },
    head: { core: safeInt(d.cost!.head.core), gold: safeInt(d.cost!.head.gold) },
  };
  const nodes = [safeInt(d.nodes![0]), safeInt(d.nodes![1])];
  const edges = [safeInt(d.edges![0]), safeInt(d.edges![1])];

  const removed = clampList<string>(d.removedIds);
  const changed = clampList<{ id: unknown; name: unknown }>(d.changed);
  const addedEdges = clampList<Record<string, unknown>>(d.addedEdges);
  const removedEdges = clampList<Record<string, unknown>>(d.removedEdges);
  const wipAdded = clampList<string>(d.wipAdded);
  const wipRemoved = clampList<string>(d.wipRemoved);

  const edgeLine = (e: Record<string, unknown>) =>
    `- ${safeText(e.from)} ${safeText(e.fromName)} → ${safeText(e.to)} ${safeText(e.toName)}`;
  const edgeBlock = (title: string, list: { items: Record<string, unknown>[]; rest: number }) =>
    list.items.length === 0 ? '' :
      `\n**${title}**（${list.items.length + list.rest} 條）\n\n`
      + list.items.map(edgeLine).join('\n')
      + (list.rest > 0 ? `\n- …還有 ${list.rest} 條` : '');

  const wipBlock = (title: string, list: { items: string[]; rest: number }) =>
    list.items.length === 0 ? '' :
      `\n${title}：${list.items.map(safeText).join(', ')}${list.rest > 0 ? ` …還有 ${list.rest} 個` : ''}`;

  const removedLine = counts.removed > 0 && removed.items.length > 0
    ? `\n⚠️ **有節點 id 消失**：${removed.items.map(safeText).join(', ')}`
      + `${removed.rest > 0 ? ` …還有 ${removed.rest} 個` : ''}（分享網址會失效）`
    : '';

  const changedBlock = changed.items.length > 0
    ? '\n<details><summary>修改的節點</summary>\n\n'
      + changed.items.map(n => `- ${safeText(n.id)} ${safeText(n.name)}`).join('\n')
      + `${changed.rest > 0 ? `\n- …還有 ${changed.rest} 條` : ''}`
      + '\n</details>'
    : '';

  return [
    SUMMARY_MARKER,
    d.identical === true && d.schemaChanged !== true ? NO_CHANGE_MARKER : '',
    '## 資料差異摘要',
    d.schemaChanged === true
      ? '\n⚠️ **基準資料格式已變更**，這次略過逐項比較——請人工確認這個 PR 對資料的影響。\n'
      : '',
    `- 節點：${nodes[0]} → ${nodes[1]}`,
    `- 邊：${edges[0]} → ${edges[1]}`,
    `- 新增 ${counts.added}｜刪除 ${counts.removed}｜修改 ${counts.changed}`,
    `- 全樹解鎖成本：核心 ${cost.base.core} → ${cost.head.core}，金幣 ${cost.base.gold.toLocaleString('en-US')} → ${cost.head.gold.toLocaleString('en-US')}`,
    removedLine,
    d.edgesRewired === true
      ? '\n⚠️ **邊數不變但前置關係被改動**——解鎖成本可能已經改變，請逐條確認下面的清單。'
      : '',
    edgeBlock('新增的前置關係', addedEdges),
    edgeBlock('刪除的前置關係', removedEdges),
    wipBlock('⚠️ 新標記為待接線（data-wip，會豁免圖結構檢查）', wipAdded),
    wipBlock('取消待接線標記', wipRemoved),
    changedBlock,
  ].filter(Boolean).join('\n');
}

/**
 * 本機／記錄檔用的一站式版本。CI 上不是走這條——CI 走
 * 「PR 端算出 JSON → default branch 的 render-pr-comment.ts 渲染」，見 `renderDiffComment` 的說明。
 */
export function buildDiffSummary(base: TreeData, head: TreeData): string {
  return renderDiffComment(computeDiff(base, head));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [basePath, headPath] = [process.argv[2], process.argv[3]];
  if (!basePath || !headPath) {
    console.error('用法: npx tsx tools/diff-summary.ts <base.json> <head.json>');
    process.exit(1);
  }
  const base = JSON.parse(readFileSync(basePath, 'utf8'));
  const head = JSON.parse(readFileSync(headPath, 'utf8'));
  const data = computeDiff(base, head);
  // 給 CI 上傳的是**資料**不是版面：留言長什麼樣由 default branch 的渲染器決定。
  writeFileSync('diff-summary.json', JSON.stringify(data));
  console.log(renderDiffComment(data));
}
