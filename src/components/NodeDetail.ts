// 節點詳情面板：把一個節點與它的 computeSelection() 結果組成畫面要顯示的 HTML，
// 寫進呼叫端傳進來的 host 元素。純函式（吃資料、寫 DOM），不掛任何事件——
// 點選、鍵盤事件的委派都在呼叫端（src/scripts/tree-canvas.ts）處理。
import { formatCost, formatGrowth, formatUnlockVia } from '../lib/format.js';
import type { TreeNode } from '../lib/types.js';
import type { Selection } from '../lib/selection.js';

const BRANCH_ZH: Record<TreeNode['branch'], string> = {
  nature: '自然', engineering: '工學', magic: '魔法', order: '秩序', chaos: '渾沌',
};
const TYPE_ZH: Record<TreeNode['type'], string> = {
  dice: '骰子', rune: '骰子符文', passive: '玩家被動', support: '支援',
};

const HTML_ESCAPE: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => HTML_ESCAPE[ch] ?? ch);
}

/**
 * 把節點描述轉成可安全塞進 innerHTML 的字串：`\n` 轉 `<br>`，`#關鍵字` 包成
 * `<span class="kw">` 供高亮（未來點擊等同搜尋該關鍵字，見 spec §6.2 第 3 點；
 * 點擊行為留給搜尋功能的任務接線）。
 *
 * 不能單純用「正規表達式比對 # 後面到下一個空白或 # 為止」：遊戲文案的 `#` 標記沒有結束
 * 符號，中文又沒有空格分詞，naive 正規表達式會把 `#` 後面一整句都吃進去（spec 附錄異常 8：
 * 實測 109 個標記中 50 個會這樣壞掉，例如 4008「#陰陽效果的骰子發動」會被整段誤判成一個
 * 關鍵字）。這裡改用 `node.keywords`——已經由 `extractKeywords()`（見 src/lib/keywords.ts）
 * 用白名單＋最長優先比對正確算出——在每個 `#` 位置只吃剛好對得上白名單詞的長度。
 */
function renderDescription(description: string, keywords: readonly string[]): string {
  const sorted = [...keywords].sort((a, b) => b.length - a.length);
  let html = '';
  let i = 0;
  while (i < description.length) {
    const ch = description[i] ?? '';
    if (ch === '#') {
      const rest = description.slice(i + 1);
      const hit = sorted.find(w => rest.startsWith(w));
      if (hit) {
        html += `<span class="kw">#${escapeHtml(hit)}</span>`;
        i += 1 + hit.length;
        continue;
      }
    }
    html += ch === '\n' ? '<br>' : escapeHtml(ch);
    i += 1;
  }
  return html;
}

/** 把節點資料與其前置鏈計算結果渲染進詳情面板容器（#detail，見 DOM id 契約）。 */
export function renderDetail(node: TreeNode, sel: Selection, host: HTMLElement): void {
  const growth = formatGrowth(node);
  const desc = renderDescription(node.description, node.keywords);

  host.innerHTML = `
    <h2>${escapeHtml(node.name)}</h2>
    <p class="meta">${BRANCH_ZH[node.branch]} · ${TYPE_ZH[node.type]} · ${formatUnlockVia(node)}</p>
    ${node.maxLevel > 1 ? `<p class="meta">等級上限 ${node.maxLevel}</p>` : ''}
    ${growth ? `<p class="growth">${escapeHtml(growth)}</p>` : ''}
    ${node.dataIssue === 'placeholder' ? '<p class="warn">數值待補（遊戲資料含未替換佔位符）</p>' : ''}
    <p class="desc">${desc}</p>
    <hr>
    <h3>前置鏈（${sel.chain.size} 個節點）</h3>
    <p class="cost">${formatCost(sel.cost)}</p>
    <p class="note">此為 AND 假設下的上限值，不含強化費用。</p>
    ${sel.skipped.length > 0 ? `<p class="note">已排除 ${sel.skipped.length} 個任務／預設解鎖節點</p>` : ''}
    ${sel.hiddenByFilter > 0 ? `<p class="note">含 ${sel.hiddenByFilter} 個被篩選隱藏的前置</p>` : ''}
    <p class="note">⚠️ 骰子樹重置需要初期化券，且有已解鎖骰子消失的災情回報，重置前請先確認。</p>
  `;
}
