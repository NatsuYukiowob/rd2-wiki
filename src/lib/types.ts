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

/**
 * 一筆花費。三種貨幣，`solar` 是 v1.1.0 太陽骰子帶進來的第三種（遊戲 GoodsType `CORE_SOLAR`，
 * 顯示名「太陽核心」）。
 *
 * ⚠️ **三個欄位都是必填**，缺席不當成 0：`Cost` 是算出來的東西（加總、差額、上限比對），
 * 讓其中一個欄位可以是 undefined 等於讓每個加法都得先寫一次 `?? 0`，而漏寫的那一處會安靜
 * 地把整筆總額變成 NaN。「缺席視為 0」只發生在**讀 JSON 那一層**（見 LevelCost.solar）。
 */
export interface Cost { core: number; gold: number; solar: number }
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
  /**
   * 「某個祖先要先練到某等級」才解得開這一顆（客戶端 `DiceTreeNodeTable` 的
   * `NeedNode`／`NeedNodeRank`）。鍵是祖先節點 id，值是它要達到的等級。
   *
   * 骰子樹的邊只表達得出「那顆要先解開」，表達不出「而且要練到 Lv.50」——太陽骰子（`1501`）
   * 除了 `1301`／`1401` 兩條入邊之外，還要求 `1201` 子彈傷害%增加練滿 50 級。圖結構不必改
   * （`1201` 本來就是那兩顆的前置），新的是這個等級門檻。
   *
   * ⚠️ **只在有值的節點上放這個欄位**，而且只收 rank ≥ 2 的條目：rank 1 就是「解鎖」，邊已經
   * 說過了。240 顆節點各掛一個空物件會吃掉 tree.json 僅存的 gzip 餘裕（同 `wip`／`category`
   * 的作法）。資料正本是 `data/prereq-ranks.json`，規則 26 守它。
   */
  prereqRanks?: Record<string, number>;
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
  levels: { level: number; gold: number; core: number; solar?: number }[];
}

/**
 * 一張逐級升級表的一列。`level 1` 是解鎖那一次，算升級追加花費時一律跳過（見 upgradeExtraCost）。
 *
 * ⚠️ `solar` 是**選填**的，這是它跟 `Cost` 唯一不同的地方：這個形狀直接對應社群維護的兩份
 * JSON（`data/upgrade-cost.json`／`data/passive-upgrade-cost.json`），而那兩份既有的幾百列
 * 一個 solar 欄位都沒有。要求必填等於逼一次無關的全檔改寫，所以缺席一律當 0（`?? 0`），
 * 由讀取端在算成 `Cost` 的那一步補上。
 */
export interface LevelCost { level: number; gold: number; core: number; solar?: number }

/**
 * 官方升級費用表的一個區間：`from`~`to` 每一級都花 `gold`，而 `core` **只在 `from` 那一級收一次**。
 *
 * 這是官方表格自己的寫法——它只列 `Lv.5→6`／`Lv.10→11` 這些跨區間的格子（例如 `16000+6`），
 * 並在表頭註明「等級5以後未說明之等級費用以前一級所需金幣資源相同」。照逐級展開存進 JSON 的話，
 * 那 100 級的 tier F 要寫 99 列，而且沒有任何地方看得出「這一段是同一個區間」。
 *
 * ⚠️ **刻意沒有 solar 欄位**：太陽核心只出現在太陽骰子與它的符文上，那是骰子分支的東西，
 * 而 tier 制只服務玩家被動與支援。留一個永遠是 0 的欄位在這裡，只會讓下一個人以為它有用。
 * `expandTier()` 產出的每一列因此固定帶 `solar: 0`。
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
 * `data/prereq-ranks.json`：「某個祖先要先練到某等級」的解鎖條件。
 *
 * ⚠️ **這份資料沒有自動來源**（同 `unlock-exceptions.json`）：它抄自客戶端 `DiceTreeNodeTable`
 * 的 `NeedNode`／`NeedNodeRank`，而正本 SVG 與 `nodes.json` 都沒有欄位放得下它。`build-data`
 * 讀它時只有一個 `as` 斷言＝執行期零檢查，所以規則 26 是它唯一的防線。
 *
 * `ranks` 的外層鍵是「被擋住的節點」，內層鍵是它的祖先、值是那個祖先要達到的等級。
 * **只收 rank ≥ 2 的條目**：rank 1 就是「解鎖」，骰子樹的邊已經表達過那件事。
 */
export interface PrereqRanks {
  note: string;
  source: string;
  ranks: Record<string, Record<string, number>>;
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

/**
 * 一顆骰子的一項數值。四個檔位的值都是官方資料表直接給的，不是本站算的——
 * 攻擊速度那一欄是「基礎值 ÷ 骰點」，自己算會在小數位上跟遊戲內顯示對不起來。
 *
 * `dice7` 以下四個欄位**要嘛全有要嘛全無**：官方的「骰子強化數據」分頁只收錄會隨骰點或
 * 對局內 SP 強化改變的項目，沒被收錄就代表它是固定值（基本面板上有、但永遠是那個數）。
 */
export interface DiceStat {
  label: string;
  /** 1 骰點、SP 強化 Lv.1 的值。含單位，直接印。 */
  base: string;
  /** 7 骰點、SP 強化 Lv.1。 */
  dice7?: string;
  /** 1 骰點、SP 強化 Lv.15。 */
  lv15?: string;
  /** 7 骰點、SP 強化 Lv.15。 */
  lv15dice7?: string;
  /** 官方寫的骰點成長規則原文（例：`每提升1骰點：+100`）。 */
  diceGrowth?: string;
  /** 官方寫的 SP 強化規則原文（例：`每強化1級：+150`）。 */
  spGrowth?: string;
}

/**
 * 一顆骰子在「骰子基本能力值」分頁上的那一列。
 *
 * 「目標」也是 `stats` 的一員（排在攻擊速度與能力1 之間，跟官方面板同順序），不是另一個欄位
 * ——渲染端因此不必靠索引把它插進陣列中間。它沒有強化檔位，會被 `isFixed()` 判成固定項目。
 */
export interface DiceStatEntry {
  name: string;
  /** 官方對這顆骰子的特殊機制註記；沒有就省略，不要寫空字串。 */
  note?: string;
  stats: DiceStat[];
}

/** `data/dice-stats.json`：以 gameId 為鍵。刻意不進 tree.json，見該檔的說明。 */
export type DiceStatsTable = Record<string, DiceStatEntry>;

/** 戰術的階段（官方資料表「階段」欄）。`選項` 是 69 號「選擇由我決定」底下的三個子選項。 */
export type TacticStage = '前期' | '中期' | '後期' | '選項';
/**
 * 戰術的適用模式（官方資料表「適用模式」欄）。
 *
 * ⚠️ **只有兩個值**：資料表第三個值 `未啟用`（遊戲沒開放）的 16 條刻意不落地，
 * 見 `data/tactics.json` 的說明。所以「`對戰` ⟺ 沒有 `coop`」是一條不變量，規則 24 守它。
 */
export type TacticMode = '對戰' | '對戰／合作';

/**
 * 一條戰術（`data/tactics.json` 的一筆）。
 *
 * 不是骰子樹的節點：不花錢解鎖、沒有前置、不參與成本計算，所以**不進 `data/dice-tree.svg`
 * 也不進 tree.json**（塞進去會同時弄壞 239／248 的節點邊數與全樹解鎖成本）。
 */
export interface Tactic {
  /** 官方編號。子選項是 `69-1`／`69-2`／`69-3`——**含 `-` ⟺ `stage === '選項'`**，規則 24 守。 */
  id: string;
  /** 官方名稱。子選項在資料表裡帶 `↳ ` 前綴，落地時已去掉——那是版面，不是名字。 */
  name: string;
  stage: TacticStage;
  mode: TacticMode;
  /** 對戰模式的效果全文。 */
  versus: string;
  /** 合作模式的效果全文；`mode === '對戰'` 的 11 條沒有這一欄。⚠️ 47 條裡有 32 條與 `versus` 逐字相同（官方就是這樣寫的），不要因為「重複」把它省掉——省掉就得在渲染端猜。 */
  coop?: string;
  /** 官方資料表的「內部ID」欄，玩家拿本站對照官方表的鍵。同 `TreeNode.gameId` 的角色。 */
  gameId: string;
  /** `data/tactic-icons/` 底下來源 PNG 的內容 sha256 前 12 碼。 */
  icon: string;
  /**
   * 上游資料本身的問題，站台照樣呈現但標記出來讓它可被查詢。
   *
   * `upstream-icon`：62 炸彈狂的「圖示檔名」欄被上游寫成 `UpgradeSPMinusPer.png`
   * （那是 2 研究加速的圖，而它自己的內部ID 是 `BombDiceSpawnOnMerge`），素材裡沒有
   * 炸彈狂專屬圖。Yuki 2026-08-26 裁決照上游用，畫面上不標。
   */
  dataIssue?: 'upstream-icon';
}

/**
 * Boss 的難度（客戶端 `MinionTable` 的兩張表）。
 *
 * ⚠️ **只有兩個值**：一般模式 10 隻、合作困難模式 11 隻（困難多出「雷昂」，它沒有一般版）。
 * 兩批在客戶端是同一張表的兩段，內部ID 靠 `_hard` 後綴區分——但那是 join key 不是難度來源，
 * 難度要自己一欄，否則「靠 gameId 結尾判斷」這種推導哪天上游改了命名就整批分錯組。
 */
export type BossDifficulty = '一般' | '困難';

/** 一個 Boss（`data/boss.json` 的一筆）。同 `Tactic`，不是節點。 */
export interface Boss {
  id: string;
  name: string;
  /** 效果全文。⚠️ 含 `#關鍵字` 標記（蛇王的 `#一般怪物`），要走 `renderStaticText()`，規則 25 守它落在白名單內。 */
  effect: string;
  /** 官方資料表的「內部ID」欄（`snake`／`royal`…）。 */
  gameId: string;
  /** `data/boss-icons/` 底下來源 PNG 的內容 sha256 前 12 碼。 */
  icon: string;
  /** 出現在哪個難度；`/boss` 靠它分成兩組，規則 25 守它只有兩個合法值。 */
  difficulty: BossDifficulty;
}
