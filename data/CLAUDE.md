# data/：資料來源、對帳與各資料檔的匯入裁決

動 `data/` 底下任何檔案（尤其是拿新版遊戲資料來對帳、重產資料檔）之前讀這份。
各資料檔的欄位語意在 `src/lib/types.ts` 的型別註解，守門規則在 `tools/validate.ts`。

## 上游：遊戲客戶端解包表

決策：**客戶端解包表 > 手填 xlsx**（不要因為 xlsx 還是舊值就改回去）。

- 從 Android 客戶端（`split_base_assets.apk`）用 UnityPy 讀 `assets/bin/Data` 的 `*Table` TextAsset——每張表有
  CSV 源檔＋編譯二進位兩份，取 CSV；表頭三列＝註解／欄名／型別，資料從第 4 列起。文字在 `localization_text`
  （`ko,en,ja,zh-tw` 四欄）。解包工具、解出的 CSV、各產生腳本**不進版控**（維護者本機）。
- **對照鍵**：節點 id ＝ `DiceTreeNodeTable.Id`；成本 ＝ `RankUpGoldArr[0]`／`RankUpGoodsArr[0]`（`RankUpGoodsType`：
  `NODE_STONE` 核心、`CORE_SOLAR` 太陽核心、`CORE_GEAR_SECOND` 齒輪二階核心）；骰子 ＝ `DefenderTable` 第 KindId 列；
  符文 ＝ `RuneTable.Id`；被動 ＝ `PlayerPassiveTable` 第 KindId 列。
  ⚠️ **等級上限不是 `RankUpGoldArr` 的長度**（上游一律補滿 50 格），骰子符文的上限在 `RuneTable.MaxRank`。
- **SVG 座標 ＝ `(1000 + 0.2·x, 850 − 0.2·y)`**（`Position` 欄）。刻意不吻合表格的節點：`1407`（版面調整）、
  `1601`（比表格再往下 30，讓出骰子標籤）、`2503`／`2603`（一起往上 20，否則標籤壓到 `2303`）。其餘一律照表格。
- ⚠️ **客戶端描述是樣板不是成品**：`{0}`／`{1}` 用 `Value1`／`Value1_RankAdd` 填、`<tag>X</tag>` 換成 `#關鍵字`、
  `<color>`／`<u>` 剝掉。三類差異**不是遊戲改了**：(a) 樣板沒放成長佔位（`盛開`／`排序增幅`／`末日宣言`），正本保留
  `(+每級)` 讓規則 17 算得出來；(b) 負值成長印成 `-0.5秒(+-0.2秒)`，正本維持 `0.5秒(+0.2秒)`；(c) 值在別張表
  （`蔑視弱者` 的 30／100）。判「真變動」要**三向比對**：上一版上游 ≠ 新版客戶端才算；wiki ≠ 客戶端但舊上游 ＝ wiki 的是本站自己的正規化。
- ⚠️ **sprite 名稱與譯名對得起來不等於它就是那個東西的圖**（活動貨幣挑錯過一次）。拿不到 UI 綁定時標成推測並找實機截圖對。

## 正本刻意跟上游不一致的格子（對帳時會顯示成差異，不要改回去）

- 5403：上游 `（最多100疊加）`（全形）→ 正本 `(最多100疊加)`（半形，全站一致）。
- **以客戶端表為準、xlsx 仍是舊值的格子**：`nodes.json` 的 4307／4407／5304／5403／5404 解鎖成本與 2201 描述、
  `maxlevel-official.json` 的 D2000、`dice-stats.json` 的 D206／D407 攻擊力，D004／D005／D104／D107／D200 首領額外傷害／
  D201／D202／D208×2／D302／D306／D402／D406 的技能四檔。對帳時拿 `DefenderTable`／`DefenderSkillTable`／
  `ProjectileAbilityTable`／`DiceTreeNodeTable`／`RuneTable` 對。
- 決策：`2009`／`5001` 描述末尾 xlsx 加註的數字保留；`D102` 審判骰子攻擊速度是「—」（客戶端 `AttackInterval` 為 0）。
- ⚠️ 判斷某格是否「仍不一致」要**把兩邊字串直接比對**，不是看上游還有沒有大括號。

## 對帳清單

- ⚠️ **`maxlevel-official.json` 的滿級值要跟 `description` 同一個 commit 進來**，只改一邊規則 17 會擋（不是誤報）。
- ⚠️ **上游只給 `nodes.json` 時要逐 `gameId` 對整份表**：肉眼 diff 只看得到「有改的」，看不到「該改沒改的」。
- ⚠️ **比對 xlsx 時「Lv.50：X」那一行要單獨剝掉再比**（技能效果欄第二行以後可能是續行也可能是滿級值）。
- 描述出現裸數字（`300`／`225%`）時確認 `parseGrowth` 沒有誤抓——它要 `基礎(+每級)` 的形狀。
- 改版時 `changelog.json` 的文字**不能用 `→`／`←`**（e2e ST4b 擋靜態頁的文字箭頭），寫成「從 X 降為 Y」。
- ⚠️ 戰術階段上游有兩列寫成 `'Final  '`（尾隨空白），**先 trim**，否則多出第六種階段。
- 階段清單有三份要一起改：`src/lib/types.ts` 的 `TacticStage`、`src/lib/tactics.ts` 的 `TACTIC_STAGES`（＝篩選鈕順序）、
  規則 24(e) 的 `stages`；E2E 是 `tests/e2e/battle.spec.ts` 的 T6。

## 超越骰子（`1501` 太陽／`2503` 齒輪二階，含符文 `1601`／`2603`）

- 解鎖除了入邊還要前置節點練到 Lv.50（`1201`／`2203`）→ `data/prereq-ranks.json`（上游 `NeedNode`／`NeedNodeRank`，
  規則 26），不寫進描述。登場條件寫在 `dice-stats.json` 的 `note`（客戶端 `MythicTranscendTable`）。
- 符文的逐級費用在 `passive-upgrade-cost.json` 的 `special`（金幣＋超越核心）。
- **圖示不是 `render-nodes` 產的**，重跑 `render-nodes` 時要另外處理：節點 ＝ `DiceTree_Transcendence_on`
  等比縮到高 210 放 (8,0)，疊 `Dice_<名>2`（正面卡片版；`_3` 是 3D 版不要用）以 132/172 縮放、水平置中、y=9（LANCZOS）；
  符文 ＝ `Runenode_<名>_0` 等比縮放；`/board` 純骰子圖用 `Dice_<名>2`（`Dice_GearSecond1` 是執行期才疊齒輪的空框）。
  ⚠️ `render-nodes` 沒有排除清單，重跑會把這四顆蓋成扁平渲染且 validate 不擋——重跑前自己排除或事後換回。
  正本裡 `1501` 刻意仍是 `<rect>`，六角只在圖裡；不要為了配合圖改成 6 點 polygon（`shapeOf()` 判成 `'hex'`＝支援節點的形狀）。

## 各資料檔的匯入裁決（重產時照做）

| 檔 | 守門 | 要照做的裁決 |
|---|---|---|
| `upgrade-cost.json` | 規則 15 | **只適用骰子符文**（`appliesTo`／`upgradeTableApplies()` 擋）；跟 `passive-upgrade-cost.json` **不要合併** |
| `maxlevel-official.json` | 規則 17 | 鍵一定用 `gameId`（同名節點很多）；佔位符要略過不能報錯；有覆蓋率下限；`npm run validate` 必填（檔案不在就失敗） |
| `passive-upgrade-cost.json` | 規則 22（雙向） | `bands` 照官方寫法（`core` 只在 `from` 那級收一次），展開只走 `src/lib/upgrade-tiers.ts` 的 `expandTier()`，validate 與 `/sim` 共用 |
| `dice-stats.json` | 規則 23 | 見下 |
| `tactics.json`／`boss.json` | 規則 24／25 | 見下 |
| `rift-shop.json` | 規則 27 | 換圖用 `add-icon --rift-shop`（同名的檔位一起換）；來源 `TacticsEffectTable` 的 `Store === True` 列；跟 `tactics.json`（`Use === True`）**不要合併**；每個檔位一筆、按階級分組；三種「意志」寫死在頁面、不進資料檔 |
| `events.json` | 規則 29 | 軸是活動不是版本；內容是通用表格（`sections[].columns`＋`rows`）；只收節日活動；檔期與截圖客戶端拿不到，產生腳本的「人工補充」區塊保留，無實測來源時 `period` 為 `null`；活動貨幣圖進 `public/currency/`、種類登記在 `src/lib/cost-html.ts` 的 `CurrencyIconKind` |
| `rewards.json` | `tests/data/rewards.test.ts`（**沒有 validate 規則**） | 由 `tools/import-rewards.py` 從本機主表匯入；收藏品圖只在 `assetStatus: 'ready'` 且有 `icon` 時用，**沒確認過的圖不要拿截圖或單層 sprite 充數**；`public/rewards/` 沒有轉檔管線，別放更大的原圖 |
| `changelog.json` | 規則 20 | 規則 20 檢查**最新一筆帶 `data` 的條目**，不是 `entries[0]` |
| `prereq-ranks.json` | 規則 26 | 同一祖先被多顆要求時取最大 rank |
| `offgame-effects.json` | 規則 28 | 由本機產生腳本從客戶端表重產，**不要手改數字**；`target` 語意見 `src/lib/offgame-calc.ts` 檔頭；決策：`conditional` 不顯示；施加者自己那一列的加值（1206／3202／4207／4208／4308）是 `statAdd` 不是 `board`；`board` target 由 `src/lib/board-buffs.ts` 消費 |
| `unlock-exceptions.json` | 規則 18 | 布林旗標必須是真布林（`build-data` 看 truthiness）；`note` 必須是字串（面板的 `escapeHtml()` 對非字串丟例外） |

### `dice-stats.json`

1. 「目標」是 `stats` 的一員（排在攻擊速度與能力1 之間），不是另一個欄位。
2. 命名漂移視為同一項：`D004` 攻擊速度增益＝攻擊速度增益量、`D401` 吞噬範圍＝範圍、`D406` 攻擊週期＝技能冷卻時間。
3. **備註欄不可整欄照抄**：校訂記錄（判準 `/^原始.*文本/`）是給維護者的，`tests/data/dice-stats.test.ts` 釘住保留的 gameId。CI 擋不到。
4. 四檔全部用客戶端表算：`base`／`dice7 = base+6·LvAdd`／`lv15 = base+14·UpAdd`／`lv15dice7` 兩者疊加；攻擊速度另算
   （`dice7 = base÷7`）。來源欄 `DefenderTable`（Attack／AttackInterval／BossAttackPer）、`DefenderSkillTable`
   （PowerConstant／Range／CastCount／Interval）、`ProjectileAbilityTable`（Value／Duration／Range／StackMax），以 `Local_*` 的 zh-tw 名對到 `label`。
   ⚠️ `Duration`／`StackMax`／`CastCount` 三種來源欄的項目是公式外推、未獨立驗證（`D002`／`D003`／`D400`／`D100`／`D302`／`D209`），有實機截圖時優先對這幾格。
   秒單位的成長文字一律帶 `s`。
5. 官方空著的格子寫 `待實測`，不要省略（省略會被判成固定值）；**不用 CI 警告記錄**（validate 黃金樣本要求 warnings 為零），
   改由 `tests/data/dice-stats.test.ts` 逐格釘住；`tests/e2e/codex.spec.ts` 的 C7 守「待實測」不得回到畫面。
6. 四檔必須反推得出成長參數（規則 23(i)，`src/lib/dice-calc.ts` 的 `deriveParams()`，validate 與 `board.astro` 共用）。
7. `spGrowth`（客戶端 `*_UpAdd` 原值）必須等於 6. 反推的每級強化，固定項目不准寫「每強化1級」（規則 23(j)）。

### `tactics.json`／`boss.json`

1. 每條戰術帶 `availability: { versus, coopNormal, coopHard }`，**是否可用只看它**，不從有沒有 `coop` 文本推導；
   某模式可用就必須有對應文本（規則 24(j)）。三模式都沒開的編號**整筆不落地**。
2. `69` 的三個子選項**巢狀在父戰術的 `options`**，階段與模式繼承父戰術。
3. `62 炸彈狂` 照上游用 `UpgradeSPMinusPer.png`（上游欄位寫錯、沒有專屬圖），標 `dataIssue: 'upstream-icon'`。
4. Boss `1 蛇王` 的 `召喚#一般怪物` 是關鍵字標記，不是佔位符。
5. `boss.json` 是**怪物圖鑑**（1.1.3 起）：收錄範圍＝`MinionTable.CollectionUse === True` 的列，`kind` 照 `MinionType`
   （`Boss` → 首領，`Speed`／`Big`／`Hunt` → 一般怪物）、`difficulty` 照 `CollectionDifficulty`；**不要靠 `gameId` 的
   `_hard` 後綴推導難度**。一般怪物的 id 從 22 往後接，既有 `#b1`–`#b21` 錨點不動。
   圖一律用圖鑑立繪（256 級的 `Snake`…`Joker`、`<名>_Hard`、`Leon_Hard`、`SpeedMinion`、`BigMinion`、`SPgolem`），
   不是舊的 128 扁平徽章。巨大用 `BigMinion`（1.1.3 新增，137×150；已對實機圖鑑確認），不是幾乎同圖的舊 `Big_minion`。`CollectionRewardStone`＝初次遇到該怪物時給的骰子核心數（Yuki 2026-10-04 確認），跟圖鑑內容無關，不上站。
6. 「終盤」是本站命名（客戶端 `TacticPhase` 的 `Final`，localization 沒有階段名）。
