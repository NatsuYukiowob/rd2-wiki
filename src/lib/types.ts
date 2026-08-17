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
}

export interface TreeData { meta: TreeMeta; nodes: TreeNode[]; edges: Edge[] }
