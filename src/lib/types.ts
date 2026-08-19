export type NodeType = 'dice' | 'rune' | 'passive' | 'support';
export type Branch = 'nature' | 'engineering' | 'magic' | 'order' | 'chaos';
export type Element = Branch | 'support';
/**
 * 玩家被動的細分類（遊戲資料表的「種類」欄）。
 *
 * `type` 只分四種，70 個玩家被動全擠在同一格；遊戲自己是分五類的，而且差別對玩家是實的：
 * 「系別屬性」只加本系骰子、「全骰屬性」加全部，兩者常常同名同描述格式，光看 `type` 分不出來。
 *
 * `support-upgrade` 是本站的命名：遊戲資料表把支援角色與它的冷卻縮減都標成「支援」，
 * 但前者是 `type === 'support'` 的節點、後者是玩家被動，混用同一個字會讓面板寫出
 * 「支援 · 支援」與「玩家被動 · 支援」兩種都看不懂的組合。
 */
export type PassiveCategory =
  | 'branch-stat' | 'global-stat' | 'branch-skill' | 'player-passive' | 'support-upgrade';
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
  /**
   * 骰子覺醒：該骰子達到 7 骰點時自動啟用的效果，只有 `type === 'dice'` 的節點才有。
   *
   * 它不是骰子樹上的節點——不用花核心或金幣解鎖、沒有前置、也不參與成本計算，所以刻意
   * 掛在骰子身上當一個欄位，而不是新增 41 個節點（那會動到 239／248 這組不變量，
   * 也會讓「解鎖成本」憑空多出一筆玩家其實不用付的錢）。
   */
  awakening?: string;
  /** 玩家被動的細分類；只有 `type === 'passive'` 的節點有（規則 16）。 */
  category?: PassiveCategory;
  /** 描述文字（不含 awakening）裡用到的 `#關鍵字`。 */
  keywords: string[];
  growth: Growth | null;
  dataIssue: 'placeholder' | 'no-growth' | null;
  icon: string;
  /**
   * `data-wip="1"`＝先佔位、還沒接線（規則 6(c)／6(d)）。只有在為真時才寫進 tree.json，
   * 所以現況（0 個 wip 節點）不佔任何 gzip 預算。
   *
   * 它進到產物裡是為了讓 PR 差異摘要看得見「誰被標成 wip、誰被取消 wip」——那個標記會讓節點
   * 豁免圖結構檢查，是資料裡權限最大的一個開關，改動它必須在留言上留下痕跡。
   */
  wip?: true;
}

export type Edge = [string, string];

/**
 * 一條遊戲內建的狀態詞彙（`#關鍵字`）解釋，資料正本是 `data/keywords.json`——那份檔案抄自
 * 遊戲資源包自己的詞彙表，同時扮演兩個角色：規則 8 的 `#` 標記白名單，以及玩家看得到的解釋。
 * 兩者刻意共用一份，才不會出現「白名單有這個詞、但站上點開沒有解釋」的半套資料。
 */
export interface GlossaryEntry {
  /** 遊戲資源包裡的代碼（例如 FROZEN）。給貢獻者對照原始資料用，站台不顯示。 */
  code: string;
  /** 遊戲內這個標記的底色；同色代表同一類機制（橘＝骰子機制、紫＝減益、藍＝召喚物…）。 */
  color: string;
  desc: string;
}

/**
 * 詞彙表送進 tree.json 的形狀：`code` 只在 `data/keywords.json` 裡給貢獻者比對遊戲資源檔用，
 * 站台一個字都不顯示，所以不隨每次載入送給瀏覽器（39 條省下約 0.7 KB，而 gzip 預算只有 20 KB）。
 */
export type GlossaryDisplay = Omit<GlossaryEntry, 'code'>;

/**
 * 同一個遊戲代碼被官方翻成兩個顯示名時，把後出現的那個指回本尊，而不是抄一份解釋。
 *
 * 實例（v1.0.1 資源包）：`TRANSFER` 在詞彙表裡是 `#SP怪物`，貪婪骰子的覺醒文案卻寫 `#傳送`；
 * `SOW` 在詞彙表裡是 `#果實`，花骰子的覺醒文案卻寫 `#播種`。兩份解釋各留一份的話，
 * 哪天上游改了字，只會有一邊被更新而且沒有人會發現。
 */
export interface GlossaryAlias { aliasOf: string }

/** `data/keywords.json` 裡一則詞條的兩種可能形狀。 */
export type GlossaryRecord = GlossaryEntry | GlossaryAlias;

export function isGlossaryAlias(r: GlossaryRecord): r is GlossaryAlias {
  return 'aliasOf' in r;
}

/**
 * 技能升級花費表（`data/upgrade-cost.json`）。
 *
 * ⚠️ **只適用骰子符文**，`appliesTo` 就是拿來擋這件事的：玩家被動的等級上限有 10／15／20／
 * 50／100 五種、單價也各不相同（金幣 3,000 到 15,000），套這張表會算出一個看起來很專業的
 * 錯數字。`level 1` 那一列就是解鎖那一次，金額與符文 `data-cost` 的首級金幣相同（規則 15 對過）。
 */
export interface UpgradeCostTable {
  appliesTo: { type: NodeType; maxLevel: number };
  levels: { level: number; gold: number; core: number }[];
}

export interface TreeMeta {
  svgVersion: string;
  gameBundle: string;
  /** 玩家在遊戲裡看得到的版本號（例如 1.0.1），跟 gameBundle 的內部資源包編號是兩件事。 */
  gameVersion: string;
  updated: string;
  viewBox: [number, number, number, number];
  roots: string[];
  bounds: Record<Branch, [number, number, number, number]>;
  totalUnlockCost: Cost;
  /**
   * 節點描述裡真的用得到的 `#關鍵字` 解釋。刻意只放用得到的（含這些解釋自己再引用到的詞），
   * 不是整份 data/keywords.json：白名單是資料規則、要涵蓋未來的資料，而這裡是要傳到瀏覽器的
   * 位元組，得受 tree.json 的 gzip 預算管。
   */
  glossary: Record<string, GlossaryDisplay>;
  /** 技能升級花費表；正本沒有這份資料時是 null，站台就不顯示累計花費。 */
  upgradeCostTable: UpgradeCostTable | null;
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
    /** 標籤基線相對樞紐中心的垂直位移（正本說了算，見 tools/lib/svg-parse.ts 的說明）。 */
    labelDy: number;
  } | null;
}

export interface TreeData { meta: TreeMeta; nodes: TreeNode[]; edges: Edge[] }
