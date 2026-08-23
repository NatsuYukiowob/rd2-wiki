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
/**
 * 節點的取得方式——它只說「靠什麼開門」，**不等於「要不要付錢」**。
 *
 * ⚠️ 這兩件事一度被綁在一起（`cost` 以外＝不用付錢），2026-08-23 拆開了：官方資料表
 * v1.0.3 v2 把恐懼骰子寫成「合作累積900擊殺後，使用8核心解鎖」。付不付錢現在看
 * `unlockPaid`，`sumUnlockCost()` 與 `upgradeTableApplies()` 兩邊排除的判準都是
 * `unlockVia === 'cost' || unlockPaid`。
 *
 * `quest` 與 `achievement` 分開：前者是遊戲裡的任務系統（新手任務點數），後者是累計進度
 * 獎勵（合作擊殺數、競技場分數）。玩家拿到它們的路徑完全不同，混成一種的話面板只能寫
 * 「任務解鎖」，而那對一顆要靠競技場積分才拿得到的骰子是錯的。
 */
export type UnlockVia = 'cost' | 'quest' | 'default' | 'achievement';
export type GrowthUnit = '%' | 's' | 'count' | 'x' | '';

export interface Cost { core: number; gold: number }
export interface Growth { base: number; perLevel: number; unit: GrowthUnit }
export interface ParsedCost { cost: Cost }

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
  /**
   * 官方資料表寫的取得條件原文（「合作累積2100擊殺後，從討伐獎勵領取（無視骰子樹前置）」）。
   *
   * 只有 `unlockVia !== 'cost'` 的節點才有，來源是 `data/unlock-exceptions.json` 的 `note`。
   * 面板優先顯示它而不是「任務解鎖」這種分類詞——分類詞只說得出「不是用買的」，玩家真正
   * 需要知道的是「那要怎麼拿」。沒有原文時才退回分類詞，所以這個欄位是可選的。
   */
  unlockNote?: string;
  /**
   * 成就／任務只是開門，玩家仍要付 `unlockCost` 那一筆。
   *
   * `unlockVia` 原本被當成「非 cost ＝ 不用付錢」在用，但官方資料表 v1.0.3 v2 把恐懼骰子
   * 寫成「合作累積900擊殺後，**使用8核心解鎖**」——條件與價錢是兩回事。沒有這個旗標的話，
   * 那 8 核心會從每一條經過它的前置鏈裡安靜消失（`sumUnlockCost()` 直接跳過非 cost 節點），
   * 而畫面上不會有任何地方說話。只在為真時才寫進 tree.json。
   */
  unlockPaid?: true;
  /**
   * 這顆從骰子樹外面直接領得到，不必解前置（官方原文：「無視骰子樹前置」）。
   *
   * 目前是貪婪骰子（討伐獎勵）與空虛骰子（競技場通行證）。它**不改變圖結構**——邊照樣存在、
   * 239／248 不變，只有 `prerequisiteChain()` 走到它時停止往上追祖先。`/tree` 上指向它的
   * 那條邊會畫成虛線（見 render.ts）。只在為真時才寫進 tree.json。
   */
  bypassPrereq?: true;
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

/** 一張逐級升級表的一列。`level 1` 是解鎖那一次，算升級追加花費時一律跳過（見 upgradeExtraCost）。 */
export interface LevelCost { level: number; gold: number; core: number }

/**
 * 官方升級費用表的一個區間：`from`~`to` 每一級都花 `gold`，而 `core` **只在 `from` 那一級收一次**。
 *
 * 這是官方表格自己的寫法——它只列 `Lv.5→6`／`Lv.10→11` 這些跨區間的格子（例如 `16000+6`），
 * 並在表頭註明「等級5以後未說明之等級費用以前一級所需金幣資源相同」。照逐級展開存進 JSON 的話，
 * 那 100 級的 tier F 要寫 99 列，而且沒有任何地方看得出「這一段是同一個區間」。
 */
export interface UpgradeBand { from: number; to: number; gold: number; core: number }

/** 一個升級 tier：等級上限與解鎖金幣是它的識別（見 tierKeyOf），bands 是 Lv.2 之後的費用。 */
export interface UpgradeTier { maxLevel: number; unlockGold: number; bands: UpgradeBand[] }

/**
 * 玩家被動／支援的升級費用表（`data/passive-upgrade-cost.json`），另含少數不適用任何通用表的特例。
 *
 * ⚠️ **這份資料不進 `tree.json`**：tier 是 `(maxLevel, unlockCost.gold)` 的純函數，那兩個欄位
 * 產物裡本來就有，複製一份 `costTier` 欄位進去只是拿 gzip 預算換一個推得出來的值。
 * `/sim` 是靜態頁，建置期直接讀這個檔。
 */
export interface PassiveUpgradeCost {
  note: string;
  source: string;
  /** 鍵是官方表格的升級類型代號（A–F）。 */
  tiers: Record<string, UpgradeTier>;
  /** 鍵是節點 id。官方表格單獨列出來、套不進任何 tier 的節點（目前只有 `4303`）。 */
  special: Record<string, { maxLevel: number; levels: LevelCost[] }>;
}

/**
 * 官方資料表在「技能效果」欄標註的滿級數值（`Lv.50：216%`），鍵是 `data-game-id`。
 *
 * 它不進 tree.json，也不給站台顯示——站台的滿級值是 `maxLevelValue()` 從 `growth` 現推的。
 * 這份資料存在的唯一目的是**反向驗算那個推導**（規則 17）：`growth` 是用正則從一段中文描述
 * 裡挖出來的，描述少一個 `(+4%)`、多一個負號、或括號寫成全形，解析結果都會安靜地變成
 * 「沒有成長值」或「每級 −0.2 秒」，而所有既有規則都照樣放行。拿官方自己算好的滿級值來對，
 * 是唯一能從外部指出「這段描述被解析成別的意思」的東西。
 */
export interface MaxLevelOfficial {
  note: string;
  source: string;
  values: Record<string, { level: number; value: number; unit: GrowthUnit }>;
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
