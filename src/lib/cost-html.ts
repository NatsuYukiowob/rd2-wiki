import type { Cost } from './types.js';

/**
 * 成本的 HTML 版：每一種貨幣前面帶一張遊戲內的貨幣圖（金幣／骰子核心／太陽核心），
 * 文字部分跟 `formatCost()` 逐字相同（Yuki 2026-09-06 指定「金幣(圖) 骰子核心(圖) 太陽核心(圖)」）。
 *
 * 三個刻意的取捨：
 * 1. **圖是裝飾，`alt=""`**——貨幣名稱本來就印在旁邊，螢幕閱讀器念「金幣 100,000」就夠了；
 *    給圖一個 alt 會變成「金幣 金幣 100,000」。也因此 innerText／textContent 跟純文字版
 *    一模一樣，既有那些 `toHaveText('核心 30 ＋ 金幣 …')` 的斷言一條都不必改。
 * 2. **純文字版 `formatCost()` 留著**給 aria-label、`simReport()` 文字報告、PR 差異摘要用——
 *    那些地方沒有 DOM，塞 `<img>` 只會變成一串標籤字面。
 * 3. 圖檔放 `public/currency/`（不在 `public/assets/`——那個目錄是 build:data 的產出、整個
 *    gitignored），路徑走站台根目錄 `/currency/…`，Cloudflare Pages 與本機 serve 都照樣拿得到。
 *    16×16 的 width/height 只是預先佔位防止排版抖動，實際大小由 `.currency-icon` 的 `1em` 決定。
 */
export type CurrencyKind = 'core' | 'gold' | 'solar';

/**
 * 圖示用得到、但 `Cost` 裝不下的第四種貨幣：**討伐硬幣**（`/rift-shop` 的裂縫商店計價）。
 *
 * ⚠️ 刻意**不加進 `CurrencyKind`**：`Cost` 是骰子樹的三格數字（核心／金幣／太陽核心），
 * 全站的成本加總、`/sim` 的側欄、規則 4 與差異摘要都建立在「就這三種」之上。討伐硬幣是
 * 困難合作模式的**局內**貨幣（客戶端 `GoodsTable` 裡根本沒有它，跟 SP 一樣一局結束就沒了），
 * 加進去等於讓每一處成本運算都多背一個永遠是 0 的欄位。它只需要一張圖，所以只擴圖示這一層。
 */
export type CurrencyIconKind = CurrencyKind | 'tacticcoin';

const CURRENCY: Record<CurrencyIconKind, { label: string; file: string }> = {
  core: { label: '核心', file: 'core.png' },
  gold: { label: '金幣', file: 'gold.png' },
  solar: { label: '太陽核心', file: 'solar.png' },
  tacticcoin: { label: '討伐硬幣', file: 'tacticcoin.png' },
};

export function currencyIcon(kind: CurrencyIconKind): string {
  return `<img class="currency-icon" src="/currency/${CURRENCY[kind].file}" alt="" width="16" height="16" aria-hidden="true">`;
}

function part(kind: CurrencyKind, n: number): string {
  return `${currencyIcon(kind)}${CURRENCY[kind].label} ${n.toLocaleString('en-US')}`;
}

/** `formatCost()` 的帶圖版：有值的貨幣才印，順序核心→金幣→太陽核心，皆為 0 印「免費」。 */
export function costHtml(c: Cost): string {
  const parts: string[] = [];
  if (c.core > 0) parts.push(part('core', c.core));
  if (c.gold > 0) parts.push(part('gold', c.gold));
  if (c.solar > 0) parts.push(part('solar', c.solar));
  return parts.length > 0 ? parts.join(' ＋ ') : '免費';
}

/**
 * `/sim` 側欄三列合計的帶圖版：核心與金幣**永遠印**（0 也印，那三列是常駐的儀表板，
 * 「核心 0」是資訊不是雜訊），太陽核心只在有值時多接一段——文字跟 `src/scripts/sim.ts`
 * 原本的 `cost()` 逐字相同。
 */
export function simCostHtml(c: Cost): string {
  return `${part('core', c.core)} ／${part('gold', c.gold)}` + (c.solar > 0 ? ` ／${part('solar', c.solar)}` : '');
}
