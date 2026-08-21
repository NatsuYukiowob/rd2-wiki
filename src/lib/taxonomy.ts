import type { Branch, Element, NodeType, PassiveCategory } from './types.js';

const BRANCH_BY_PREFIX: Record<string, Branch> = {
  '1': 'nature', '2': 'engineering', '3': 'magic', '4': 'order', '5': 'chaos',
};
const ELEMENT_BY_STROKE: Record<string, Element> = {
  '#ef625e': 'nature', '#50b7d8': 'engineering', '#a871ec': 'magic',
  '#f3bd55': 'order', '#e979a5': 'chaos', '#f3c5ff': 'support',
};
const TYPE_BY_ZH: Record<string, NodeType> = {
  '骰子': 'dice', '骰子符文': 'rune', '玩家被動': 'passive', '支援': 'support',
};

const CATEGORY_BY_ZH: Record<string, PassiveCategory> = {
  '系別屬性': 'branch-stat', '全骰屬性': 'global-stat', '系別技能': 'branch-skill',
  '玩家被動': 'player-passive', '支援強化': 'support-upgrade',
};

/** 分支由 id 首碼決定；支援節點的分支也跟著 id 首碼走，不是固定的 support。 */
export function branchOfId(id: string): Branch {
  const b = BRANCH_BY_PREFIX[id[0] ?? ''];
  if (!b) throw new Error(`未知的 id 首碼: ${id}`);
  return b;
}
/** element 由節點的 stroke 顏色決定；支援節點的 stroke 固定為 support 色。 */
export function elementOfStroke(stroke: string): Element {
  const e = ELEMENT_BY_STROKE[stroke.toLowerCase()];
  if (!e) throw new Error(`未知的 stroke: ${stroke}`);
  return e;
}
/** SVG `data-type` 中文對照到站台用的 NodeType。 */
export function typeOfZh(zh: string): NodeType {
  const t = TYPE_BY_ZH[zh];
  if (!t) throw new Error(`未知的 type: ${zh}`);
  return t;
}
/** SVG `data-category` 中文對照到站台用的 PassiveCategory。 */
export function categoryOfZh(zh: string): PassiveCategory {
  const c = CATEGORY_BY_ZH[zh];
  if (!c) throw new Error(`未知的 category: ${zh}`);
  return c;
}
