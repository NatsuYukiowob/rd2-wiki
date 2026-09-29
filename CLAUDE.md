# rd2-wiki

《Random Dice 2》互動式骰子樹攻略站。Astro 靜態站，部署在 Cloudflare Pages
（https://rd2wiki.org/），GitHub `NatsuYukiowob/rd2-wiki`（public）。

> 這份檔案只收「開工前不讀就會做錯，而且讀程式碼讀不到」的事。單點成因與實測數字寫在
> 該處的程式碼註解裡，歷史沿革看 git log 與 PR。**不要把日期、PR 號、「誰裁決」、會漂移的
> 數字寫進來**——決策只寫「決策：X（不要改回）」，數字當場跑。

## 開工前必讀

- **資料正本是兩個檔**：`data/dice-tree.svg`（只有幾何，一個字都沒有）＋ `data/nodes.json`
  （全部文案，以節點 id 為鍵），id 集合必須雙射（規則 19）。join key 一律用 `data-id`，
  **不要拿座標配對**（浮點與 `transform` 一改就對不上）。
- **這份 CLAUDE.md 與整個 repo 是公開的**。不要寫進絕對路徑、主機名稱、內網 IP 或憑證。
  掃描：`git ls-files -z | xargs -0 grep -lnE '/mnt/|/home/|內網IP'`。
- **樣式一律用 `:root` 的 token**，不准寫裸的 px／rem（`tests/styles/tokens.test.ts` 守）。
- **動版面用幾何斷言驗收**（兩矩形不相交、top 差 < 0.5px、`scrollHeight === innerHeight`），不是看截圖；
  反過來，**純視覺的改動測試綠不等於做對**——用 Playwright 截圖自己先看一遍。
- **本機跑 E2E 前確認 4321 沒有 `astro dev` 在聽**（`reuseExistingServer: true` 會拿它當受測站台）；
  開著預覽時用 `E2E_PORT=4399 npm run e2e`。
- **`npx playwright test` 不會重新建置**（`npm run e2e` 才有 `pree2e`）。「改壞看會不會紅」的順序：
  改壞 → `npm run build` → `npx playwright test -g …` → 還原 → 再 build。
- **開發中只跑受影響的 spec**：`npm run build && npx playwright test tests/e2e/<檔>.spec.ts --project=desktop`，
  動到手機版面才加 `--project=mobile`。全套（`npm run e2e`）只在 PR 收尾跑一次，修正後只重跑紅掉的檔。
  改了共用 CSS／`chrome.css`／發版前：`E2E_MOBILE_ALL=1 npm run e2e`。
- **mobile project 只跑標了 `@mobile` 的測試**（`playwright.config.ts` 的 `grep`）。有 `isMobile` 分支、
  `test.skip(!isMobile, …)`、或幾何在手機寬度不同的測試 → `test('…', { tag: '@mobile' }, …)`。漏標不會紅。
- **不要調高 `workers`**（3 workers 時 mobile 的 `/sim`、`/tree` 穩定 `Page crashed`）。全套紅在
  `Page crashed`／`Target crashed` 時先單跑該檔，不要當程式 bug 追。
- **分資料夾的 CLAUDE.md**：只在讀到該資料夾的檔案時自動載入，下列情況**要自己先讀**：
  - `src/pages/CLAUDE.md`（各頁契約）：改 `src/pages/`，**或改 `src/scripts/`、`src/styles/` 的頁面檔**（`board.ts`、`sim.ts`、`battle.css`…）。
  - `src/lib/canvas/CLAUDE.md`（畫布）：改 `src/lib/canvas/`，**或 `src/scripts/tree-canvas.ts`、`src/scripts/sim.ts` 的畫布部分**。
  - `data/CLAUDE.md`（資料來源、對帳流程、各資料檔的匯入裁決）：改 `data/` 或重產資料檔。

## 核心概念

| 資產 | 內容 | 守門 |
|---|---|---|
| `data/dice-tree.svg` | 只有**幾何**：`<g class="node">` 的 `data-id`、`transform`、形狀與 `stroke`、`<image>`、`data-wip`；邊 | 見 CI 規則表 |
| `data/nodes.json` | 全部**文案**：`name` `label` `type` `category?` `gameId` `cost` `maxLevel` `description` `awakening?` | 見 CI 規則表 |
| `data/icons/` | 節點圖（有底板，檔名＝內容 sha256 前 12 碼），由正本 SVG 引用 | 規則 7 |
| `data/board-icons/`／`data/dice3-icons/` | 純骰子圖（2 號素材，骰盤用）／3D 立體圖（3 號素材，圖鑑用），各有一份 `{節點 id: hash}` 對應表 | 規則 21／30（共用 `checkDiceIconMap()`） |
| `data/tree-center.png` | 中央樞紐圖 | 規則 10 |
| `data/tactic-icons/`／`boss-icons/`／`rift-shop-icons/` | 雜湊直接寫在資料檔那一筆的 `icon` 欄，不對應任何節點 | 規則 24／25／27 |
| `public/events/`、`public/rewards/` | 固定檔名直接 `<img src>`，**沒有內容雜湊、沒有轉檔管線** | 規則 29(j)／`tests/data/rewards.test.ts` |

- 由社群發 PR 維護，**CI 是唯一防線**（維護者不可能逐行 review SVG 的 diff）。
- ⚠️ **同一顆骰子在三條資產路徑的圖不一樣，不要互相接線**（節點圖／純骰子圖／3D 圖）。接錯時兩份檔案
  各自合法、畫面只是「變回扁平」；規則 30 的測試要求兩份對應表不得指向同一個雜湊。
- ⚠️ **只有 `rift-shop-icons` 允許多對一**（同一效果的三個檔位共用一張，規則 27 的 `sharedIconKey: 'name'`）；
  戰術只有 `9`／`40` 一組共圖（規則 24(g) `sharedIconIds`）。
- **文案不放 SVG**（含 `<text>`，標籤搬到 `label` 欄）：改一句描述＝JSON 一行 diff。正本用 Inkscape 打開是
  無名圖示，`npm run preview` 把標籤與 id 注回；**正本 → preview → normalize 必須逐位元組回到正本**
  （`tests/tools/build-preview-svg.test.ts`）。
- **版面與節點外觀來自遊戲內的原圖**（座標取原圖 ×0.5，`render-nodes.ts` 的 `DRAWING_TO_SITE`；原圖不在版控內）。節點外觀是多層疊出來的，換圖示不能只複製檔案，要跑 `npm run render-nodes`（Chromium 渲染成
  扁平 PNG 並寫回正本；不掛在建置流程上）。⚠️ `data/dice-tree.svg` 是它的**輸出**：正本裡寫死的 `fill`
  站台讀不到。⚠️ **`render-nodes` 跨 Chromium 版本不是位元組可重現**——「重跑後 PNG 不變」不可當驗收條件。
  ⚠️ 超越骰子 `1501`／`2503` 與它們的符文 `1601`／`2603`（`type` 是骰子符文）的圖**不是 `render-nodes` 產的**，重跑時會被蓋掉、validate 不擋，要另外處理（見 `data/CLAUDE.md`）。
- **節點底盤色改不動**（大多數節點的底盤是遊戲貼圖）。站台底色因此刻意不跟原圖一致，見 `tokens.css` 的 `--bg` 註解。
- ⚠️ **瀏覽器不渲染這份 SVG，站台上沒有節點元素**。`build:data` 把正本壓成 `src/generated/tree.json`，
  `/tree` 與 `/sim` 由 `src/lib/canvas/`（`mountCanvasTree()`）用 **Canvas 2D** 畫。
  `document.querySelector('.node')` 回 null、CSS 碰不到節點（在 `canvas.css` 加 `.node` 規則無效也不報錯）；
  唯一例外是每顆節點一顆的隱形 `<button>`。外觀在 `theme.ts`（從 token 讀）、`state.ts`、`painter.ts`，
  細節見 `src/lib/canvas/CLAUDE.md`。
- 核心功能：點一個節點 → 高亮它在 DAG 上的**所有祖先聯集**（去重、含自身、多重前置視為 AND）→ 算出解鎖成本。

## 指令

```bash
npm run validate    # 資料驗證（CI 守門員，規則表見下）
npm run typecheck   # tsc --noEmit（含 noUnusedLocals）
npm run normalize   # 攤平圖層/matrix/相對路徑、清掉 <text> 與註解（送 PR 前必跑）
npm run preview     # 把標籤注回幾何，產出 data/dice-tree.preview.svg（不進版控）
npm run add-icon    # 新增圖示，自動用內容雜湊命名（--board／--dice3／--tactic／--boss／--rift-shop 指向另一條資產路徑）
npm run render-nodes -- <遊戲原圖路徑>  # 用 Chromium 重畫全部節點圖示（遊戲改版才跑）
npm run split -- <遊戲原圖路徑>         # 從原圖切出正本與圖示（重建整份資料時才用）
npm run build:data  # 產出 src/generated/tree.json + public/assets/（會印效能預算的實測值）
npm run build       # build:data + astro build
npm test            # 有 pretest 自動跑 build:data
npm run e2e         # 有 pree2e 自動跑 build
npm run compare -- <beforeURL> <afterURL>  # computed-style 逐元素比對，兩個 port 各服務一份 dist
                     # ⚠️ 不在 CI 上；改動 CSS（尤其拆檔／搬檔）送 PR 前必跑，見 tools/compare-computed.ts 檔頭
```

## 本機文字編輯器（dev only）

`npm run dev` 後右下角「✎ 編輯」：點頁面上一段字，面板列出它在 `data/*.json` 的字串值與 `src/` 原始碼候選，
存檔直接寫回來源。程式在 `tools/dev-editor/`（`core.ts` 純邏輯有單元測試、`integration.ts` 掛 dev server API、
`client.ts` 是 overlay）。面板的「驗證」＝`npm run validate`。

- **只在 `astro dev` 存在**；寫檔 API 只收 127.0.0.1／::1——用 LAN／Tailscale 位址開會 403。
- **存檔只換那一個字串／那一段原始碼**（diff 永遠一行），帶舊值做衝突偵測。`data/` 存檔後自動重跑 `build:data`。
- **原始碼候選是原文切片**：`{nodes.length}` 這種插值會出現在文字框裡，**別把 `{…}` 刪掉**。
- 排序靠 `data-astro-source-file`／`-loc`：Astro 只在 dev toolbar 開著時標這兩個屬性。
- overlay 刻意寫死 px 與色碼、**不用站台 token**（token 規則不適用 `tools/`，`tokens.test.ts` 也不掃）。
- canvas 上的字（`/tree`、`/sim` 節點標籤）點不到，用面板搜尋框。
- ⚠️ 改 `integration.ts`／`core.ts` 要重啟 dev server；`client.ts` 會熱更新。
- ⚠️ 存檔結果靠 sessionStorage ＋ `/result` 在重整後取回，**不要改成只看 `/save` 的回應**（見 `client.ts`）。

## 不變量（改動後務必重驗）

計數（節點／邊／全樹成本）由 `tests/tools/build-data.test.ts`、`5201` 前置鏈成本由 `tests/lib/selection.test.ts` 斷言，改資料時
**同一個 commit** 更新那裡的期望值並在註解寫明增減來源；不要把數字抄進這裡。

| 項目 | 判準 | 守門 |
|---|---|---|
| 覺醒 `awakening` | 每顆骰子一則，其餘節點不准有 | 規則 14 |
| `gameId` | 全有、全檔唯一 | 規則 16 |
| `category` | 只掛在玩家被動上 | 規則 16 |
| `dataIssue` | `placeholder`／`no-growth` 都應為 0 | 規則 17 |
| 解鎖例外 | `unlockVia` 只說「靠什麼開門」；`unlockPaid`（仍要付錢）、`bypassPrereq`（無視前置）另外說 | `data/unlock-exceptions.json`，規則 18 |
| 升級 tier ↔ 節點 | **雙向零殘餘** | `data/passive-upgrade-cost.json`，規則 22 |
| 骰子數值 ↔ 節點 | 雙向零殘餘 | `data/dice-stats.json`，規則 23 ＋ `tests/data/dice-stats.test.ts` |
| 戰術／Boss／裂縫／活動 | 見各自規則 | 規則 24／25／27／29 |
| 獎勵 | **沒有 validate 規則** | `tests/data/rewards.test.ts` |
| 畫布 viewBox | `0 0 2000 1700` | |
| 效能預算（硬斷言） | `tree.json` gzip ≤ 20KB／sprite ≤ 400KB（實測值 `build:data` 會印） | `tests/tools/build-data.test.ts`（CI 規則 12） |

- **版本欄位有三個、意義不同，首頁顯示前兩個，不要合併**：`data-game-version`（玩家看得到的遊戲版本）、
  `<metadata>` 的 `resource bundle`（決策：直接寫遊戲版本，不採客戶端 `BundleVersion`，語意不同）、
  `data-version`（正本 schema 版本）。⚠️ `<metadata>` 開頭 `layout rebased on RD2骰子樹 v1.0.1` 講的是**版面**來源，不要順手改。
- **覺醒不是節點**（不花錢、沒有前置、不進成本），是骰子身上的欄位；做成節點會同時弄壞節點邊數與全樹成本。
- **`gameId` 刻意不進 tree.json**，規則 16 是它唯一的防線（改壞了站台完全不受影響）。
- **`支援強化` 是本站的命名**（遊戲表把支援角色與冷卻縮減都標「支援」），見 `src/lib/labels.ts`。
- ⚠️ **`meta.totalUnlockCost` 不受解鎖例外影響**（是 SVG 成本總和，站台不顯示）；會跟著變的是 `sumUnlockCost()`。
- **顯示尺寸逐節點寫在正本的 `<image width/height>`**。**不要再加「類型 → 尺寸」對照表**（同類型也有不同尺寸）。
  改了尺寸要回頭看 `src/lib/canvas/view.ts` 的 `*_ICON_TARGET_PX` 與 `SHADOW_ON/OFF_AT_ICON_PX`
  （`SHADOW_OFF` 必須高於前兩者），`tests/lib/canvas/view.test.ts` 有斷言。
- ⚠️ **`tests/tools/build-data.test.ts` 的效能預算有兩條斷言，不要合併**：一條量測試自組產物（會低估），
  一條量 `pretest` 寫出的 `src/generated/tree.json`。少了後者就會「本機全綠、CI 爆掉」。
- **描述文字以「遊戲內實際顯示」為準**：上游樣板有沒填值的 `{n}` 時，遊戲連同那一段不顯示；**但上游填得出值就用上游的**。
  正本刻意跟上游不一致的格子清單在 `data/CLAUDE.md`，對新版資料表時會顯示成差異，**不要改回去**。
- ⚠️ **佔位符偵測機制留著但真實資料已無樣本**（`parseGrowth` 的 `{n}` 判定、`dataIssue: 'placeholder'`、
  規則 9、面板「數值待補」）。對應測試**一律用合成樣本**，不要綁真實節點。
- ⚠️ **沒有進 tree.json 的資料檔**（`dice-stats`、`passive-upgrade-cost`、`tactics`、`boss`、`rift-shop`、
  `events`、`rewards`、`maxlevel-official`、`offgame-effects`）：「表與節點對不上」在產物層面零痕跡，
  **validate 規則（或 rewards 的單元測試）是唯一防線**，而且對應規則必須是**雙向**的。
- ⚠️ **任何「這顆練滿要多少」一律走 `levelTableFor()`**（`/sim` 與 NodeDetail 同一判準）；
  `upgradeTableApplies()` 只給通用符文表用——special 節點套通用表會印出差兩個數量級的數字。
- ⚠️ **`unlockNote` 是自由文字而 `renderDetail()` 用 `innerHTML`**：`NodeDetail.ts` 一定要 `escapeHtml(formatUnlockVia(node))`（規則 18 擋不住內容）。
- **`bypassPrereq` 不改圖結構**：邊照樣存在，只有前置鏈遍歷在它停止往上追；`/tree` 把入邊畫成虛線
  （旗標由 `scene.ts` 搬成 `SceneEdge.bypassable`；`painter.ts` 的邊迴圈跑兩趟、`setLineDash` 設在迴圈外——它是 context
  狀態不是每條線的屬性；顏色透明度仍走 `state.ts` 的 `edgeColor()`／`edgeAlpha()`）。站台沒有全站圖例，虛線由詳情面板那句「鏈上有 N 顆可直接領的骰子」說明。
  ⚠️ **那句綁 `Selection.bypassNodes`，不可以綁 `bypassed`**（理由見 `src/lib/selection.ts`；E2E X2 守）。
  面板三句話講三件事不要混：「已排除 N 個非成本解鎖節點」／「鏈上有 N 顆可直接領的骰子」／「因此已跳過 N 個前置」。
- **首頁（`src/pages/index.astro`）的資料版本戳記用 `changelog.entries.find(e => e.data)`**（跟規則 20 的 `checkChangelog()` 同一個 `find`），
  不要為了讓帶 `data` 的條目留在前 3 筆去調排序；日誌由新到舊，同一天可多筆。`tests/e2e/codex.spec.ts` 的 C5 守。

## CI 規則（`tools/validate.ts`）

**編號注意**：`規則 11`＝差異摘要留言、`規則 12`＝效能預算，都是 CI 步驟不是 validate 規則；
`規則 13` 起才接回 validate。每條的成因寫在 `tools/validate.ts` 該規則旁，這裡只列判準。

| 規則 | 守什麼 |
|---|---|
| 0 | 邊是 `<svg>` 直屬；節點與邊不帶 `display`／`visibility`／`style`／`opacity="0"`；`marker-end` 指向正本定義過的箭頭、不得有 `marker-start`；座標與 viewBox 是有限數 |
| 1 | `nodes.json` 結構：必填、型別、長度 ≤ 500、無未知欄位；**選用欄位不用時整個省略，不可寫 `""`** |
| 2 | id 唯一且符合 `^[1-5][0-6]\d\d$`（首碼＝分支 1–5，次碼 0–6） |
| 3 | `type` ↔ 外框 `stroke` 對應：支援節點的 stroke 必須是 support 色，反之亦然（看 stroke 不看形狀） |
| 4 | `cost` 只寫錢，等級行不准混進去（改語意時 tree.json 不變，要有自己的測試） |
| 5 | 一個端點同時對上兩顆節點 → 報錯 |
| 6 | 無環、根集合正確、全部從根可達（`data-wip="1"` 豁免可達性；6(c) 只警告） |
| 6(d) | **`data-wip="1"` 的節點完全不准接線**（豁免＋能接線＝可把節點切到別的分支而 validate 全綠） |
| 7 | 圖示：(a) 檔案存在 (b) 檔名＝內容 sha256 前 12 碼 (c) PNG 結構與解析度 (d) 孤兒只警告 (e) 顯示尺寸×2 ≤ 解析度 |
| 8(b) | 詞彙表欄位、色碼、解釋文字裡的 `#` 查得到；`code` 是 HTML id／錨點，**不得撞號、必須英文字母開頭的 ASCII** |
| 9 | 成長值解析警告（不擋 PR） |
| 10 | 中央樞紐：`<svg>` 直屬、無 transform、圖檔解析度 ≥ 顯示尺寸 2 倍、放射線終點落在 `data-links` 節點中心 |
| 13 | viewBox ＝ `0 0 2000 1700`；節點與邊端點在畫布內；任兩節點中心相距 ≥ 5 |
| 14 | 覺醒只掛在骰子上 |
| 15 | 升級花費表 ↔ 解鎖金幣；**跳過 `passive-upgrade-cost.json` 的 `special` 節點** |
| 16 | `gameId` 全有且唯一；`category` 只在玩家被動 |
| 17 | 官方滿級值反向驗算 `growth` |
| 18 | 解鎖例外表型別與長度（`unlockPaid`／`bypassPrereq` 是布林） |
| 19 | SVG `data-id` 集合 ≡ `nodes.json` 鍵集合，**兩種殘餘都逐一列出 id** |
| 20 | changelog 結構＋最新資料條目與正本版本欄位一致（擋「資料改了、日誌沒改」） |
| 21 | `/board` 純骰子圖對應表（`data/board-icons.json`＋目錄）(a)–(h)：漏骰子、目錄、12 碼小寫 hex、檔不存在、**兩筆同圖**、對應表裡的非骰子 id。實作在 `checkDiceIconMap()`，跟規則 30 共用 |
| 30 | `/dice` 3D 骰子圖（`data/dice3-icons.json`＋目錄）：同一支 `checkDiceIconMap()`，子規則字母一一對應。`validate.test.ts` 的規則 30 組**刻意不重抄規則 21**，只驗第二條路徑真的接上、且不與 `board-icons` 同圖 |
| 22 | 玩家被動升級費用表：tier 形狀與區間連續、`(maxLevel, unlockGold)` 不撞號、**節點 ↔ tier 雙向對得到**、`special` 鍵是節點 id 且不與 tier 重疊、`mythic` 的 kind 要在 `MYTHIC_CORES`、**未知欄位一律擋**（舊寫法 `"solar": N` 會被指名） |
| 23 | `data/dice-stats.json`（以 **gameId** 為鍵，規則 19 抓不到）：(a) 漏骰子 (b) 孤兒 (c) `name` 不符 (d) 結構 (e) stat 型別（`""` 不放行） (f) `label` 撞號 (g) 四檔位全有或全無 (h) 未知欄位——**(h) 是 (g) 的補完**，鍵全拼錯時 (g) 沉默 (i) 四檔位反推得出成長參數 (j) `spGrowth` 等於 (i) 的每級強化。(b) 要先讓路給規則 19／1 |
| 24 | `data/tactics.json`：(a) 非空陣列 (b)–(d) 圖示目錄（含子選項的圖）(e) 欄位型別、`stage` 合法 (f) 圖不存在 (g) 兩筆同圖——**只放行 `sharedIconIds`**，且那兩筆反過來必須同圖 (h) 編號與 **`gameId` 撞號** (i) 子選項形狀，id 是「母編號-序號」、含 `-` 卻在頂層也擋 (j) `availability` 三布林齊全且至少一 true、可用模式要有對應文本、未啟用編號指名擋 (k) `#標記` 在白名單 |
| 25 | `data/boss.json`：通用檢查走 `checkIconedRecordList()`；**自己只寫一條** `difficulty` ∈ {一般, 困難}，其餘不准複製 |
| 26 | `data/prereq-ranks.json`：外層只有 note／source／ranks；內層鍵必須是外層節點的**祖先**且非自己；2 ≤ rank ≤ 該前置 `maxLevel`。`TreeNode.prereqRanks` **只在有值的節點上放欄位**（tree.json 預算） |
| 27 | `data/rift-shop.json`：走 `checkIconedRecordList()` 且傳 `sharedIconKey: 'name'`；**(g) 雙向**——跨名共用錯、同名不同圖也錯。自己的語意檢查：(e) `grade` 合法、`cost`／`weight` 正整數 (i) 同階級 `weight` 一致（刻意不寫死數值）(j) 同名多筆的階級互異 |
| 28 | `data/offgame-effects.json`：**雙向**（每顆符文／被動都有一筆，`none` 附 reason；孤兒擋）、`target` 在 `src/lib/offgame.ts` 詞彙內、`scope` 合法、`maxLevel` 一致、成長值與描述一致（`parseGrowth`）、`stat*` 的 `label` 在 dice-stats 存在、`mechanic` 必填 template（`{V}`／`{V2}`）、未知欄位擋。不進 tree.json，這條是唯一防線 |
| 29 | `data/events.json`：**不走 `checkIconedRecordList()`**。(a) 非空陣列 (b) 必填／未知欄位（**沒有 `notes` 欄位**，決策：維護者註記不進資料，不要加回）(c) `id` 小寫英數連字號、不撞號（頁面錨點）(d) `version` x.y.z (e) `period` 只能 `null` 或 `{begin, finish}` (f) `currencies` 的 `kind` 已登記 (g) 段落形狀 (h) **每列格數＝表頭欄數** (i) 格子是非空字串或 `{icon, text}` (j) `screenshots` 檔在 `public/events/`、`caption` 非空、寬高正整數、檔名無路徑；**目錄讀不到是錯不是跳過**。合法 `icon`／`kind` 只有 `src/lib/events.ts` 的 `EVENT_ICON_KINDS` 一份 |

- ⚠️ **幾何規則吃 `nodes`，文案規則吃 `withText`**（文案規則＝1／3／4／8／9／14／15／16／17）。
  餵錯的話 `nodes.json` 漏一筆會變成幾十條假錯誤。規則 21(h)／30(h) 判斷「是不是骰子」也走 `withText`。
- ⚠️ **共用實作只有一份，新檢查加在那裡，不准複製**：掃雜湊命名圖示目錄＝`checkHashNamedIconDir()`
  （規則 7／21／24／25／27／30）；對應表型＝`checkDiceIconMap()`（21／30）；一筆一 id 的資料檔型＝
  `checkIconedRecordList()`（24／25／27）。孤兒檔一律只警告。已知擋不到：兩顆骰子的雜湊互換。
- **`parseCost` 只吃單行**：規則 4 拒絕的輸入 `build:data` 也要拒絕，判斷寫在 `parseCost`（`src/lib/cost.ts`）。
- **正本上唯一合法的 `<text>` 是樞紐標籤**，`parseTree` 掃**全檔**擋（`tools/lib/svg-parse.ts`）。
  `label` 上限 20 碼點（`MAX_LABEL_LENGTH`，`tools/lib/node-text.ts`）。
- **`npm run normalize`**（`tools/normalize-svg.ts`）刪樞紐以外的 `<text>` 並比對同目錄的 `nodes.json`，
  不同就逐筆列出 exit 1；**比對與中止在 `writeFileSync` 之前**（`normalize-cli.test.ts` 守）。
  ⚠️ 它把 `svg > g:not(.node):not(.tree-center)` 當圖層攤平——**新增刻意保留的頂層 `<g>` 要加進這個排除清單**，
  否則被安靜拆散而 validate 不抱怨。

## 設計系統

**token 全部定義在 `src/styles/tokens.css`，也只准定義在那裡**（`tests/styles/tokens.test.ts` 以它為唯一來源，
正則只認縮排兩格的 `--x`）。新增樣式一律用 token；各 token 的理由與備援值寫在 `tokens.css`。

| 組 | token |
|---|---|
| 間距 | `--space-h/1..7`（4px 網格，`--space-h` 是唯一半階） |
| 圓角 | `--r-xs/sm/md/lg/btn/pill`（`--r-btn` 只給 `.btn`／`.seg`） |
| 字級 | `--fs-xs/sm/md/base/lg/xl/2xl/3xl` |
| 表面 | `--surface-0/1/2/3`、`--border-strong` |
| 陰影 | `--shadow-1/2/3`、`--ring` |
| 動效 | `--t-fast/press/med/slow`、`--e-out/in-out/spring`、`--p-lift/press/stagger/stagger-max/glow` |
| 面的質感 | `--hair`、`--ink`、`--depth`、`--face`／`--face-lift`／`--face-float` |
| 排印 | `--font`、`--font-num`、`--ls-label` |
| 按鈕 | `--btn-pri-bg/fg/edge/line`、`--btn-alt-bg` |

- **表面分層**：靜態頁的面 `--surface-1`；浮在畫布上的 chrome `--surface-2`；hover／選中 `--surface-3`；
  `--surface-0` 只給凹進去的元素（比卡片低一階，**不是**比 `--bg` 深）。
- **面的質感只用 `--face-*`，元件裡不准自己疊 box-shadow**：`--face` 靜止、`--face-lift` hover、
  `--face-float` 浮層（不帶下緣硬邊）。hover 抬升一律 `var(--p-lift)`，不寫死 `translateY`。
- ⚠️ **`--fs-xs`（12px）的中文不准加 `font-weight: 600`**；粗體中文最小 `--fs-sm`。
- 標題個性＝`font-weight: 700`＋`letter-spacing: 0.02em`（`base.css`），**不用拉丁 display face 排標題**。
- **`--font-num`**（自架 Baloo 2 拉丁 subset，只給 `.meta`／`.stat-v`／`.game-id`／`.nav-updated`）：
  後面必須接上 `--font` 全部成員；字型路徑走 `/fonts/`（`public/assets/` 在 `.gitignore`）；`.game-id` 的
  `font-family` 要明寫（會被 `code` 搶走）；刻意不補 `font-weight: 500`。重跑 subset 照 `public/fonts/README.md`
  （`tokens.test.ts` 驗 ≤ 30KB，E2E D15b 驗純拉丁節點只用一種字型）。
- **`--ls-label` 只給 `--fs-xs` 級標籤**，不准往內文或整句中文擴。
- **焦點框全站只有一條** `:focus-visible { outline: var(--ring) }`。
- **每一條 `transition` 都要指名 token 曲線**；`--e-spring` 只給狀態切換（`tokens.test.ts`「過場曲線」擋裸 `ease`）。
  ⚠️ `--t-med`／`--slide-ms` **長度不准動**（`tree-canvas.ts` 用 `cssMs()` 讀成常數），只換曲線安全。
- **按壓**＝`transform: scale(var(--p-press))`；⚠️ **不要在 `:active` 裡寫 `transition-duration`**（單值覆寫整份清單）；
  停用的按鈕要 `:not(:disabled)`。
- **進場動畫**：`[data-enter]` 由 `Base.astro` `<head>` 的同步 `is:inline` script 掛上、頁尾 `setTimeout` 移除
  （兩端都不能省、**不能改用 `animationend`**、**不寫成伺服器輸出的 `<html data-enter>`**）；`--i` 的上限只在 CSS 夾，
  模板不准 `Math.min`。載入後約一秒 hover 不抬起是已知且接受的。
- **JS 讀 CSS 時間一律 `cssMs()`／`cssNumber()`**（`src/lib/css-ms.ts`），**不准裸 `parseFloat`**（建置會把 `440ms` 壓成 `.44s`）。
- **E2E 量卡片幾何前先 `settleEnter(page)`**（`tests/e2e/probe.ts`）：`[data-enter]` 期間 `animation … both` 的結束值
  會壓過 `:hover` 的 transform，hover 抬升的斷言會驗到動畫填充值而永遠通過（D14 的正向控制這樣假綠過）。
- **減少動態的規則每個 CSS 檔自帶一個 `@media (prefers-reduced-motion: reduce)`**（`/tree` 的在 `tree.astro`），
  不寫全域 `*{transition-duration:0.01ms}`（會關掉傳達資訊的 opacity）。⚠️ **覆寫選擇器要跟被覆寫那條一模一樣、
  `:is()` 包法也一樣**，否則具體度低一階而輸掉（D18）。`tokens.css` 的 reduce 區塊是唯一改 token 的（`--face-lift`，理由在該處）。
- ⚠️ **`:has()` 與 `color-mix()` 都要有退化路徑**：`forced-colors` 區塊、`color-mix()` 前一行純色 fallback。
- **守門**：`tokens.test.ts` 掃裸 px／rem（例外在 `ALLOWED` 附理由）、驗每個 `var(--x)` 定義得出來、級距內不准撞值；
  掃描名單自動列舉，另拿寫死的 `EXPECTED_CSS` 反驗——**新增或改名 CSS 檔要一起改 `EXPECTED_CSS`**。
  `tests/e2e/chrome.spec.ts` 的 D1–D12 守沾頂、`--nav-h`、`aria-current`、焦點框、footer 沉底、過場時間。

### 共用元件（`components.css`）

頁面專屬 class（`.home-card`、`.battle-item`…）仍掛著供測試與 JS 抓，只留那一頁的版面差異。**新頁面先套共用 class，不要再長一種。**

| class | 掛在哪 | 判準 |
|---|---|---|
| `.page-head` | 每頁唯一的 `<h1>` | 掛在 h1 本身，不是容器 |
| `.sec-title` | 段落 `<h2>` | 金色菱形 `::before` |
| `.card` | `.home-card`／`.guide-card`／`.dice-card` | 按壓縮放**只給 `a.card`** |
| `.row-card` | `.event-card-link`／`.battle-item` | 抬升只給 `a.row-card` |
| `.chip` ＋ `.filter-bar` | 篩選鈕與沾頂篩選列 | `/tree` 的分支跳轉鈕也是 `.chip`（不套 `.filter-bar`） |
| `.pill` | `.stat-pill` | 框線是**透明**不是拿掉（寬度不准變，C8） |
| `.btn` ＋ `.btn-pri`／`.btn-alt` | 動作按鈕 | 硬邊是 box-shadow 不是 border；**一頁最多一顆 `.btn-pri`**；`[aria-pressed]`＝金框 |
| `.seg` | 分段切換 | 沒選中的框是透明不是 0；外高＝一顆獨立按鈕（B52） |
| `.step` | 「‹ 值 ›」步進 | 名字在 `aria-label`；內距刻意小（B52） |
| `.panel` | 側欄與浮在內容旁的面 | 浮層（`#dice-picker`、`#dice-card`）不用它 |

### CSS 檔的分工

新樣式放哪個檔先查這張表（`tokens.css`、`base.css`、`chrome.css`、`content.css`、`components.css` 由 Base 載，其餘由頁面載）：

| 檔 | 放什麼 |
|---|---|
| `tokens.css` | token（唯一允許定義 token 的地方） |
| `base.css` | 全站重置＋`.sr-only` |
| `chrome.css` | 導覽列 `#site-nav`（含下拉） |
| `content.css` | 靜態內容頁 `.page`、`#hit-counter`、詞彙頁 `.kw-*` |
| `components.css` | 共用元件、`.filter-bar`、`--branch` 供應者、`.branch-dot`、首頁與遊戲介紹卡片 |
| `detail.css` | `/tree` 的 `#detail` |
| `canvas.css` | 畫布**容器**（`/tree`、`/sim`）；畫布**內容**的外觀在 `src/lib/canvas/theme.ts` |
| `dice.css` | `/dice` 圖鑑 |
| `board.css` | `/board` |
| `battle.css` | `/tactic`、`/boss`、`/rift-shop` 的橫列清單 |
| `events.css` | `/events`，含全站第一份 `<table>` 樣式（其他頁要表格從這拿） |
| `rewards.css` | `/rewards` |

- ⚠️ **`/tree` 的 `#toolbar`／`#filters`／`#branch-nav`／`#branch-chips` 在 `tree.astro` 的 `<style is:global>`**，不在 CSS 檔。
- ⚠️ `--branch` 供應者與 `.chip-xs` 必須留在 `components.css`（理由在該處）。

### 版面的硬規則

- ⚠️ **頁面級 `import '../styles/x.css'` 一定寫在 `import Base` 之後**；`Base.astro` 那五行 CSS import 的順序也是層疊順序。
  寫反是零錯誤零警告（`tokens.test.ts`「import 順序＝層疊順序」守）。
- **導覽列 sticky，不准換行**：每項 `white-space: nowrap`、≤720px 隱藏「上次更新」（D9）；塞不下時是**內層
  `.nav-links` 橫向捲動**，不換行、不縮字、不拿掉入口；「遊戲介紹」`<details>` 留在捲動盒外（D13、D19、
  `tests/e2e/navigation.spec.ts`，`webkit-nav` project 只在 CI 有 WebKit）。點外面關閉聽 `pointerdown` 也聽 `click`。≤720px 品牌只留圖示（`.brand-text` 用 clip-path，
  不能 `display:none`）；**露出半截的最後一項是唯一的「還能滑」線索**，加寬任何一項前先看 D21。
- **`/tree` 工具列尺寸不准隨篩選狀態改變**：金點 `::before` 一直存在只是透明；`清除篩選` 用 `visibility: hidden` 佔位（O2、O3）。
- **篩選面板開合**：寬度只能 JS 量、鎖 px 再動，**動完拿掉 inline width**，收尾用 `setTimeout` 不用 `transitionend`；
  開關狀態讀模組變數 `filtersOpen` 不讀 class；測試不能假設 `aria-expanded` 翻了幾何就開始變（O3 用 `expect.poll`）；
  `.animating` 期間才 `flex-wrap: nowrap`；Esc／點外面關閉只在 ≤720px；跨斷點用 `matchMedia` change 重設
  （先確認 `addEventListener` 存在，linkedom 替身沒有）。細節在 `src/scripts/tree-canvas.ts` 與 `tree.astro`。
- **篩選器是 `<label>` 包真的 checkbox**，checkbox 用 `position: absolute; inset: 0; opacity: 0`，
  **不准 `display: none`／`visibility: hidden`**（C6）。分組用 `<div role="group" aria-label>`，**不用 `<fieldset><legend>`**（D12）。
  切換鈕列距由 `line-height` 給，**不准 `margin-bottom`**（P）。
- **導覽列偏移只能有一個來源**：`html { scroll-padding-top }`，元素不准再加 `scroll-margin-top`（D10）。
- ⚠️ **`[aria-current='page']` 的金線畫在 `::before`**（`::after` 是下拉 ▾）；選擇器要把 `.nav-menu > summary` 一起列（D3、D11）。
- ⚠️ `.dice-card` 的分支色條是頂緣 `::after`（`z-index: 2`，要贏過 `.card-term` 覆蓋層，C12）。
- ⚠️ `body` 是 flex column 時 `main` 寫 `width: 100%; margin-inline: auto`，不寫 `margin: 0 auto`。
- ⚠️ **`.sr-only` 一律 clip-path**；拿掉可見文字時不要把 live region 一起拿掉。
- ⚠️ **E2E 驗減少動態用 `page.emulateMedia({ reducedMotion: 'reduce' })`**，`test.use({ reducedMotion })` 在目前版本沒傳進 page。

## 版面沒有固定偏移量

**零偏移量**，動版面時不准引入新的寫死偏移（E2E 的 U 不該捲動、V 詳情卡片避開側欄、J 手機抽屜不蓋工具列、W footer 讓位）：

- `body:has(#canvas-host)` 是 flex column，`<main>` 與 `#canvas-host` 都 `flex: 1`。
- `--nav-h` 由 `src/lib/nav-height.ts` 量**視窗座標**（`rect.bottom`，不加 `scrollY`），`Base.astro` 的 `installNavHeight()` 全站安裝。
- `--chips-h` 由 `tree-canvas.ts` 量 chip 列寫入，**不寫死**；手機 footer 與 `#detail`（`inset: auto 0 var(--chips-h) 0`，不靠內距推）用它讓位。
- ⚠️ `#canvas-host > canvas` 是 `position: absolute; inset: 0`，**不能用 `width/height: 100%`**（見 `canvas.css`）。
  實際 CSS 寬高由 `canvas-tree.ts` 的 `measure()` 用 inline style 寫成「視口＋2×邊距」並 `translate(−邊距)`——
  **那個 inline width 不是多餘的，不要「修正」掉**。

## 資料解析

### 成本

- **型別**：`Cost` ＝ `{ core, gold, mythic? }`（`src/lib/cost.ts`）。`core`／`gold` 必填；`mythic` 是 `kind → 數量`，
  **缺席＝沒有超越核心，有的話值都 > 0**（正規形）。**不可對 `mythic` 裡的數字直接加減**，一律走
  `addCost()`／`subCost()`／`mythicAmount()`／`mythicEntries()`。`LevelCost.mythic` 同樣選填，`UpgradeBand` 沒有。
- **新增一顆神話骰子＝在 `src/lib/currency.ts` 的 `MYTHIC_CORES` 加一筆＋放 `public/currency/<kind>.png`，不改任何型別**。
  解析、顯示、`/sim` 上限欄、規則 22 都從這份清單列舉；陣列順序＝顯示順序，新的往後接（`tests/lib/cost.test.ts`）。
- **成本字串格式（`parseCost`）**：順序固定 **金幣→核心→超越核心**，禁反序禁重複（超越核心全部合計只准一種）；
  分隔符是全形 `／`（U+FF0F）；金幣 ≥ 4 位必須千分位逗號，超越核心兩種都收；`核心 N／太陽核心 M`（無金幣）刻意不支援。
  沒登記的 `X核心` 要擋在「未登記的超越核心」那句錯誤。
- **超越核心的顯示一律「有值才印」**（`formatCost`、`/sim` 三列合計、`simReport` 看總計、PR 差異摘要）。
- CI 差異摘要讀 base 的 tree.json 走 `costFromJson()`：吃舊形狀，**只印登記過的種類名稱**（`mythic` 的鍵來自 PR 作者）。
- **畫面顯示走 `src/lib/cost-html.ts` 的 `costHtml()`／`simCostHtml()`**，文字與 `formatCost()` 逐字相同；
  純文字 `formatCost()` 只給 aria-label、`simReport()`、差異摘要。貨幣圖在 `public/currency/`（**不是** gitignored 的
  `public/assets/`），用 `npm run add-currency-icon -- <kind> <PNG>` 產生，**不要走 `add-icon` 的雜湊管線**（檔名寫死引用）。
- **`CurrencyIconKind` 可以比 `CurrencyKind` 多**（`tacticcoin`、`/events`／`/rewards` 的資源）：局內或非骰子樹貨幣
  只擴圖示層，**不要加進 `Cost`**。名稱與圖一律走 `currencyIconDetails(kind)`，頁面不另抄對照表。

### 節點文字與關鍵字

- **等級上限一律讀 `nodes.json` 的 `maxLevel`**，不從 title 推。
- `#關鍵字` 沒有結束符 → 用 `data/keywords.json` 白名單**最長優先**比對，不可用正則貪婪抓。
- **`data/keywords.json` 同時是規則 8 的白名單與玩家看的詞彙解釋**，決策：不拆成兩份。別名用 `{"aliasOf": "本尊"}`，
  規則 8(b) 禁鏈狀別名。
- `meta.glossary` 只放用得到的詞條（傳遞閉包）、**不含 `code`**、key 要排序（否則資料沒變 diff 也翻）。
- **`node.keywords` 只含描述裡用到的，不含覺醒**；覺醒的關鍵字由 `meta.glossary` 現算。改它的語意會動到搜尋與篩選。
- 成長值單位六種（`%`／秒／次／個／倍／無）且有 `(+-0.2秒)`；`src/lib/growth.ts` 的正則限定位數，**不可寫回 `[\d.]+`**（回溯，validate 在 fork PR 上跑）。
- `stroke` 不在固定元素上：骰子 `<rect>`、符文／支援 `<polygon>`、被動 `<circle>`。

### SVG 解析

- **屬性值裡不可有字面換行**：Chromium 會正規化成空格、linkedom 不會，兩邊讀出不同值。要換行寫 `&#10;`
  （瀏覽器內解析正本的功能，如線上編輯器，一定會踩到）。
- `tools/lib/dom.ts` 的 `attr()`：linkedom 不解屬性裡的 `&amp;`／`&lt;`，卻會解 `<title>` 裡的。

## 工具與 CLI

- **CLI entry guard 一律 `import.meta.url === pathToFileURL(process.argv[1] ?? '').href`**（`tests/tools/entry-guard.test.ts` 掃 `tools/*.ts`）。
- **`String.replace` 回傳值沒變不代表失敗、變了也不代表成功**：寫回正本要在 callback 設旗標，用 `render-nodes.ts` 的 `mustReplace()`。
- Playwright 的 `omitBackground` 對內容自己畫的背景無效，截圖工具要把背景 `<rect>` 一併隱藏；驗收量 alpha 通道分佈。
- **Astro 頁面 import 不到 `tools/` 的模組**（build 與 typecheck 都過，渲染時才 `is not defined`）→ 共用純函式放 `src/lib/`，tools 反過來 import。
- `split-svg.ts`／`render-nodes.ts` 的來源檔一律由參數傳入，**不給預設路徑**。
- `npm run compare` 逐索引走 DOM，**有新增元素的改動給不出答案**——驗零回歸要自己逐選擇器比 computed style。

## 測試環境

- `src/generated/tree.json` 是 gitignored 產物，`pretest`／`pree2e` 會先產生，**不要拿掉**。
- **tree.json 是傳輸形狀不是 `TreeData`**：讀它一律經 `decodeTree()`（`src/lib/tree-wire.ts`）；站台用
  `src/lib/tree-data` 的 `treeData`，測試用 `tests/helpers/read-tree.ts` 的 `readTree()`。**不可 `JSON.parse(...) as TreeData`**。
- **E2E 不量畫布內的 DOM 幾何，一律問 `window.__tree`**（`src/lib/canvas/debug-api.ts`：`count()`／`scale()`／
  `nodeScreenRect(id)`／`state()`／`hitAt(x, y)`）。隱形按鈕被 `clip-path` 裁成 1px，`boundingBox()` 不報錯只給錯值。
  它永遠安裝，不加 build flag。
- **畫布外觀只有截圖快照守得到**（`tests/e2e/tree.spec.ts-snapshots/`，容差見 `playwright.config.ts`）：
  - 快照**只在 Playwright 官方容器內比對**：`npm run e2e:snapshots`（docker）；裸機上 F 一律 skip。升 `@playwright/test`
    時 `ci.yml` 的 `container:` tag 與 `package.json` 兩個 script 的 tag 一起改。
  - 盲區：全樹視角改壞單顆圖擋不下來；畫面改了快照照樣綠是常態（每像素另有色差門檻）。
  - 更新基準圖要 `npm run e2e:snapshots -- --update-snapshots=all`（預設只重寫比對失敗的），再對 `git show HEAD:<png>`
    逐張比，確認只有該變的變了。**不要放寬容差**。
  - worktree 的 `node_modules` 是 symlink 時，手動 `docker run` 多掛 `-v <主 checkout>/node_modules:/work/node_modules:ro`，並先在宿主 build。
- linkedom 沒有 canvas、不更新 `document.activeElement` → 這兩類只能 E2E 驗。`painter.test.ts` 用 Proxy 假 `Ctx2D`，驗呼叫不驗長相。
- 臨時 Playwright 腳本要放在 repo 目錄下才 import 得到 `@playwright/test`。
- **手機 project 截 `fullPage: true` 會把觸控版面永久換掉**（`(hover: none) and (pointer: coarse)` 變 false）：
  看手機版面截視窗，截完不在同一頁做幾何斷言。
- **兩個工作區同時跑 E2E 會互相偷 server**（`reuseExistingServer: true`＋固定埠）：一邊用 `E2E_PORT=4399`；
  懷疑時 `curl localhost:<port> | grep -c <自己的東西>`；收工 `pgrep -af "bin/serve"` 確認無殘留。

## 部署

`ci.yml` 的 `deploy` job 上傳 `verify` 驗過的 `dist/`（上線位元組＝被驗過的位元組）。細節與成因在 `ci.yml` 各步的註解；改它前讀：

- **checkout 在 `download-artifact` 之前**（`clean: true` 會洗掉 `dist/`）；sparse checkout **只取 `functions/` 與 `deploy/`**、
  關 cone mode，不要改回整個 repo（token 所在的 job 不裝網站相依樹）。少了 `functions/` Pages 會靜默跳過 Functions。
- action 一律 pin 40 碼 SHA（repo 開了 `sha_pinning_required`）。
- **不用 wrangler-action**：wrangler 裝在 `deploy/`（自己的 lockfile），無 secret 的步驟 `npm ci --ignore-scripts --prefix deploy`，
  token 只出現在部署那一步。升級：`cd deploy && npm i wrangler@<新版> --ignore-scripts`，lockfile 一起 commit。
- 部署後 smoke check 等 `deploy-sha.txt` 回本次 SHA，再驗 `/` 200、`POST /api/hits` 回 `{"n":<數字>}`；打正式網域（部署專屬網址有 Access）。
- deploy 比線上舊（`behind`）會跳過；**回滾用 Cloudflare Pages 儀表板的 Rollback**，重跑舊 run 不會部署。
- 正式網域寫死在多處，換網域 `git grep rd2wiki.org` 全找。
- **`public/_headers` 對 Pages Functions 無效**：標頭兩邊都寫（Function 在 `functions/api/hits.ts` 自己放），驗收分開驗。
- **`#hit-counter` 在 HTML 裡不代表看得到**（預設 `hidden`，拿到數字才顯示）；要驗顯示用瀏覽器。前端只看 payload 形狀、
  **不信 status code**（`src/lib/hit-counter.ts`）。

### SEO

- `public/robots.txt` 的 `Sitemap:` 是絕對網址，換網域跟 `site` 一起改。
- `@astrojs/sitemap` **不加 `filter`**（`astro.config.mjs` 註解）；`tests/e2e/seo.spec.ts` 的 `PAGES` 完全相等比對 `<loc>`，增刪頁面要同步改。
- 404 頁是 `src/pages/404.astro`，**不是 `public/404.html`**。`<title>` 格式 `Random Dice 2 wiki | 分頁名`（半形 `|`，R 守）；
  `noIndex` 只給 404（省略 canonical＋`noindex`）。
- `seo.spec.ts` 的「未知路徑回 404」本機是假綠；部署後驗：`curl -o /dev/null -w '%{http_code}\n' https://rd2wiki.org/no-such-page` 要 404。

## README 與門面素材

README 是產品頁形式（banner ＋ 徽章 ＋ `> [!WARNING]` 免責 ＋ 分讀者章節）。

- 素材在 `.github/media/`（banner 原始碼 `banner.src.html`，重產指令在檔頭），**不要放 `public/`**（會進站台吃規則 12 預算）。
- banner 裡不放節點數這類會隨資料變的數字；banner 與 tagline 文案沿用 `Base.astro` 的 `OG_TITLE`／`DESCRIPTION`。
- 已知限制與 `src/lib/flags.ts` 的暫停功能不寫進 README。
- 不用 root-relative 連結（`[/about](/about)` 會連到 `github.com/about`）；README 與 `CONTRIBUTING.md` 都寫完整網址。
- `LICENSE` 保持**逐字標準 MIT**；「MIT 不涵蓋 `data/` 內遊戲素材」的範圍說明放 README〈授權〉與 `data/NOTICE.md`，**不要加回 `LICENSE`**。
- 推之前先看渲染結果：`gh api -X POST /markdown`（`mode: gfm`、`context: NatsuYukiowob/rd2-wiki`）產 HTML，套 github-markdown-css 截圖。

## 不進版控

`docs/`（規格書、實作計畫、已知問題）與 `.superpowers/` 刻意不進版控，只在維護者本機。

## 暫時停用的功能

`src/lib/flags.ts` 的 `FEATURES`：布林值一翻功能就回來；對應測試斷言的是**現在**的行為，開回來時紅的那幾條會指出還要改哪裡。

## 已知待辦

**待辦正本是 [GitHub Issues](https://github.com/NatsuYukiowob/rd2-wiki/issues)**，不在這裡另列。以下是不要退回去的結論：

- **畫面上常駐標籤只有骰子與支援**，符文與被動只在 hover／聚焦／進前置鏈時顯示；縮字級解決不了重疊（E2E 的 M 守，量測在 `src/pages/tree.astro` 註解）。
- **自動化只在 Chromium 驗過**，iOS Safari 沒有覆蓋；改 `shadowBlur`、離屏 canvas、sprite `drawImage` 這條路徑時要另找實機看。
