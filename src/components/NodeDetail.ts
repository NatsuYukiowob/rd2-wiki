// 節點詳情面板：把一個節點與它的 computeSelection() 結果組成畫面要顯示的 HTML，
// 寫進呼叫端傳進來的 host 元素。純函式（吃資料、寫 DOM），不掛任何事件——
// 點選、鍵盤事件的委派都在呼叫端（src/scripts/tree-canvas.ts）處理。
//
// 面板是一疊「視圖」而不是一張固定的卡片（2026-08-20）：點描述裡的 `#關鍵字` 或
// 「骰子覺醒」那一列，會在**同一張卡片裡**換頁（左滑推入），左上角出現返回鍵。
// 這裡只負責產生每一種視圖的 HTML；堆疊、動畫、瀏覽器上一頁的接線都在 tree-canvas.ts。
import { formatCost, formatGrowth, formatUnlockVia } from '../lib/format.js';
import { cumulativeUpgradeCost, upgradeTableApplies } from '../lib/cost.js';
import type { GlossaryDisplay, TreeNode, UpgradeCostTable } from '../lib/types.js';
import type { Selection } from '../lib/selection.js';

const BRANCH_ZH: Record<TreeNode['branch'], string> = {
  nature: '自然', engineering: '工學', magic: '魔法', order: '秩序', chaos: '渾沌',
};
const TYPE_ZH: Record<TreeNode['type'], string> = {
  dice: '骰子', rune: '骰子符文', passive: '玩家被動', support: '支援',
};
/**
 * 玩家被動的細分類。有分類時顯示它而不是「玩家被動」——70 個節點全寫同一個字沒有資訊量，
 * 而「系別屬性只加本系、全骰屬性加全部」正是玩家分不出來、又真的會影響取捨的那件事。
 */
const CATEGORY_ZH: Record<NonNullable<TreeNode['category']>, string> = {
  'branch-stat': '系別屬性', 'global-stat': '全骰屬性', 'branch-skill': '系別技能',
  'player-passive': '玩家被動', 'support-upgrade': '支援強化',
};

/** 覺醒的啟用條件。遊戲資料表的「升級需求」欄 41 條全是這一個字串，所以是常數不是欄位。 */
const AWAKENING_CONDITION = '7 骰點時啟用';

const HTML_ESCAPE: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => HTML_ESCAPE[ch] ?? ch);
}

/**
 * 把節點描述轉成可安全塞進 innerHTML 的字串：`\n` 轉 `<br>`，`#關鍵字` 包成
 * `<button class="kw">`——點下去會在同一張卡片裡推出那個詞的解釋（見 tree-canvas.ts 的委派）。
 *
 * 用 `<button>` 而不是 `<span>`：它本來就能 Tab 聚焦、能按 Enter/Space 觸發、螢幕閱讀器
 * 會念成按鈕。用 `<span role="button" tabindex="0">` 要自己補鍵盤處理，補漏一項就是一個
 * 只有滑鼠能用的功能。
 *
 * 不能單純用「正規表達式比對 # 後面到下一個空白或 # 為止」：遊戲文案的 `#` 標記沒有結束
 * 符號，中文又沒有空格分詞，naive 正規表達式會把 `#` 後面一整句都吃進去（spec 附錄異常 8：
 * 實測 109 個標記中 50 個會這樣壞掉，例如 4008「#陰陽效果的骰子發動」會被整段誤判成一個
 * 關鍵字）。這裡改用白名單＋最長優先比對，在每個 `#` 位置只吃剛好對得上白名單詞的長度。
 */
function renderDescription(
  description: string,
  keywords: readonly string[],
  glossary: Record<string, GlossaryDisplay>,
): string {
  const sorted = [...keywords].sort((a, b) => b.length - a.length);
  let html = '';
  let i = 0;
  while (i < description.length) {
    const ch = description[i] ?? '';
    if (ch === '#') {
      const rest = description.slice(i + 1);
      const hit = sorted.find(w => rest.startsWith(w));
      if (hit) {
        const entry = glossary[hit];
        // 顏色照抄遊戲內該標記的底色（同色＝同一類機制），詞彙表查不到就退回統一強調色。
        // 用 style 而不是 class：顏色是資料（data/keywords.json）不是版面，加一個詞不該要改 CSS。
        const style = entry ? ` style="color:${escapeHtml(entry.color)}"` : '';
        html += `<button type="button" class="kw" data-term="${escapeHtml(hit)}"${style}>#${escapeHtml(hit)}</button>`;
        i += 1 + hit.length;
        continue;
      }
    }
    html += ch === '\n' ? '<br>' : escapeHtml(ch);
    i += 1;
  }
  return html;
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
): string {
  const growth = formatGrowth(node);
  const desc = renderDescription(node.description, node.keywords, glossary);
  // 練滿的累計花費。表格只適用骰子符文（見 UpgradeCostTable），套不上就整列不顯示——
  // 顯示一個算錯的總價比什麼都不顯示糟得多。
  const maxUpgrade = upgradeTableApplies(upgradeCostTable, node)
    ? cumulativeUpgradeCost(upgradeCostTable, node.maxLevel)
    : null;

  return `
    <p class="meta">${BRANCH_ZH[node.branch]} · ${node.category ? CATEGORY_ZH[node.category] : TYPE_ZH[node.type]} · ${formatUnlockVia(node)}</p>
    ${node.maxLevel > 1 ? `<p class="meta">等級上限 ${node.maxLevel}</p>` : ''}
    ${maxUpgrade ? `<p class="upgrade">練滿 ${node.maxLevel} 級累計 ${escapeHtml(formatCost(maxUpgrade))}<span class="cond">含解鎖那一次</span></p>` : ''}
    ${growth ? `<p class="growth">${escapeHtml(growth)}</p>` : ''}
    ${node.dataIssue === 'placeholder' ? '<p class="warn">數值待補（遊戲資料含未替換佔位符）</p>' : ''}
    <p class="desc">${desc}</p>
    ${node.awakening ? `<button type="button" class="awakening-link" data-detail-awakening>骰子覺醒<span class="cond">${AWAKENING_CONDITION}</span><span class="chev" aria-hidden="true">›</span></button>` : ''}
    <hr>
    <h3>前置鏈（${sel.chain.size} 個節點）</h3>
    <p class="cost">${formatCost(sel.cost)}</p>
    <p class="note">此為 AND 假設下的上限值，不含強化費用。</p>
    ${sel.skipped.length > 0 ? `<p class="note">已排除 ${sel.skipped.length} 個任務／預設解鎖節點</p>` : ''}
    ${sel.hiddenByFilter > 0 ? `<p class="note">含 ${sel.hiddenByFilter} 個被篩選隱藏的前置</p>` : ''}
    <p class="note">⚠️ 骰子樹重置需要初期化券，且有已解鎖骰子消失的災情回報，重置前請先確認。</p>
  `;
}

/** 根視圖（節點）的 HTML。`back` 恆為 false——它是堆疊最底層。 */
export function nodeViewHtml(
  node: TreeNode,
  sel: Selection,
  glossary: Record<string, GlossaryDisplay> = {},
  upgradeCostTable: UpgradeCostTable | null = null,
): string {
  return viewShell({
    title: escapeHtml(node.name),
    body: nodeBody(node, sel, glossary, upgradeCostTable),
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
  glossary: Record<string, GlossaryDisplay> = {},
  upgradeCostTable: UpgradeCostTable | null = null,
): void {
  host.innerHTML = `<div class="stack">${nodeViewHtml(node, sel, glossary, upgradeCostTable)}</div>`;
}
