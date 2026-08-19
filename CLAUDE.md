# rd2-wiki

《Random Dice 2》互動式骰子樹攻略站。Astro 靜態站，部署在 Cloudflare Pages
（https://rd2-wiki.pages.dev/），GitHub `NatsuYukiowob/rd2-wiki`（public）。

## 這個專案的核心概念

資料正本是 **`data/dice-tree.svg`**——一份帶 `data-*` 屬性的 SVG（239 節點 / 248 邊），
外加 `data/icons/`（238 張 PNG，檔名 = 內容 sha256 前 12 碼）與 `data/tree-center.png`
（中央樞紐的合成圖，見下）。由社群發 PR 維護，CI 是唯一防線（維護者不可能逐行 review
SVG 的 diff）。

**外觀整個來自遊戲內的原圖**：2026-08-18 依 `RD2骰子樹 v1.0.1`（`/mnt/data/share/Yuki/
random dice 2 dice tree/RD2骰子樹v1.0.1/dice_tree_v1.0.1_fixed.svg`）重做，座標取原圖 ×0.5
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
npm run render-nodes # 用 Chromium 從遊戲原圖重新渲染全部節點圖示（遊戲改版才跑，見下）
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
- `5201` 前置鏈 = **核心 66 ／ 金幣 23,000**（spec §6.4 基準）
- 全樹解鎖成本 = **核心 1,772 ／ 金幣 6,662,000**
- `dataIssue==='placeholder'` **4** 個、`no-growth` **5** 個
- 畫布 viewBox `0 0 2000 1700`；顯示尺寸**逐節點**寫在正本的 `<image width/height>`
  （骰子 50×53 ×41、符文 26×26 ×123、被動小 34×34 ×45、被動大 44×44 ×25、支援 51×47 ×5）。
  **不要再加「類型 → 尺寸」對照表**：同一種類型底下也會有不同尺寸（被動有大小兩種），
  舊的 `sizeOfType()` 就是為此拿掉的。這幾個數字改動後一定要回頭看
  `src/scripts/tree-canvas.ts` 的兩個 `*_ICON_TARGET_PX`——它們是照骰子寬度換算的，
  曾經因為骰子從 56 縮到 50 卻沒跟著改，讓每個視角都多放大 12%
- 效能預算硬斷言：`tree.json` gzip ≤ 20KB（目前 16.4KB）、sprite ≤ 400KB（目前 130KB）

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

### ⚠️ 寫死的版面偏移量咬過四次

1. `#branch-nav` 寫死 `top: 6rem`，假設工具列恆 3rem 高。
2. `#tree-controls`／`#detail` 寫死 `top: 3rem`，假設 nav 恆 48px 高（實際 50.59px，
   差 2.59px 造成右上角 1px 突出）。
3. 手機篩選抽屜 `translateY(-110%)`，假設「自身高度的 110%」一定蓋得過 `top: 3rem`。
4. **（2026-08-19）** `#canvas-host` 寫死 `height: calc(100vh - 110px)`，而 nav ＋ footer
   實際是 124.53（桌機）／165.47（手機）——每個尺寸多出 15–55px 的捲動，捲到底時 fixed 的
   `#tree-controls` 與 nav 之間裂開一條縫。

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

## 不進版控

`docs/`（規格書、實作計畫、部署步驟、已知問題）**刻意移出版控**，只留本機，
備份在 `/mnt/data/share/Yuki/rd2-wiki-docs/`。v1 開發歷程（39 commit）在本機
`feat/v1-dice-tree` 分支，未推遠端。

## 暫時停用的功能

`src/lib/flags.ts` 的 `FEATURES` 列出「程式碼還在、只是先不讓使用者碰到」的東西，目前兩項：
導覽列的「貢獻」入口（`/about` 直接開網址仍打得開）、詳情面板 `#關鍵字` 點下去自動搜尋。
布林值一翻功能就回來（樣式與接線共用同一個開關，不會出現「看起來能點卻沒反應」）；
對應的測試斷言的是**現在**的行為，開回來時會紅，紅的那幾條會直接指出還要改哪裡。

## 已知待辦

見本機 `docs/v1-known-issues.md`（30 個延後的 Minor ＋ 開發期 35 項裁決）。最需要注意的：

1. ~~節點標籤重疊~~ **已解（2026-08-18）**：畫面上恆常只留骰子（41）與支援（5）的標籤，
   符文（123）與被動（70）改成滑過／鍵盤聚焦／被選進前置鏈時才單獨顯示（純 CSS，見
   `src/pages/tree.astro` 的 `.node ... .label` 規則）。量測依據：符文標籤平均寬 61 單位、
   最近鄰距離只有 41（比值 1.49），全顯示必然重疊（實測 27 對）；**縮字級沒用**（縮到 7px
   仍有 15 對），只留骰子與支援則是 0 對。E2E 由 `tests/e2e/tree.spec.ts` 的 M 守著
2. **只在 Chromium 驗過**，核心渲染用 `<pattern>` 這條冷門 SVG 路徑，iOS Safari 未驗
3. `slug` 已從 v1 移除，v2 做 `/dice` 圖鑑時要依 spec §7 重新設計（含人工名稱對照表）
