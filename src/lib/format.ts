// 成本與成長值的顯示格式化：把資料層的原始數字轉成使用者看得懂的中文字串。
// 純函式，不碰 DOM——DOM 組裝在 src/components/NodeDetail.ts。
import { maxLevelValue } from './growth.js';
import type { Cost, GrowthUnit, TreeNode } from './types.js';

// 成長值單位對照表。key 用 GrowthUnit 這個精確聯集型別（而非 Record<string, string>），
// 讓編譯器強制要求五種單位全部涵蓋到——少寫一種會直接編譯失敗，不會漏到執行期才發現。
// 'count'（次／個）是 growth.ts 把遊戲文案兩種寫法合併成的同一個單位，資料裡已經回不去
// 原始用字，顯示上取較通用的「次」。
const UNIT_TEXT: Record<GrowthUnit, string> = {
  '%': '%',
  s: '秒',
  count: '次',
  x: '倍',
  '': '',
};

/**
 * 把解鎖成本格式化成含千分位的顯示字串，例：「核心 26 ＋ 金幣 12,000」。
 * 只有一種貨幣有值時不顯示另一種；兩者皆為 0 顯示「免費」。
 */
export function formatCost(c: Cost): string {
  const parts: string[] = [];
  if (c.core > 0) parts.push(`核心 ${c.core.toLocaleString('en-US')}`);
  if (c.gold > 0) parts.push(`金幣 ${c.gold.toLocaleString('en-US')}`);
  return parts.length > 0 ? parts.join(' ＋ ') : '免費';
}

/**
 * 換算節點從 1 級到滿級的成長值，例：「1 級 20% → 15 級 90%」。
 * 等級上限為 1（無成長曲線可言）或沒有成長資料時回傳 null，由呼叫端決定要不要顯示這一列
 * （spec §6.2 第 3 點：`maxLevel > 1` 但無成長資料者只顯示等級上限，不顯示換算列）。
 */
export function formatGrowth(node: TreeNode): string | null {
  if (!node.growth || node.maxLevel <= 1) return null;
  const unit = UNIT_TEXT[node.growth.unit];
  const top = maxLevelValue(node.growth, node.maxLevel);
  return `1 級 ${node.growth.base}${unit} → ${node.maxLevel} 級 ${top}${unit}`;
}

/**
 * 節點解鎖方式的顯示文字。
 *
 * `unlockVia !== 'cost'` 的節點（任務解鎖／預設解鎖，全樹目前只有 `4008` 陰陽骰子與
 * `2001` 鐵甲骰子兩個）雖然 `unlockCost` 欄位仍有數字，但那不是玩家能實際花這筆錢買到
 * 的價格——`sumUnlockCost()` 本來就會把它們從成本合計排除（見 graph.ts）。詳情面板若
 * 無條件對這兩個節點也顯示 `formatCost(unlockCost)`，會在同一個面板裡自相矛盾：上面
 * meta 列寫著「核心 8」，下面成本區塊卻寫「免費」還註明「已排除」，並暗示玩家可以花
 * 核心買到只能靠任務取得的節點（審查回饋，2026-08-17 第 1 輪修正）。
 */
export function formatUnlockVia(node: Pick<TreeNode, 'unlockVia' | 'unlockCost'>): string {
  if (node.unlockVia === 'quest') return '任務解鎖';
  if (node.unlockVia === 'default') return '預設解鎖';
  return formatCost(node.unlockCost);
}
