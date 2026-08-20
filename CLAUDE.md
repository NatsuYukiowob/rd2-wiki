# rd2-wiki

《Random Dice 2》互動式骰子樹攻略站。Astro 靜態站，部署在 Cloudflare Pages
（https://rd2-wiki.pages.dev/），GitHub `NatsuYukiowob/rd2-wiki`（public）。

## 這個專案的核心概念

資料正本是 **`data/dice-tree.svg`**——一份帶 `data-*` 屬性的 SVG（239 節點 / 248 邊），
外加 `data/icons/`（238 張 PNG，檔名 = 內容 sha256 前 12 碼）與 `data/tree-center.png`
（中央樞紐的合成圖，見下）。由社群發 PR 維護，CI 是唯一防線（維護者不可能逐行 review
SVG 的 diff）。

**外觀整個來自遊戲內的原圖**：2026-08-18 依遊戲內的骰子樹畫面 `RD2骰子樹 v1.0.1`
（`dice_tree_v1.0.1_fixed.svg`，素材不在版控內）重做，座標取原圖 ×0.5
（原圖節點座標全是 20 的倍數，減半後仍是 10 的倍數），圖示、配色、邊的粗細與顏色也都對過去。
那份原圖**只有畫面、沒有任何文字資料**（0 個 `<text>` / `<title>` / `data-name`），名稱／
花費／描述一律留在本正本裡。

⚠️ **原圖的節點不是「一張圖」，是多層疊出來的**——底盤圖 ＋ SVG 漸層圖形 ＋ 帶 CSS filter 的
符號 ＋ 投影濾鏡。所以「換圖示」不能只是複製檔案，要跑 `npm run render-nodes`：它用真的
Chromium 把每個節點各自渲染成一張扁平 PNG（濾鏡與漸層由瀏覽器算，不重寫一份），再把結果
與尺寸寫回正本。這支**不掛在建置流程上**，一年跑不了幾次，CI 與貢獻者都不必裝瀏覽器。

核心功能：點一個節點 → 高亮它在 DAG 上的**所有祖先聯集**（去重、含自身、多重前置視為 AND）
→ 算出解鎖成本。

## 指令

```bash
npm run validate    # 資料驗證（規則 0–10 ＋ 13，CI 守門員）
npm run typecheck   # tsc --noEmit（含 noUnusedLocals，會抓沒用到的 import）
npm run normalize   # 攤平 Inkscape 的圖層/matrix/相對路徑（貢獻者送 PR 前必跑）
npm run add-icon    # 新增圖示，自動用內容雜湊命名
npm run render-nodes -- <遊戲原圖路徑>  # 用 Chromium 重畫全部節點圖示（遊戲改版才跑，見下）
npm run split -- <遊戲原圖路徑>         # 從原圖切出正本與圖示（重建整份資料時才用）
npm run build:data  # 產出 src/generated/tree.json + public/assets/
npm run build       # build:data + astro build
npm test            # 有 pretest 自動跑 build:data
npm run e2e         # 有 pree2e 自動跑 build
```

## 不變量（改動後務必重驗）

- 版本欄位有**三個、意義不同**：`data-game-version`（玩家看得到的遊戲版本，目前 1.0.1）、
  `<metadata>` 的 `resource bundle`（資料抄自哪一版遊戲資源包，目前 0.0.5）、
  `data-version`（正本自己的 schema 版本，目前 1.1.0）。首頁顯示前兩個，不要合併
- 節點 **239**、邊 **248**、根 5 個（`1001 2001 3001 4008 5002`）、多重前置 **14** 個
- **41 顆骰子各有一則 `data-awakening`**（7 骰點自動啟用的覺醒效果），其餘 198 個節點不准有
  （規則 14）。覺醒**不是節點**：不用花錢解鎖、沒有前置、不進成本計算——所以它是骰子身上的
  一個欄位，不是第 240–280 個節點。做成節點會同時弄壞 239／248 與全樹解鎖成本
- **`data-game-id` 全 239 個都要有、且全檔唯一**（骰子 `D000`／符文 `D0000`／共通 `S0200`，
  規則 16）。它是正本與遊戲資料表唯一對得起來的鍵——⚠️ **刻意不進 tree.json**（站台不顯示，
  239 個字串要吃 0.55KB gzip），所以規則 16 是它唯一的防線，改壞了站台完全不受影響
- **`data-category` 只掛在 70 個玩家被動上**（`系別屬性 25／全骰屬性 15／系別技能 15／
  玩家被動 10／支援強化 5`，規則 16）。詳情面板有分類時顯示分類、沒有才顯示 type。
  `支援強化` 是本站的命名：遊戲資料表把支援角色與它的冷卻縮減都標成「支援」，照抄會寫出
  「支援 · 支援」與「玩家被動 · 支援」兩種都看不懂的組合
- `5201` 前置鏈 = **核心 66 ／ 金幣 23,000**（spec §6.4 基準）
- 全樹解鎖成本 = **核心 1,772 ／ 金幣 6,662,000**
- `dataIssue==='placeholder'` **0** 個、`no-growth` **5** 個
- ⚠️ **描述文字以「遊戲內實際顯示」為準，不是資源包裡的原始樣板。**
  資源包有沒填值的 `{n}` 佔位符時，遊戲並不是照樣印出來，而是**連同它所在的那一段一起不顯示**
  （2026-08-20 Yuki 逐個對照遊戲畫面）：

  | id | 資源包原文 | 正本（＝遊戲畫面） |
  |---|---|---|
  | 2403 | `攻擊速度增加5%(+{1}%)` | `攻擊速度增加5%` |
  | 5302 | `#僵硬範圍增加30%(+{1}%)` | `#僵硬範圍增加30%` |
  | 5403 | `傷害增加(最多{1}疊加)` | `傷害增加` |
  | 5307 | `30%機率額外獲得{1}疊加` | `30%機率額外獲得疊加` |

  所以正本現在一個佔位符都沒有。下次拿新版資源包來對時這四個會顯示成「跟上游不一致」，
  那是刻意的。
- ⚠️ **佔位符偵測機制留著，但真實資料已經沒有樣本了。** `parseGrowth` 的 `{n}` 判定、
  `dataIssue: 'placeholder'`、規則 9 的警告、面板的「數值待補」全都還在——上游隨時可能再
  冒出新的佔位符，那是唯一會提醒我們的東西。對應的測試因此**全部改成合成樣本**
  （注入一段 `{1}` 再驗），不再綁在某顆真實節點上；綁真實節點的話，資料一改測試就跟著消失，
  而那段程式還活著卻沒有任何東西守著。
  ⚠️ 注入的夾具要**描述與 `<title>` 一起改**，只改一邊會先被規則 1 擋下來，測到的就不是規則 9
- 畫布 viewBox `0 0 2000 1700`；顯示尺寸**逐節點**寫在正本的 `<image width/height>`
  （骰子 50×53 ×41、符文 26×26 ×123、被動小 34×34 ×45、被動大 44×44 ×25、支援 51×47 ×5）。
  **不要再加「類型 → 尺寸」對照表**：同一種類型底下也會有不同尺寸（被動有大小兩種），
  舊的 `sizeOfType()` 就是為此拿掉的。這幾個數字改動後一定要回頭看
  `src/scripts/tree-canvas.ts` 的兩個 `*_ICON_TARGET_PX`——它們是照骰子寬度換算的，
  曾經因為骰子從 56 縮到 50 卻沒跟著改，讓每個視角都多放大 12%
- 效能預算硬斷言：`tree.json` gzip ≤ 20KB（**目前 18.9KB，只剩 1.1KB**）、sprite ≤ 400KB（目前 130KB）。
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

### 2026-08-19 補上的守門（review 報告 P2）

前置鏈與成本可以在「畫面完全沒變」的情況下被改掉，這幾條就是堵那個：

- **規則 6(d)：`data-wip="1"` 的節點完全不准接線。** 這是最要緊的一條。wip 讓節點豁免
  「非預期的根」與「從根不可達」兩項檢查——而那是圖結構唯一的守門員。豁免＋能接線＝可以把
  任意節點切下來接到別的分支，validate 全綠、節點數與邊數不變、四個不變量都對，而成本變了
  （報告實測：5201 鏈 66 → 86 核心）。豁免與接線能力二選一。
- **規則 0（parseTree）**：邊必須是 `<svg>` 直屬子元素（不可藏在 `<defs>`／圖層／節點群組裡）；
  節點與邊都不可帶 `display`／`visibility`／`style` 或 `opacity="0"`；`marker-end` 必須指向
  正本定義過的箭頭、且不可有 `marker-start`；座標與 viewBox 一律驗到是有限數。
- **規則 13**：viewBox 必須等於 `0 0 2000 1700`；節點與邊端點必須落在畫布內；
  任兩顆節點中心至少相距 5（疊在一起時，邊接到誰只取決於它們在檔案裡的先後順序）。
- **規則 5**：一個端點同時對上兩顆節點時直接報錯，不再靜靜取第一顆。
- **規則 1／4**：`data-name`／`data-description` 有長度上限；`data-cost` 的「最高 N 級」
  與 `<title>` 的「最高等級：N」必須一致。
- `tools/lib/dom.ts` 的 `attr()`：**linkedom 不解屬性裡的 `&amp;`／`&lt;`，卻會解 `<title>` 裡的**
  ——名稱含 `&` 的節點會讓規則 1 永遠對不起來。所有 data-* 文字欄位改用 `attr()` 讀。
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
（`typeof body.n === 'number'`）——因為未知路徑回 200、Functions 沒部署時回 405。

### ⚠️ 未知路徑目前回 200 加一份首頁，不是 404

`dist/` 裡沒有 `404.html` 時，Cloudflare Pages 會當成 SPA 處理、拿 index.html 當 fallback。
實測 `curl -sI https://rd2-wiki.pages.dev/this-does-not-exist-12345` → `HTTP/2 200`，
內容是 `<title>首頁 rd2-wiki</title>`。打錯的網址與失效的分享連結都會被搜尋引擎和連結預覽
當成有效頁面。要修就是加一個 `public/404.html`（尚未做）。

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
  linkedom 不遵守**，同一份檔案兩邊會讀出不同的 `data-description`。目前沒有實際症狀——
  站台在瀏覽器端讀的是建置期產物 `tree.json`，不在瀏覽器裡解析 SVG——但任何「在瀏覽器裡
  直接解析這份 SVG」的功能（例如線上編輯器）都會踩到。修法是把屬性值裡的換行改編成
  `&#10;`，`<title>` 的內容則要保留真正的換行（元素內容不做這個正規化）
- **玩家被動的等級上限在 `<title>` 的最後一行**（`最高等級：N`），不在 `data-cost`；
  取「第二行」會在多行描述的節點上靜默算錯
- `#關鍵字` 標記**沒有結束符**，中文無分詞 → 必須用 `data/keywords.json` 白名單
  最長優先比對，不可用正則貪婪抓
- **`data/keywords.json` 一份檔案兩個角色**：規則 8 的白名單 ＋ 玩家看得到的詞彙解釋
  （62 條，抄自遊戲資源包的狀態詞彙表，含 `code`／`color`／`desc`）。刻意不拆成兩份——
  拆開就會出現「白名單加了詞、但站上點開沒有解釋」而兩邊都不報錯。規則 8(b) 守欄位齊全、
  色碼格式、以及**解釋文字裡的 `#` 也要查得到**（逐節點的規則 8 只掃 data-description，
  掃不到詞彙表自己）。
- `meta.glossary` 只放**用得到的**詞條（節點用到的 ＋ 覺醒用到的 ＋ 這些解釋自己再引用到的，
  **目前 41 條**），不是整份 64 條，而且**不含 `code`**（那是給貢獻者比對遊戲資源檔的，
  站台不顯示）。key 進 tree.json 前有排序：傳遞閉包是用堆疊展開的，不排序的話資料沒變
  diff 也會整段翻掉。**這些數字別手寫進文件**——`npm run build:data` 每次都會印出實際值
- **別名詞條 `{"aliasOf": "本尊"}`**：同一個遊戲代碼被官方翻成兩個顯示名時用它，不要抄第二份
  解釋。v1.0.1 實例兩個，而且都只出現在覺醒文字裡：`TRANSFER` 詞彙表寫 `#SP怪物`、貪婪骰子
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
