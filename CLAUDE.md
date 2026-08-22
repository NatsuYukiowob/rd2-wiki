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

- **`data/dice-tree.svg`**——只有**幾何**（239 個 `<g class="node">`／248 條邊）：`data-id`、
  `transform`、形狀與 `stroke`、`<image>`、`data-wip`。
- **`data/nodes.json`**——全部**文案**：`name` `label` `type` `category?` `gameId` `cost`
  `maxLevel` `description` `awakening?`。
- 外加 `data/icons/`（238 張 PNG，檔名＝內容 sha256 前 12 碼）、`data/tree-center.png`、
  `data/board-icons/`（41 張純骰子圖，見 `/board`）。由社群發 PR 維護，**CI 是唯一防線**
  （維護者不可能逐行 review SVG 的 diff）。

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

核心功能：點一個節點 → 高亮它在 DAG 上的**所有祖先聯集**（去重、含自身、多重前置視為 AND）
→ 算出解鎖成本。

## 指令

```bash
npm run validate    # 資料驗證（規則 0–21，CI 守門員）
npm run typecheck   # tsc --noEmit（含 noUnusedLocals）
npm run normalize   # 攤平圖層/matrix/相對路徑、清掉 <text> 與註解（送 PR 前必跑）
npm run preview     # 把標籤注回幾何，產出 data/dice-tree.preview.svg（不進版控）
npm run add-icon    # 新增圖示，自動用內容雜湊命名
npm run render-nodes -- <遊戲原圖路徑>  # 用 Chromium 重畫全部節點圖示（遊戲改版才跑）
npm run split -- <遊戲原圖路徑>         # 從原圖切出正本與圖示（重建整份資料時才用）
npm run build:data  # 產出 src/generated/tree.json + public/assets/
npm run build       # build:data + astro build
npm test            # 有 pretest 自動跑 build:data
npm run e2e         # 有 pree2e 自動跑 build
```

## 不變量（改動後務必重驗）

| 項目 | 值 | 備註 |
|---|---|---|
| 節點／邊／根／多重前置 | 239 ／ 248 ／ 5（`1001 2001 3001 4008 5002`）／ 14 | |
| 全樹解鎖成本 | 核心 1,772 ／ 金幣 6,662,000 | |
| `5201` 前置鏈 | 核心 42 ／ 金幣 23,000 | 舊文件的「66」是解鎖例外表擴充前的基準 |
| 覺醒 `awakening` | 41 顆骰子各一則，其餘 198 個節點不准有 | 規則 14 |
| `gameId` | 239 個全有、全檔唯一 | 規則 16 |
| `category` | 只掛在 70 個玩家被動上 | 規則 16 |
| `dataIssue` | `placeholder` 0 ／ `no-growth` 0 | 規則 17 |
| `unlockVia !== 'cost'` | 9 個，全是骰子 | `data/unlock-exceptions.json`，規則 18 |
| 畫布 viewBox | `0 0 2000 1700` | |
| 效能預算（硬斷言） | `tree.json` gzip ≤ 20KB（目前 19.1KB）／sprite ≤ 400KB（目前 130KB） | |

- **版本欄位有三個、意義不同**：`data-game-version`（玩家看得到的遊戲版本，1.0.3）、
  `<metadata>` 的 `resource bundle`（資料抄自哪一版資源包，0.0.6）、`data-version`（正本自己的
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
  遊戲**連同那一段一起不顯示**（2026-08-20 Yuki 逐個對照遊戲畫面）。目前正本刻意跟上游不一致的
  只有三處，下次對新版資源包時會顯示成差異，那是刻意的：

  | id | 上游 | 正本（＝遊戲畫面） |
  |---|---|---|
  | 2403 | `攻擊速度增加5%(+{1}%)` | `攻擊速度增加5%` |
  | 5302 | `#僵硬範圍增加30%(+{1}%)` | `#僵硬範圍增加30%` |
  | 5403 | `傷害增加30（最多100疊加）`（全形） | `(最多100疊加)`（半形，全站一致） |

  ⚠️ **上游填得出值就用上游的**——「連同那一段一起不顯示」只適用於**上游自己也沒有值**的情形。
- ⚠️ **佔位符偵測機制留著，但真實資料已經沒有樣本了**（`parseGrowth` 的 `{n}` 判定、
  `dataIssue: 'placeholder'`、規則 9、面板的「數值待補」）。上游隨時可能再冒出新的佔位符，
  那是唯一會提醒我們的東西。對應測試因此**全部用合成樣本**（注入一段 `{1}` 再驗），
  綁真實節點的話資料一改測試就跟著消失，而那段程式還活著卻沒人守。

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
- **`data/changelog.json`＝站台更新日誌**（首頁顯示最新 3 筆），由**規則 20** 守。它是全站唯一
  沒有自動來源的內容，而「忘了寫」在畫面上跟「這次沒更新」長得一模一樣。規則 20 檢查的是
  **最新一筆帶 `data` 區塊的條目**而不是 `entries[0]`——純站台功能的條目排在最前面卻沒有資料版本
  可言，硬要求 `entries[0]` 帶 `data` 的話每次改前端都得假造一筆版本，規則就被繞過去了。
  條目**由新到舊**排列，同一天可以有多筆（先後有意義）。
  ⚠️ **首頁（`src/pages/index.astro`）的版本戳記要用 `changelog.entries.find(e => e.data)` 另外找**（跟規則 20 的 `checkChangelog()` 同一個 `find`），不要為了讓帶 `data` 的
  條目「剛好留在前 3 筆」去調整排序——資料版本戳記能不能顯示，不該反過來決定日誌要怎麼排。
  `tests/e2e/codex.spec.ts` 的 C5 驗「玩家真的看得到」。
- **`data/unlock-exceptions.json`＝解鎖例外表**，由**規則 18** 守。它不是 SVG 的一部分，
  `build-data` 讀它時只有一個 `as` 斷言＝執行期零檢查。三種寫壞法在規則 18 之前全部 CI 全綠：
  key 打錯（那顆骰子安靜地變回要花核心買）、`unlockVia` 打錯（成本照樣排除，但面板印出字面的
  `undefined`）、`note` 空字串。⚠️ **規則 18 擋型別與長度，擋不住內容**——`unlockNote` 是自由文字
  而 `renderDetail()` 用 `innerHTML`，所以 `NodeDetail.ts` 一定要 `escapeHtml(formatUnlockVia(node))`。

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
| 15 | 升級花費表 ↔ 正本解鎖金幣 |
| 16 | `gameId` 全有且唯一；`category` 只在玩家被動 |
| 17 | 官方滿級值反向驗算 `growth` 的推導 |
| 18 | 解鎖例外表的型別與長度 |
| 19 | SVG 的 `data-id` 集合 ≡ `nodes.json` 的鍵集合，雙射零殘餘，**兩種殘餘都要逐一列出 id**（239 個節點，只說「數量對不上」等於沒說） |
| 20 | changelog 的結構，以及最新一筆資料條目與正本版本欄位一致。擋的不是「日誌寫錯」，是**「資料改了、日誌沒改」** |
| 21 | `/board` 純骰子圖：(a) 骰子漏一筆對應 (b)(c)(d) 目錄本身 (e) 值必須是 12 碼小寫 hex（擋路徑穿越與 `[object Object].png`） (f) 指向的檔不存在 (g) **兩筆指到同一張圖** (h) 對應表自己留著一筆不是（或已不是）骰子的 id |

⚠️ **幾何規則吃 `nodes`，文案規則吃 `withText`**。`withText` 是「兩邊都在、結構又合法」的過濾集合；
把它餵給幾何規則的話，`nodes.json` 漏一筆會被翻譯成幾十條指向 SVG 的假錯誤（實測：刪掉 `1001`
一筆文案 → 55 條錯誤，54 條是規則 5／6／10／18 在說「從根不可達」，唯一說對的規則 19 被埋在裡面）。
文案規則＝1／3／4／8／9／14／15／16／17，其餘全部走 `nodes`。

⚠️ **(b)(c)(d)「掃一個雜湊命名的圖示目錄」規則 7 與 21 共用 `checkHashNamedIconDir()`，
只有一份實作**。要加檢查就加在那裡，不要為第二個目錄複製第二份出去——上一份複製品漂到
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

`:root` 有五組 token，**新增樣式一律用它們**：

| 組 | token | 說明 |
|---|---|---|
| 間距 | `--space-h/1..7` | 4px 網格（`--space-h` 是唯一半階 2px） |
| 圓角 | `--r-xs/sm/md/lg/pill` | 4/6/10/14/999px |
| 字級 | `--fs-xs/sm/md/base/lg/xl/2xl/3xl` | `--fs-base` 是 1rem |
| 表面 | `--surface-1/2/3`、`--border-strong` | 見下 |
| 陰影與節奏 | `--shadow-1/2/3`、`--t-fast/med`、`--ring` | `--shadow-3` 給浮在畫布上的東西 |

- **表面分層**：靜態頁的面 → `--surface-1`；浮在畫布上的 chrome（`#toolbar`、`#detail`、
  `#branch-chips`、下拉選單、`/dice` 的篩選列）→ `--surface-2`；hover／選中的填色 → `--surface-3`。
  舊的 `--panel` 已刪除——一個東西兩個名字正是要收掉的漂移來源。
- **焦點框全站只有一條** `:focus-visible { outline: var(--ring) }`。元件只在需要**額外**回饋時才補。
- **動畫長度一律用 `cssMs()` 從 CSS 讀**，JS 不寫第二份。
- **減少動態的規則收在檔尾一個 `@media` 裡**，刻意不寫成 `*{transition-duration:0.01ms!important}`：
  那會連 opacity 一起關掉，而 `/tree` 的篩選淡出是靠 opacity 在**傳達資訊**，不是裝飾。
- ⚠️ **`:has()` 與 `color-mix()` 都要有退化路徑。** 切換鈕的「選中」完全靠 `:has(input:checked)`
  ＋底色而真正的 checkbox 是 `opacity: 0`——不支援 `:has()` 的引擎或 `forced-colors: active` 下，
  五顆鈕長得一模一樣、焦點也看不見。`color-mix()` 一律在前面補一行純色 fallback。
- **守門**：`tests/styles/tokens.test.ts` 掃裸的 px／rem（例外寫在檔案裡的 `ALLOWED` 並附理由），
  並確認每個 `var(--x)` 都在 `:root` 定義得出來（打錯的名字不會報錯，只會安靜掉回預設值）。
  `tests/e2e/chrome.spec.ts` 的 D1–D12 守沾頂、`--nav-h`、`aria-current`、焦點框、footer 沉底、過場時間。

### 版面的硬規則

- **導覽列是 `position: sticky` 的**，一換行就等於永久佔掉畫面：`#site-nav` 每一項都要
  `white-space: nowrap`（中文沒有空白，瀏覽器會在任意兩字之間斷開），≤720px 時不顯示「上次更新」
  （它比其他四項加起來還寬）。D9 守——實測只有隱藏那段拿掉才會紅，`nowrap` 是防更窄的裝置，
  **不要因為「拿掉也是綠的」就刪**。
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
高度就自己跳 12.4px。(c) 只動 `height` 不動 `top` 是「往上收」不是「上下往中間收」，動畫那一幀要
同時 `positionPanel({ assumeHeight })`。(d) ⚠️ **`toH` 是 `.stack` 的高度，`positionPanel` 要的是
整張卡片的高度**（多一層 padding 與框線、而且已被 `max-height` 夾過），餵錯 → 動畫途中往下漂 16.9px。

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
   所以 `tests/lib/board-image.test.ts` 直接讀 `global.css` 釘住這四個選擇器。
2. **分享圖（`src/scripts/board-export.ts` 用 canvas 畫的那張）不能把圖片拉伸貼滿格子**。
   `src/lib/board-image.ts` 的 `iconRect(box, imgW, imgH, ratio)` 依
   `min(內框寬/imgW, 內框高/imgH)` 等比縮放置中，跟畫面上的 contain 對齊。`imgW`／`imgH` 刻意做成
   **必填**（不像 `ratio` 有預設值），呼叫端量不到真實尺寸時寧可在型別層面就過不了。
   ⚠️ `ratio` 的預設 0.78 跟 `.board-cell img { width: 78% }` 是配套關係，兩邊各寫死同一個數字，
   由一條讀 `global.css` 的測試比對兩邊沒有各自漂移。

`src/scripts/board.ts` 的 `diceMeta` 是從 `#dice-picker` 的 `<img src>` 讀回來的，所以拖曳、骰盤格、
分享圖三處畫面全部自動跟著換，不必維護第二份路徑。

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

- 成本字串的分隔符是**全形斜線 `／`**（U+FF0F），全檔 0 個半形 `/`。
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
