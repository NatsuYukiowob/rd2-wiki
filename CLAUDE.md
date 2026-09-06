# rd2-wiki

《Random Dice 2》互動式骰子樹攻略站。Astro 靜態站，部署在 Cloudflare Pages
（https://rd2-wiki.pages.dev/），GitHub `NatsuYukiowob/rd2-wiki`（public）。

> 這份檔案只收「開工前不讀就會做錯，而且讀程式碼讀不到」的事。單點成因與實測數字寫在
> 該處的程式碼註解裡（`src/`＋`tools/` 有 25% 是註解），歷史沿革看 git log 與 PR。

## 開工前必讀

- **資料正本是兩個檔**：`data/dice-tree.svg`（只有幾何，一個字都沒有）＋ `data/nodes.json`
  （全部文案，以節點 id 為鍵）。兩邊的 id 集合必須雙射（規則 19）。join key 一律用 `data-id`，
  **不要拿座標配對**——浮點與 `transform` 一改就對不上。
- **這份 CLAUDE.md 與整個 repo 是公開的**。不要寫進絕對路徑、主機名稱、內網 IP 或憑證。
  掃描：`git ls-files -z | xargs -0 grep -lnE '/mnt/|/home/|內網IP'`。
- **樣式一律用 `:root` 的 token**，不准寫裸的 px／rem（`tests/styles/tokens.test.ts` 守）。
- **動版面要用幾何斷言驗收**（兩矩形不相交、top 差 < 0.5px、`scrollHeight === innerHeight`），
  不是看截圖；反過來，**純視覺的改動測試綠不等於做對**——用 Playwright 截圖自己先看一遍。
  這兩件事各自咬過（前者：寫死偏移量五次；後者：全套測試綠卻同時帶著兩個只有人工看圖才發現的 bug）。
- **本機跑 E2E 前先確認 4321 沒有 `astro dev` 在聽**。`reuseExistingServer: true` 會直接拿它
  當受測站台，測到的是 dev server 不是 `dist/`。開著預覽時用 `E2E_PORT=4399 npm run e2e`。
- **`npx playwright test` 不會重新建置**（`npm run e2e` 才有 `pree2e`）。拿它做「改壞看會不會紅」
  的抽查時，順序必須是：改壞 → `npm run build` → `npx playwright test -g …` → 還原 → 再 build。
- **文件裡不要寫測試條數、節點數這類會隨改動漂移的數字**，寫了就會說謊而 CI 擋不住
  （banner 犯過一次）。要數字就當場跑。

## 核心概念

- **`data/dice-tree.svg`**——只有**幾何**（241 個 `<g class="node">`／251 條邊）：`data-id`、
  `transform`、形狀與 `stroke`、`<image>`、`data-wip`。
- **`data/nodes.json`**——全部**文案**：`name` `label` `type` `category?` `gameId` `cost`
  `maxLevel` `description` `awakening?`。
- 外加 `data/icons/`（240 張 PNG，檔名＝內容 sha256 前 12 碼）、`data/tree-center.png`、
  `data/board-icons/`（42 張純骰子圖，見 `/board`）、`data/tactic-icons/`（58 張，見 `/tactic`）、
  `data/boss-icons/`（21 張，見 `/boss`）。由社群發 PR 維護，**CI 是唯一防線**
  （維護者不可能逐行 review SVG 的 diff）。
  ⚠️ **四條資產路徑彼此獨立**：`data/icons/` 由正本 SVG 引用（規則 7）、`board-icons` 另有一份
  `{節點 id: hash}` 對應表（規則 21），戰術與 Boss 的雜湊則直接寫在各自資料檔那一筆的 `icon` 欄
  （規則 24／25）——那兩份資料不對應任何節點，沒有「要對到 SVG 裡的 id」這個約束。

**為什麼拆**：`<title>` 曾是 `name` ＋ `description` 的完整副本（23.5 KB），文案佔正本 48.6%。
拆完之後改一句描述＝JSON 一行 diff，而不是一行 500 字元、rect/image/text 混在一起的 `<g>`。
`<text>` 標籤同樣搬走改成 `label` 欄位（60 個是縮寫，`所有骰子傷害` → `全骰傷害`，是真資料
不是副本）——留在 SVG 的話線上編輯器（#32）改一個縮寫仍得對 SVG 動行區塊外科手術。
代價是正本用 Inkscape 打開是 239 個無名圖示，補償是 `npm run preview` 把標籤與 id 注回幾何。
那條動線可逆：**正本 → preview → normalize 逐位元組回到正本**，`tests/tools/build-preview-svg.test.ts` 守。

**外觀整個來自遊戲內的原圖**（2026-08-18 依 `RD2骰子樹 v1.0.1` 重做，座標取原圖 ×0.5，素材不在版控內）。
原圖**只有畫面、沒有任何文字資料**。
⚠️ **原圖的節點不是「一張圖」，是多層疊出來的**（底盤圖＋SVG 漸層＋CSS filter＋投影濾鏡），
所以「換圖示」不能只是複製檔案，要跑 `npm run render-nodes`：用真的 Chromium 把每個節點渲染成
一張扁平 PNG，再把結果與尺寸寫回正本。這支**不掛在建置流程上**，CI 與貢獻者都不必裝瀏覽器。

⚠️ **`data/dice-tree.svg` 是 `render-nodes` 的輸出，不是輸入**（輸入是 `process.argv[2]` 傳進來的
遊戲原圖）。所以正本裡那六個寫死的 `fill`（`#405276`／`#55506d`／`#322b4b`／`#7d4cb1`／`#736b91`／
`#2f2942`）**站台一個都讀不到**——改它們只會影響「有人把正本拖進看圖軟體」時的長相。
⚠️ **節點底盤色改不動**（2026-08-26 實測，不要再試）：239 顆裡 123 顆符文的整顆節點就是一張遊戲
貼圖（`<use href="#sprite-N">`），70 顆玩家被動的外圈底盤也是貼圖（只有內圓是 SVG 漸層），真正
由 SVG `<rect fill>` 畫底盤的只有 41 顆骰子 ＋ 5 顆支援（`#453e60` 外層／`#423a5b` 內層）。
換色會變成 46 顆跟著走、193 顆留在原色。站台底色因此**刻意不再跟原圖一致**，見 `tokens.css`。
⚠️ **`render-nodes` 跨 Chromium 版本不是位元組可重現。** 零改動重跑，238 張裡有 5 張會變（正好是
五個支援節點 `1114`／`2114`／`3114`／`4114`／`5114`），差異是純邊緣的次像素位移、肉眼看不出來；
同一台機器連跑兩次則完全相同。`@playwright/test` 是 `^1.49.0` 的 caret 範圍，`npm install` 換到
新的 Chromium 就會漂。**所以「重跑後 PNG 位元組不變」不可以拿來當驗收條件**，會無關改動地紅。

核心功能：點一個節點 → 高亮它在 DAG 上的**所有祖先聯集**（去重、含自身、多重前置視為 AND）
→ 算出解鎖成本。

## 指令

```bash
npm run validate    # 資料驗證（規則 0–25，CI 守門員）
npm run typecheck   # tsc --noEmit（含 noUnusedLocals）
npm run normalize   # 攤平圖層/matrix/相對路徑、清掉 <text> 與註解（送 PR 前必跑）
npm run preview     # 把標籤注回幾何，產出 data/dice-tree.preview.svg（不進版控）
npm run add-icon    # 新增圖示，自動用內容雜湊命名（--board／--tactic／--boss 各指向另一條資產路徑）
npm run render-nodes -- <遊戲原圖路徑>  # 用 Chromium 重畫全部節點圖示（遊戲改版才跑）
npm run split -- <遊戲原圖路徑>         # 從原圖切出正本與圖示（重建整份資料時才用）
npm run build:data  # 產出 src/generated/tree.json + public/assets/
npm run build       # build:data + astro build
npm test            # 有 pretest 自動跑 build:data
npm run e2e         # 有 pree2e 自動跑 build
npm run compare -- <beforeURL> <afterURL>  # computed-style 逐元素比對，兩個 port 各服務一份 dist
                     # ⚠️ 不在 CI 上，純靠人記得跑；改動 CSS（尤其是拆檔／搬檔）送 PR 前必跑，見 tools/compare-computed.ts 檔頭
```

## 不變量（改動後務必重驗）

| 項目 | 值 | 備註 |
|---|---|---|
| 節點／邊／根／多重前置 | 241 ／ 251 ／ 5（`1001 2001 3001 4008 5002`）／ 15 | 2026-09-06 起含太陽骰子 `1501`（前置 `1201`＋`1301`＋`1401`）與它的符文 `1601` |
| 全樹解鎖成本 | 核心 1,842 ／ 金幣 7,056,000 ／ 太陽核心 2,100 | 太陽核心是 1.1.0 新貨幣，只有 `1501`／`1601` 用到 |
| `5201` 前置鏈 | 核心 42 ／ 金幣 20,000 | 2026-08-23 起 `5008` 可直接領，鏈上不再算 `5109` 的 3,000；核心不變是拿掉 `5007` 的 8 與加回 `5002` 的 8 剛好抵消 |
| 覺醒 `awakening` | 42 顆骰子各一則，其餘 199 個節點不准有 | 規則 14 |
| `gameId` | 241 個全有、全檔唯一 | 規則 16 |
| `category` | 只掛在 70 個玩家被動上 | 規則 16 |
| `dataIssue` | `placeholder` 0 ／ `no-growth` 0 | 規則 17 |
| `unlockVia !== 'cost'` | 9 個，全是骰子 | `data/unlock-exceptions.json`，規則 18 |
| `unlockPaid` ／ `bypassPrereq` | 1 個（`5002`）／ 2 個（`5006` `5008`） | 同上；`unlockVia` 只說「靠什麼開門」，這兩個才說「要不要付錢」「要不要解前置」 |
| 可升級節點 | 85 ＝ 50 級符文 43 ＋ `4303` ＋ `1601`（20 級、太陽核心特例表）＋ 玩家被動／支援 40 | 其餘 156 個 `maxLevel` 是 1 |
| 升級 tier ↔ 節點 | 6 個 tier 對 40 個節點，**雙向零殘餘** | `data/passive-upgrade-cost.json`，規則 22 |
| 骰子數值 ↔ 節點 | 42 顆骰子雙向零殘餘；帶四個檔位的項目 **99 個**＝官方強化分頁 97 列＋太陽骰子 2 項 | `data/dice-stats.json`，規則 23 ＋ `tests/data/dice-stats.test.ts` |
| 戰術 | **58 條**（官方 74 條 − 未啟用 16 條）；階段 23／24／8／3；`mode === '對戰'` 的 **7 條** ⟺ 沒有 `coop`（1.1.0 把 6／21／22／24 開放合作） | `data/tactics.json`，規則 24 |
| Boss | **21 條**（一般 10 ＋ 困難 11，`difficulty` 欄），圖示雙向零殘餘 | `data/boss.json`，規則 25 |
| 初始就可解鎖的節點 | 11 個（前置只有起始骰子） | `/sim` 的測試挑節點時要從這裡挑 |
| 畫布 viewBox | `0 0 2000 1700` | |
| 效能預算（硬斷言） | `tree.json` gzip ≤ 20KB（目前 18.5KB）／sprite ≤ 400KB（目前 130KB） | |

- **版本欄位有三個、意義不同**：`data-game-version`（玩家看得到的遊戲版本，1.1.0）、
  `<metadata>` 的 `resource bundle`（資料抄自哪一版資源包；2026-09-06 起直接寫遊戲版本 1.1.0——
  資料改從客戶端解包表來，客戶端 `table-metadata` 自己的 `BundleVersion 0.0.4` 語意不同、不採用，Yuki 裁決）、`data-version`（正本自己的
  schema 版本，1.1.0）。首頁顯示前兩個，不要合併。⚠️ `<metadata>` 開頭那句
  `layout rebased on RD2骰子樹 v1.0.1` 講的是**版面**抄自哪一版，跟遊戲版本是兩件事，不要順手一起改。
- **覺醒不是節點**：不用花錢解鎖、沒有前置、不進成本計算，所以是骰子身上的一個欄位。
  做成節點會同時弄壞 239／248 與全樹解鎖成本。
- **`gameId` 刻意不進 tree.json**（站台不顯示，239 個字串要吃 0.55KB gzip），所以規則 16 是它
  唯一的防線——改壞了站台完全不受影響。
- **`支援強化` 是本站的命名**：遊戲資料表把支援角色與它的冷卻縮減都標成「支援」，照抄會寫出
  「支援 · 支援」與「玩家被動 · 支援」兩種都看不懂的組合。
- ⚠️ **`meta.totalUnlockCost` 不受解鎖例外影響**——那是「SVG 成本總和」（spec §2.1），刻意不排除
  非 cost 節點，站台一個地方都沒顯示它；會跟著變的是 `sumUnlockCost()` 的前置鏈計算。
- **顯示尺寸逐節點寫在正本的 `<image width/height>`**（骰子 50×53、符文 26×26、被動 34×34 與
  44×44、支援 51×47）。**不要再加「類型 → 尺寸」對照表**：同一種類型底下也會有不同尺寸，
  舊的 `sizeOfType()` 就是為此拿掉的。改動後一定要回頭看 `src/lib/viewport.ts` 的兩個
  `*_ICON_TARGET_PX`（照骰子寬度換算，曾因骰子從 56 縮到 50 沒跟著改，每個視角多放大 12%）
  與 `SHADOW_ON/OFF_AT_ICON_PX`（`SHADOW_OFF` 必須高於那兩個，否則預設視角會重畫 239 個
  drop-shadow，手機平移從 40 掉回 20 FPS）。`tests/lib/viewport.test.ts` 有斷言。
- ⚠️ **`tests/tools/build-data.test.ts` 的效能預算有兩條斷言**，不要合併：一條量測試自己組的
  產物（`spriteIndex` 是全同值替身，壓得比真實座標好，**會低估約 0.5KB**），另一條量 `pretest`
  用 CLI 寫出的 `src/generated/tree.json`。餘裕只剩 1KB，少了後面那條就會「本機全綠、CI 爆掉」。
- **描述文字以「遊戲內實際顯示」為準，不是資源包裡的原始樣板。** 資源包有沒填值的 `{n}` 佔位符時，
  遊戲**連同那一段一起不顯示**（2026-08-20 Yuki 逐個對照遊戲畫面）。目前正本刻意跟 xlsx 不一致的
  有**兩類**，下次對新版資料表時都會顯示成差異，那是刻意的，**不要改回去**：

  | id | 上游 | 正本（＝遊戲畫面） |
  |---|---|---|
  | 5403 | `傷害增加30（最多100疊加）`（全形） | `(最多100疊加)`（半形，全站一致） |

  ⚠️ **第二類：以客戶端解包表為準的格子**（PR #61；Yuki 2026-09-02 裁決「客戶端解包 > 手填
  xlsx」；2026-09-06 拿 1.1.0 客戶端表親驗過：22 格裡只有 `D200` 首領額外傷害在 1.1.0 變了，其餘全部相符）。xlsx v1.0.3-v2 在這些格子跟客戶端表
  不一致：`nodes.json` 的 4307／4407／5304／5403／5404
  解鎖成本與 2201 描述、`maxlevel-official.json` 的 D2000、`dice-stats.json` 的 15 項
  （D206／D407 攻擊力；D004／D005／D104／D107／D200 首領額外傷害／D201／D202／D208×2／D302／
  D306／D402／D406 的技能四檔）。下次對帳時這些格子要拿客戶端表（`DefenderTable`／
  `DefenderSkillTable`／`ProjectileAbilityTable`／`DiceTreeNodeTable`／`RuneTable`）再對，
  **不要因為 xlsx 還是舊值就改回去**。

  ⚠️ **上游填得出值就用上游的**——「連同那一段一起不顯示」只適用於**上游自己也沒有值**的情形。
  ⚠️ **`2403` 與 `5302` 曾經在這張表上，2026-08-23 移除**：v1.0.3 的上游那兩格現在跟正本
  **逐字相同**（`連接齒輪骰子時，攻擊速度增加5%` ／ `#僵硬範圍增加30%`，v1 與 v2 都是）。
  判準是**把兩邊字串直接比對**，不是「上游沒有大括號了」——後者只證明佔位符不在了，
  不排除上游把值填進去而正本仍砍了整段的情形。**不要因為舊文件寫過就當成「還在不一致」，
  也不要只靠大括號計數就下這個結論。**
- ⚠️ **佔位符偵測機制留著，但真實資料已經沒有樣本了**（`parseGrowth` 的 `{n}` 判定、
  `dataIssue: 'placeholder'`、規則 9、面板的「數值待補」）。上游隨時可能再冒出新的佔位符，
  那是唯一會提醒我們的東西。對應測試因此**全部用合成樣本**（注入一段 `{1}` 再驗），
  綁真實節點的話資料一改測試就跟著消失，而那段程式還活著卻沒人守。

### 資料來源：1.1.0 起以客戶端解包表為正本（2026-09-06）

- **資料正本的上游從 xlsx 換成遊戲客戶端的資料表**。做法：從 Android 客戶端（`split_base_assets.apk`）
  用 UnityPy 讀 `assets/bin/Data` 裡的 `*Table` TextAsset——每張表有**兩份**（CSV 源檔＋編譯二進位），
  取 CSV 那份；表頭三列＝註解列／欄名列／型別列，資料從第 4 列起。文字在 `localization_text`
  TextAsset（`ko,en,ja,zh-tw` 四欄 CSV）。解包工具與解出來的 CSV **不進版控**（維護者本機），
  這裡只記對照方式。
- **對照鍵**：節點 id ＝ `DiceTreeNodeTable.Id`（`1501`／`1601` 就是上游自己的 id）；成本 ＝
  `RankUpGoldArr[0]`／`RankUpGoodsArr[0]`（`RankUpGoodsType` 是貨幣：`NODE_STONE` 核心、`CORE_SOLAR`
  太陽核心）；⚠️ **等級上限不是 `RankUpGoldArr` 的陣列長度**——上游一律把那兩個陣列補滿到 50 格，
  骰子符文真正的上限在 `RuneTable.MaxRank`（`1601` 太陽強化就是這樣被讀成 50 級，實機只有 20，
  2026-09-06 修正；124 顆 `DICE_RUNE` 重對過一次，只有這一顆錯）；
  骰子 ＝ `DefenderTable` 第 KindId 列；符文 ＝ `RuneTable.Id`；
  被動 ＝ `PlayerPassiveTable` 第 KindId 列；四檔 ＝ `base`／`base+6·LvAdd`／`base+14·UpAdd`／兩者疊加。
  **SVG 座標 ＝ `(1000 + 0.2·x, 850 − 0.2·y)`**（`Position` 欄）。2026-09-06 依 Yuki 的實機截圖把火系
  符文 `1201`／`1301`／`1401` 與秩序系 `4202`／`4302`／`4402` 從本站早年挪過的位置**放回表格座標**，
  241 顆裡只剩 `1407` 與 `1601` 不吻合：`1407` 是刻意的版面調整，`1601` 比表格再往下 30（表格把符文
  放在骰子正下方 50 處，本站的骰子標籤就在那裡）。
- ⚠️ **客戶端的描述是樣板不是成品**：`{0}`／`{1}` 要用 `Value1`／`Value1_RankAdd` 填、`<tag>X</tag>`
  要換成 `#關鍵字`、`<color>`／`<u>` 要剝掉。而且有三類差異**不是遊戲改了**：(a) 樣板沒放成長
  佔位（`盛開`／`排序增幅`／`末日宣言`／`貪婪獎勵增加`），正本要保留 `(+每級)` 讓規則 17 算得出來；
  (b) 負值成長印成 `-0.5秒(+-0.2秒)`，正本維持 `0.5秒(+0.2秒)`；(c) 值不在 RuneTable 而在別張表
  （`蔑視弱者` 的 30／100）。判「真變動」要**三向比對**：xlsx 1.0.3 ≠ 客戶端才算，wiki ≠ 客戶端
  但 xlsx ＝ wiki 的是本站自己的正規化。
- **2026-09-06 依 1.1.0 客戶端更新的格子**：8 條描述（`1404`／`2406`／`2304`／`3402`／`3405`／
  `5004`／`5005`／`5401`）、2 則覺醒（`1003` `#果實`、`5006` `#SP怪物`——同一個 tag 代碼的顯示名
  統一，`播種`／`傳送` 仍是別名）、`藥水` 的說明、8 條戰術、`D200` 的首領額外傷害。**刻意沒改**：
  `2009`／`5001` 描述末尾 xlsx 加註的數字（Yuki 2026-09-06 裁決保留）；PR #61 那 22 格除 `D200`
  外全部與 1.1.0 客戶端相符（這次是親驗，不再只是裁決）。
- **太陽骰子（`1501`）**：座標照表格 (860,680)，符文 `1601` 在 (860,760)。它的解鎖除了兩條入邊還要
  `1201` 練到 Lv.50——這是「前置節點等級條件」，正本放在 `data/prereq-ranks.json`（上游 `NeedNode`／
  `NeedNodeRank` 欄），不寫進描述。登場條件「3 骰點火骰子 3 個以上時超越」寫在 `dice-stats.json`
  的 `note`。兩顆的圖示**不是 `render-nodes` 產的**：`1501` 是遊戲的超越節點底板
  `DiceTree_Transcendence_on`（六角金框，Mythic 專用）疊上 `Dice_solar2` sprite（正面卡片版，跟其他骰子節點同一種視角；`_3` 是 3D 立體版，不要用）；`1601` 是
  `Runenode_Sun_0` 等比縮到 104×104。⚠️ 正本裡 `1501` 仍是 `<rect>`（骰子形狀），六角只在圖裡——
  `shapeOf()` 把 6 點 polygon 判成支援節點，規則 3 會擋。下次重跑 `render-nodes` 時要另外處理這顆。
- 客戶端 `table-metadata.BundleVersion` 是 `0.0.4`（比 1.0.3 時期的 0.0.6 小，語意顯然不同），
  所以 `resource bundle` 欄位改寫遊戲版本 1.1.0（Yuki 裁決）。

### 下次拿新版資料表來對

- ⚠️ **`maxlevel-official.json` 的滿級值一定要跟 `description` 同一個 commit 進來。**
  只改一邊規則 17 就會擋下（`… 推算的 Lv.50 滿級值 314 與官方資料表的 108 不一致`），
  那是規則 17 該做的事，不是誤報。
- ⚠️ **上游只給 `nodes.json` 的話要自己對整份表。** 肉眼 diff 兩份 JSON 只會看到「這幾處有改」，
  看不到「那幾處該改沒改」——把 xlsx 的「技能效果」欄整欄拉出來逐 `gameId` 比對。
- ⚠️ **比對 xlsx 時「Lv.50：X」那一行要單獨剝掉再比。** 技能效果欄是多行的，第二行以後可能是
  描述續行、也可能是滿級值；把「第一行＝描述」當通則會生出 40 幾筆假差異。
- 描述裡出現裸數字（`300`／`225%`）時回頭確認 `parseGrowth` 沒有誤抓——它要的是 `基礎(+每級)` 的形狀。

### 幾份沒有自動來源的資料

- **`data/upgrade-cost.json`＝技能升級花費表（1–50 級）**。⚠️ **只適用骰子符文**：玩家被動的
  等級上限有 10／15／20／50／100 五種、單價各不相同，套這張表會算出一個看起來很專業的錯數字，
  `appliesTo` 與 `upgradeTableApplies()` 就是擋這件事。規則 15 把表格 1 級的金額與正本裡 43 個
  50 級符文的解鎖金幣對起來——那是兩份資料唯一的交點，對不上就代表其中一份是舊的，
  而兩邊各自看都完全合法。
- **`data/maxlevel-official.json`＝官方標註的滿級數值**，鍵是 `gameId`。**不進 tree.json、站台
  一個字都不顯示**——唯一用途是**規則 17 反向驗算 `maxLevelValue()` 的推導**。`growth` 是用正則
  從中文描述挖出來的，挖錯不會有任何既有規則說話：少一個 `(+4%)` 讓 `growth` 變 null、多一個
  負號算出「50 級 −10.3 秒」、括號打成全形整段配不到——三種都是合法 SVG、合法成本、合法關鍵字。
  ⚠️ **鍵一定要用 `gameId`**：光「所有骰子傷害」就有 15 個同名節點。
  ⚠️ 兩個容易改壞的地方：(1) **佔位符要略過不能報錯**（否則跟規則 9 的「不擋 PR」政策自相矛盾）；
  (2) **有覆蓋率下限**——只走夾具裡有的項目等於「刪掉一個鍵就關掉那顆節點的檢查」。
- **`data/passive-upgrade-cost.json`＝玩家被動與支援的升級費用**（6 個 tier A–F ＋ `4303`、`1601` 兩個特例；`special` 不限玩家被動，1601 是 20 級骰子符文、逐級金幣與太陽核心都不同），
  由**規則 22** 守。⚠️ **它不進 tree.json**：tier 是 `(maxLevel, unlockCost.gold)` 的純函數，那兩個
  欄位產物裡本來就有，複製一份 `costTier` 欄位進去只是拿 gzip 預算換一個推得出來的值。
  代價是「表與節點對不上」在產物層面完全沒有痕跡——一顆節點對不到 tier，`/sim` 只會安靜地不讓它
  升級（跟「這顆本來就不能升級」在畫面上一模一樣），一個多餘的 tier 則永遠不會被察覺。所以規則 22
  是**雙向**的：40 個節點每一顆都要對得到 tier，6 個 tier 每一個也都要對得到節點。
  ⚠️ `bands` 是官方表格自己的寫法（`from`~`to` 每級花 `gold`，`core` **只在 `from` 那一級收一次**），
  展開成逐級表的是 `src/lib/upgrade-tiers.ts` 的 `expandTier()`，validate 與 `/sim` 共用同一份
  ——連續性判斷寫兩份就會漂移。**符文的 1–50 級表仍在 `data/upgrade-cost.json`，兩份不要合併**
  （適用型別、識別方式、資料來源都不同）。
- **`data/dice-stats.json`＝41 顆骰子的官方基本能力值與強化數據**（`/dice` 的數值面板），
  鍵是 **`gameId`**，由**規則 23** 守。來源是官方資料表 v1.0.3-v2 的兩個分頁（⚠️ 15 項自 PR #61 起
  以客戶端解包表為準，清單見上方「刻意跟 xlsx 不一致」第二類）：`骰子基本能力值`
  （基本面板 41 列）與 `骰子強化數據`（會隨骰點／SP 強化改變的項目 97 列），**兩張表在這裡併成
  同一個形狀**。⚠️ **不進 tree.json**（同 `passive-upgrade-cost.json` 的理由：`/dice` 是靜態頁
  直接讀 `data/`，而這份有 32KB），所以「表與節點對不上」在產物層面零痕跡，規則 23 因此是**雙向**的。
  三件併表時做過的裁決，重新產生這份檔案時要照做：
  1. **「目標」是 `stats` 的一員**（排在攻擊速度與能力1 之間，跟官方面板同順序），不是另一個欄位
     ——渲染端才不必靠索引把它插進陣列中間。它沒有強化檔位，會被 `isFixed()` 判成固定項目。
  2. **三組命名漂移視為同一項**（基礎值逐格相同驗過）：`D004` 攻擊速度增益＝攻擊速度增益量、
     `D401` 吞噬範圍＝範圍、`D406` 攻擊週期＝技能冷卻時間。`D200` 首領傷害倍率則是強化分頁**獨有**
     （基本面板上沒有），照樣要收。
  3. **備註欄不可以整欄照抄。** 那一欄混了兩種東西：6 條在解釋遊戲機制（為什麼這顆的攻擊速度或
     目標是「—」），1 條是資料表作者自己的校訂記錄——`D401` 吞噬骰子的「原始目標文本：範圍前」，
     意思是官方原文寫「範圍前」而那一欄被正規化成「範圍內」（跟 `nodes.json` 的「擊殺**範圍內**
     怪物時」一致，正規化是對的）。**校訂記錄是給維護者看的，印在卡片上對玩家只會像個錯字**
     （Yuki 2026-08-24 回報）。判準是 `/^原始.*文本/`，由 `tests/data/dice-stats.test.ts` 釘住
     那 7 個 gameId（含 1.1.0 太陽骰子 `D008` 的登場條件）。⚠️ **CI 擋不到這件事**——`note` 是自由文字，規則 23 只驗型別與長度。
  4. **官方自己空著的格子照原文寫 `待實測`**（目前 **0 格**：原本唯一的 `D208` 原子旋轉速度 Lv.15
     兩檔，PR #61 依客戶端解包表補上 `7s`／`4.6s`，成長其實在骰點軸不在 SP 軸）。省略的話那一項
     會被判成「固定值」，畫面上跟「它本來就不會變」一模一樣。
     ⚠️ **這件事刻意不用 CI 警告記錄**——validate 的黃金樣本斷言 warnings 必須為零，一條永遠不會
     消失的警告會讓那個基線失效。改用 `tests/data/dice-stats.test.ts` 逐格釘住（現在釘的是空清單），
     上游再空一格就會紅；`tests/e2e/codex.spec.ts` 的 C7 反向守「待實測」不得回到畫面上。
- **`data/tactics.json`（58 條）與 `data/boss.json`（21 條）**＝`/tactic` 與 `/boss` 兩頁的全部
  內容，由**規則 24／25** 守。來源是官方資料表 v1.0.3-v2 的 `戰術`（sheet8）與 `Boss`（sheet9）
  兩個分頁，圖來自素材包的 `戰術/`／`Boss/`（檔名與分頁的「圖示檔名」欄一對一，Boss 10/10、
  啟用戰術 58/58 全中）。三件匯入時做過的裁決，重新產生這兩份檔案時要照做：
  1. **只收「已啟用」的 58 條**（Yuki 2026-08-26）。官方 74 條裡有 16 條標「未啟用」——資料表有、
     遊戲沒開。因此「`mode === '對戰'` ⟺ 沒有 `coop`」在這份檔案裡才是真的不變量（規則 24(j)），
     把未啟用那批加回來會同時打破它（那 16 條的合作效果全是空的）。順帶：`59 情侶` 與
     `70 死神格子` 這兩條**沒有圖示檔名也沒有圖**，剛好都在未啟用名單裡。
  2. **`62 炸彈狂` 照上游用 `UpgradeSPMinusPer.png`**——那是 `2 研究加速` 的圖，上游把「圖示檔名」
     欄寫錯了（它自己的內部ID 是 `BombDiceSpawnOnMerge`），而素材裡沒有炸彈狂專屬圖。
     資料檔標 `dataIssue: 'upstream-icon'` 讓它可被查詢，畫面上不標。⚠️ 這個檔名在官方表裡是
     **撞號**的，只因為研究加速是未啟用才沒撞進站台——哪天那 16 條要收，規則 24(g) 會先擋下來。
  3. **Boss `1 蛇王` 的 `召喚#一般怪物` 是關鍵字標記，不是上游漏填的佔位符**（2026-08-26 誤判過
     一次）。`一般怪物` 就在 `data/keywords.json` 裡。⚠️ **全站的戰術與 Boss 文字裡只有這一個
     `#` 標記**——所以 `/boss` 的就地展開刻意做成「把解釋插在同一段話下面」，沒有移植 `/dice` 那套
     滑入式視圖堆疊：為一個詞把最容易寫壞的那段互動複製成第二份，只會多一份會漂移的複本。
  4. **Boss 收進合作困難模式的 11 隻（Yuki 2026-09-06 裁決）**，來源改為 1.1.0 客戶端 `MinionTable`
     ＋ zh-tw localization（不再是 xlsx sheet9）。難度靠 `difficulty` 欄，**不要靠 `gameId` 的 `_hard`
     後綴推導**——那是 join key，上游改命名就整批分錯組而畫面上看起來完全正常。困難版多出「雷昂」，
     它沒有一般版。順帶修掉 id 7 熔岩巨獸抄錯的 effect（原本寫成「使隨機減少骰點減少」）。
     ⚠️ **8/11 隻困難 Boss 的客戶端圖與一般版是同一張圖**（byte 相同），只有疾風仙子／國王史萊姆／
     雷昂三張不同——畫面上看起來「重複」是照實反映客戶端。目前沒撞規則 25(g)，只因為一般那 10 張
     是更早一版素材包的重新編碼（同尺寸、不同位元組）；哪天把一般版的圖也換成解包版，那 8 對就會
     撞號，屆時要決定的是「兩筆共用同一張圖是否允許」，不是隨便換掉其中一張。
  5. 戰術 1.1.0 起 `6`／`21`／`22`／`24` 開放合作模式（`mode` 改「對戰／合作」並補 `coop`），
     `mode === '對戰'` 剩 7 條。
  ⚠️ 兩份都**不進 tree.json**（同 `dice-stats.json` 的理由），所以規則 24／25 是它們唯一的防線。

- **`data/changelog.json`＝站台更新日誌**（首頁顯示最新 3 筆），由**規則 20** 守。它是全站唯一
  沒有自動來源的內容，而「忘了寫」在畫面上跟「這次沒更新」長得一模一樣。規則 20 檢查的是
  **最新一筆帶 `data` 區塊的條目**而不是 `entries[0]`——純站台功能的條目排在最前面卻沒有資料版本
  可言，硬要求 `entries[0]` 帶 `data` 的話每次改前端都得假造一筆版本，規則就被繞過去了。
  條目**由新到舊**排列，同一天可以有多筆（先後有意義）。
  ⚠️ **首頁（`src/pages/index.astro`）的版本戳記要用 `changelog.entries.find(e => e.data)` 另外找**（跟規則 20 的 `checkChangelog()` 同一個 `find`），不要為了讓帶 `data` 的
  條目「剛好留在前 3 筆」去調整排序——資料版本戳記能不能顯示，不該反過來決定日誌要怎麼排。
  `tests/e2e/codex.spec.ts` 的 C5 驗「玩家真的看得到」。
- **`data/prereq-ranks.json`＝前置節點的等級條件**（目前只有 `1501` 太陽骰子要求 `1201` 練到 Lv.50），由**規則 26** 守。
  它不改圖結構（1201 本來就是 1301／1401 的祖先），改的是三件事：`/tree` 詳情面板的前置鏈成本多一段
  「前置練等」（用 `levelTableFor()`＋`upgradeExtraCost()` 算 Lv.1→rank 的追加費用，查不到表印「成本未確認」
  而不是 0）；`/sim` 的「可取得」多一條「祖先等級 ≥ rank」、一鍵點亮會把祖先拉到 rank、取得後祖先不能降到
  rank 以下（`maxSelectableLevel` 的下界）。同一個祖先被多顆節點要求時取最大的 rank。
  ⚠️ **任何「這顆練滿要多少」的顯示一律走 `levelTableFor()`**（`/sim` 與 NodeDetail 同一個判準），
  `upgradeTableApplies()` 只給通用符文表用——1601 太陽強化的費用在 `special`（只有金幣＋太陽核心）。
  它 2026-09-06 從 50 級改成 20 級後不再撞到通用表的 `maxLevel === 50`，但判準不因此放寬：當時
  用通用表印出過「核心 99 ＋ 金幣 465,700」這種差兩個數量級的錯數字，下一顆 special 節點照樣會踩。
- **`data/unlock-exceptions.json`＝解鎖例外表**，由**規則 18** 守。它不是 SVG 的一部分，
  `build-data` 讀它時只有一個 `as` 斷言＝執行期零檢查。三種寫壞法在規則 18 之前全部 CI 全綠：
  key 打錯（那顆骰子安靜地變回要花核心買）、`unlockVia` 打錯（成本照樣排除，但面板印出字面的
  `undefined`）、`note` 空字串、**`unlockPaid`／`bypassPrereq` 寫成非布林**（`build-data` 判斷的是
  truthiness，`"false"` 這種字串一律為真，於是「我明明寫了 false」變成「已啟用」）。⚠️ **規則 18 擋型別與長度，擋不住內容**——`unlockNote` 是自由文字
  而 `renderDetail()` 用 `innerHTML`，所以 `NodeDetail.ts` 一定要 `escapeHtml(formatUnlockVia(node))`。

  ⚠️ **`unlockVia` 只說「靠什麼開門」，不等於「不用付錢」**（2026-08-23 拆開）。官方 v1.0.3 v2 把
  三顆渾沌骰子的解鎖條件改寫成兩種語意，各自對應一個旗標：

  | 旗標 | 節點 | 語意 | 誰在用 |
  |---|---|---|---|
  | `unlockPaid` | `5002` 恐懼 | 成就開門，**仍要付** `unlockCost`（「合作累積900擊殺後，使用8核心解鎖」） | `sumUnlockCost()`、`upgradeTableApplies()` |
  | `bypassPrereq` | `5006` 貪婪／`5008` 空虛 | 從討伐獎勵／競技場通行證**直接領，無視骰子樹前置** | `prerequisiteChain()`、`render.ts` |

  **`bypassPrereq` 不改變圖結構**——邊照樣存在、239／248 不變，只有前置鏈遍歷走到它時停止往上追。
  `/tree` 上指向它的入邊掛 `.edge-bypassable` 畫成虛線（CSS 在 `canvas.css`，**只設
  `stroke-dasharray`**，所以跟 `.in-chain`／篩選／`has-selection` 那三組 opacity 規則互不搶屬性）。
  站台**沒有全站圖例**，虛線的意思由詳情面板那句「鏈上有 N 顆可直接領的骰子」承擔。

  ⚠️ **那句要綁 `Selection.bypassNodes`（鏈上有幾顆），不可以綁 `bypassed`（省了幾個前置）**：
  跳過的祖先常常從另一條路回到鏈上——`5005` 變異骰子的前置是 `5006` 與 `5103`，而 `5103` 的祖先鏈
  就是 `5002` → `5007` → `5103`，所以 `bypassed = 0` 而 `bypassNodes = 1`，虛線邊仍在鏈上、仍被
  高亮成金色。**全站有 18 個選取會讓虛線邊兩端都在鏈上，其中 11 個 `bypassed` 是 0**；綁錯的話
  那 11 個會出現「一條金色虛線，畫面上零說明」。E2E 的 X2 三種狀態都守（鏈外淡出、鏈內金色、面板有話說）。
  ⚠️ 面板上三句話講三件事，不要混：「已排除 N 個非成本解鎖節點」＝在鏈上但不用付錢、
  「鏈上有 N 顆可直接領的骰子」＝虛線的說明、「因此已跳過 N 個前置」＝真的省掉的祖先數。

## CI 規則（`tools/validate.ts`）

**編號注意**：`規則 11`＝差異摘要留言、`規則 12`＝效能預算，都是 CI 步驟不是 validate 規則；
`規則 13` 起才接回 validate。

| 規則 | 守什麼 |
|---|---|
| 0 | 邊必須是 `<svg>` 直屬子元素；節點與邊不可帶 `display`／`visibility`／`style`／`opacity="0"`；`marker-end` 必須指向正本定義過的箭頭且不可有 `marker-start`；座標與 viewBox 驗到是有限數 |
| 1 | `nodes.json` 的**結構**：必填齊全、型別、長度 ≤ 500、無未知欄位；**選用欄位不用時要整個省略，不可寫成 `""`**（空字串是 falsy，會安靜通過「非骰子不該有覺醒」） |
| 4 | 擋「等級行重新混進 `cost`」。⚠️ 改語意 tree.json 一個位元組都不會變，所以它需要自己的測試 |
| 5 | 一個端點同時對上兩顆節點時直接報錯，不再靜靜取第一顆 |
| 6 | 無環、根集合正確、所有節點從根可達（`data-wip="1"` 的節點豁免可達性，讓貢獻者先接資料再接線；6(c) 只警告） |
| 6(d) | **`data-wip="1"` 的節點完全不准接線**。wip 讓節點豁免「非預期的根」與「從根不可達」，而那是圖結構唯一的守門員——豁免＋能接線＝可以把任意節點切到別的分支，validate 全綠、節點數邊數不變、四個不變量都對，而成本變了。豁免與接線能力二選一 |
| 7 | 圖示：(a) 正本引用的檔案存在 (b) 檔名＝內容 sha256 前 12 碼 (c) PNG 結構與解析度 (d) 孤兒檔只警告 (e) 顯示尺寸×2 ≤ 圖檔解析度 |
| 8(b) | 詞彙表欄位齊全、色碼格式、解釋文字裡的 `#` 也要查得到；`code` 就是 HTML id 與網址錨點（`/guide/status#FROZEN`），所以**不得撞號**、**必須是英文字母開頭的 ASCII 識別字** |
| 9 | 成長值解析警告（**不擋 PR**） |
| 10 | 中央樞紐：`<svg>` 直屬、不帶 transform、圖檔存在且解析度 ≥ 顯示尺寸兩倍、放射線終點落在 `data-links` 指定節點中心 |
| 13 | viewBox 必須等於 `0 0 2000 1700`；節點與邊端點落在畫布內；任兩顆節點中心至少相距 5（疊在一起時邊接到誰只取決於檔案裡的先後順序） |
| 14 | 覺醒只掛在骰子上 |
| 15 | 升級花費表 ↔ 正本解鎖金幣；**跳過 `passive-upgrade-cost.json` 的 `special` 節點**（`special` 的定義就是「套不進通用表」，`levelTableFor()` 執行期也是 special 優先——`1601` 太陽強化 20 級、解鎖金幣 50,000，不跳就永遠紅） |
| 16 | `gameId` 全有且唯一；`category` 只在玩家被動 |
| 17 | 官方滿級值反向驗算 `growth` 的推導 |
| 18 | 解鎖例外表的型別與長度（含 `unlockPaid`／`bypassPrereq` 必須是布林） |
| 19 | SVG 的 `data-id` 集合 ≡ `nodes.json` 的鍵集合，雙射零殘餘，**兩種殘餘都要逐一列出 id**（239 個節點，只說「數量對不上」等於沒說） |
| 20 | changelog 的結構，以及最新一筆資料條目與正本版本欄位一致。擋的不是「日誌寫錯」，是**「資料改了、日誌沒改」** |
| 21 | `/board` 純骰子圖：(a) 骰子漏一筆對應 (b)(c)(d) 目錄本身 (e) 值必須是 12 碼小寫 hex（擋路徑穿越與 `[object Object].png`） (f) 指向的檔不存在 (g) **兩筆指到同一張圖** (h) 對應表自己留著一筆不是（或已不是）骰子的 id |
| 22 | 玩家被動升級費用表：6 個 tier 的形狀與區間連續性、`(maxLevel, unlockGold)` 不得撞號、**每個可升級的共通節點都對得到 tier、每個 tier 也都對得到節點**、`special` 的鍵是節點 id 且不與 tier 重疊、`special` 的 levels 可帶選填 `solar`（非負整數） |
| 24 | `data/tactics.json`：(a) 最外層是非空陣列／(b)(c)(d) 圖示目錄本身／(e) 每筆欄位型別、未知欄位、`stage`／`mode` 的合法值、`dataIssue`／(f) 指向的圖不存在／(g) 兩筆指到同一張圖／(h) 編號格式與撞號／(i) **子選項語意**（id 含 `-` ⟺ `stage === '選項'`，且母條目要在）／(j) **`mode === '對戰'` ⟺ 沒有 `coop`**（兩個方向都要問：漏抓一邊會讓合作模式冒出官方沒有的文字，漏抓另一邊會讓那條戰術在合作模式下整條消失）／(k) `#標記` 要在白名單。⚠️ `mode` 是 `未啟用` 時**指名道姓地擋**——那是官方資料表真有的第三個值，泛用訊息會讓人以為是打錯字 |
| 26 | `data/prereq-ranks.json`（前置節點的等級條件，客戶端 `NeedNode`／`NeedNodeRank`）：最外層只有 note／source／ranks；外層鍵與內層鍵都是節點 id，內層必須是外層那顆的**祖先**、不得是自己；rank 是整數且 2 ≤ rank ≤ 該前置的 `maxLevel`（rank 1 就是解鎖，邊已表達）。⚠️ `TreeNode.prereqRanks` **只在有值的節點上放欄位**——tree.json 餘裕不到 1 KB，241 顆各多一個空物件會爆 |
| 25 | `data/boss.json`：通用檢查與規則 24 同一支 `checkIconedRecordList()`。⚠️ **自己只寫一條**：`difficulty` 必須是「一般」或「困難」（同規則 24(e) 那一類的資料自身語意）。除此之外仍然一條都不要加——複製通用檢查的第二份出去就一定漂移 |
| 23 | `data/dice-stats.json`：(a) 骰子漏一筆／(b) 表自己的孤兒 entry／(c) `name` 與正本節點不符／(d) entry 結構／(e) stat 欄位型別（含 `diceGrowth`／`spGrowth`，空字串不放行——`growthNote()` 用 `??`，`""` 會印成「骰點：／強化：…」）／(f) 同一顆骰子的 `label` 撞號／(g) 四個檔位的值要嘛全有要嘛全無／(h) 未知欄位。⚠️ 以 **gameId** 為鍵，規則 19 抓不到它的殘餘。⚠️ **(h) 是 (g) 的補完不是潔癖**：三個檔位鍵**全部**打錯時 (g) 完全沉默，那一項被判成固定值，畫面上跟「它本來就不會變」一模一樣。⚠️ (b) 的「找不到節點」那一半要先讓路給規則 19／規則 1，否則 `nodes.json` 漏一筆文案會多噴假錯誤 |

⚠️ **幾何規則吃 `nodes`，文案規則吃 `withText`**。`withText` 是「兩邊都在、結構又合法」的過濾集合；
把它餵給幾何規則的話，`nodes.json` 漏一筆會被翻譯成幾十條指向 SVG 的假錯誤（實測：刪掉 `1001`
一筆文案 → 55 條錯誤，54 條是規則 5／6／10／18 在說「從根不可達」，唯一說對的規則 19 被埋在裡面）。
文案規則＝1／3／4／8／9／14／15／16／17，其餘全部走 `nodes`。

⚠️ **(b)(c)(d)「掃一個雜湊命名的圖示目錄」規則 7／21／24／25 共用 `checkHashNamedIconDir()`，
只有一份實作**（規則 24 與 25 再往上共用一層 `checkIconedRecordList()`，那層管的是
「一筆一個 id、雜湊寫在紀錄 `icon` 欄」這種資料檔的 (a)(e)(f)(g)(h)(k)）。要加檢查就加在那裡，不要為第二個目錄複製第二份出去——上一份複製品漂到
「不驗 PNG、孤兒檔嚴重度相反、逐 entry 重複讀檔」才被抓到。孤兒檔一律只警告：那只是 repo
裡多一個沒人引用的 PNG，擋下來會連「換圖忘了刪舊檔」一起擋。

⚠️ **規則 21(h) 必須先跳過規則 19 與規則 1 的地盤**：判斷「是不是骰子」要走 `withText`，
不讓開的話 `nodes.json` 漏一筆文案就會多噴一條指向 `board-icons.json` 的假錯誤。
規則 21 仍擋不到：**兩顆骰子的雜湊互換**（內容定址的本質限制，每一條檢查都照樣成立）。

- **`parseCost` 只吃單行**：規則 4 拒絕的輸入 `build:data` 必須也拒絕，判斷寫在 `parseCost` 裡
  而不是 validate，兩邊才不會對同一份輸入給不同答案。
- **正本上唯一合法的 `<text>` 是樞紐的標籤**（在 `parseTree` 擋）。節點標籤的正本是 `nodes.json`
  的 `label`；`nodeRef()` 的退路因此改用 `transform` 座標（「它在哪」而不是「它叫什麼」）。⚠️ **這條掃全檔，不是只掃
  `g.node` 底下**：在 Inkscape 裡把節點解散群組，`<text>` 會落到圖層根，normalize 攤平圖層時
  再把它搬到 `<svg>` 底下——只看 `g.node` 的話它會永遠留著，而且是 normalize 的定點
  （CI 的 `git diff --exit-code` 全綠）、validate 也沒有規則看得到。
- **`label` 有自己的長度上限 20**（`MAX_LABEL_LENGTH`），用碼點計字。搬走之後 review 幾何 PR
  看不到標籤，「把 description 貼進 label」只剩規則 1 會說話。
- **`npm run normalize`（`tools/normalize-svg.ts`）刪掉樞紐以外的所有 `<text>` 並比對 `nodes.json`**：相同＝預覽檔殘留只報
  個數；不同＝有人在 GUI 裡改了字，逐筆列出並 exit 1。CI 的「正規化定點檢查」跑的就是這支。
  ⚠️ **比對與中止排在 `writeFileSync` 之前，漂移時一個位元組都不寫。** 反過來寫的話那個錯誤是
  **一次性**的：再跑一次就全綠，貢獻者改的字無聲消失。`tests/tools/normalize-cli.test.ts` 守。
  ⚠️ **`nodes.json` 找的是 SVG 同目錄那份**，寫死路徑會在破壞性寫檔之後噴 ENOENT。
- ⚠️ **`normalize` 會把不認得的 `<g>` 當成圖層攤平**（`tools/normalize-svg.ts` 最後一步，選擇器 `svg > g:not(.node):not(.tree-center)`）。
  新增任何刻意保留的頂層 `<g>` 時記得加進排除清單，否則它會被安靜拆散、解析端當作「沒有那個東西」，
  validate 也不會抱怨（規則只在該元素存在時才檢查）。中央樞紐第一次接上時就踩過。

## 設計系統

`:root` 有八組 token，全部定義在 **`src/styles/tokens.css`**，**新增樣式一律用它們**：
⚠️ **token 定義只准留在 `tokens.css`，不要寫到別的檔**——`tests/styles/tokens.test.ts`「每個
`var(--x)` 都真的定義得出來」那條拿 `tokens.css` 當唯一來源，正則是 `^\s{2}(--…)`（只認縮排
兩格、不綁 `:root` 區塊，故意不合併九個檔一起掃），寫到別處會讓那條檢查對那個 token 失效。

⚠️ **`--surface-0` 比卡片還低一階**，只給「凹進去」的元素用（目前是 `/dice` 的數值 pill）。
它**不是**「比 `--bg` 再深一階」：2026-08-26 換成炭燼配色之後，`--surface-0` 反而比 `--bg` 淺
（對比 1.06；舊暗紫配色是深 1.13）。要看的一直都是 `--surface-0` → `--surface-1` 那一階，
`.stat-pill` 只出現在卡片上、從不貼著 `--bg`。理由與備援值寫在 `tokens.css` 該處。

| 組 | token | 說明 |
|---|---|---|
| 間距 | `--space-h/1..7` | 4px 網格（`--space-h` 是唯一半階 2px） |
| 圓角 | `--r-xs/sm/md/lg/pill` | 3/4/5/7/999px（2026-08-26 整體收小一階） |
| 字級 | `--fs-xs/sm/md/base/lg/xl/2xl/3xl` | 0.75→2.4rem（2026-08-26 拉開對比，見下） |
| 表面 | `--surface-1/2/3`、`--border-strong` | 見下 |
| 陰影 | `--shadow-1/2/3`、`--ring` | `--shadow-3` 給浮在畫布上的東西 |
| 動效 | `--t-fast/press/med/slow`、`--e-out/in-out/spring`、`--p-lift/press/stagger/stagger-max/glow` | 見下 |
| 面的質感 | `--hair`、`--face`／`--face-lift`／`--face-float`、`--p-lift` | 見下 |
| 排印 | `--font`、`--font-num`、`--ls-label` | 見下 |

- **表面分層**：靜態頁的面 → `--surface-1`；浮在畫布上的 chrome（`#toolbar`、`#detail`、
  `#branch-chips`、下拉選單、`/dice` 的篩選列）→ `--surface-2`；hover／選中的填色 → `--surface-3`。
  舊的 `--panel` 已刪除——一個東西兩個名字正是要收掉的漂移來源。
- **面的質感用 `--face-*`，不要在元件裡自己疊 box-shadow**（2026-08-26 PR ④）。三個是同一個
  配方的三個狀態：`--face` 靜止（上緣 `--hair` 高光 ＋ 下緣硬邊 ＋ `--shadow-2`）、`--face-lift`
  hover（硬邊跟著 `--p-lift` 長）、`--face-float` 浮在畫布上的面（**不要下緣硬邊**——硬邊在講
  「它坐在某個平面上」，而 `#detail`／下拉選單沒有坐在任何東西上）。抄散到元件檔就是四份會漂
  的複本，跟 `--panel`、`render.ts` 的第二份金色同一族。
- **hover 抬升一律 `var(--p-lift)`**，不要再寫死 `translateY(-2px)`：`--face-lift` 的下緣硬邊
  是用 `calc(2px + var(--p-lift))` 跟著它算的，寫死就對不上。
- **字級級距 2026-08-26 拉到 3.2 倍**（0.75 / 0.84 / 0.92 / 1 / 1.2 / 1.45 / 1.85 / 2.4rem）。
  舊的 0.78→1.9 只有 2.4 倍，八階擠在一起，標題與輔助文字得靠顏色和粗細去分。
  ⚠️ `--fs-xs` 現在是 **12px**，那個尺寸的中文**一律不准再加 `font-weight: 600`**——橫筆畫會
  連成一條線，看起來像被劃掉（`dice.css` 的 `.awakening-head` 記著這個實測）。粗體中文最小 `--fs-sm`。
- **標題（`h1/h2/h3`）的個性來自 `font-weight: 700` ＋ `letter-spacing: 0.02em`**，規則在
  `base.css`，⚠️ 不要用拉丁 display face 排標題（Archivo 沒有中文字，只會讓標題裡的數字跳出來）。
- **數字與代號用 `--font-num`（自架的 Archivo 拉丁 subset，14.7KB）**：`.meta`／`.stat-v`／
  `.game-id`／`.nav-updated`。字型檔在 `public/fonts/`，來源與重製指令在該處的 `README.md`。
  ⚠️ 三個容易踩的點：(一) `--font-num` 後面**必須**原封不動接上 `--font` 的全部成員，Archivo
  沒有中文字，只寫 `Archivo, sans-serif` 會讓同一句話裡的中文掉到瀏覽器預設；(二) 路徑走
  `/fonts/` 不是 `/assets/fonts/`——`public/assets/` 整個在 `.gitignore`（build:data 的產出
  目錄），放進去 CI 與線上會 404；(三) `.game-id` 是 `<code>`，`base.css` 的 `code, pre` 會把它
  搶去 `ui-monospace`，那個位置的 `font-family` **一定要明寫**。
  ⚠️ wght 軸只保留 500–700，所以沒寫 `font-weight` 的位置會被字型匹配夾到 500。**刻意不補
  `font-weight: 500`**：那會連帶把同一句話裡退回 `--font` 的中文也加粗，12px 的粗體中文會糊。
  ⚠️ **重跑 subset 有兩個靜靜出錯的地方**（2026-08-26 都踩過）：`--unicodes` 加了上游沒有的
  碼位不會報錯（`U+2192` 就是這樣進了 README 卻沒進字型），`--layout-features` 留空會把
  `kern`／`tnum` 一起砍掉。守門：`tokens.test.ts` 驗體積 ≤30KB，E2E 的 **D15b** 用 CDP 的
  `CSS.getPlatformFontsForNode` 驗純拉丁節點只用到一種字型。
  ⚠️ **`tabular-nums` 不等於「數字等寬」**：Chromium 把字形前進寬度四捨五入到整數像素，
  16px 下 Archivo 的數字仍是 9px／10px 兩種。不要拿「換一天寬度不變」寫註解或斷言。
- **小標籤的字距走 `--ls-label`（0.1em）**，只給 `--fs-xs` 級的標籤用（`.dice-card .meta`、
  `.stat-pill .stat-k`）。⚠️ 不要往內文或 1rem 的整句中文擴——中文加字距會把行內的詞界抹平，
  整行變成等距字塊（`#detail .meta` 因此刻意只掛 `--font-num`、不掛字距）。
- **焦點框全站只有一條** `:focus-visible { outline: var(--ring) }`。元件只在需要**額外**回饋時才補。
- **每一條 `transition` 都要指名 token 曲線**（`--e-out` hover／按壓／光暈／進場；`--e-in-out`
  兩端都要停穩的位移；`--e-spring` **只給狀態切換**——目前只有切換鈕被勾選與 `/tree` 篩選面板
  開合兩處）。裸的 `ease` 由 `tokens.test.ts` 的「過場曲線」擋住。
  ⚠️ `--t-med`／`--slide-ms` **不准動**：`tree-canvas.ts` 的 `cssMs()` 讀它們當
  `CENTER_MS`／`FILTERS_MS`／`SLIDE_MS`。只換曲線不換長度是安全的。
- **按下去要有回饋**：`transform: scale(var(--p-press))`，`transform` 的過場長度走 `--t-press`。
  ⚠️ **不要在 `:active` 裡寫 `transition-duration: var(--t-press)`**——那是單值，會把同一份
  清單裡每個屬性的長度一起覆寫掉（切換鈕的 spring 就是這樣被關掉的）。
  ⚠️ 停用的按鈕要 `:not(:disabled)`。
- **進場動畫**：`[data-enter] :is(.home-card, .guide-card, .dice-card)` 掛 `rise`（`base.css`）。
  `--i` 由 Astro 在建置時寫成 inline style，**夾上限的動作只在 CSS**
  （`min(var(--i, 0), var(--p-stagger-max))`），模板不准自己 `Math.min`。
  ⚠️ `data-enter` 由 `Base.astro` `<head>` 裡一支**同步的 `is:inline` script** 掛上、載入後由
  頁尾那支 script 的 `setTimeout` 移除。兩端都不能省：不是 `is:inline` 就會被打包成 defer
  （卡片先以定位狀態進 DOM）；不移除的話 `/dice` 用 `[hidden]` 篩選切回來時動畫會重播。
  **不能改用 `animationend`**——`display: none` 的元素不派發那個事件。
  ⚠️ **刻意不寫成伺服器端輸出的 `<html data-enter>`**：那樣沒有 JS 的環境會永遠留著它。
  ⚠️ 那段期間 `animation-fill-mode: both` 的結束值會壓過 `:hover` 的 transform，載入後約一秒
  內卡片 hover 不會抬起。已知且刻意接受。
- **動畫長度一律用 `cssMs()` 從 CSS 讀**，JS 不寫第二份——實作只有一份，在
  **`src/lib/css-ms.ts`**（`cssMs` 給時間值、`cssNumber` 給 `--p-stagger-max` 這種無單位的）。
  ⚠️ **不可以用裸的 `parseFloat`**：Astro 的 CSS 壓縮會把 `440ms` 改寫成 `.44s`，`parseFloat`
  拿到的是 **0.44**。而且**只在建置產物裡發生**，`astro dev` 不壓縮，本機完全看不出來。
  2026-08-26 實際咬到：進場動畫的 `data-enter` 在 ~957ms 就被拿掉，41 張卡片裡 36 張還沒跑完。
- **測試量卡片幾何前先呼叫 `settleEnter(page)`**（`tests/e2e/probe.ts`）。`[data-enter]` 期間
  卡片掛著 transform，`boundingBox()` 會帶次像素誤差，而 `animation … both` 的結束值會**壓過
  `:hover` 的 transform**——D14 的正向控制就是這樣變成「驗到動畫的填充值」而永遠通過的。
- **減少動態的規則每個檔自帶一份**（`chrome.css`／`components.css`／`dice.css`／`detail.css`／
  `board.css` 各一個 `@media (prefers-reduced-motion: reduce)`，`sim.astro` 也有一份；`/tree` 另有兩個區塊收在
  `src/pages/tree.astro` 自己的 `<style is:global>` 裡——`#filters.animating`（篩選面板寬度
  過場）與 `#filters-toggle`（三條）各一個），刻意不寫成
  `*{transition-duration:0.01ms!important}`：那會連 opacity 一起關掉，而 `/tree` 的篩選淡出是靠
  opacity 在**傳達資訊**，不是裝飾。
  ⚠️ **reduce 的覆寫選擇器要跟被覆寫的那一條長得一模一樣**，`:is()` 的包法也要一樣：
  `:is()` 的具體度等於它引數裡最高的那一個，攤開來寫會比包起來寫低一階而輸掉。
  2026-08-26 實測踩過（`/board` 與 `/tree` 的按壓在 reduce 之下照樣縮，E2E 的 D18 抓到）。
  ⚠️ **`tokens.css` 也有一個 reduce 區塊，而且它是唯一一個改 token 而不是改元件的**：
  重新宣告 `--face-lift`，把下緣硬邊從 `calc(2px + var(--p-lift))` 壓回 2px。理由與「為什麼
  不能在元件的 reduce 區塊裡覆寫 `--p-lift`」寫在該處——**自訂屬性的 `var()` 代換是在宣告
  它的那個元素上算完再繼承的**，在子元素上改來源變數影響不到已經算完的那一份。
- ⚠️ **`:has()` 與 `color-mix()` 都要有退化路徑。** 切換鈕的「選中」完全靠 `:has(input:checked)`
  ＋底色而真正的 checkbox 是 `opacity: 0`——不支援 `:has()` 的引擎或 `forced-colors: active` 下，
  五顆鈕長得一模一樣、焦點也看不見。`color-mix()` 一律在前面補一行純色 fallback。
- **守門**：`tests/styles/tokens.test.ts` 掃裸的 px／rem（例外寫在檔案裡的 `ALLOWED` 並附理由），
  確認每個 `var(--x)` 都在 `:root` 定義得出來（打錯的名字不會報錯，只會安靜掉回預設值），
  並確認**級距內沒有兩個 token 撞值**（`--r-*`／`--fs-*`／`--space-*`／`--shadow-*`）——
  同一個值兩個名字時改哪一個都只有一半的地方會跟上，2026-08-26 收小圓角時 `--r-sm` 差點
  撞上 `--r-xs`。
  ⚠️ **掃描名單全部自動列舉**（2026-08-26 拆檔後）：`.css` 用 `readdirSync(src/styles)`；
  `.astro` 用 `readdirSync({ recursive: true })` 掃 `src/pages`（含 `guide/` 子目錄）與
  `src/components`，挑出內容含 `<style` 的檔案，不是寫死幾個檔名。並自帶一條**反例斷言**：
  把 `readdirSync` 掃到的 `.css` 集合拿去跟一份**寫死**的 `EXPECTED_CSS`（九個檔名）比對——
  少一個、多一個沒人知道的檔、或改名，三種壞法都會紅（2026-08-26 code review 抓到：舊版是
  拿同一個 `readdirSync` 運算式跟自己比，恆真，已修正）。
  `tests/e2e/chrome.spec.ts` 的 D1–D12 守沾頂、`--nav-h`、`aria-current`、焦點框、footer 沉底、過場時間。

### 十個 CSS 檔

`src/styles/global.css`（2029 行）2026-08-26 拆成九個按作用域劃分的檔案（同日 `/tactic`
與 `/boss` 上線時加上 `battle.css`，共十個），畫面零變化
（`tools/compare-computed.ts` 驗過，見「指令」一節）。新樣式要放哪個檔，先查這張表：

| 檔 | 放什麼 | 誰載 |
|---|---|---|
| `tokens.css` | `:root` 的八組 token（間距／圓角／字級／表面／陰影／面的質感／排印／動效）——**唯一**允許定義 token 的地方 | Base |
| `base.css` | 全站重置（`*`／`html`／`body`／`main`／`footer`／`a`／`pre`）＋ `.sr-only` | Base |
| `chrome.css` | 全站導覽列 `#site-nav`（含「遊戲介紹」下拉） | Base |
| `content.css` | 靜態內容頁共用 `.page`（首頁／圖鑑／遊戲介紹）＋首頁訪客計數器 `#hit-counter`＋詞彙頁 `.kw-*` | Base |
| `components.css` | 跨頁共用元件：篩選切換鈕 `.chip`、**沾頂篩選列 `.filters`／`.filter-count`**、`--branch` 供應者（`:is(.dice-card, .chip)[data-branch=…]`）、分支色點 `.branch-dot`、首頁卡片、遊戲介紹索引卡 | Base |
| `detail.css` | `/tree` 詳情面板 `#detail`（含視圖堆疊換頁動畫） | `/tree` |
| `canvas.css` | 畫布本體：`#canvas-host`／`#tree`／`#viewport`、節點與邊 `.node`／`.edge`、中央樞紐 `.tree-center*` | `/tree`、`/sim` |
| `dice.css` | `/dice` 圖鑑：卡片網格 `.codex-grid`、`.dice-card` 本體、關鍵字卡片 `.card-term*`、數值面板 `.dice-stats`、篩選列 `.filters` | `/dice` |
| `board.css` | `/board` 骰盤編輯器：`.board-*`／`#board-*`、組合列 `#deck-row`／`.deck-*`、選骰面板 `#dice-picker`／`.picker-*` | `/board` |
| `battle.css` | `/tactic` 與 `/boss` 共用的橫列清單：`.battle-*` | `/tactic`、`/boss` |

⚠️ **`#toolbar`／`#filters`／`#branch-nav`／`#branch-chips`（`/tree` 工具列與篩選面板）不在
`canvas.css` 裡**，它們留在 `src/pages/tree.astro` 自己的 `<style is:global>` 區塊——那個區塊
在這次拆檔之前就已經是頁面自己的樣式，不是 `global.css` 的一部分，所以拆檔沒有動它，找 `#filters`
的樣式要去 `tree.astro`，不是九個 CSS 檔。

⚠️ **只看「放什麼」與「誰載」，不要抄行號**——原始行號對應的是拆檔當下那個 commit 的
`global.css`，檔案一改行號就過期，`docs/superpowers/plans/2026-08-26-css-split.md` 的完整版
（含行號、不進版控）才是那次拆檔的第一手記錄。

- **頁面級 import 順序＝層疊順序，見「版面的硬規則」那一節的第一條**（`import Base` 必須排在
  頁面自己的 CSS import 之前）。
- **兩個容易分錯的分派**：`--branch` 供應者留在 `components.css` 不進 `dice.css`——它是
  `.chip[data-branch]` 的唯一來源，而 `.chip` 用在 `/tree` 的篩選面板；`.chip-xs` 同理留在
  `components.css`，它跟 `.chip` 具體度相同 (0,1,0)，只靠檔案順序排在後面才贏。
- ⚠️ **`.filters` 2026-08-26 從 `dice.css` 搬到 `components.css`**（`/tactic` 也用它）。找沾頂
  篩選列的樣式要去 `components.css`，不是 `dice.css`。搬動用 `npm run compare` 驗過：`/dice` 的
  `<main>` 位元組完全相同，computed style 零差異（只剩進場動畫在飛行中的取樣雜訊）。

### 版面的硬規則

- ⚠️ **頁面級 `import '../styles/x.css'` 一定要寫在該頁 `import Base from …` 那一行之後。**
  Astro 依 import 順序輸出 `<link>`，寫在 `import Base` 前面的話頁面級 `<link>` 會排到 Base
  的五個 `<link>` 前面，頁面級規則需要蓋過 Base 級同具體度的規則時就會靜靜地輸掉層疊，而且是
  **零錯誤零警告**——實測把 `board.astro` 的 `import '../styles/board.css'` 移到 `import Base`
  之前重建，`/board` 的 `<style>` offset 1976 落在 Base `<link>` offset 5783 之前，build 完全
  正常。`tests/styles/tokens.test.ts` 的「import 順序＝層疊順序」守著這條，也守 `Base.astro`
  自己那五行 CSS import 的固定順序（同一族坑：那五行的順序本身就是層疊順序，調換一樣是靜默的）。
- **導覽列是 `position: sticky` 的**，一換行就等於永久佔掉畫面：`#site-nav` 每一項都要
  `white-space: nowrap`（中文沒有空白，瀏覽器會在任意兩字之間斷開），≤720px 時不顯示「上次更新」
  （它比其他四項加起來還寬）。D9 守——實測只有隱藏那段拿掉才會紅，`nowrap` 是防更窄的裝置，
  **不要因為「拿掉也是綠的」就刪**。
- ⚠️ **窄螢幕塞不下時是「導覽列自己橫向捲動」**（≤720px，Yuki 2026-08-23 指定），不是換行、
  不是縮字級、也不是拿掉入口。捲的必須是 `#site-nav` 自己——讓整份文件橫捲會踩到 `/board` 的
  B13。`overflow-x` 一設 `overflow-y` 就會被算成 `auto`，而「遊戲介紹」的下拉是絕對定位掛在 nav
  底下的，**一定要明確寫 `overflow-y: visible`**，否則它會被整個裁掉。D13 守。
- **工具列的尺寸不准隨篩選狀態改變**（浮在畫布上的盒子，寬度一變整排東西跟著跳，而且是邊打字邊跳）。
  「符合 N 個節點」那句話已整個拿掉。⚠️ 金點的 `::before` 要**一直存在**、平常 `background: transparent`
  ——只在 `.active` 才長出 `content` 的話按鈕會寬 16px，問題原地復發。⚠️ `清除篩選` 用
  `visibility: hidden` 佔位而不是 `display`／`hidden`（依規範就不可聚焦，不必另外 `inert`）。
  O2 守寬度、O3 守收合。
- **`display: none ↔ flex` 不能過場，`width: auto` 也不是可內插的值**——只能 JS 量出自然寬度、
  暫時鎖成 px 再動。⚠️ **動完一定要把 inline width 拿掉**，否則面板卡在當初量到的寬度、視窗一縮
  就不會再換行。收尾用 `setTimeout` 不用 `transitionend`（後者在 `display:none`、動畫被中斷、
  分頁切到背景時不一定派發）。
- ⚠️ **開關狀態不能從 class 讀**（`.open` 在收合過場結束前還掛著，過場中再按一次會算成「再關一次」）。
  用模組變數 `filtersOpen`。⚠️ 連帶：**測試也不能假設「`aria-expanded` 翻了＝幾何已經開始變」**
  ——`setFiltersOpen()` 先寫 aria，再把寬度鎖成當前值，真正的收縮要到兩層 rAF 之後，那段窗裡量到的
  差值正好是 0（平行負載下咬過一次）。O3 現在用 `expect.poll`。
- ⚠️ **面板收窄時裡面的東西不能被壓縮**（「清除篩選」四個字一被壓縮就折成四行，整條工具列在過場中
  先長高一倍再收掉）。`flex: none` ＋ `white-space: nowrap`，`.animating` 期間 `flex-wrap: nowrap`
  ——**只在動畫中**，平常仍要能換行否則手機抽屜會比視窗還寬。
- ⚠️ **「Esc 關閉」與「點外面關閉」只在抽屜版面（≤720px）生效**：桌機的面板是工具列的一部分，
  綁上去的話使用者每次平移畫布都會把自己的篩選面板關掉。
- ⚠️ **跨版面斷點要重設狀態**（桌機開著面板縮到手機寬度，`.open` 會變成使用者從沒打開過的全寬抽屜）。
  用 `matchMedia(...).addEventListener('change')`；⚠️ 掛之前要確認 `addEventListener` 存在，
  單元測試的 linkedom 只給了 `matchMedia` 一個回傳 `{ matches }` 的替身。
- **篩選器是共用的 `.chip` 切換鈕**，外觀是按鈕但骨子裡仍是 `<label>` 包真的 `checkbox`
  （鍵盤、螢幕閱讀器的「已勾選」、沒有 JS 時仍可操作，全是瀏覽器免費給的）。checkbox 用
  `position: absolute; inset: 0; opacity: 0` 攤平，**不要改成 `display: none`／`visibility: hidden`**
  （會退出 Tab 順序，篩選器變成只有滑鼠能用）。C6 守。
- **篩選分組不要用 `<fieldset><legend>`**：`<legend>` 一律排在版面**之外**的自己一列，要拉回同一列
  只能 `float`，float 又得靠祖先 `overflow: hidden` 收住，而那會**裁掉切換鈕的焦點框**。
  改用 `<div role="group" aria-label>` ＋ flex ＋ `gap`。D12 守。
- **切換鈕不准用 `margin-bottom` 撐換行的列距**（它跟搜尋框排同一列，下邊界會把中心往上推，實測差
  2.0px，P 直接紅）。列距改由 `line-height` 給。
- **導覽列的偏移量只能有一個來源**：`html { scroll-padding-top }` 與 `.kw-entry { scroll-margin-top }`
  一度帶著同一個算式，瀏覽器兩個都算，錨點跳過去停在導覽列下方 74px 而不是 12px。D10 守。
- ⚠️ **`[aria-current='page']` 的金線一定要畫在 `::before`**：`summary::after` 已經拿 `::after`
  畫下拉的 ▾，而它的具體度更高——用 `::after` 的話 `content` 仍是 ▾、卻吃到金線的絕對定位，
  箭頭被拉成一條金色橫槓掉到導覽列外面。**兩條規則各贏一半，這種半套生效比整條失效難認得多。** D3 守。
  同一族的第二次：`#site-nav [aria-current='page']` 的具體度 (1,1,0) 輸給 `#site-nav .nav-menu > summary`
  的 (1,1,1)，下拉拿得到金線卻拿不到金字，選擇器要把 summary 一起列進去。D11 守。
- ⚠️ **`.dice-card` 的分支色條必須是 `border-left`，不能用 `::before`**：`.card-term` 是 `inset: 0`
  的絕對定位覆蓋層，定位基準是卡片的**內距框**，會蓋掉任何畫在內距框裡的東西。
- ⚠️ **`body` 變 flex column 之後，`main` 要寫 `width: 100%; margin-inline: auto`**，不能留
  `margin: 0 auto`——水平方向的 auto 邊界會取消 stretch，main 縮到內容寬。這個坑踩過兩次。
- ⚠️ **拿掉可見文字時不要把 live region 一起拿掉。** `.sr-only` 一律用 `clip-path` 視覺隱藏，
  **不能**用 `display: none`／`visibility: hidden`／`hidden`——那三種會一併從無障礙樹消失，就不播報了。
- ⚠️ **Playwright 的 `test.use({ reducedMotion: 'reduce' })` 在目前這版沒有傳進 page**
  （實測 `matchMedia(...).matches` 仍是 `false`），測試會安靜地變成「在沒有減少動態的情況下驗減少動態」。
  用 `page.emulateMedia({ reducedMotion: 'reduce' })`。

## 版面沒有固定偏移量

寫死的偏移量咬過五次（`#branch-nav` 的 `top: 6rem`、`#tree-controls` 的 `top: 3rem`、
手機抽屜的 `translateY(-110%)`、`#canvas-host` 的 `calc(100vh - 110px)`、手機 `#detail` 用
`padding-bottom` 推警告）。**現在的做法是零偏移量**：

- `body:has(#canvas-host)` 是 flex column，`<main>` 與 `#canvas-host` 都 `flex: 1`。
- `--nav-h` 由 `src/lib/nav-height.ts` 量 nav 寫進 CSS 變數，量的是**視窗座標**（`rect.bottom`）
  ——消費者都是 `fixed`／`sticky`，`top` 本來就相對視窗算。一度改成 `+ window.scrollY` 是錯的：
  捲到 y=100 時會把它們放到 nav 下方 100px。由 `Base.astro` 的 `installNavHeight()` 全站安裝。
- `--chips-h` 由 `tree-canvas.ts` 量 chip 列的實際高度寫入（**不要寫死 3.5rem**）；手機 footer
  用它讓位，否則 `#branch-chips` 會永遠疊在「著作權屬 111 Percent Inc.」那句上面。W 守。
- 手機 `#detail` 用 `inset: auto 0 var(--chips-h) 0` 讓**可視方框**停在 chip 列上方，
  不是靠內距推——內距在捲動內容的**結尾**，使用者根本還沒捲到那裡。
- ⚠️ **`#tree` 必須是 `position: absolute; inset: 0`**，不能用 `width/height: 100%`：SVG 有內建
  長寬比，`height: 100%` 在父層高度未定案時退回 auto，用寬度反推出一個內在高度把 `<main>` 撐開。

**動版面時不要再引入新的固定偏移量。** E2E 的 U（不該捲動）、V（詳情卡片避開側欄）、
J（手機抽屜不蓋住工具列）是這三條防線。

## 頁面

### `/tree` 詳情卡片的擺位（2026-08-23 改版）

選節點時**畫布緩動平移把節點帶到畫面水平中央**，卡片貼在節點**正上方或正下方**——不是左右。
左右兩側正是前置鏈延伸的方向；而擺上或擺下**必須是算出來的**（`sideLeastCovered()` 模擬兩種
擺法各會蓋住幾個前置節點，取少的），因為五個分支生長方向不同：1 系往上、2／3 系往下、
4 系往左、5 系往右，**寫死任何一邊都會有兩系的前置鏈被整條蓋掉**（實測固定放上方時 239 顆有
155 顆仍被蓋）。手機維持底部抽屜，這一整段都不套用。

- 高度上限用**卡片那一側到畫面邊緣還剩多少**算，不是整個視窗——用整窗算的話卡片一長高就會被
  夾制推到節點身上（選好節點後在搜尋框打字就會長高一行）。低於 `MIN_PANEL_H` 才換邊。
- 置中時多留 `CENTER_SLACK`（約一行），吸收上面那種長高，免得一打字就冒捲軸。
- **置中平移期間卡片釘在終點不動**，只有畫布在走；`cancelCenterPan()` 只能掛在真的會動畫布的
  路徑上（一度掛在 `window` keydown 的開頭 → 節點上按 Enter 完全不會置中）。
- 節點卡片桌機是**橫式兩欄**（`.node-body > .col`／`.col.chain`，重置警告跨兩欄），手機單欄。
- 守它的 E2E：**N**（置中＋垂直緊鄰）、**N2**（不蓋前置鏈）、**N3**（平移期間卡片不動）、
  **N4**（兩欄）、**N5**（Enter 也置中）、**N6**（打字與拖曳都不壓到節點）。

### `/tree` 詳情面板＝視圖堆疊

面板不是一張攤平的卡片，而是**同一張卡片裡換頁**：點 `#關鍵字` 或「骰子覺醒」會左滑推入下一頁。
**為什麼不用浮動彈出層**：彈出層要自己算位置還要防超出畫面，而手機版 `#detail` 本來就是貼著螢幕底的
抽屜，「貼著某個字彈出去」幾乎沒有可用空間；換頁則位置完全不變，巢狀關鍵字也順著同一個機制解決。

渲染在 `NodeDetail.ts`，堆疊／動畫／歷史接線在 `tree-canvas.ts`。事件全部委派在 `#detail` 上
（面板每次都整段重寫 innerHTML）。**系統上一頁＝卡片的返回鍵**：每推一層 `pushState`（網址不變）。

踩過的坑（都有 E2E 的 Z／Z2／Z3／Z4 釘著，逐條弄壞都會紅）：

1. **`history.go()` 是非同步的，而每筆紀錄記著推入時的網址**——先改網址再退，退回去那筆會把網址
   還原。所以是 `afterHistoryUnwind(run)`：退完才做事，另配一條 300ms 保險絲。
2. **上一段動畫的收尾必須在「決定哪張是 from、哪張是 to」之前跑**，晚一步就會把這一段剛要顯示的
   那張反手藏起來。連按返回一次退兩層時必現。
3. **舊視圖一 `display:none`，焦點就掉回 `<body>`**。換頁後要 `focusView()`。E2E 驗的是「焦點所在
   那張視圖的**標題**」，不是「焦點有沒有在某張視圖裡」——後者會被剛按下、還沒被藏起來的那顆按鈕
   矇混過去，永遠是綠的。
4. **面板重繪也要退歷史，而且退完要再寫一次網址**（`resetViewStack()` 走 `afterHistoryUnwind(syncUrl, depth)`）。不退 → 使用者按上一頁什麼都不會發生；退了卻不
   重寫 → 面板換成新節點、網址還停在舊的 `?node=`，重整回到錯的節點。⚠️ **驗這件事一定要驗網址**，
   只驗 `history.state` 的深度完全看不出來。
5. **換節點時要 `abortSlide()` 不是 `finishSlideNow()`**（`.stack` 馬上會被換掉，跑收尾等於對一批
   即將丟棄的元素做清理）；但 `panel-sliding` 一定要拿掉，留著的話接下來 280ms 內每一幀都會變拖尾。
   ⚠️ 驗它要用**當下讀一次**的 `getAttribute('class')`，`expect(locator).not.toHaveClass()` 是重試型
   斷言，殘留的 class 會在計時器到期時自己消失，等一下就變綠。
6. **`document` 上的 Esc 監聽器會互相踩到**：抽屜那個先跑而且會先移除 `.open`，後面的後備監聽器
   再用 class 判斷已經來不及。抽屜那條要 `stopImmediatePropagation()`（`stopPropagation` 不夠）。

換頁過渡的「抖」有四個獨立原因，**全部是量錯東西**（Z4 一條一條釘著）：
(a) `slide()` 量**起始**高度時新視圖若還在正常流程裡，`.stack` 是兩張加起來 → 先暴衝再縮回；`.sliding`（絕對定位）必須
在量之前掛上，而且 `slide()` 是**唯一**負責掛它的地方。(b) `overflow: hidden` **常駐在 `.stack`**，只掛在 `.animating` 上的話 class 一掛
高度就自己跳 12.4px。(c) 只動 `height` 不動 `top` → **貼著節點的那一緣會漂**（卡片放上方時是下緣），動畫那一幀要
同時 `positionPanel({ assumeHeight })`。(d) ⚠️ **`toH` 是 `.stack` 的高度，`positionPanel` 要的是
整張卡片的高度**（多一層 padding 與框線、而且已被 `max-height` 夾過），餵錯 → 動畫途中往下漂 16.9px。
(e) ⚠️ **量那個終點高度要用 `getBoundingClientRect().height`，不可以用 `offsetHeight`**——後者
四捨五入成整數（實測 280 vs 實際 279.7），卡片會在最後一格越過落定位置再被拉回，那是一次真正的
反向，Z4 的 0.3px 門檻會紅。

⚠️ **驗這種事要在頁面內用 rAF 逐幀取樣**，不能一次 `page.evaluate` 量一格：往返一趟 10–20ms，
這些 10–30px 的瞬間偏移根本落不進取樣點。高度斷言要同時驗「不越過頭尾範圍」與「逐格同方向」——
只驗前者會漏掉先衝過頭再補回來，只驗後者會漏掉暴衝之後仍然單調的情形。
`#detail` 的 `overflow-x` 一定要明確寫 `hidden`，而且兩軸都要非 visible（只設 `overflow-x` 的話
`overflow-y` 會被算成 `auto`）。

### `/dice` 圖鑑與 `/guide` 遊戲介紹

在這之前全站幾乎沒有可索引的文字（`dist/tree/index.html` 只有 194 個字元）。

- **`/dice` 只收 41 顆骰子本體**（`type === 'dice'`）。⚠️ 符文／玩家被動／支援那 198 個節點**刻意
  不進圖鑑**（Yuki 指定）：它們是加在骰子或玩家身上的強化，混進同一個網格會讓 41 顆真正的骰子被稀釋掉。
- **`/guide/[slug]` 的分組依據是官方色碼**（`keywords.json` 的 `color`）——同色＝同一類機制，
  **分組不是本站的判斷，只有組名是**，頁面上要照實註明。清單在 `src/lib/glossary-groups.ts`。
  ⚠️ **算條數不要用 `index.byTerm.size`**：那份表為了讓別名也查得到本尊會把別名指到同一筆上。
- **色碼是分組的唯一依據，出現沒見過的顏色要當場失敗**（`buildGlossary()` 直接丟例外）。放行的話
  那個詞會從每一頁消失，而 239 個節點描述裡引用它的 `#關鍵字` 全部連到不存在的錨點——兩件事在畫面上
  都不報錯。
- **`/dice` 的卡片裡點 `#關鍵字` 不跳頁**，就地換成解釋，過場與 `/tree` 的面板同一組
  `--slide-ms`／`--slide-ease`。跟面板刻意不同的兩點：**卡片高度不動**（41 張卡片排在 CSS grid 裡，
  任何一張改高度都會推動同一列的其他卡片），以及**不列出哪些節點用到**，只給一條 `/tree?q=<詞>` 入口。
- 解釋文字在**建置期**渲染成 HTML 放進 `#codex-terms`，前端只負責塞與堆疊（斷詞器不必送到瀏覽器）。
  ⚠️ 那份負載刻意放在 `<div hidden>` 的文字內容裡，**不是 `<script type="application/json">`**：
  解釋 HTML 裡有 `</a>`，塞進腳本標籤會被 Astro 編譯器送去解析，實測 build 直接失敗。
- ⚠️ **卡片本文包在 `.dice-card-main` 裡**（過場要能整塊 transform），所以 CSS **不可以用
  `.dice-card > header` 這種子代選擇器**——就是這樣讓圖示與名稱從並排掉成上下堆疊的，而且沒有任何
  測試會說話。裁切靠 `.dice-card` 與 `.card-term` **兩層** `overflow: hidden`（C3 用命中測試守）。
- **同一時間只准開一張卡片的詞彙層**（`dice.astro` 的 `openCard`）。允許多張同時開的話 Esc 就沒有明確的對象——舊版抓「DOM 裡第一張
  開著的」，於是在第二張按 Esc 關掉的是第一張。C3c 守。
- ⚠️ **關鍵字的顏色要查 `index.byTerm` 不要查 `displayGlossary()`**（後者不含別名，`#播種`／`#傳送`
  會變成全站唯二沒有官方色的標記）。同理 `usedBy` 要先把別名收斂成本尊再去重。
- ⚠️ **量過場的斷言一定要在動畫進行中取樣**：收尾會把 `.slide-anim` 拿掉，事後再讀
  `transitionDuration` 永遠是 `0s`。
- **斷詞器只有一份**：`src/lib/markup.ts` 的 `renderTaggedText()`。`#關鍵字` 的白名單＋最長優先比對
  是全站最容易寫壞的一段（naive 正則會把 `#` 後面整句吃掉），複製第二份出去就一定漂移。差別只在
  「一個詞怎麼包」，由呼叫端傳 `renderTerm` 進去。
- **卡片上的官方數值面板（2026-08-24）是純 CSS，不要改成 JS。** 四個檔位（基礎／7 骰點／Lv.15／
  Lv.15＋7 骰點）的值**全部都是真的文字節點**，由 `.dice-stats:has(input[value='…']:checked)` ＋
  radio 決定顯示哪一個。三個理由，改動前先看懂：
  1. 用 JS 換 `textContent` 的話，另外三檔的數字**進不了 HTML**——而「文字進得了 HTML」正是這一頁
     存在的理由。
  2. 切換鈕不必等腳本載入才長出來，沒有 41 張卡片同時跳版的那一幀。
  3. **radio group 是一個 Tab 停留點**（方向鍵在組內移動）。做成 41×4 顆 `<button>` 就是 164 個
     Tab 停留點。
  ⚠️ **radio 的 `name` 要帶節點 id**（`stat-mode-${node.id}`）。忘了的話 41 張卡片變成同一組，
  切一張會把其他 40 張的選取清掉——而畫面上「數字沒變」跟「這顆本來就不會變」長得一模一樣。E2E 的 C10 守。
  ⚠️ **`:has()` 有退化路徑**：不支援時四個值會同時顯示成「150 750 2250 2850」，所以
  `@supports not (selector(:has(*)))` 裡只留基礎值並把切換鈕整個收掉。
  ⚠️ **固定項目只印一份值**（`.stat-fixed`），不要複製四份；`isFixed()` 同時涵蓋「官方強化表沒收錄」
  與「收錄了但四檔全等」（例如陰陽骰子的攻擊力，官方寫「骰點不變」＋「無變化」）。
  ⚠️ **四個值疊在同一個 grid 格子裡**（`.stat-v { display: inline-grid }` ＋ 子元素 `grid-area: 1/1`
  ＋ `visibility` 收放），所以 pill 的寬度永遠等於最長那個值。**這不是排版偏好，是尺寸穩定性的
  唯一來源**：`.stat-pills` 會 wrap，pill 一變寬就可能多擠出一列，而卡片在 CSS grid 的同一列裡會把
  鄰居一起撐高。⚠️ **不可以改回 `display: none`**——`display: none` 的元素不參與 grid 尺寸計算。
  2026-08-24 的 `/code-review` 實測：尖刺骰子攻擊力 750 → 15750 讓 pill 區塊 68px → 106px，
  火骰子與花骰子跟著從 424.6px 被撐到 462.7px，而使用者根本沒去動那兩張（手機 8 張受影響）。
  ⚠️ **C8 因此要掃全部 41 張 × 四個檔位**：火骰子從來不會 reflow，只量它＝假通過。
  同理，量卡片高度**不要用 `toBe`**（`boundingBox()` 的浮點尾數會差 3e-5，實測 424.625 vs
  424.6249694824219），那會搶在全站掃描之前紅掉、把真正的成因蓋住。
  ⚠️ **寫這一塊的 E2E 一定要加 `useInnerText: true`**：`toHaveText` 預設讀 `textContent`，會把
  `display:none` 的另外三檔一起讀進來（實測拿到「攻擊力 15075022502850」），而它**仍然通過**
  `/攻擊力\s*150/` 這種樣式——等於什麼都沒驗。
- **`/tree` 的詳情面板沒有被改**。圖鑑卡片是另一個元件（`DiceCard.astro`），刻意不重用
  `nodeViewHtml()`：面板的外殼是互動的，前置鏈區塊也只在畫布上才成立。
- 這幾頁**不吃 `tree.json` 的 gzip 預算**（`getStaticPaths`／頁面直接讀 `data/`）。

### `/board` 骰盤擺放編輯器

內容**不可索引**（拖曳擺放，畫面上沒有可搜尋文字），價值全在互動。它容易被下一個人「順手補回」
某些看起來像漏掉的功能，所以把裁決寫下來——**刻意不做**：戰鬥模擬、機率模擬、合成（骰子升級／融合）、
網址編碼、`localStorage`（Yuki 2026-08-22 指定，`src/pages/board.astro` 開頭有同一份注解）。
重新整理會回到空骰盤，這是已知且刻意的行為，不是待補的持久化。

**骰子圖示是「純骰子圖」（不含底板），跟骰子樹節點圖是兩條平行的資產路徑。** 正本管線（規則 7）
只處理 SVG 引用到的圖示，純骰子圖完全不在正本裡，所以另立一條：`data/board-icons/`（41 張來源
PNG，檔名＝內容 sha256 前 12 碼，`addIcon()` 直接重用）＋ `data/board-icons.json`（`{節點 id: hash}`，
兩邊由 `npm run add-icon -- --board <id> <png>` 一次更新），
`build:data` 轉成 `public/assets/board-icons/<hash>.webp`（`tools/lib/icons.ts` 的 `buildBoardIcon()`），規則 21 守。
⚠️ **刻意不套 `withGutter()`**：gutter 是為了 `<pattern>` 的繞回取樣而存在，`/board` 用的是普通
`<img>`，加了只會讓圖示在方框裡顯得更小。

⚠️ **這批來源圖尺寸與長寬比都不統一**（跟節點圖示統一 200×210 不一樣），帶出兩個不變量：

1. **四個顯示點**——`.board-cell img`／`.deck-dice img`／`.picker-dice img`／`.drag-ghost`——
   一律 `object-fit: contain`（`cover` 會裁掉骰子的角）。改成 `cover` 會 CI 全綠而畫面上出事，
   所以 `tests/lib/board-image.test.ts` 直接讀 `board.css` 釘住這四個選擇器。
2. **分享圖（`src/scripts/board-export.ts` 用 canvas 畫的那張）不能把圖片拉伸貼滿格子**。
   `src/lib/board-image.ts` 的 `iconRect(box, imgW, imgH, ratio)` 依
   `min(內框寬/imgW, 內框高/imgH)` 等比縮放置中，跟畫面上的 contain 對齊。`imgW`／`imgH` 刻意做成
   **必填**（不像 `ratio` 有預設值），呼叫端量不到真實尺寸時寧可在型別層面就過不了。
   ⚠️ `ratio` 的預設 0.78 跟 `.board-cell img { width: 78% }` 是配套關係，兩邊各寫死同一個數字，
   由一條讀 `board.css` 的測試比對兩邊沒有各自漂移。

`src/scripts/board.ts` 的 `diceMeta` 是從 `#dice-picker` 的 `<img src>` 讀回來的，所以拖曳、骰盤格、
分享圖三處畫面全部自動跟著換，不必維護第二份路徑。

### `/tactic` 戰術與 `/boss`

官方資料表 `戰術`（58 條已啟用）與 Boss（一般 10 ＋ 困難 11）的內容。`/boss` 分成「一般」「困難」兩組，各一個 h2 ＋
各自的 `.battle-list`，Boss 名稱因此是 **h3**（`/tactic` 仍是 h2；兩邊共用 `.battle-name` 這個 class，
所以字級不隨標籤變）。**lede 的兩個數量從資料算**，不寫死。B1／B1b 守。**兩者都不是骰子樹的節點**
（不花錢解鎖、沒有前置、不進成本計算），資料與圖示各走一條平行路徑，見上面「幾份沒有自動來源
的資料」與規則 24／25。跟 `/dice` 一樣是靜態頁、建置期直接讀 `data/`，`tree.json` 一個位元組
都不會變（2026-08-26 實測 sha256 與 main 相同）。

- **兩頁的入口收在「遊戲介紹」下拉裡，不在導覽列頂層**（Yuki 2026-08-26 指定）：它們跟下拉裡
  其他幾頁一樣是「遊戲有什麼」的說明，不是站台的互動工具（骰子樹／圖鑑／骰盤／模擬器）。
  ⚠️ **`Base.astro` 的 `guideCurrent` 要涵蓋下拉裡的每一頁**，不能只看 `/guide`——下拉預設是
  收起來的，站在 `/tactic` 時只有裡面那條 `aria-current`，導覽列上等於零提示。B6 兩邊都守。
- **版面是橫列清單不是卡片網格**（Yuki 2026-08-26 指定）：效果文字最短 12 字、最長 55 字，
  排進等寬網格會讓同一列的卡片高度參差；橫列讓長文字自己往下長，不影響鄰居。
- ⚠️ **編號與內部ID 一律不顯示在畫面上**（Yuki 2026-08-26）：那兩個是拿本站對官方資料表用的，
  玩家在遊戲裡看不到。**但資料檔要留著**——`id` 是錨點（`#t69-1`）與規則 24 的鍵，`gameId` 是
  日後對新版資料表唯一可靠的 join key，兩個都不能因為畫面不印就刪掉。子選項的從屬關係改由
  縮排 ＋ 一個 `aria-hidden` 的 `↳` ＋「選項」階段標籤承擔。E2E 的 **T1b** 量的是
  `main` 的 `innerText`（不是原始 HTML——`id="t6"` 這種屬性留著是對的），反例驗過會紅。
- ⚠️ **模式切換鈕的文字是「目前正在看的模式」，不是「按下去會變成什麼」**（Yuki 2026-08-26
  指定）。這是 CLAUDE.md 那條「切換鈕文字固定不變」的**例外**——那條的理由是文字互換會讓沾頂
  的工具列寬度跳動，而這裡兩個字串都是四個中文字（對戰模式／合作模式），寬度不變。
  ⚠️ **換文字時 `aria-label` 要一起換**：它是無障礙名稱，只換可見文字的話螢幕閱讀器會一直念
  同一句。可見文字／`aria-label`／`data-mode` 三件事要同時換，少一件就是畫面與讀屏各說各話，
  而兩邊都不會報錯。T5 三件都驗。
- **對戰／合作兩段文字都輸出進 HTML，切換只換顯示哪一段**（CSS 的 `[data-mode]`）。用 JS 換
  `textContent` 的話合作那一段永遠進不了 HTML——而「文字進得了 HTML」正是這兩頁存在的理由，
  跟 `/dice` 的數值面板做成純 CSS 是同一個判準。
  ⚠️ **驗這一塊不要用 `toHaveText`**：`textContent` 會把 `display: none` 的另一段一起讀進來
  （`dice.css` 的數值面板為此吃過虧）。E2E 的 T5 量的是**可見性**與**可見條數**。
- ⚠️ **`.battle-item[hidden]` 那條 `display: none` 是必要的不是保險**：`.battle-item` 本身是
  `display: grid`，會壓過 `[hidden]` 的預設值——少了它，篩選時「隱藏」的那幾條照樣在畫面上，
  而計數已經扣掉它們（`.dice-card[hidden]` 為同一個理由存在）。
- ⚠️ **子選項的顯示要跟著母條目**：69「選擇由我決定」是前期，它底下三個子選項的階段是
  「選項」——只勾「選項」的話，畫面上會出現三條縮排、掛著 `↳` 卻找不到母條目的孤兒
  （編號拿掉之後更看不出它們屬於誰）。`apply()` 因此是**兩輪**：先各自判斷，再把
  「母條目不在畫面上」的子選項收掉。T6b 守，反例驗過會紅。
- `#tactic-empty`（篩到零筆的提示）**只有一條路徑走得到**：把三個非「選項」階段全部取消勾選
  ——那時三個子選項也會被上面那條規則收掉，整頁真的是 0 筆。T6b 順帶驗這一段。
- **兩頁的圖示來源長寬比不統一**（戰術 176×206 與 164×166 都有、Boss 約 128×128），所以
  `.battle-icon` 一律 `object-fit: contain`——跟 `/board` 那四個顯示點是同一條不變量，
  改成 `cover` 會 CI 全綠而畫面上圖被裁角。B5 守。
- ⚠️ **驗「圖載得到」不要用 `naturalWidth`**：這些 `<img>` 是 `loading="lazy"`，畫面外的幾十張
  本來就還沒開始載，量到的是捲軸位置不是圖存不存在（第一版就這樣紅在「29 張載不到」）。
  B5 改成逐個網址發請求。

### `/sim` 骰子樹模擬器

在骰子樹上逐顆解鎖、調等級，即時算出這套規劃要花多少核心、金幣與太陽核心（資源上限有三個輸入框
`sim-limit-core`／`-gold`／`-solar`，`exceedsLimit()` 的 `limits` 是三個 `number | null`，太陽核心走同一條
「只擋會變貴的方向」）。**刻意不做**：戰鬥／機率模擬、
骰子強度評分、網址編碼分享、分支點數統計（Yuki 2026-08-23 指定）。⚠️ **進度存在 `localStorage`
（鍵 `rd2-sim-v1`），這跟 `/board` 刻意不存是相反的裁決**——理由是模擬一棵 239 節點的樹是會做很久
的事，而擺 5 顆骰子不是。版本號寫在鍵名裡，格式改了就換一個鍵，不寫遷移程式。

- **算術全部在純函式層**：`src/lib/sim.ts`（狀態機）、`src/lib/sim-io.ts`（存檔與文字報告）、
  `src/lib/upgrade-tiers.ts`（費用查表）。`src/scripts/sim.ts` 只做「把狀態畫成畫面、把事件翻成
  狀態轉換」。**每個操作都回傳新狀態而不是就地改**——undo／redo 直接把整份狀態推進堆疊，不必為
  每種操作各寫一次反向操作（而反向操作正是最容易漏掉連帶效果的地方）。
- **畫布是自己組的**（`renderTree()` ＋ `Viewport`），**不重用 `src/scripts/tree-canvas.ts`**：
  那支是 side-effect 腳本、載入即掛載，而且跟 `/tree` 的篩選器、詳情卡片擺位、高解析圖示 LOD
  綁死。⚠️ 共用的是 **`canvas.css` 的兩個區塊**（「畫布頁的版面骨架」與「畫布內容」），2026-08-23
  從 `tree.astro` 搬過去——搬的當下就抓到一個真 bug：`/sim` 完全沒有節點外觀那一節，標籤吃
  SVG 預設的 **16px**（使用者座標），**別的節點的標籤蓋住了 10 顆節點的圖示中心**，症狀是
  「點某幾顆完全沒反應」。⚠️ 反例測過：擋住這件事的是**字級**——單獨拿掉
  `pointer-events: none`、或讓符文標籤全部顯示，S13 都不會紅，把字級改回 16px 才紅。
  **加樣式時不要以為 `pointer-events: none` 是那道防線。**
- ⚠️ **不能在節點上綁 `click`。** `svg.setPointerCapture()` 一旦生效，後續 pointer 事件（以及由
  它們合成的 click）的 target 全部被改標成 svg 本身，節點的 handler 永遠不會跑——實測就是整頁點
  下去沒反應。做法跟 `/tree` 一樣：pointerdown「當下」記下被按到的節點，pointerup 只用來量位移。
- ⚠️ **SVG 元素不吃 HTML 的 `hidden` 屬性。** 等級牌第一版用 `toggleAttribute('hidden')` 收放，
  那是完全沒有作用的一行，239 個牌子全部留在畫面上——**所有測試照樣綠，是截圖才看出來的**。
  現在交給 CSS 的 `.node:not(.sim-owned) .sim-badge { display: none }`。
- **可選初始骰子（陰陽／貪婪／空虛）只能用勾的，不能在樹上點。** 它們不花錢，讓玩家點一下就拿到
  等於送。判準從資料推導（`unlockVia` 非 cost 非 default 且無 `unlockPaid`），不硬編碼 id。
  ⚠️ **恐懼骰子（`5002`）不在這一組**：它是成就開門但仍要付 8 核心（`unlockPaid`），走一般解鎖流程。
- **「一鍵點亮」遇到沒勾的初始骰子時一顆都不解**（`pathTo()` 回 `need: []`）。解一半的話玩家會花掉
  資源、目標節點卻仍然點不開，而畫面上只會說「還缺前置」。
- **能力彙總的分組判準是「這個名稱在整份資料裡跨不跨系」**，不是「玩家現在解了哪幾顆」——用後者的話
  同一個效果會隨解鎖進度在分組之間跳來跳去（解第一顆時歸在該系、解第二顆時突然變成全域）。
  沒有 `growth` 的節點**不硬湊數字**，照描述列出來並標次數；要解析「起始SP增加40」這種固定值得另寫
  一組認得四種句型的正則，而那組正則挖錯不會有任何地方說話（同 `growth` 需要規則 17 反向驗算的理由）。
- ⚠️ **資源上限只能擋「會變貴」的方向。** 玩家的實際用法是「先規劃、事後才填上限」，填完那一刻
  通常已經超支；只看新總額有沒有超的話，連取消節點、降等級這些**會讓成本下降**的操作都會被擋，
  他除了 undo 或整份重置之外沒有出路。`exceedsLimit()` 收一個選用的 `previous` 就是為了這件事
  （不傳＝純看現況，給畫面上那行「已超出設定的上限」用）。E2E 的 S16 守。
- ⚠️ **狀態轉換失敗時，畫面仍然要跟著 `selected` 走。** `activate()` 先改 `selected` 再讓
  `commit()` 失敗的話，面板與 `.sim-selected` 會停在上一顆節點，而面板上那些按鈕讀的是
  `selected`——按下去作用在畫面上看不到的那顆。S20 守。
- ⚠️ **拖曳等級滑桿時不可以重建面板。** `renderDetailPanel()` 是 `innerHTML` 整段重寫，拖到一半
  重寫會把玩家正按著的 `<input type="range">` 換成新元素，指標捕捉隨之失效——實測 100 級的節點
  從最左端拖到最右端**只走到 Lv.6**。所以 `input` 走 `applyState()` ＋ `updateLevelReadout()`
  （只改文字），`change`（放開）才推一步 undo 並完整重畫。整段拖曳算**一步**復原，不是 99 步。
  ⚠️ **驗這件事一定要用真的滑鼠拖曳**：`fill()` ＋ `dispatchEvent('input')` 只送一次事件，完全
  繞過這條路徑（S3 就是這樣一直綠著的）。S17 用真滑鼠、S17b 直接驗「元素沒被換掉」這個根因；
  **手機的觸控拖曳 Playwright 驅動不了原生 range，只能真機驗**。
- ⚠️ **狀態色的 `filter` 會蓋掉鍵盤焦點的 `#focus-ring`。** `#tree.sim .node.sim-available .icon`
  的具體度 (1,4,0) 壓過 canvas.css 的 `.node:focus .icon` (0,3,0)，而 `.node:focus` 已經
  `outline: none`——Tab 到「可取得」或「已選取」的節點時**畫面零變化**。補一條
  `.sim-available:focus .icon` (1,5,0) 拿回來。這是這份文件為 `/tree` 記過的同一族坑。S15 守。
- ⚠️ **`#sim-toast` 是這一頁唯一的 `role="status"`，不可以用 `hidden` 收放。** 收放靠清空
  `textContent`，視覺由 CSS 的 `:empty` 收——`hidden`／`display:none`／`visibility:hidden` 三種
  都會讓它從無障礙樹消失，於是「超出資源上限」這些唯一的失敗回饋對螢幕閱讀器完全不存在。S19 守。
- ⚠️ **邊有三階，不是兩階**：沒到手＝暗（0.25）、**兩端都在手上＝正常亮度**（`edgeIsLinked`）、
  **真的走過＝再加金色**（`edgeWasUsed`）。`1001` 火骰子連著 `1005` 風與 `1007` 冰，三顆都是遊戲
  一開始就送的——那條路是通的，卻不是玩家走出來的。**只有兩階的話這兩條不是被畫成金線（看起來
  像自己解過），就是跟「還沒走到的路」一樣暗；Yuki 先後回報了這條界線的兩邊。**
  可選初始骰子同理（從討伐獎勵／通行證領的，指向它的邊沒被走過）。
  ⚠️ `edgeWasUsed` 是 `edgeIsLinked` 的**子集**，CSS 靠這個包含關係把兩件事拆成互不搶屬性的
  兩條規則（`.sim-linked` 只設 opacity、`.sim-active` 只設 stroke），不必去算具體度也不靠順序。
  `src/lib/sim.ts` 有一條全邊掃描的測試守著那個包含關係，畫面三階由 S18 守。
- **E2E 挑節點要挑「初始狀態就可解鎖」的那 11 顆**（前置只有起始骰子），否則每條測試都得先「一鍵
  點亮」，測到的就不是自己要測的那件事。⚠️ **定位要用 `.icon` 不是整個 `<g>`**：節點群組的
  bounding box 是「圖示 ∪ 標籤」的聯集，標籤比圖示寬得多，聯集框的中心常常落在**隔壁那顆節點**上
  （實測點 1201 打到 1001）。⚠️ 安全點擊區**兩個方向都要算**：工具列與手機版抽屜擋上下，桌機側欄
  擋右邊——只算上下的話節點會落在 `<aside>` 底下，症狀是「側欄一直停在空狀態」。

## 圖示

⚠️ **圖示的 alpha 輪廓＝高亮的形狀。** `.node.in-chain` 的金色光暈與鍵盤 focus 的 `#focus-ring`
**描的都是圖示自己的 alpha 輪廓**，不是節點宣告的 `shape`——所以圖裁得乾不乾淨會直接變成高亮的形狀。
兩個真實案例：

1. **角色圖示被切平**（五個支援角色的底板下緣圓弧被切掉 2–3 列，一被選進前置鏈就變成一條橫的淡黃色
   條）。修法是用最底 24 列擬合圓角補回去，再從頂端切掉同樣列數的全透明列，**畫布尺寸維持不變**
   （長寬比一變，圖在 `rect` 裡就會被拉扁）。守門是 `tests/data/icon-silhouette.test.ts`，判準是圖檔
   本身的兩個數字（最底列寬比、最後一列的落差），⚠️ **不是截圖比對像素**——光暈是 6px 模糊、跟深色底
   混完亮度很低，抓不到；放寬成「暖色」又會連角色自己的暖色像素一起抓進來。
2. **`<pattern>` 邊界的繞回取樣**（節點**上緣**一條極淡的水平金線，跟圖檔內容無關——換回舊圖、改用
   sprite 填色，那條線都一樣在）。tile 尺寸剛好等於 rect，取樣器在 tile 邊界是繞回的，底部不透明的
   底板邊會被當成最頂那列的鄰居取樣進去。修法是 `tools/lib/icons.ts` 的 `withGutter()` 把圖縮 2px 置中、四周留一圈全透明像素
   （sprite 那邊順帶解掉相鄰格子互相滲色）。守門是 `tests/tools/icons.test.ts`（`GUTTER = 0` 會紅）。
   **這個坑會影響所有 239 個節點**，只是底部不透明、上半部細的圖最容易看見。

⚠️ **走錯過的兩條路，不要再試一次**：(a)「是 CSS `drop-shadow()` 的濾鏡區域把光暈切掉了」——不是，
換成具名 `<filter>` ＋大區域之後那條線原封不動，而且 CSS 版的光暈**擴散得比具名版更遠**。
(b) 用截圖比對金色像素找那條線——抓不到（角色自己就有大量金／橙色像素，前置鏈的連線也是金色）。
有用的量法是「相鄰兩列的平均色差」找突變列，以及**同一個視角開關 `.in-chain` 兩次相減**只留下光暈。

- **sprite 的透明邊要跟著輸出解析度縮放**：sprite 是 1×、高解析圖是 2×，兩者貼到畫面上**同一個
  `<rect>`**；兩邊都留 1px 的話圖佔的比例差 3.8 個百分點，放大到觸發切換的那一刻每顆符文突然大 4.2%。
  `withGutter()` 收 gutter 參數，1× 傳 `GUTTER`、2× 傳 `GUTTER * 2`。
- **日後加圖示要注意**：`tools/add-icon.ts` 只驗「是有效 PNG 且最長邊 ≥96px」，不看裁切品質。
  角色類的圖進來時順手跑一次 `icon-silhouette.test.ts`。
- ⚠️ **掃金邊的座標要換算裝置像素**：CSS px ≠ 截圖像素（Pixel 7 dpr 2.625），E2E 的 H 曾因此一直靠
  光暈外暈擦邊過。

### 中央樞紐 `<g class="tree-center">`

正本裡唯一一個**不是節點**的圖形群組：遊戲內的「骰子樹」本體，五顆起手骰從它放射出去。沒有 id、
沒有花費，不參與成本計算、祖先高亮與篩選（`.node` 選擇器碰不到它）。`data-links` 列出五條放射線接到
的節點 id，圖在建置期轉成 `public/assets/tree-center.webp`（不進 sprite——sprite 依節點類型的顯示尺寸
分區打包，樞紐不屬於任何類型）。整組是**選用的**：沒有時 `meta.center` 是 null、站台不畫。規則 10 守。

## 資料解析

- **成本的畫面顯示走 `src/lib/cost-html.ts` 的 `costHtml()`／`simCostHtml()`**（2026-09-06，Yuki 指定貨幣旁要有
  遊戲內的圖）：每種貨幣前一張 `.currency-icon`（`public/currency/{core,gold,solar}.png`，64×64 正方置中，
  `alt=""`＋`aria-hidden`），**文字跟 `formatCost()` 逐字相同**，所以 `toHaveText`／`textContent` 的斷言不用改。
  純文字版 `formatCost()` 只給 aria-label、`simReport()`、PR 差異摘要用。圖高走 `1em`，跟著所在行的字級。
  ⚠️ 用 `innerHTML` 塞的地方（`/sim` 三列合計原本是 `textContent`）數字全來自 `Cost` 的 number，不含自由文字。
  ⚠️ `public/currency/` 在 `public/` 根目錄——不是 `public/assets/`（那個整個 gitignored、是 build:data 的產出）。
- 成本字串的分隔符是**全形斜線 `／`**（U+FF0F），全檔 0 個半形 `/`。
- **成本字串有三種貨幣**（2026-09-06 起）：`parseCost` 收五種形狀——`金幣 N`／`核心 N`／`金幣 N／核心 M`／
  `金幣 N／太陽核心 K`／`金幣 N／核心 M／太陽核心 K`，順序固定**金幣→核心→太陽核心**，禁反序禁重複。
  金幣四位數以上一定要千分位逗號，**太陽核心兩種都收**（`2,000` 與 `2000`）；`核心 N／太陽核心 M`
  （沒有金幣）刻意不支援。上限 `MAX_SOLAR = 100_000`（同 `MAX_CORE` 的理由）。
  **`Cost` 三個欄位全必填、`LevelCost.solar` 選填**：Cost 是算出來的（加總／差額／上限比對），可選欄位
  等於每個加法都要 `?? 0`，漏一處整筆變 NaN；「缺席當 0」只發生在讀兩份費用表 JSON 的那一層。
  `UpgradeBand` 刻意沒有 solar（tier 制只服務玩家被動與支援）。**太陽核心的顯示一律「有值才印」**
  （`formatCost`、`/sim` 三列合計、`simReport`、PR 差異摘要那行）；`simReport` 的判準是總計不是逐行。
  solar 全 0 時所有輸出逐位元組跟 1.0.3 時期相同。⚠️ 代價是 `tree.json` 每顆節點多一個 `"solar":0`，
  gzip 餘裕從 0.9 KB 掉到 0.5 KB——真的撞線時的解法是「產物層用選填、進 `TreeData` 時正規化成 0」。
- **等級上限一律在 `nodes.json` 的 `maxLevel`**（舊寫法「取 title 第二行」會在多行描述的節點上靜默算錯）。
- `#關鍵字` 標記**沒有結束符**，中文無分詞 → 必須用 `data/keywords.json` 白名單最長優先比對，
  不可用正則貪婪抓。
- **`data/keywords.json` 一份檔案兩個角色**：規則 8 的白名單 ＋ 玩家看得到的詞彙解釋（含 `code`／
  `color`／`desc`）。刻意不拆成兩份——拆開就會出現「白名單加了詞、但站上點開沒有解釋」而兩邊都不報錯。
- `meta.glossary` 只放**用得到的**詞條（節點用到的＋覺醒用到的＋這些解釋自己再引用到的），不是整份，
  而且**不含 `code`**（那是給貢獻者比對遊戲資源檔的）。key 進 tree.json 前有排序：傳遞閉包是用堆疊
  展開的，不排序的話資料沒變 diff 也會整段翻掉。**這些數字別手寫進文件**，`build:data` 每次都會印出實際值。
- **別名詞條 `{"aliasOf": "本尊"}`**：同一個遊戲代碼被官方翻成兩個顯示名時用它，不要抄第二份解釋。
  規則 8(b) 禁止鏈狀別名。
- ⚠️ **`node.keywords` 的語意是「描述裡用到的」，不含覺醒**。面板要列出覺醒的關鍵字時是拿
  `meta.glossary` 的 key 當清單現算（`termsIn()`）——改 `node.keywords` 的語意會連帶動到搜尋與篩選。
- `stroke` 不在固定元素上：骰子在 `<rect>`、符文/支援在 `<polygon>`、被動在 `<circle>`。
- 成長值單位有 `%` / 秒 / 次 / 個 / **倍** / 無單位六種，且有負值加雙符號 `(+-0.2秒)`。
  `src/lib/growth.ts` 的正則限定位數，不可寫回 `[\d.]+`——那會災難性回溯（實測 2 萬位輸入 2.5 秒），
  而 validate 是 fork PR 也跑得到的工作。
- ⚠️ **屬性值裡的字面換行是個地雷**：XML 規範要求 parser 正規化成空格，**Chromium 遵守、linkedom
  不遵守**，同一份檔案兩邊會讀出不同的 `data-description`。目前正本上已經沒有多行文字屬性（隨文案
  搬進 JSON 的 `\n`），但任何「在瀏覽器裡直接解析這份 SVG」的功能（例如線上編輯器）都會踩到，
  修法是改編成 `&#10;`。
- `tools/lib/dom.ts` 的 `attr()`：**linkedom 不解屬性裡的 `&amp;`／`&lt;`，卻會解 `<title>` 裡的**。

## 工具與 CLI

- ⚠️ **CLI entry guard 一律用 `pathToFileURL`。** 舊寫法 `import.meta.url === \`file://${process.argv[1]}\``
  在 Windows 上恆為 false（`argv[1]` 是反斜線路徑，`import.meta.url` 是 `file:///C:/...`），腳本印完
  banner 就 exit 0 什麼都沒做——最貴的是 `npm run validate`：**它是閘門，卻在 Windows 上一直「通過」
  而沒有驗任何東西**。POSIX 也不安全：`import.meta.url` 會 percent-encode，template literal 不會，
  所以路徑含空白或非 ASCII 就踩到同一個空跑。`tests/tools/entry-guard.test.ts` 掃過 `tools/*.ts` 釘住：

  ```ts
  import { pathToFileURL } from 'node:url';
  if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  ```

  `?? ''` 是因為 `noUncheckedIndexedAccess`；`pathToFileURL('')` 解析成 cwd 的 URL 而不是丟例外，
  guard 單純不成立，是安全的預設。（外部貢獻者在 PR #34 找到並修掉。）
- ⚠️ **`String.replace` 比對不到會原樣回傳——「字串有沒有變」不是成功判準。** `render-nodes.ts` 靠一串
  正則把渲染結果寫回正本：第一版用 `patched++` 數區塊（每個區塊必定 +1，等於什麼都沒驗），改成比對
  前後字串又立刻誤報（重跑時值本來就一樣）。**正確做法是看正則有沒有真的比對到**（`replace` 的
  callback 裡設旗標），`mustReplace()` 就是為此存在。同一個錯在這個檔案犯過兩次。
  失敗長相：正本留著指向已被刪掉的舊圖示雜湊，validate 爆出 239 個規則 7(a) 錯誤，而完全看不出是
  哪一步說了謊。
- ⚠️ **Playwright 的 `omitBackground` 只拿掉「頁面」的背景**，對**內容自己畫的背景**無效。原圖有一張
  `<rect width="100%" height="100%">`，沒把它一起 `display:none` 的話截出來的每張圖都夾帶實心底色。
  後果會蔓延：節點變成不透明方塊蓋掉穿過它的線與鄰居的標籤，`outline` 與 `drop-shadow` 去描那個方塊
  而不是按鈕。**檢查方式是量 alpha 通道的分佈，不是看截圖。**
- ⚠️ **`split-svg.ts` 與 `render-nodes.ts` 的來源檔一律由參數傳入、沒有預設值。** 以前預設指向維護者
  本機的遊戲原圖，別人跑到只會得到一個看不懂的 ENOENT，而那條路徑也不該留在公開 repo 裡。

## 測試環境

- **`src/generated/tree.json` 是 gitignored 的建置產物**，多個測試會讀它 → `pretest`／`pree2e`
  已補上，**不要拿掉**。
- linkedom 沒有 `getScreenCTM()`，`.focus()` 也不會更新 `document.activeElement` → 這類行為只能靠 E2E 驗。
- 臨時的 Playwright 腳本要放在 **repo 目錄下**才 import 得到 `@playwright/test`。
- ⚠️ **備份檔名要帶上路徑，不要只用 `basename`。** 這個 repo 有好幾組同名不同路徑的檔案
  （`src/lib/sim.ts` 與 `src/scripts/sim.ts`、`src/lib/board.ts` 與 `src/scripts/board.ts`）。
  2026-08-23 用 `for f in …; do cp "$f" "$SCRATCH/$(basename $f).bak"; done` 備份三個檔去跑反例，
  後備份的 `src/lib/sim.ts` 覆蓋掉前一個同名備份，還原時把 lib 的內容寫進了 scripts——那一輪的
  修改全部消失，靠 `git checkout` 取回上一個 commit 再重做才救回來。
- ⚠️ **兩個工作區同時跑 E2E 會互相偷 server。** `playwright.config.ts` 的 `reuseExistingServer: true` 配上寫死的埠，意思是
  **只要那個埠上有人在聽就拿它當受測站台**。2026-08-19 實際咬到人：worktree 那邊跑 E2E 時 Playwright
  重用了主 checkout 殘留的 `serve dist`，測到別份產物，症狀是「element(s) not found」，看起來完全像
  自己的程式沒輸出那個元素。破案靠 `curl localhost:<port> | grep -c <自己的東西>` 回 0。
  平行開兩個工作區時其中一邊用 `E2E_PORT=4399 npm run e2e`；收工前確認 `pgrep -af "bin/serve"` 沒有殘留。
  這跟上面「`npx playwright test` 不會重新建置」是同一族的坑——**都是「你以為在測自己的東西，其實不是」**。

## 部署

- ⚠️ **`ci.yml` 的 `deploy` job 刻意沒有 `actions/checkout`**，只 `download-artifact` 拿 `verify` 驗過的
  `dist/`，好讓「上線的位元組＝被驗過的位元組」。代價是 runner 的工作目錄裡**只有 dist/**，而
  Cloudflare Pages 的 Functions 是看「執行指令的那個目錄底下有沒有 `functions/`」決定要不要打包的
  （不存在就整段跳過，**沒有 warning、部署照樣回成功**）。哪天要加 Pages Functions：
  - ⚠️ **checkout 要放在 `download-artifact` 之前**（`actions/checkout` 預設 `clean: true` 會清空工作
    目錄，順序反了會把下載好的 `dist/` 洗掉，然後部署一個空目錄——而且大概不會報錯）。
  - ⚠️ action 要 pin 40 碼 SHA（repo 開了 `sha_pinning_required`）。
  - **deploy 後面要補一步 smoke**，否則「binding 沒綁／表沒建／functions 沒上傳／CSP 擋掉」四種失敗
    都會收斂成「那塊功能靜靜消失」，沒有任何人會知道。
- ⚠️ **`public/_headers` 對 Pages Functions 的回應無效**（官方文件明載）。CSP 之類的標頭要兩邊都寫：
  靜態頁走 `_headers`，Function 在程式碼裡自己放進 `Response`。驗收也要分開驗。
- ⚠️ **`#hit-counter` 抓得到 HTML 不代表看得到。** 訪客計數器預設 `hidden`，前端拿到數字才顯示——
  endpoint 掛掉時它會**安靜地不出現**，那是刻意的降級。`curl … | grep -c "位訪客"` 回 1 只證明標記在
  HTML 裡。要驗顯示就用瀏覽器。
  順帶：前端判斷 API 成功與否**不看 status code**，只看 payload 形狀（`typeof body.n === 'number'`）。
  「`/api/hits` 沒部署時回什麼」完全取決於 `dist/` 裡有什麼，而那會變（補 404 頁之前是 200 ＋ 一份
  首頁 HTML，之後是 404，POST 到存在的靜態路徑則是 405）——**不要因為現在有 404 了就改回去信 status code**。

### SEO 基礎欄位

- **`public/robots.txt`**——`Sitemap:` 那行是絕對網址，換網域要跟 `site` 一起改。
- **`@astrojs/sitemap`**——⚠️ **不要加 `filter` 排除 404**：實測不帶任何選項產出的 `<loc>` 就只有現有
  頁面，404 是套件預設就排除的，自己寫的 filter 是死碼。⚠️ `tests/e2e/seo.spec.ts` 的 `PAGES` 用
  **完全相等**比對 `<loc>` 清單，新增或移除頁面一定要同時改那份清單。
- **`src/pages/404.astro`**（⚠️ 不是 `public/404.html`）——產物同樣是 `dist/404.html`、Pages 一樣認，
  但走 Astro 才吃得到 `Base.astro` 的導覽列與樣式；寫成 public/ 底下的靜態 HTML 就得複製一份無人看守、
  必然漂移的樣式副本。
- **`Base.astro` 的 `<title>` 格式是 `Random Dice 2 wiki | 分頁名`**（站名在前），分隔符是半形 `|`，
  **不帶破折號**（`tests/e2e/tree.spec.ts` 的 R 守）。`noIndex` prop 目前只有 404 頁用，開起來會
  **省略 canonical 並加 `<meta name="robots" content="noindex">`**（404 頁的 canonical 只會固定指向
  `/404/`，等於邀請搜尋引擎去索引那個網址）。
- ⚠️ **`seo.spec.ts` 的「未知路徑回 404」在本機是假綠。** E2E 的 webServer 是 `serve dist`，它對找不到
  的檔案本來就回 404——soft 404 是 **Cloudflare Pages 那端**的行為。那條守的是「本機沒退步」，真正的
  驗收只能在部署後對正式站做：`curl -o /dev/null -w '%{http_code}\n' https://rd2-wiki.pages.dev/no-such-page` 要回 404。

## README 與門面素材

README 是產品頁形式（banner ＋ 徽章 ＋ `> [!WARNING]` 免責 ＋ 分讀者章節）。

- 素材在 **`.github/media/`**（含 banner 的原始碼 `banner.src.html`，重產指令寫在該檔開頭）。
  **不要放進 `public/`**——那會被打包進站台，還要吃規則 12 的效能預算。
- ⚠️ **banner 裡不要放節點數這類會隨資料改動的數字**（第一版烤了「239 節點／248 條連線」，資料 PR
  一改數字圖就會說謊，而 CI 完全擋不住）。會變的事實只放文字。
- banner 與 tagline 的文案**沿用 `Base.astro` 的 `OG_TITLE`／`DESCRIPTION`**，不維護第二份。
- 已知限制與 `src/lib/flags.ts` 的暫停功能**刻意不寫進 README**——那是維護者資訊，留在這份檔案。
- ⚠️ **不要用 `[/about](/about)` 這種 root-relative 連結**：GitHub 會把它連到 `github.com/about`。
  README 與 `CONTRIBUTING.md`（會被 `about.astro` import）都要寫完整網址。
- ⚠️ `LICENSE` 尾端有「MIT 只涵蓋程式碼」的附註 → GitHub 判成 `license.key = "other"`，動態 license
  徽章顯示 *not identifiable by github*。徽章已改成靜態的，**不要為了讓徽章好看去刪那段附註**。
- **推上去之前先在本機看渲染結果**（不是想像）：

  ```bash
  jq -Rs '{text:., mode:"gfm", context:"NatsuYukiowob/rd2-wiki"}' README.md > /tmp/md.json
  gh api -X POST /markdown --input /tmp/md.json > /tmp/readme.html
  # 套 github-markdown-css 後用 Playwright 截 fullPage，light/dark 各一張
  ```

  這樣抓到過上面那條 root-relative 連結與失效的 license 徽章——兩個都是純讀 Markdown 看不出來的。

## 不進版控

`docs/`（規格書、實作計畫、部署步驟、已知問題）與 `.superpowers/`（SDD 工作區）**刻意移出版控**，
只留維護者本機並另外備份。v1 開發歷程（39 commit）在本機 `feat/v1-dice-tree` 分支，未推遠端。

## 暫時停用的功能

`src/lib/flags.ts` 的 `FEATURES` 目前只剩一項：導覽列的「貢獻」入口（`/about` 直接開網址仍打得開）。
布林值一翻功能就回來；對應的測試斷言的是**現在**的行為，開回來時會紅，紅的那幾條會直接指出還要改哪裡。

⚠️ 原本的 `keywordSearch`（`#關鍵字` 點下去自動搜尋）**已經移除**：那個手勢現在用來換頁，搜尋改成
詞彙頁上一顆看得見的「搜尋 #X」按鈕，不再是隱藏行為。`.kw-clickable` 這個雙用途 class 也一併拿掉了。

## 已知待辦

**待辦正本是 [GitHub Issues](https://github.com/NatsuYukiowob/rd2-wiki/issues)**，不要在這份文件裡
另外維護一份清單。完整的歷史清單在未進版控的 `docs/` 裡。

下面兩項留在這裡，是因為它們是「不要退回去」的結論，不是待辦：

1. ~~節點標籤重疊~~ **已解**：畫面上恆常只留骰子（41）與支援（5）的標籤，符文（123）與被動（70）
   改成滑過／鍵盤聚焦／被選進前置鏈時才單獨顯示（純 CSS）。量測依據：符文標籤平均寬 61 單位、最近鄰
   距離只有 41，全顯示必然重疊（實測 27 對）；**縮字級沒用**（縮到 7px 仍有 15 對），只留骰子與支援
   則是 0 對。E2E 的 M 守著。
2. **自動化只在 Chromium 驗過**，核心渲染用 `<pattern>` 這條冷門 SVG 路徑。iOS Safari 沒有自動化覆蓋，
   但 2026-08-20 起 iOS 使用者回報沒有問題，所以不列為待辦；日後改動 `<pattern>` 那條路徑時要重新確認。
