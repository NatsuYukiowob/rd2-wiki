// 節點分類的中文顯示字。
//
// 抽出來成獨立模組，是因為現在有兩個地方要印同一組字：/tree 的詳情面板（NodeDetail.ts）
// 與 /dice 圖鑑的卡片。各留一份的話，哪天遊戲把「系別屬性」改名，兩頁會顯示不同的東西，
// 而且不會有任何測試說話。
import type { TreeNode } from './types.js';

export const BRANCH_ZH: Record<TreeNode['branch'], string> = {
  nature: '自然', engineering: '工學', magic: '魔法', order: '秩序', chaos: '渾沌',
};

export const TYPE_ZH: Record<TreeNode['type'], string> = {
  dice: '骰子', rune: '骰子符文', passive: '玩家被動', support: '支援',
};

/**
 * 玩家被動的細分類。有分類時顯示它而不是「玩家被動」——70 個節點全寫同一個字沒有資訊量，
 * 而「系別屬性只加本系、全骰屬性加全部」正是玩家分不出來、又真的會影響取捨的那件事。
 */
export const CATEGORY_ZH: Record<NonNullable<TreeNode['category']>, string> = {
  'branch-stat': '系別屬性', 'global-stat': '全骰屬性', 'branch-skill': '系別技能',
  'player-passive': '玩家被動', 'support-upgrade': '支援強化',
};

/** 節點在畫面上的類型字：玩家被動優先顯示細分類。 */
export function typeLabel(node: Pick<TreeNode, 'type' | 'category'>): string {
  return node.category ? CATEGORY_ZH[node.category] : TYPE_ZH[node.type];
}

/** 骰子覺醒的啟用條件。遊戲資料表的「升級需求」欄 41 條全是這一個字串，所以是常數不是欄位。 */
export const AWAKENING_CONDITION = '7 骰點時啟用';
