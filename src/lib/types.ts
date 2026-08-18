export type NodeType = 'dice' | 'rune' | 'passive' | 'support';
export type Branch = 'nature' | 'engineering' | 'magic' | 'order' | 'chaos';
export type Element = Branch | 'support';
export type Shape = 'rect' | 'diamond' | 'circle' | 'hex';
export type UnlockVia = 'cost' | 'quest' | 'default';
export type GrowthUnit = '%' | 's' | 'count' | 'x' | '';

export interface Cost { core: number; gold: number }
export interface Growth { base: number; perLevel: number; unit: GrowthUnit }
export interface ParsedCost { cost: Cost; maxLevel: number | null }

export interface TreeNode {
  id: string;
  branch: Branch;
  element: Element;
  type: NodeType;
  name: string;
  label: string;
  shape: Shape;
  size: [number, number];
  x: number;
  y: number;
  unlockCost: Cost;
  unlockVia: UnlockVia;
  maxLevel: number;
  prereqMode: null;
  upgradeCost: null;
  description: string;
  keywords: string[];
  growth: Growth | null;
  dataIssue: 'placeholder' | 'no-growth' | null;
  icon: string;
}

export type Edge = [string, string];

export interface TreeMeta {
  svgVersion: string;
  gameBundle: string;
  updated: string;
  viewBox: [number, number, number, number];
  roots: string[];
  bounds: Record<Branch, [number, number, number, number]>;
  totalUnlockCost: Cost;
  // sprite.size 是圖集本身的實際像素尺寸 [寬, 高]；渲染時巢狀 <image> 的 width/height
  // 必須設成這組數字（不能省略，也不能亂填），否則圖集會被錯誤縮放、每個格子跟著錯位。
  sprite: { url: string; size: [number, number]; index: Record<string, [number, number, number, number]> };
  /**
   * 骰子樹正中央的樞紐裝飾（遊戲內的「骰子樹」本體）。它不是 239 個節點之一——沒有 id、
   * 沒有花費，不參與成本計算、祖先高亮與篩選，只是畫面正中央的錨點，五顆起手骰從它放射出去。
   * 正本沒有這一組時是 null，站台就不畫。
   */
  center: {
    x: number;
    y: number;
    size: [number, number];
    url: string;
    /** 樞紐放射線連到的節點 id（＝五顆起手骰）。 */
    links: string[];
    label: string;
  } | null;
}

export interface TreeData { meta: TreeMeta; nodes: TreeNode[]; edges: Edge[] }
