// 節點詳情面板：把一個節點與它的 computeSelection() 結果組成畫面要顯示的 HTML，
// 寫進呼叫端傳進來的 host 元素。純函式（吃資料、寫 DOM），不掛任何事件——
// 點選、鍵盤事件的委派都在呼叫端（src/scripts/tree-canvas.ts）處理。
//
// 面板是一疊「視圖」而不是一張固定的卡片（2026-08-20）：點描述裡的 `#關鍵字` 或
// 「骰子覺醒」那一列，會在**同一張卡片裡**換頁（左滑推入），左上角出現返回鍵。
// 這裡只負責產生每一種視圖的 HTML；堆疊、動畫、瀏覽器上一頁的接線都在 tree-canvas.ts。
import { formatGrowth, formatUnlockVia } from '../lib/format.js';
import { costHtml } from '../lib/cost-html.js';
import { levelTableFor, upgradeExtraCost } from '../lib/upgrade-tiers.js';
import type { Cost, GlossaryDisplay, PassiveUpgradeCost, TreeNode, UpgradeCostTable } from '../lib/types.js';
import type { Selection } from '../lib/selection.js';
import { escapeHtml, renderTaggedText } from '../lib/markup.js';
import { AWAKENING_CONDITION, BRANCH_ZH, typeLabel } from '../lib/labels.js';

/**
 * 面板版的描述渲染：`#關鍵字` 包成 `<button class="kw">`，點下去會在同一張卡片裡推出
 * 那個詞的解釋（見 tree-canvas.ts 的委派）。斷詞邏輯本身在 src/lib/markup.ts——靜態頁
 * （/dice、/guide）用同一支斷詞器、換一種包法，兩邊不會各養一份而漂移。
 *
 * 用 `<button>` 而不是 `<span>`：它本來就能 Tab 聚焦、能按 Enter/Space 觸發、螢幕閱讀器
 * 會念成按鈕。用 `<span role="button" tabindex="0">` 要自己補鍵盤處理，補漏一項就是一個
 * 只有滑鼠能用的功能。
 */
function renderDescription(
  description: string,
  keywords: readonly string[],
  glossary: Record<string, GlossaryDisplay>,
): string {
  return renderTaggedText(description, keywords, glossary, (term, entry) => {
    // 顏色照抄遊戲內該標記的底色（同色＝同一類機制），詞彙表查不到就退回統一強調色。
    // 用 style 而不是 class：顏色是資料（data/keywords.json）不是版面，加一個詞不該要改 CSS。
    const style = entry ? ` style="color:${escapeHtml(entry.color)}"` : '';
    return `<button type="button" class="kw" data-term="${escapeHtml(term)}"${style}>#${escapeHtml(term)}</button>`;
  });
}

/**
 * 一張視圖的外殼：頂部工具列（返回／關閉）＋標題＋內容。
 *
 * ✕ 每一層都給，← 只在推進過至少一層之後才出現——深到第三層還要按三次返回才關得掉，
 * 那是把「離開」變成一件需要耐心的事。
 */
function viewShell(opts: { title: string; body: string; back: boolean }): string {
  // tabindex="-1"：推入／返回之後要用程式把焦點移進來（見 tree-canvas.ts）。少了這一步，
  // 舊視圖一 display:none，焦點就掉回 <body>，Esc 與 Tab 都不再落在卡片上。
  return `<section class="view" tabindex="-1">
    <div class="view-head">
      ${opts.back ? '<button type="button" class="view-back" data-detail-back aria-label="返回上一頁">←</button>' : ''}
      <h2>${opts.title}</h2>
      <button type="button" class="view-close" data-detail-close aria-label="關閉詳情">✕</button>
    </div>
    ${opts.body}
  </section>`;
}

/** 節點視圖的內容（不含外殼）。 */
function nodeBody(
  node: TreeNode,
  sel: Selection,
  glossary: Record<string, GlossaryDisplay>,
  upgradeCostTable: UpgradeCostTable | null,
  tables: PassiveUpgradeCost,
): string {
  const growth = formatGrowth(node);
  const desc = renderDescription(node.description, node.keywords, glossary);
  // 練滿的累計花費＝解鎖那一筆 ＋ Lv.2 → maxLevel 的追加。查不到費用表就整列不顯示——
  // 顯示一個算錯的總價比什麼都不顯示糟得多。
  //
  // ⚠️ **查表一律走 `levelTableFor()`（跟 `/sim` 同一個判準），不要用 `upgradeTableApplies()`**：
  // 那支只認通用符文表（`type === 'rune'` ＋ `maxLevel === 50`），而 1601 太陽強化雖然剛好
  // 符合那兩個條件，它的費用卻在 `data/passive-upgrade-cost.json` 的 `special` 裡（逐級金幣
  // 與太陽核心都不同、一顆核心都不用）。用通用表算出來的是「核心 99 ＋ 金幣 465,700」——
  // 一個看起來很專業、而且跟真實費用（金幣 40,500,000 ＋ 太陽核心 81,000）差了兩個數量級的
  // 數字。`levelTableFor()` 明確讓 special 優先，兩張表的優先順序只有那一份實作。
  const levels = levelTableFor(node, tables, upgradeCostTable);
  const extra = levels ? upgradeExtraCost(levels, node.maxLevel) : null;
  const maxUpgrade: Cost | null = extra && {
    core: extra.core + node.unlockCost.core,
    gold: extra.gold + node.unlockCost.gold,
    solar: extra.solar + node.unlockCost.solar,
  };

  // 兩欄：左欄是「這個節點是什麼」，右欄是「要花多少才走得到」，
  // 最後那句重置警告（spec §2.1 強制要求，永遠是卡片最後一段）**跨兩欄**放底部——
  // 它是三段裡最長的一句，塞在右欄會把整張卡片撐高、左欄底下留一大塊空白。
  // ⚠️ 分欄是**版面**不是內容，所以只加兩層 <div>、由 CSS 決定要不要真的並排
  //（桌機兩欄、手機仍是一欄，見 src/pages/tree.astro 的媒體查詢）。
  // 原本兩段之間的 <hr> 拿掉了：並排之後那條橫線會橫跨兩欄、切在莫名其妙的位置，
  // 分隔改由 .chain 的左框線（手機是上框線）給。
  return `
    <div class="node-body">
      <div class="col">
        <p class="meta">${BRANCH_ZH[node.branch]} · ${typeLabel(node)} · ${node.unlockVia === 'cost' ? costHtml(node.unlockCost) : escapeHtml(formatUnlockVia(node))}</p>
        ${node.maxLevel > 1 ? `<p class="meta">等級上限 ${node.maxLevel}</p>` : ''}
        ${maxUpgrade ? `<p class="upgrade">練滿 ${node.maxLevel} 級累計 ${costHtml(maxUpgrade)}<span class="cond">含解鎖那一次</span></p>` : ''}
        ${growth ? `<p class="growth">${escapeHtml(growth)}</p>` : ''}
        ${node.dataIssue === 'placeholder' ? '<p class="warn">數值待補（遊戲資料含未替換佔位符）</p>' : ''}
        <p class="desc">${desc}</p>
        ${node.awakening ? `<button type="button" class="awakening-link" data-detail-awakening>骰子覺醒<span class="cond">${AWAKENING_CONDITION}</span><span class="chev" aria-hidden="true">›</span></button>` : ''}
      </div>
      <div class="col chain">
        <h3>前置鏈（${sel.chain.size} 個節點）</h3>
        ${sel.prereqRanks.length > 0
          // 有必要練等時分三件事講：總計、解鎖前置、每一段練等各多少。混成一個數字的話，
          // 太陽骰子那 595,700 金幣裡有 78% 其實是拿去練 1201 的，玩家完全看不出來。
          ? `<p class="cost">總計 ${costHtml(sel.totalCost)}</p>
        <p class="note">解鎖前置 ${costHtml(sel.cost)}</p>
        ${sel.prereqRanks.map(r =>
          // cost 是 null ＝查不到費用表。**寫「成本未確認」而不是印 0**：「這一段免費」跟
          // 「這一段算不出來」在畫面上必須是兩件事（見 PrereqRankCost 的說明）。
          `<p class="note">前置練等 ${escapeHtml(r.name)} Lv.${r.rank}：${r.cost ? costHtml(r.cost) : '成本未確認'}</p>`
        ).join('\n        ')}`
          : `<p class="cost">${costHtml(sel.cost)}</p>`}
        <p class="note">此為 AND 假設下的上限值${sel.prereqRanks.length > 0 ? '；除了上列必要練等之外，不含其他強化費用' : '，不含強化費用'}。</p>
        ${sel.skipped.length > 0 ? `<p class="note">已排除 ${sel.skipped.length} 個非成本解鎖節點</p>` : ''}
        ${sel.bypassNodes > 0 ? `<p class="note">鏈上有 ${sel.bypassNodes} 顆可直接領的骰子，通往它的前置邊畫成虛線</p>` : ''}
        ${sel.bypassed > 0 ? `<p class="note">因此已跳過 ${sel.bypassed} 個前置</p>` : ''}
        ${sel.hiddenByFilter > 0 ? `<p class="note">含 ${sel.hiddenByFilter} 個被篩選隱藏的前置</p>` : ''}
      </div>
      <p class="note reset-warn">⚠️ 骰子樹重置需要初期化券，且有已解鎖骰子消失的災情回報，重置前請先確認。</p>
    </div>
  `;
}

/**
 * 根視圖（節點）的 HTML。`back` 恆為 false——它是堆疊最底層。
 *
 * ⚠️ `glossary`／`upgradeCostTable`／`tables` **刻意都沒有預設值**：三者少傳一個的後果都是
 * 面板安靜地少一段或印出錯的數字（詞彙不再可點、練滿那一列消失、1601 拿到通用表的數字），
 * 而型別檢查與測試都不會有反應。要跳過就得自己寫一個 null 出來，那是看得見的決定。
 */
export function nodeViewHtml(
  node: TreeNode,
  sel: Selection,
  glossary: Record<string, GlossaryDisplay>,
  upgradeCostTable: UpgradeCostTable | null,
  tables: PassiveUpgradeCost,
): string {
  return viewShell({
    title: escapeHtml(node.name),
    body: nodeBody(node, sel, glossary, upgradeCostTable, tables),
    back: false,
  });
}

/**
 * 關鍵字視圖：一個詞的解釋。解釋裡再引用到的詞照樣是可點的 `.kw`，點下去再推一層——
 * 這就是「同一張卡片換頁」取代常駐解釋清單的理由：巢狀不必再想怎麼攤平。
 */
export function termViewHtml(term: string, glossary: Record<string, GlossaryDisplay>): string {
  const entry = glossary[term];
  const body = entry
    ? `<p class="desc">${renderDescription(entry.desc, Object.keys(glossary), glossary)}</p>
    <button type="button" class="kw-search" data-detail-search="${escapeHtml(term)}">搜尋 #${escapeHtml(term)}</button>`
    : '<p class="warn">這個詞不在詞彙表裡</p>';
  const color = entry ? ` style="color:${escapeHtml(entry.color)}"` : '';
  return viewShell({ title: `<span${color}>#${escapeHtml(term)}</span>`, body, back: true });
}

/** 骰子覺醒視圖。沒有覺醒的節點不會走到這裡（呼叫端只在 `node.awakening` 有值時推）。 */
export function awakeningViewHtml(node: TreeNode, glossary: Record<string, GlossaryDisplay>): string {
  return viewShell({
    title: '骰子覺醒',
    body: `<p class="meta">${escapeHtml(node.name)} · ${AWAKENING_CONDITION}</p>
    <p class="desc">${renderDescription(node.awakening ?? '', Object.keys(glossary), glossary)}</p>`,
    back: true,
  });
}

/**
 * 把節點資料與其前置鏈計算結果渲染進詳情面板容器（#detail，見 DOM id 契約），
 * 並把視圖堆疊重設成只有根視圖一層。
 */
export function renderDetail(
  node: TreeNode,
  sel: Selection,
  host: HTMLElement,
  glossary: Record<string, GlossaryDisplay>,
  upgradeCostTable: UpgradeCostTable | null,
  tables: PassiveUpgradeCost,
): void {
  host.innerHTML = `<div class="stack">${nodeViewHtml(node, sel, glossary, upgradeCostTable, tables)}</div>`;
}
