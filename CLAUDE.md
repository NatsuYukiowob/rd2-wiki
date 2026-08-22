# rd2-wiki

《Random Dice 2》互動式骰子樹攻略站。Astro 靜態站，部署在 Cloudflare Pages
（https://rd2-wiki.pages.dev/），GitHub `NatsuYukiowob/rd2-wiki`（public）。

## 這個專案的核心概念

資料正本是**兩個檔**（2026-08-22 起，#21 PR1）：

- **`data/dice-tree.svg`**——只有**幾何**（239 個 `<g class="node">`／248 條邊）：`data-id`、
  `transform`、形狀與 `stroke`、`<image>`、`data-wip`。**一個字都沒有**
- **`data/nodes.json`**——全部**文案**，以節點 id 為鍵：`name` `label` `type` `category?`
  `gameId` `cost` `maxLevel` `description` `awakening?`

外加 `data/icons/`（238 張 PNG，檔名 = 內容 sha256 前 12 碼）與 `data/tree-center.png`
（中央樞紐的合成圖，見下）。由社群發 PR 維護，CI 是唯一防線（維護者不可能逐行 review
SVG 的 diff）。

⚠️ **兩邊的 id 集合必須雙射**（規則 19）——這是「它們已經不同步」唯一會說話的地方。
join key 一律用 `data-id`，**不要拿座標配對**：浮點與 `transform` 一改就對不上。

為什麼要拆：`<title>` 是 `name` ＋ `description` 的完整副本（23.5 KB），規則 1 的存在理由
就是守那份副本；文案總計佔正本 48.6%（173,782 → 89,325 bytes）。拆完之後改一句描述＝
JSON 一行 diff，而不是一行 500 字元、rect/image/text 混在一起的 `<g>`。

⚠️ **`<text>` 標籤在 PR2（2026-08-22）也搬走了**，改成 `label` 欄位。它不是 `name` 的副本
（239 個裡 60 個是縮寫，`所有骰子傷害` → `全骰傷害`），是真資料——但留在 SVG 的話，線上
編輯器（#32）改一個縮寫仍然得對 SVG 動「行區塊外科手術」，而那是 #32 最脆弱的一段。
全搬之後編輯器任何文字操作都只碰 JSON。代價是正本用 Inkscape 打開是 239 個無名圖示，
補償是 **`npm run preview`**：把標籤與 id 注回幾何，產出 `data/dice-tree.preview.svg`
（gitignored）。那條動線是可逆的——**正本 → preview → normalize 逐位元組回到正本**，
`tests/tools/build-preview-svg.test.ts` 有一條測試守著它。

**外觀整個來自遊戲內的原圖**：2026-08-18 依遊戲內的骰子樹畫面 `RD2骰子樹 v1.0.1`
（`dice_tree_v1.0.1_fixed.svg`，素材不在版控內）重做，座標取原圖 ×0.5
（原圖節點座標全是 20 的倍數，減半後仍是 10 的倍數），圖示、配色、邊的粗細與顏色也都對過去。
那份原圖**只有畫面、沒有任何文字資料**（0 個 `<text>` / `<title>` / `data-name`），名稱／
花費／描述一律留在 `data/nodes.json`。

⚠️ **原圖的節點不是「一張圖」，是多層疊出來的**——底盤圖 ＋ SVG 漸層圖形 ＋ 帶 CSS filter 的
符號 ＋ 投影濾鏡。所以「換圖示」不能只是複製檔案，要跑 `npm run render-nodes`：它用真的
Chromium 把每個節點各自渲染成一張扁平 PNG（濾鏡與漸層由瀏覽器算，不重寫一份），再把結果
與尺寸寫回正本。這支**不掛在建置流程上**，一年跑不了幾次，CI 與貢獻者都不必裝瀏覽器。

核心功能：點一個節點 → 高亮它在 DAG 上的**所有祖先聯集**（去重、含自身、多重前置視為 AND）
→ 算出解鎖成本。

## 指令

```bash
npm run validate    # 資料驗證（規則 0–10、13–19，CI 守門員）
npm run typecheck   # tsc --noEmit（含 noUnusedLocals，會抓沒用到的 import）
npm run normalize   # 攤平 Inkscape 的圖層/matrix/相對路徑、清掉 <text> 與註解（送 PR 前必跑）
npm run preview     # 把標籤注回幾何，產出 data/dice-tree.preview.svg（不進版控，肉眼看版面用）
npm run add-icon    # 新增圖示，自動用內容雜湊命名
npm run render-nodes -- <遊戲原圖路徑>  # 用 Chromium 重畫全部節點圖示（遊戲改版才跑，見下）
npm run split -- <遊戲原圖路徑>         # 從原圖切出正本與圖示（重建整份資料時才用）
npm run build:data  # 產出 src/generated/tree.json + public/assets/
npm run build       # build:data + astro build
npm test            # 有 pretest 自動跑 build:data
npm run e2e         # 有 pree2e 自動跑 build
```

## 不變量（改動後務必重驗）

- 版本欄位有**三個、意義不同**：`data-game-version`（玩家看得到的遊戲版本，目前 1.0.3）、
  `<metadata>` 的 `resource bundle`（資料抄自哪一版遊戲資源包，目前 0.0.6）、
  `data-version`（正本自己的 schema 版本，目前 1.1.0）。首頁顯示前兩個，不要合併。
  ⚠️ `<metadata>` 開頭那句 `layout rebased on RD2骰子樹 v1.0.1 (2026-08-18)` 講的是**版面**
  抄自哪一版，跟 `data-game-version` 是兩件事——v1.0.3 沒有動幾何，所以它仍然停在 v1.0.1，
  不要順手一起改
- 節點 **239**、邊 **248**、根 5 個（`1001 2001 3001 4008 5002`）、多重前置 **14** 個
- **41 顆骰子各有一則 `awakening`**（7 骰點自動啟用的覺醒效果），其餘 198 個節點不准有這個鍵
  （規則 14）。覺醒**不是節點**：不用花錢解鎖、沒有前置、不進成本計算——所以它是骰子身上的
  一個欄位，不是第 240–280 個節點。做成節點會同時弄壞 239／248 與全樹解鎖成本
- **`gameId` 全 239 個都要有、且全檔唯一**（骰子 `D000`／符文 `D0000`／共通 `S0200`，
  規則 16）。它是正本與遊戲資料表唯一對得起來的鍵——⚠️ **刻意不進 tree.json**（站台不顯示，
  239 個字串要吃 0.55KB gzip），所以規則 16 是它唯一的防線，改壞了站台完全不受影響
- **`category` 只掛在 70 個玩家被動上**（`系別屬性 25／全骰屬性 15／系別技能 15／
  玩家被動 10／支援強化 5`，規則 16）。詳情面板有分類時顯示分類、沒有才顯示 type。
  `支援強化` 是本站的命名：遊戲資料表把支援角色與它的冷卻縮減都標成「支援」，照抄會寫出
  「支援 · 支援」與「玩家被動 · 支援」兩種都看不懂的組合
- `5201` 前置鏈 = **核心 42 ／ 金幣 23,000**（spec §6.4 基準）。
  ⚠️ 2026-08-21 從核心 66 降下來，因為鏈上的 `5002`／`5006`／`5008` 三顆骰子改成非成本解鎖
  （−24 核心）。舊文件與註解裡出現的「66」是那之前的基準，見下方規則 6(d) 那段的說明
- 全樹解鎖成本 = **核心 1,772 ／ 金幣 6,662,000**
- `dataIssue==='placeholder'` **0** 個、`no-growth` **0** 個
  （2026-08-21 依官方資料表補上那 5 個節點缺的 `(+每級增量)` 之後歸零，見規則 17）
- **`unlockVia !== 'cost'` 的節點共 9 個，全是骰子**：`default` 5（`1001 1005 1007 2001 3001`
  初始解鎖）、`quest` 1（`4008`）、`achievement` 3（`5002 5006 5008`）。
  來源是 `data/unlock-exceptions.json`，其中的 `note`（官方取得條件原文）會進 tree.json 的
  `unlockNote`，面板與 aria-label 優先顯示它而不是「任務解鎖」這種分類詞。
  ⚠️ **這不會改變 `meta.totalUnlockCost`**——那是「SVG 成本總和」（spec §2.1），刻意不排除
  非 cost 節點，站台一個地方都沒顯示它；會跟著變的是 `sumUnlockCost()` 的前置鏈計算
- ⚠️ **描述文字以「遊戲內實際顯示」為準，不是資源包裡的原始樣板。**
  資源包有沒填值的 `{n}` 佔位符時，遊戲並不是照樣印出來，而是**連同它所在的那一段一起不顯示**
  （2026-08-20 Yuki 逐個對照遊戲畫面）：

  | id | 資源包原文 | 正本（＝遊戲畫面） |
  |---|---|---|
  | 2403 | `攻擊速度增加5%(+{1}%)` | `攻擊速度增加5%` |
  | 5302 | `#僵硬範圍增加30%(+{1}%)` | `#僵硬範圍增加30%` |

  所以正本現在一個佔位符都沒有。下次拿新版資源包來對時這兩個會顯示成「跟上游不一致」，
  那是刻意的。

  ⚠️ **2026-08-21 更新：官方資料表補值的那幾個要照抄實值，不再砍整段。**
  資料表 v2 把 `5403`／`5307`／`5206` 三處原本沒填的數字補上了（`傷害增加30(最多100疊加)`、
  `30%機率額外獲得2疊加`、`#SP怪物的SP獲得量增加10(+5)`）。上游填得出來就用上游的，
  「連同那一段一起不顯示」只適用於**上游自己也沒有值**的情形——也就是上表剩下的兩個。

  ⚠️ **2026-08-22 v1.0.3 起 `5403` 的括號刻意不跟上游。** 資料表 v1.0.3 把它寫成全形
  `傷害增加30（最多100疊加）`，全站其他描述一律半形，正本維持 `(最多100疊加)`。
  下次拿新版資源包來對時這處會顯示成「跟上游不一致」，跟上面那兩個佔位符一樣是刻意的。
- ⚠️ **佔位符偵測機制留著，但真實資料已經沒有樣本了。** `parseGrowth` 的 `{n}` 判定、
  `dataIssue: 'placeholder'`、規則 9 的警告、面板的「數值待補」全都還在——上游隨時可能再
  冒出新的佔位符，那是唯一會提醒我們的東西。對應的測試因此**全部改成合成樣本**
  （注入一段 `{1}` 再驗），不再綁在某顆真實節點上；綁真實節點的話，資料一改測試就跟著消失，
  而那段程式還活著卻沒有任何東西守著。
  ⚠️ 2026-08-22 前注入夾具要**描述與 `<title>` 一起改**；文案搬進 `nodes.json` 之後只有一個位置
- 畫布 viewBox `0 0 2000 1700`；顯示尺寸**逐節點**寫在正本的 `<image width/height>`
  （骰子 50×53 ×41、符文 26×26 ×123、被動小 34×34 ×45、被動大 44×44 ×25、支援 51×47 ×5）。
  **不要再加「類型 → 尺寸」對照表**：同一種類型底下也會有不同尺寸（被動有大小兩種），
  舊的 `sizeOfType()` 就是為此拿掉的。這幾個數字改動後一定要回頭看
  `src/lib/viewport.ts` 的兩個 `*_ICON_TARGET_PX`——它們是照骰子寬度換算的，
  曾經因為骰子從 56 縮到 50 卻沒跟著改，讓每個視角都多放大 12%。
  **同一批還有 `SHADOW_ON_AT_ICON_PX` / `SHADOW_OFF_AT_ICON_PX`**（節點投影的開關門檻，
  也是量骰子圖示的 CSS 顯示寬度）：`SHADOW_OFF` 必須高於那兩個 `*_ICON_TARGET_PX`，否則
  「整棵樹都看得到」的預設視角會重新畫滿 239 個 drop-shadow，手機平移直接從 40 掉回 20 FPS。
  這條不變式在 `tests/lib/viewport.test.ts` 有斷言，改壞了會紅
- 效能預算硬斷言：`tree.json` gzip ≤ 20KB（**目前 19.1KB，只剩 0.9KB**——v1.0.3 的較長描述吃掉了 0.1KB）、sprite ≤ 400KB（目前 130KB）。
  ⚠️ `tests/tools/build-data.test.ts` 有**兩條**預算斷言：一條量測試自己組的產物（`spriteIndex`
  是 238 筆全同值的替身，全同值壓得比真實座標好，**會低估約 0.5KB**），另一條量 `pretest`
  用 CLI 寫出的 `src/generated/tree.json`，也就是真正會被下載的位元組。餘裕只剩 1KB 的現在，
  少了後面那條就會出現「本機全綠、CI 硬斷言爆掉」
- **`data/upgrade-cost.json`＝技能升級花費表（1–50 級）**，`meta.upgradeCostTable` 帶進站台。
  ⚠️ **只適用骰子符文**：玩家被動的等級上限有 10／15／20／50／100 五種、單價 3,000–15,000
  各不相同，套這張表會算出一個看起來很專業的錯數字。`appliesTo` 與 `upgradeTableApplies()`
  就是擋這件事的。練滿 50 級＝**金幣 465,700 ／核心 99**（含解鎖那一次）。
  規則 15 把表格 1 級的金額與正本裡 43 個 50 級符文的解鎖金幣對起來——那是兩份資料唯一的
  交點，對不上就代表其中一份是舊的，而兩邊各自看都完全合法
- **`data/maxlevel-official.json`＝官方資料表標註的 44 條滿級數值**（`Lv.50：216%`），
  鍵是 `gameId`。**它不進 tree.json、站台一個字都不顯示**——站台的滿級值是
  `maxLevelValue()` 從 `growth` 現推的。這份資料唯一的用途是**規則 17：反向驗算那個推導**。
  `growth` 是用正則從一段中文描述裡挖出來的，而挖錯不會有任何一條既有規則說話：少寫一個
  `(+4%)` 只會讓 `growth` 變 null（面板那行「1 級 X → 50 級 Y」整條消失）、多一個負號會算出
  「50 級 −10.3 秒」、括號打成全形則整段配不到——三種都是合法的 SVG、合法的成本、合法的
  關鍵字，規則 1–16 全部放行。⚠️ **鍵一定要用 `gameId` 不能用節點 id 或名稱**：
  光「所有骰子傷害」就有 15 個同名節點，靠名稱配對會配錯。
  這條規則的來由是正本原本寫「減少-0.5秒(+-0.2秒)」，站台照著算出「50 級 −10.3 秒」上線了
  一段時間，一路上沒有任何檢查說話。⚠️ 規則 17 判定「哪些節點需要官方滿級值」的依據
  2026-08-22 起是 `nodes.json` 的 `maxLevel`（以前是從 `data-cost` 剖出來的）。
  ⚠️ 兩個容易改壞的地方：(1) **佔位符要略過不能報錯**——`parseGrowth` 對 `{n}` 回的也是
  `growth: null`，照 `!growth` 那條路報下去會跟規則 9 的「不擋 PR」政策自相矛盾；
  (2) **有覆蓋率下限**——只走夾具裡有的項目等於「刪掉一個鍵就單獨關掉那顆節點的檢查」，
  所以另外斷言「maxLevel > 1 的骰子符文全部要有官方值」（實測 44/44）。
  玩家被動那 40 個有 growth 的節點官方沒標滿級值，不在覆蓋範圍，只能靠規則 9 與人工
- **`data/changelog.json`＝站台更新日誌**（首頁顯示最新 3 筆），由**規則 20** 守。
  它是全站唯一**沒有自動來源**的內容：版本號、節點數、圖示全是從正本推出來的，只有這份是
  人手寫的，而「忘了寫」在畫面上跟「這次沒更新」長得一模一樣。所以規則 20 把它跟正本綁死
  ——**最新一筆帶 `data` 區塊的條目**，其 `gameVersion`／`gameBundle`／`date` 必須等於
  `data-game-version`／resource bundle／`data-updated`。⚠️ 檢查的是「最新一筆帶 `data` 的」
  而不是 `entries[0]`：純站台功能的條目（例如圖鑑上線）排在最前面卻沒有資料版本可言，
  硬要求 `entries[0]` 帶 `data` 的話，每次改前端都得假造一筆資料版本，規則就被繞過去了。
  條目**由新到舊**排列，同一天可以有多筆（先後有意義）
- **`data/unlock-exceptions.json`＝解鎖例外表**，由**規則 18** 守。它不是 SVG 的一部分，
  `build-data` 讀它時只有一個 `as` 斷言＝執行期零檢查，而它決定哪些節點不列入成本計算、
  `note` 還會直接印在面板與 aria-label 上。三種寫壞法在規則 18 之前全部 CI 全綠：
  key 打錯（那顆骰子安靜地變回要花核心買，整條前置鏈成本跟著變）、`unlockVia` 打錯
  （仍然 `!== 'cost'` 所以成本照樣排除，但面板印出字面的 `undefined`）、`note` 空字串。
  ⚠️ **規則 18 擋型別與長度，擋不住內容**——`unlockNote` 是自由文字而 `renderDetail()` 用
  `innerHTML`，所以 `NodeDetail.ts` 那邊一定要 `escapeHtml(formatUnlockVia(node))`

### 資料更新：v1.0.1 → v1.0.3（2026-08-22）

來源是 `RD2資料表v1.0.3 主檔案-v1.xlsx`（Yuki 從 Windows 端放進 Samba 分享）。這一版**只改文案**：
239 個 `gameId` 與官方表雙向全中、零新增零移除，幾何、邊、成本、`upgrade-cost.json`、
`keywords.json` 全部沒動，所以正本 SVG 只改三個版本欄位。

`data/nodes.json` 動了 7 處 `description`（第 8 處是 `5403` 的全形括號，見上面的說明，不跟）：

| id | gameId | 舊 → 新 |
|---|---|---|
| 2009 | `D206` | 補「；子彈攻擊力骰點提升300，強化數值225%」 |
| 2203 | `D2030` | `基本傷害增加5(+11)` → `基本傷害增加40(+20)` |
| 3205 | `D3030` | `每1次#連擊，使傷害額外增加10(+2)` → `20(+6)` |
| 3303 | `D3021` | 10% → 30% 機率召喚 #強化魔彈 |
| 3305 | `D3031` | 20% → 30% 機率 #連擊增加1 |
| 3405 | `D3032` | `#連擊於1~2隨機增加` → `於0~3` |
| 5001 | `D407` | 補前綴「基本傷害200；」 |

`data/maxlevel-official.json` 跟著動兩筆滿級值：`D2030` 544 → **1020**、`D3030` 108 → **314**。

⚠️ **這兩筆一定要跟 `description` 同一個 commit 進來。** 只改描述不改滿級值，規則 17 會擋下
（實測訊息：`節點 3205（D3030）推算的 Lv.50 滿級值 314 與官方資料表的 108 不一致`）——
那正是規則 17 該做的事，不是誤報。反過來只改滿級值不改描述也一樣會紅。

⚠️ **上游只給 `nodes.json` 的話要自己對整份表。** 這次 Yuki 先給的那份 `nodes.json` 只帶了
4 處，漏掉 `D206`／`D2030`／`D407`／`5403`；`D2030` 那筆還是會影響 `growth` 的成長值改動。
把 xlsx 的「技能效果」欄整欄拉出來跟 `nodes.json` 逐 `gameId` 比對才看得出來，
肉眼 diff 兩份 JSON 只會看到「這 4 處有改」而不會看到「那 4 處該改沒改」。

⚠️ **比對 xlsx 時「Lv.50：X」那一行要單獨剝掉再比。** 技能效果欄是多行的，第二行以後可能是
描述的續行、也可能是滿級值；把「第一行＝描述」當通則會生出 40 幾筆假差異。

`2009` 與 `5001` 的新描述裡有 `300`／`225%`／`200` 這種裸數字，實測 `parseGrowth` **沒有**
誤抓（兩者 `growth` 仍是 `null`）——它要的是 `基礎(+每級)` 的形狀。這點每次改描述都值得回頭確認。

### 中央樞紐 `<g class="tree-center">`

正本裡唯一一個**不是節點**的圖形群組：遊戲內的「骰子樹」本體，五顆起手骰從它放射出去。
沒有 id、沒有花費，不參與成本計算、祖先高亮與篩選（`.node` 選擇器碰不到它）。
`data-links` 列出五條放射線接到的節點 id，`<image href="tree-center.png">` 是圖，
建置期轉成 `public/assets/tree-center.webp`（不進 sprite——sprite 依節點類型的顯示尺寸分區
打包，樞紐不屬於任何類型）。整組是**選用的**：沒有這一組時 `meta.center` 是 null、站台不畫。
CI 規則 10 守它（`<svg>` 直屬、不帶 transform、圖檔存在且解析度 ≥ 顯示尺寸兩倍、
放射線終點確實落在 `data-links` 指定節點的中心；連線與根不一致只警告）。
**注意編號**：`規則 11`＝差異摘要留言、`規則 12`＝效能預算，都是 CI 步驟不是 validate 規則。
2026-08-19 補的 `規則 13`（幾何健全性）才是 validate 規則，編號接在 12 後面是為了不動既有兩個。

### 規則 1／4／19 的現行語意（2026-08-22 起，#21 PR1）

- **規則 1** 以前是「`<title>` 必須與 `data-*` 全等」。`<title>` 沒了，現在它驗的是
  `data/nodes.json` 的**結構**：必填欄位齊全、型別正確、長度 ≤ 500、不得有未知欄位，
  而且**選用欄位（`category`／`awakening`）不用時要整個省略，不可寫成 `""`**——空字串是
  falsy，會安靜地通過「非骰子不該有覺醒」那條。
- **規則 4** 以前交叉比對「`data-cost` 的『最高 N 級』」與「`<title>` 的『最高等級：N』」。
  ⚠️ 那條**一次都沒觸發過**：123 個骰子符文只寫前者、40 個玩家被動只寫後者，兩邊從不重疊。
  等級上限現在一律走 `maxLevel` 欄位，規則 4 改成擋「等級行重新混進 `cost`」——不讓第二個
  位置長回來。**這種改動 tree.json 一個位元組都不會變，所以它需要自己的測試。**
- **規則 20**（2026-08-22 新）：`data/changelog.json` 的結構，以及「最新一筆資料條目」與
  正本版本欄位一致。擋的不是「日誌寫錯」，是**「資料改了、日誌沒改」**——手法跟規則 17
  同一族：讓兩份資料互為對方的答案。
- **規則 8(b) 2026-08-22 擴充**：詞彙的 `code` 現在不只是識別字串，它就是 `/dice` 與
  `/guide/*` 上那個詞條的 **HTML id 與網址錨點**（`/guide/status#FROZEN`）。所以多驗兩件事：
  **不得撞號**（同一頁兩個相同 id，瀏覽器只跳得到第一個，另一個詞從此連不到）、
  **必須是英文字母開頭的 ASCII 識別字**（含中文或空白會讓錨點在網址列被編碼成一長串轉義）。
- **規則 19**（新）：SVG 的 `data-id` 集合 ≡ `nodes.json` 的鍵集合，雙射、兩邊零殘餘，
  而且**兩種殘餘都要逐一列出 id**（239 個節點，只說「數量對不上」等於沒說）。
- ⚠️ **幾何規則吃 `nodes`，文案規則吃 `withText`**（`tools/validate.ts`）。`withText` 是
  「兩邊都在、結構又合法」的過濾集合；把它餵給幾何規則的話，`nodes.json` 漏一筆會被翻譯成
  幾十條指向 SVG 的假錯誤（實測：刪掉 `1001` 一筆文案 → 55 條錯誤，54 條是規則 5／6／10／18
  在說「從根不可達」「邊端點未對齊」，唯一說對的規則 19 被埋在裡面）。
  文案規則＝1／3／4／8／9／14／15／16／17，其餘全部走 `nodes`。
- **`parseCost` 只吃單行**：規則 4 拒絕的輸入 `build:data` 必須也拒絕，判斷寫在 `parseCost`
  裡而不是 validate，兩邊才不會對同一份輸入給不同答案。`ParsedCost.maxLevel` 已移除。
- **正本上唯一合法的 `<text>` 是樞紐的標籤**（在 `parseTree` 擋，跟 `<title>` 同一條防線，
  2026-08-22 PR2 起）。節點標籤的正本是 `nodes.json` 的 `label`；SVG 裡的 `<text>` 只可能來自
  「把預覽檔存回正本」或有人手動加，兩種都是第二份會漂移的文案，而畫面上看不出差別
  （站台讀 tree.json，不解析正本）。`nodeRef()` 的退路因此改用 `transform` 座標
  （「它在哪」而不是「它叫什麼」）。
  ⚠️ **這條掃全檔，不是只掃 `g.node` 底下**：在 Inkscape 裡把節點解散群組、或把標籤拖出它的
  `<g>`，`<text>` 會落到圖層根，normalize 攤平圖層時再把它搬到 `<svg>` 底下。只看 `g.node`
  的話它會永遠留著，而且是 normalize 的定點（CI 的 `git diff --exit-code` 全綠）、validate
  也沒有規則看得到（code review 實測：0 errors 0 warnings）。
- **`label` 有自己的長度上限 20**（`MAX_LABEL_LENGTH`，其餘文字欄位仍是 500），且用碼點計字。
  搬走之後 review 幾何 PR 看不到標籤，「把 description 貼進 label」只剩規則 1 會說話。
- **`npm run normalize` 刪掉樞紐以外的所有 `<text>`，並比對 `nodes.json`**：跟 `label`
  （或 `class="id"` 的 id）相同＝預覽檔殘留，只報個數；不同＝有人在 GUI 裡改了字，
  逐筆列出並 **exit 1**。CI 的「正規化定點檢查」跑的就是這支，所以它同時擋住了「在 SVG 裡
  改文字」這條路。
  ⚠️ **比對與中止排在 `writeFileSync` 之前，漂移時一個位元組都不寫。** 反過來寫（先寫檔再
  報錯）看起來也有報錯，但那個錯誤是**一次性**的：訊息捲過去沒看到，再跑一次就全綠——
  `<text>` 已經被刪掉寫回去了，貢獻者改的字無聲消失（code review 實測第二次 exit=0、
  正本與 HEAD 逐位元組相同）。`tests/tools/normalize-cli.test.ts` 守這條。
  ⚠️ **`nodes.json` 找的是 SVG 同目錄那份**（不是寫死 `data/nodes.json`），找不到就只報個數、
  照常正規化——這支也拿來正規化測試夾具與暫存檔，寫死路徑會在**破壞性寫檔之後**噴 ENOENT。
  normalize 也會清掉**註解**（含它後面那個只有換行的文字節點）——不清的話，「預覽檔 → 正本」
  會在正本頂端留下一行「這是產生檔」，內容正好是相反的。

### 2026-08-19 補上的守門（review 報告 P2）

前置鏈與成本可以在「畫面完全沒變」的情況下被改掉，這幾條就是堵那個：

- **規則 6(d)：`data-wip="1"` 的節點完全不准接線。** 這是最要緊的一條。wip 讓節點豁免
  「非預期的根」與「從根不可達」兩項檢查——而那是圖結構唯一的守門員。豁免＋能接線＝可以把
  任意節點切下來接到別的分支，validate 全綠、節點數與邊數不變、四個不變量都對，而成本變了
  （報告實測：5201 鏈 66 → 86 核心；⚠️ 66 是 2026-08-21 解鎖例外表擴充**前**的基準，現在是 42）。豁免與接線能力二選一。
- **規則 0（parseTree）**：邊必須是 `<svg>` 直屬子元素（不可藏在 `<defs>`／圖層／節點群組裡）；
  節點與邊都不可帶 `display`／`visibility`／`style` 或 `opacity="0"`；`marker-end` 必須指向
  正本定義過的箭頭、且不可有 `marker-start`；座標與 viewBox 一律驗到是有限數。
- **規則 13**：viewBox 必須等於 `0 0 2000 1700`；節點與邊端點必須落在畫布內；
  任兩顆節點中心至少相距 5（疊在一起時，邊接到誰只取決於它們在檔案裡的先後順序）。
- **規則 5**：一個端點同時對上兩顆節點時直接報錯，不再靜靜取第一顆。
- **規則 1／4**：文字欄位有長度上限（500）；`cost` 不可換行。
  ⚠️ 這兩條 2026-08-22（#21）改過語意，見下面「規則 1／4／19 的現行語意」。
- `tools/lib/dom.ts` 的 `attr()`：**linkedom 不解屬性裡的 `&amp;`／`&lt;`，卻會解 `<title>` 裡的**
  ——名稱含 `&` 的節點會讓舊版規則 1 永遠對不起來。這個地雷隨 `<title>` 一起消失了
  （JSON 原生處理 `&`），`attr()` 仍留著給剩下的 `data-id` 等屬性用。
- `src/lib/growth.ts` 的正則從 `[\d.]+` 改成限定位數：舊寫法會災難性回溯（實測 2 萬位輸入
  2.5 秒、20 萬位數十秒），而 validate 是 fork PR 也跑得到的工作。

## 踩過的坑

### ⚠️ 寫死的版面偏移量咬過五次

1. `#branch-nav` 寫死 `top: 6rem`，假設工具列恆 3rem 高。
2. `#tree-controls`／`#detail` 寫死 `top: 3rem`，假設 nav 恆 48px 高（實際 50.59px，
   差 2.59px 造成右上角 1px 突出）。
3. 手機篩選抽屜 `translateY(-110%)`，假設「自身高度的 110%」一定蓋得過 `top: 3rem`。
4. **（2026-08-19）** `#canvas-host` 寫死 `height: calc(100vh - 110px)`，而 nav ＋ footer
   實際是 124.53（桌機）／165.47（手機）——每個尺寸多出 15–55px 的捲動，捲到底時 fixed 的
   `#tree-controls` 與 nav 之間裂開一條縫。

5. **（2026-08-19）** 手機版 `#detail` 用 `bottom: 0` ＋ `padding-bottom: 4.5rem`，
   靠內距把最後一段災情警告推到 `#branch-chips` 上方。**那只在「已經捲到底」時成立**——
   面板一變長（加了關鍵字解釋／骰子覺醒／練滿花費三段），內容超出 `max-height` 而
   `scrollTop` 還是 0，警告就落在可視區下緣、也就是 chip 列正下方（實測 warn 798–839
   對上 chips 786.75）。內距在捲動內容的**結尾**，使用者根本還沒捲到那裡。
   現在是 `inset: auto 0 var(--chips-h) 0`：讓**可視方框**停在 chip 列上方。
   E2E 測試 K 也補了一條「面板方框不得伸進 chip 列」的幾何斷言（原本只驗警告段落，
   而那條靠 `scrollIntoViewIfNeeded` 先捲一下，剛好繞開了這個情形）。

**現在的做法**：`body:has(#canvas-host)` 是 flex column，`<main>` `flex: 1`，
`#canvas-host` 也 `flex: 1`，畫布自然吃掉剩餘空間，零偏移量。
`--nav-h` 仍由 `tree-canvas.ts` 量 nav 寫進 CSS 變數（量的是文件座標 `rect.bottom + scrollY`，
不是視窗座標——頁面可捲時 resize 會把它烤成負數）。

⚠️ **`#tree` 必須是 `position: absolute; inset: 0`**，不能用 `width/height: 100%`：SVG 有內建
長寬比（viewBox 2000×1700），`height: 100%` 在父層高度未定案時退回 auto，用寬度反推出一個
內在高度（1280 寬 → 1088 高）把 `<main>` 撐開，版面又捲得動。
⚠️ `main:has(#canvas-host)` 要加 `margin-inline: 0; width: 100%`：global.css 的
`main { margin: 0 auto }` 在 flex 容器裡會**取消 stretch**，畫布會縮成 SVG 預設的 300px 寬。

**動版面時不要再引入新的固定偏移量**，並且驗收要用**幾何斷言**（兩個矩形不相交、
top 差距 < 0.5px、`scrollHeight === innerHeight`），不是看截圖。
E2E 的 U（不該捲動）、V（詳情卡片避開側欄）、J（手機抽屜不蓋住工具列）就是這三條防線。

### 手機版 footer 要讓位給 `#branch-chips`

`#branch-chips` 是 `position: fixed; bottom: 0`，頁面不捲動之後它會永遠疊在 footer 上緣——
而 footer 第二行是「著作權屬 111 Percent Inc.」這句必須看得到的聲明。作法是
`body:has(#canvas-host) footer { padding-bottom: calc(1rem + var(--chips-h)) }`，
`--chips-h` 由 `tree-canvas.ts` 量 chip 列的實際高度寫入（**不要寫死 3.5rem**）。
`<main>` 是 `flex: 1`，footer 變高只會讓畫布跟著縮，不會把捲軸叫回來。E2E 的 W 守這條。

### ⚠️ deploy job 沒有 checkout：任何靠 repo 根目錄的東西都不會上線

`ci.yml` 的 `deploy` job **刻意沒有 `actions/checkout`**，只 `download-artifact` 拿 `verify` 驗過的
`dist/`，然後 `wrangler pages deploy dist`。這是為了讓「上線的位元組＝被驗過的位元組」。

代價是 runner 的工作目錄裡**只有 dist/**。Cloudflare Pages 的 Functions 是看
「執行指令的那個目錄底下有沒有 `functions/`」來決定要不要打包的
（`node_modules/wrangler/.../cli.js`：`path.join(process.cwd(), "functions")`，
不存在就整段跳過，**沒有 warning、部署照樣回成功**）。所以哪天要加 Pages Functions，
必須在 deploy job 補一步 checkout：

- ⚠️ **checkout 要放在 `download-artifact` 之前**。`actions/checkout` 預設 `clean: true` 會清空
  工作目錄，順序反了會把下載好的 `dist/` 洗掉，然後部署一個空目錄——而且大概不會報錯。
- ⚠️ action 要 pin 40 碼 SHA（repo 開了 `sha_pinning_required`）。
- 加了 Functions 之後，**deploy 後面要補一步 smoke**（例如 `curl -fsS <endpoint> | grep -q ...`），
  否則「binding 沒綁／表沒建／functions 沒上傳／CSP 擋掉」四種失敗都會收斂成
  「那塊功能靜靜消失」，沒有任何人會知道。

### ⚠️ `public/_headers` 對 Pages Functions 的回應無效

官方文件明載 `_headers` 定義的自訂標頭**不會套用到 Pages Functions 產生的回應**
（https://developers.cloudflare.com/pages/configuration/headers/ ）。
所以 CSP 之類的標頭要兩邊都寫：靜態頁走 `_headers`，Function 在程式碼裡自己放進 `Response`。
驗收也要分開驗——`curl -sI` 打靜態頁**和**打 Function 的路徑。

### ⚠️ `#hit-counter` 抓得到 HTML 不代表看得到

首頁的訪客計數器（`functions/api/hits.ts` ＋ D1）預設 `hidden`，前端拿到數字才顯示——
endpoint 掛掉時它會**安靜地不出現**，那是刻意的降級。

所以 `curl https://rd2-wiki.pages.dev/ | grep -c "位訪客"` 回 1 只證明**標記在 HTML 裡**，
不證明使用者看得到。要驗顯示就用瀏覽器（Playwright `isVisible()` ＋ 讀 `#hit-number` 的文字），
這跟版面驗收要用幾何斷言是同一條原則。

順帶：前端判斷 API 成功與否**不看 status code**，只看 payload 形狀
（`typeof body.n === 'number'`）。理由是「`/api/hits` 沒部署時回什麼」完全取決於 `dist/`
裡有什麼，而那會變：2026-08-22 補上 404 頁之前是 **200 ＋ 一份首頁 HTML**，之後是 **404**，
POST 到一個存在的靜態路徑則是 **405**。三種都不是數字，所以判準只能是 payload 形狀
——**不要因為現在有 404 了就改回去信 status code**。

### 靜態內容頁：/dice 圖鑑與 /guide 遊戲介紹（2026-08-22）

在這之前全站**幾乎沒有可索引的文字**：`/tree` 的節點名與描述全是瀏覽器讀 `tree.json` 之後
才渲染的，2026-08-20 實測 `dist/tree/index.html` 只有 194 個字元。這批頁面把資料靜態輸出。

- **`/dice`＝骰子圖鑑，只收 41 顆骰子本體**（`type === 'dice'`，正本裡的矩形節點）。
  ⚠️ 符文／玩家被動／支援那 198 個節點**刻意不進圖鑑**（Yuki 2026-08-22 指定）：它們是加在
  骰子或玩家身上的強化，不是「一顆骰子」，混進同一個網格會讓 41 顆真正的骰子被稀釋掉。
- **`/guide/[slug]`＝遊戲介紹四頁**，清單在 `src/lib/glossary-groups.ts` 的 `GUIDE_PAGES`。
  分組依據是**官方色碼**（`keywords.json` 的 `color`，抄自資料表「狀態效果」分頁的底色碼）
  ——同色＝同一類機制，**分組不是本站的判斷，只有組名是**，頁面上要照實註明。
  五組四頁：橘 26 骰子機制、藍 13 召喚物、紫 12 狀態效果＋綠 2 增減益（合一頁，兩條撐不起
  一頁）、灰 9 怪物與名詞。⚠️ **算條數不要用 `index.byTerm.size`**：那份表為了讓別名
  （播種、傳送）也查得到本尊，會把別名也指到同一筆上，數出來是 64 不是 62。
- **`/dice` 的卡片裡點 `#關鍵字` 不跳頁**，就地換成那個詞的解釋，**左右滑動過場**與 `/tree`
  的詳情面板同一組 `--slide-ms`／`--slide-ease`、同樣的 ±100%／∓30% 位移與雙層 rAF
  （2026-08-22 Yuki 指定）。跟面板刻意不同的兩點：**卡片高度不動**（每一層都是
  `position:absolute; inset:0`，撐不下就自己捲——41 張卡片排在 CSS grid 裡，任何一張改高度
  都會推動同一列的其他卡片，面板那種高度過場在網格裡不成立），以及**不列出哪些節點用到**，只給一條
  `/tree?q=<詞>` 的入口。沒有節點用到的 25 條連那條入口都不給（過去是 0 筆結果的搜尋）。
  解釋文字在**建置期**就渲染成 HTML 放進頁面裡的 `#codex-terms`，前端只負責塞與堆疊——
  斷詞器不必送到瀏覽器，也就不會出現兩邊對同一段文字斷出不同結果。
  ⚠️ 那份負載刻意放在 `<div hidden>` 的文字內容裡，**不是 `<script type="application/json">`**：
  解釋 HTML 裡有 `</a>`，塞進腳本標籤會被 Astro 編譯器送去解析，實測 build 直接失敗
  （`Unexpected "/"`）。
- ⚠️ **卡片本文包在 `.dice-card-main` 裡**（過場要能整塊 transform），所以 CSS **不可以用
  `.dice-card > header` 這種子代選擇器**——2026-08-22 就是這樣讓圖示與名稱從並排掉成上下
  堆疊的，而且沒有任何測試會說話。裁切靠 `.dice-card` 與 `.card-term` **兩層** `overflow: hidden`；
  拿掉其中一層還是裁得住，兩層都拿掉才會滑出卡片外（`codex.spec.ts` 的 C3 用命中測試守著）。
- **同一時間只准開一張卡片的詞彙層**（`dice.astro` 的 `openCard`）。允許多張同時開的話，
  Esc 就沒有明確的對象——舊版是抓「DOM 裡第一張開著的」，於是在第二張按 Esc 關掉的是第一張，
  焦點還被丟到第一張的連結上（2026-08-22 code review 抓到，`codex.spec.ts` 的 C3c 守著）。
- ⚠️ **關鍵字的顏色要查 `index.byTerm` 不要查 `displayGlossary()`**：後者不含別名，
  於是 `#播種`／`#傳送` 會渲染成全站唯二沒有官方色的標記。同理，`usedBy` 要先把別名收斂成
  本尊再去重，否則同時寫了 `#SP怪物` 與 `#傳送` 的節點（5006）會被算兩次。
- **色碼是分組的唯一依據，出現沒見過的顏色要當場失敗**：`buildGlossary()` 直接丟例外
  （建置停下來），規則 8(b) 也擋一次。放行的話那個詞會從每一頁消失，而 239 個節點描述裡
  引用它的 `#關鍵字` 全部連到不存在的錨點——兩件事在畫面上都不報錯。
- ⚠️ **量過場的斷言一定要在動畫進行中取樣**：收尾會把 `.slide-anim` 拿掉，事後再讀
  `transitionDuration` 永遠是 `0s`。C3 的做法是在頁面內自己 `click()` 之後用 rAF 連續取樣
  300ms，一次拿到「有沒有掛 transition」與「有沒有戳出卡片外」兩件事。
- **斷詞器只有一份**：`src/lib/markup.ts` 的 `renderTaggedText()`。`#關鍵字` 的白名單＋最長
  優先比對是全站最容易寫壞的一段（naive 正則會把 `#` 後面整句吃掉），複製第二份出去就一定
  漂移。差別只在「一個詞怎麼包」，由呼叫端傳 `renderTerm` 進去：面板包 `<button>`（點了在
  卡片裡換頁），靜態頁包 `<a href="/guide/status#FROZEN">`。
- **`/tree` 的詳情面板沒有被改**。圖鑑卡片是另一個元件（`DiceCard.astro`），刻意不重用
  `nodeViewHtml()`：面板的外殼是互動的（返回／關閉／推入下一頁），前置鏈區塊也只在畫布上
  才成立。卡片改放一條「在骰子樹查看前置鏈 →」把互動交還給 `/tree?node=<id>`。
- **導覽列的「遊戲介紹」用 `<details>`**，不是自刻的下拉：`<summary>` 本來就能 Tab 聚焦、
  Enter／Space 開合、螢幕閱讀器會念出展開狀態。`Base.astro` 的 `<script>` 只補兩件 `<details>`
  沒有的事（點外面關掉、Esc 關掉並把焦點還給 `<summary>`）。沒有 JS 時它仍然能開能關。
- ⚠️ **首頁多了一個 `<section>`**（更新日誌）。`tests/e2e/tree.spec.ts` 的 T 原本用
  `page.locator('section')` 讀首頁，會踩到 Playwright 的 strict mode——已改綁 `#version-info`。
  選擇器綁版面結構本來就撐不住任何版面改動。
- 這一頁**不吃 `tree.json` 的 gzip 預算**（`getStaticPaths`／頁面直接讀 `data/`）。
  `/dice` 產物 122KB／gzip 13.8KB（大半是 `#codex-terms` 那包 62 條解釋），
  `tree.json` 仍是 19.1KB。

⚠️ **本機跑 E2E 前先確認 4321 沒有 `astro dev` 在聽**。`reuseExistingServer: true` 會直接
拿它當受測站台，於是測到的是 dev server 而不是 `dist/`。開著預覽時用 `E2E_PORT=4399 npm run e2e`。

### SEO 基礎欄位：robots.txt／sitemap／canonical／404（2026-08-22 補齊，#24–#26）

在這之前 `dist/` 裡沒有 `404.html`，Cloudflare Pages 會當成 SPA 處理、拿 index.html 當
fallback：`curl -sI .../this-does-not-exist-12345` 回 **200**、內容是首頁。連帶讓
`/robots.txt` 與 `/sitemap.xml` 也回 200，**看起來像存在其實不存在**。現在四件事都補上了：

- **`public/robots.txt`**——靜態檔，`Sitemap:` 那行是絕對網址，換網域要跟 `site` 一起改
- **`@astrojs/sitemap`**——`astro.config.mjs` 的 `integrations`，產出 `sitemap-index.xml`
  ＋ `sitemap-0.xml`。⚠️ **不要加 `filter` 排除 404**：實測（3.7.3）不帶任何選項產出的
  `<loc>` 就只有現有頁面（2026-08-22 起是 9 個），404 是套件預設就排除的，自己寫的 filter 是死碼。
  ⚠️ `tests/e2e/seo.spec.ts` 的 `PAGES` 用**完全相等**比對 `<loc>` 清單，新增或移除頁面
  一定要同時改那份清單，少一頁多一頁都會紅
- **`src/pages/404.astro`**（⚠️ 不是 issue 原本寫的 `public/404.html`）——產物同樣是
  `dist/404.html`、Pages 一樣認，但走 Astro 才吃得到 `Base.astro` 的導覽列與樣式；
  寫成 public/ 底下的靜態 HTML 就得複製一份無人看守、必然漂移的樣式副本
- **`Base.astro` 的 `<title>` 與 canonical**——標題格式是 **`Random Dice 2 wiki | 分頁名`**
  （站名在前，2026-08-22 定案），分隔符是半形 `|`；新增 `noIndex` prop，目前只有 404 頁用，
  開起來會**省略 canonical 並加 `<meta name="robots" content="noindex">`**
  （404 頁的 canonical 只會固定指向 `/404/`，等於邀請搜尋引擎去索引那個網址）

⚠️ **`tests/e2e/seo.spec.ts` 的 SEO-5「未知路徑回 404」在本機是假綠。**
E2E 的 webServer 是 `serve dist`，它對找不到的檔案本來就回 404，`dist/404.html` 存不存在
都一樣——soft 404 是 **Cloudflare Pages 那端**的行為。那條守的是「本機沒退步」，
真正的驗收只能在部署後對正式站做：
`curl -o /dev/null -w '%{http_code}\n' https://rd2-wiki.pages.dev/no-such-page` 要回 404。

### ⚠️ 兩個工作區同時跑 E2E 會互相偷 server

`playwright.config.ts` 的 `reuseExistingServer: true` 配上寫死的埠，意思是
**只要那個埠上有人在聽，就拿它當受測站台——不管那是不是你自己建的 dist**。

2026-08-19 實際咬到人：這台機器上同時有主 checkout 與一個 git worktree 在動，主 checkout
留了一個沒收掉的 `serve dist -l 4321`（`npm run e2e` 結束後殘留），worktree 那邊跑 E2E 時
Playwright 直接重用了它 → 測到的是**別份產物**。症狀是「element(s) not found」，
看起來完全像自己的程式沒輸出那個元素。破案靠 `curl localhost:4321 | grep -c <自己的東西>` 回 0。

現在埠可以用 `E2E_PORT` 覆蓋：平行開兩個工作區時，其中一邊
`E2E_PORT=4399 npm run e2e` 就互不干擾（CI 上沒有這個變數，行為不變）。
**收工前也順手確認一下 `pgrep -af "bin/serve"` 沒有殘留。**

這跟下面那條是同一族的坑——**都是「你以為在測自己的東西，其實不是」**：
一個測到舊產物，一個測到別人的產物。

### ⚠️ `npx playwright test` 不會重新建置

`npm run e2e` 有 `pree2e` 會先 `npm run build`；**直接跑 `npx playwright test` 不會**。
拿它做「把程式碼弄壞，看測試會不會紅」的抽查時，不先 `npm run build` 就是在測舊產物——
2026-08-19 我就是這樣得到一個假的「沒紅」，差點把一條沒守住的測試當成有效防線。
抽查的正確順序：改壞 → `npm run build` → `npx playwright test -g ...` → 還原 → 再 build。

### 資料解析

- 成本字串的分隔符是**全形斜線 `／`**（U+FF0F），全檔 0 個半形 `/`
- **屬性值裡的換行目前是「字面換行」，不是 `&#10;` 實體**（全檔 152 處，0 個 `&#10;`）。
  這是個潛在地雷：XML 規範要求 parser 把屬性值內的字面換行正規化成空格，**Chromium 遵守、
  linkedom 不遵守**，同一份檔案兩邊會讀出不同的 `data-description`。⚠️ 2026-08-22（#21 PR1）
  之後正本上已經沒有任何多行的文字屬性（161 處字面換行隨文案一起搬進 JSON 的 `\n`），
  這個坑只剩歷史意義。當時沒有實際症狀——
  站台在瀏覽器端讀的是建置期產物 `tree.json`，不在瀏覽器裡解析 SVG——但任何「在瀏覽器裡
  直接解析這份 SVG」的功能（例如線上編輯器）都會踩到。修法是把屬性值裡的換行改編成
  `&#10;`。（#21 PR1 之後這個修法用不到了——正本上已經沒有多行文字屬性。）
- **等級上限一律在 `nodes.json` 的 `maxLevel`**（2026-08-22 前分散在 `data-cost` 第二行與
  `<title>` 最後一行兩處）；舊寫法「取 title 第二行」會在多行描述的節點上靜默算錯
- `#關鍵字` 標記**沒有結束符**，中文無分詞 → 必須用 `data/keywords.json` 白名單
  最長優先比對，不可用正則貪婪抓
- **`data/keywords.json` 一份檔案兩個角色**：規則 8 的白名單 ＋ 玩家看得到的詞彙解釋
  （62 條，抄自遊戲資源包的狀態詞彙表，含 `code`／`color`／`desc`）。刻意不拆成兩份——
  拆開就會出現「白名單加了詞、但站上點開沒有解釋」而兩邊都不報錯。規則 8(b) 守欄位齊全、
  色碼格式、以及**解釋文字裡的 `#` 也要查得到**（逐節點的規則 8 只掃節點的 `description`，
  掃不到詞彙表自己）。
- `meta.glossary` 只放**用得到的**詞條（節點用到的 ＋ 覺醒用到的 ＋ 這些解釋自己再引用到的，
  **目前 41 條**），不是整份 64 條，而且**不含 `code`**（那是給貢獻者比對遊戲資源檔的，
  站台不顯示）。key 進 tree.json 前有排序：傳遞閉包是用堆疊展開的，不排序的話資料沒變
  diff 也會整段翻掉。**這些數字別手寫進文件**——`npm run build:data` 每次都會印出實際值
- **別名詞條 `{"aliasOf": "本尊"}`**：同一個遊戲代碼被官方翻成兩個顯示名時用它，不要抄第二份
  解釋。到 v1.0.3 為止實例都是兩個，而且都只出現在覺醒文字裡：`TRANSFER` 詞彙表寫 `#SP怪物`、貪婪骰子
  覺醒寫 `#傳送`；`SOW` 詞彙表寫 `#果實`、花骰子覺醒寫 `#播種`。規則 8(b) 禁止鏈狀別名
- ⚠️ **`node.keywords` 的語意是「描述裡用到的」，不含覺醒**。面板要列出覺醒的關鍵字時，
  是拿 `meta.glossary` 的 key 當清單現算（`NodeDetail.ts` 的 `termsIn()`）——
  改 `node.keywords` 的語意會連帶動到搜尋與篩選
- `stroke` 不在固定元素上：骰子在 `<rect>`、符文/支援在 `<polygon>`、被動在 `<circle>`
- 成長值單位有 `%` / 秒 / 次 / 個 / **倍** / 無單位六種，且有負值加雙符號 `(+-0.2秒)`

### `normalize` 會把不認得的 `<g>` 當成圖層攤平

`tools/normalize-svg.ts` 的最後一步是「把 GUI 工具留下的圖層 wrapper 拆掉」，選擇器是
`svg > g:not(.node):not(.tree-center)`。**新增任何刻意保留的頂層 `<g>` 時，記得加進這個
排除清單**——否則 normalize 會安靜地把它拆散、子元素散到 `<svg>` 底下，解析端找不到就當作
「這份正本沒有那個東西」，validate 也不會抱怨（規則只在該元素存在時才檢查）。
中央樞紐第一次接上時就踩過這個坑。

### ⚠️ `String.replace` 比對不到會原樣回傳——「字串有沒有變」不是成功判準

`tools/render-nodes.ts` 靠一串正則把渲染結果寫回正本。第一版用 `patched++` 數區塊（每個
區塊必定 +1，等於什麼都沒驗）；改成比對前後字串又立刻誤報（重跑時值本來就一樣，替換成功
也會得到相同字串）。**正確做法是看正則有沒有真的比對到**（`replace` 的 callback 裡設旗標），
`mustReplace()` 就是為此存在。同一個錯在這個檔案犯過兩次，樞紐那段也踩過一次。

失敗長相：正本留著指向已被 `rmSync` 刪掉的舊圖示雜湊，`npm run validate` 爆出 239 個
規則 7(a) 錯誤，而完全看不出是哪一步說了謊。

### ⚠️ CLI entry guard：`file://${process.argv[1]}` 是壞的，一律用 `pathToFileURL`

`tools/` 的六支腳本都靠一行 guard 判斷「我是被直接執行、還是被 import」。舊寫法
`import.meta.url === \`file://${process.argv[1]}\`` 在 Windows 上恆為 false（`argv[1]` 是
反斜線路徑，`import.meta.url` 是 `file:///C:/...`），腳本會印完 banner 就 exit 0 什麼都沒做。
最貴的是 `npm run validate`：**它是閘門，卻在 Windows 上一直「通過」而沒有驗任何東西**。

POSIX 也不是安全的：`import.meta.url` 會 percent-encode，template literal 不會，所以
checkout 路徑只要含空白或非 ASCII（`~/我的專案/`）就踩到同一個空跑。CI 沒抓到純粹是因為
runner 的路徑剛好是純 ASCII。

正確寫法只有一種，`tests/tools/entry-guard.test.ts` 會掃過 `tools/*.ts` 釘住它：

```ts
import { pathToFileURL } from 'node:url';
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
```

`?? ''` 是因為 `noUncheckedIndexedAccess` 把 `argv[1]` 型別成 `string | undefined`；
`pathToFileURL('')` 會解析成 cwd 的 URL 而不是丟例外，guard 單純不成立，是安全的預設。

外部貢獻者 dchaudhari7177 在 PR #34 找到並修掉（2026-08-20，`9aa098d`）。

### Playwright 的 `omitBackground` 只拿掉「頁面」的背景

用 Chromium 截 SVG 元素時，`omitBackground: true` 對**內容自己畫的背景**無效——原圖有一張
`<rect width="100%" height="100%">`，沒把它一起 `display:none` 的話，截出來的每張圖都夾帶
一塊實心底色（實測：全透明 0.0%、不透明 100%）。

後果會蔓延到看似無關的地方：節點變成不透明方塊蓋掉穿過它的線與鄰居的標籤，`outline` 與
`drop-shadow` 去描那個方塊而不是按鈕。**檢查方式是量 alpha 通道的分佈，不是看截圖。**

### 測試環境

- **`src/generated/tree.json` 是 gitignored 的建置產物**，多個測試會讀它 →
  `pretest`／`pree2e` 已補上，**不要拿掉**
- linkedom 沒有 `getScreenCTM()`，`.focus()` 也不會更新 `document.activeElement`
  → 這類行為只能靠 E2E 驗
- 臨時的 Playwright 腳本要放在 **repo 目錄下**才 import 得到 `@playwright/test`

## README 與門面素材

README 是產品頁形式（banner ＋ 徽章 ＋ `> [!WARNING]` 免責 ＋ 分讀者章節），對標
`github.com/moeru-ai/airi`。2026-08-19 PR #17／#18。

- 素材在 **`.github/media/`**：`banner.webp`（1280×640）、`screenshot-tree.webp`、
  `screenshot-mobile.webp`，外加 banner 的原始碼 **`banner.src.html`**（重產所需的兩個輸入與
  指令寫在該檔開頭的註解裡）。**不要放進 `public/`**——那會被打包進站台，還要吃規則 12 的效能預算。
- ⚠️ **banner 裡不要放節點數這類會隨資料改動的數字**。第一版烤了「239 節點／248 條連線」，
  2026-08-19 拿掉：資料 PR 一改數字，圖就會說謊，而 CI 完全擋不住。會變的事實只放文字。
- banner 與 tagline 的文案**沿用 `src/layouts/Base.astro` 的 `OG_TITLE`／`DESCRIPTION`**
  （連結預覽那組），不維護第二份。
- 已知限制與 `src/lib/flags.ts` 的暫停功能**刻意不寫進 README**——那是維護者資訊，留在這份檔案。
- ⚠️ **不要用 `[/about](/about)` 這種 root-relative 連結**：GitHub 會把它連到 `github.com/about`。
  README 與 `CONTRIBUTING.md`（會被 `about.astro` import）都要寫完整網址，站台端一樣正常。
- ⚠️ `LICENSE` 尾端有「MIT 只涵蓋程式碼」的附註 → GitHub 判成 `license.key = "other"`，
  shields 的動態 license 徽章顯示 *not identifiable by github*。徽章已改成靜態的，
  **不要為了讓徽章好看去刪那段附註**。
- **推上去之前先在本機看渲染結果**（不是想像）：

  ```bash
  jq -Rs '{text:., mode:"gfm", context:"NatsuYukiowob/rd2-wiki"}' README.md > /tmp/md.json
  gh api -X POST /markdown --input /tmp/md.json > /tmp/readme.html
  # 套 github-markdown-css 後用 Playwright 截 fullPage，light/dark 各一張
  ```

  這樣抓到過上面那條 root-relative 連結與失效的 license 徽章——兩個都是純讀 Markdown 看不出來的。

## 不進版控

`docs/`（規格書、實作計畫、部署步驟、已知問題）**刻意移出版控**，只留維護者本機並另外備份。
v1 開發歷程（39 commit）在本機 `feat/v1-dice-tree` 分支，未推遠端。

⚠️ **這份 CLAUDE.md 是公開的**（repo 是 public）。寫進來的東西不要帶機器上的絕對路徑、
主機名稱、內網 IP 或任何憑證——那些屬於維護者自己的筆記，不屬於 repo。
同理，`tools/split-svg.ts` 與 `tools/render-nodes.ts` 的來源檔**一律由參數傳入、沒有預設值**：
以前預設指向維護者本機的遊戲原圖，別人跑到只會得到一個看不懂的 ENOENT，而那條路徑也不該
留在公開 repo 裡。掃描指令：`git ls-files -z | xargs -0 grep -lnE '/mnt/|/home/|內網IP'`。

## 詳情面板＝視圖堆疊（2026-08-20）

面板不是一張把所有資訊攤平的卡片，而是**同一張卡片裡換頁**：點描述裡的 `#關鍵字` 或
「骰子覺醒」那一列，會左滑推入下一頁，左上角出現 ←，右上角每一層都有 ✕。

- **為什麼不用浮動彈出層**：彈出層要自己算位置、還要防超出畫面，而手機版的 `#detail` 本來
  就是貼著螢幕底的抽屜，「貼著某個字彈出去」幾乎沒有可用空間。換頁則位置完全不變，
  巢狀關鍵字（`#破滅` 的解釋裡有 `#一般怪物`）也順著同一個機制解決，不必另想怎麼攤平。
- 渲染在 `NodeDetail.ts`（`nodeViewHtml` / `termViewHtml` / `awakeningViewHtml`），
  堆疊、動畫、歷史接線在 `tree-canvas.ts`。事件全部委派在 `#detail` 上（面板每次都整段
  重寫 innerHTML，掛在按鈕上的監聽器下一次重畫就沒了）。
- **系統／瀏覽器上一頁 ＝ 卡片的返回鍵**：每推一層 `history.pushState({rd2DetailDepth: n}, '', location.href)`
  （網址不變，不污染分享連結），`popstate` 把堆疊收到 `history.state` 說的深度。

### ⚠️ 這一段踩過的四個坑（都有測試釘住，見 E2E 的 Z／Z2／Z3）

1. **`history.go()` 是非同步的，而每筆紀錄記著推入時的網址。** 先改網址再退，退回去那筆會
   把網址還原——「搜尋 #破滅」寫進去的 `?q=` 就這樣被吃掉。所以是 `afterHistoryUnwind(run)`：
   **退完才做事**，另配一條 300ms 保險絲（popstate 沒有規格保證一定會來，沒收到就直接執行）。
2. **上一段動畫的收尾必須在「決定哪張是 from、哪張是 to」之前跑。** 收尾會把上一段的 fromEl
   設成 hidden；晚一步跑就會把這一段剛要顯示的那張反手藏起來，畫面留下一個空面板。
   連按返回或系統上一頁一次退兩層時必現。
3. **舊視圖一 `display:none`，焦點就掉回 `<body>`**——Esc 收不到、Tab 從頭開始。換頁後要
   `focusView()` 把焦點移進新視圖。E2E 驗的是「焦點所在那張視圖的**標題**」，不是「焦點有沒有
   在某張視圖裡」：後者會被剛按下、還沒被藏起來的那顆按鈕矇混過去，永遠是綠的。
4. **面板重繪（換節點、改篩選）也要退歷史，而且退完要再寫一次網址。**
   不退 → 使用者按上一頁什麼都不會發生（那一步對應的視圖已經不存在）。
   退了卻不重寫網址 → `select()` 同步跑的 `syncUrl()` 寫在「即將被退掉的那一筆」上，
   傳送落地就被還原：**面板換成新節點、網址還停在舊的 `?node=`，重整回到錯的節點**。
   所以 `resetViewStack()` 走的是 `afterHistoryUnwind(syncUrl, depth)`。
   ⚠️ 驗這件事一定要驗**網址**——只驗 `history.state` 的深度的話，網址被還原完全看不出來
   （Z3 第一版就是這樣漏掉的）。
5. **換節點時要 `abortSlide()`，不是 `finishSlideNow()`。** 整個 `.stack` 馬上會被
   `renderDetail()` 換掉，跑收尾等於對一批即將被丟棄的元素做清理、還多觸發一次 focus 與重新
   定位；但 `#detail` 上的 `panel-sliding` 一定要拿掉，留著的話接下來那 280ms 內卡片跟著畫布
   平移的每一幀都會變成拖尾。
   ⚠️ 驗它要用**當下讀一次**的 `getAttribute('class')`，不能用 `expect(locator).not.toHaveClass()`
   ——殘留的 class 會在計時器到期時自己消失，重試型斷言等一下就變綠。
6. **`document` 上的 Esc 監聽器會互相踩到。** 篩選抽屜那個先跑、而且會先移除 `.open`，
   後面詳情面板的後備監聽器再用 class 判斷已經來不及——一次 Esc 同時關掉抽屜**並且**退出
   詞彙頁。抽屜那條要 `e.stopImmediatePropagation()`（同一個節點上的後續監聽器也要擋，
   `stopPropagation` 不夠）。
5. **換頁的過渡（人工回報「抖」「生硬」）。四個獨立原因，全部是量錯東西**，
   E2E 的 Z4 一條一條釘著（每一條弄壞都會紅）：

   1. `slide()` 量**起始**高度時，新視圖若還在正常流程裡，`.stack` 是兩張加起來
      → 卡片先暴衝到 565px 再縮回 198px。`.sliding`（絕對定位）必須在量之前掛上，
      而且 `slide()` 是**唯一**負責掛它的地方。
   2. `overflow: hidden` **常駐在 `.stack`**，不要只掛在 `.animating` 上。它會建立 BFC、
      改變子元素邊界外距的收合方式——class 一掛上高度就自己跳 12.4px，觸發一次多餘的
      transition，真正的動畫開始前先抖一下。
   3. 只動 `height` 不動 `top`，卡片是「往上收」不是「上下往中間收」。所以動畫那一幀要
      同時 `positionPanel({ assumeHeight })` 把**終點**位置寫進 `top`，兩者一起跑完。
      `top` 的 transition（`#detail.panel-sliding`）只在換頁期間掛上——拖曳畫布時卡片是
      每幀重寫 `top` 來跟著節點跑，有 transition 會變成拖尾。
   4. ⚠️ **`toH` 是 `.stack` 的高度，`positionPanel` 要的是整張卡片的高度**（多一層 padding
      與框線、而且已被 `max-height` 夾過）。餵錯單位 → top 偏一半，動畫途中往下漂 16.9px。
      量法：同一時刻多量一個 `panel.offsetHeight`。

   節點靠近畫面上緣、卡片被夾在工具列下方時，中心**本來就會移動**（卡片變矮之後才容得下
   「對齊節點中心」）。那是單向的平滑滑行（實測 0 次反向），不是抖動——所以 Z4 分成兩組：
   被夾制那組只驗「單調、不反向」，另一組把節點移到畫面中段、視窗調高，才驗「中心不動 ≤1px」。
   只用預設取景驗的話，原因 3 與 4 兩個 bug 完全量不出來。

   動畫長度與 easing 是 CSS 的 `--slide-ms` / `--slide-ease`，**JS 從 CSS 讀**
   （`SLIDE_MS`），不寫第二份：只改 CSS 的話收尾會在動畫還沒跑完就把 inline style 清掉。

⚠️ **驗這種事要在頁面內用 rAF 逐幀取樣**，不能一次 `page.evaluate` 量一格：往返一趟 10–20ms，
這些 10–30px 的瞬間偏移根本落不進取樣點，測試會是假綠的（Z4 第一版就是這樣）。
高度的斷言要同時驗「不越過頭尾範圍」與「逐格同方向」——只驗前者會漏掉先衝過頭再補回來，
只驗後者會漏掉暴衝之後仍然單調的情形。

`#detail` 的 `overflow-x` 一定要明確寫 `hidden`（滑入／滑出的那張靠它裁掉），而且兩軸都要
是非 visible——只設 `overflow-x` 的話 `overflow-y` 會被算成 `auto`。

## 暫時停用的功能

`src/lib/flags.ts` 的 `FEATURES` 目前只剩一項：導覽列的「貢獻」入口
（`/about` 直接開網址仍打得開）。布林值一翻功能就回來；對應的測試斷言的是**現在**的行為，
開回來時會紅，紅的那幾條會直接指出還要改哪裡。

⚠️ 原本的 `keywordSearch`（`#關鍵字` 點下去自動搜尋）**已經移除**：那個手勢現在用來換頁，
搜尋改成詞彙頁上一顆看得見的「搜尋 #X」按鈕，不再是隱藏行為。`.kw-clickable` 這個
雙用途 class 也一併拿掉了。

## 已知待辦

**待辦正本是 [GitHub Issues](https://github.com/NatsuYukiowob/rd2-wiki/issues)**（2026-08-20 起）。
要接手什麼、目前欠什麼，看那裡，不要在這份文件裡另外維護一份清單。
完整的歷史清單（30 個延後的 Minor ＋ 開發期 35 項裁決）在未進版控的 `docs/` 裡，見上一節。

下面兩項留在這裡，是因為它們是「不要退回去」的結論，不是待辦：

1. ~~節點標籤重疊~~ **已解（2026-08-18）**：畫面上恆常只留骰子（41）與支援（5）的標籤，
   符文（123）與被動（70）改成滑過／鍵盤聚焦／被選進前置鏈時才單獨顯示（純 CSS，見
   `src/pages/tree.astro` 的 `.node ... .label` 規則）。量測依據：符文標籤平均寬 61 單位、
   最近鄰距離只有 41（比值 1.49），全顯示必然重疊（實測 27 對）；**縮字級沒用**（縮到 7px
   仍有 15 對），只留骰子與支援則是 0 對。E2E 由 `tests/e2e/tree.spec.ts` 的 M 守著
2. **自動化只在 Chromium 驗過**，核心渲染用 `<pattern>` 這條冷門 SVG 路徑。
   iOS Safari 沒有自動化覆蓋，但 **2026-08-20 起 iOS 使用者回報沒有問題**，
   所以不列為待辦；日後改動 `<pattern>` 那條路徑時要重新確認
