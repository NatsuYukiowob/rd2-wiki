# 頁面（src/pages/ 各頁的契約）

頁面的腳本在 `src/scripts/`、樣式在 `src/styles/`，改那些檔時也適用本檔；全站規則見 repo 根目錄 `CLAUDE.md`。
每條只留結論＋檔案指標＋守它的測試；成因與實測數字在該處的程式碼註解裡。

## 跨頁共通

- **「文字進得了 HTML」是靜態頁存在的理由**：多個檔位／模式的文字**全部輸出進 HTML**，切換只換顯示哪一段
  （純 CSS 或 `hidden`），不用 JS 換 `textContent`。`/dice` 數值面板、`/tactic` 模式、`/guide/keywords` 分類、
  `/rewards` 分類同一判準。
- **驗「只看得見一段」的斷言要加 `useInnerText: true`／量可見性**：`toHaveText` 預設讀 `textContent`，會把
  `display:none` 的其他段一起讀進來，而 `/攻擊力\s*150/` 這種樣式照樣通過（`tests/e2e/codex.spec.ts` 註解）。
- **`display: grid|flex` 的元素要自己補 `[hidden] { display: none }`**：作者樣式壓過 `[hidden]` 的預設值，
  少了它篩掉的項目仍在畫面上而計數已扣掉。現存：`.battle-item[hidden]`、`.dice-card[hidden]`、
  `.battle-group-head[hidden]`、`.battle-list[hidden]`。
- **來源長寬比不統一的圖一律 `object-fit: contain`**（`/board` 四個顯示點、`.battle-icon`）；改 `cover`
  CI 全綠而畫面裁角。唯一刻意用 `cover` 的是 `/events` 索引縮圖（`events.css` 註解）。
- **「遊戲介紹」下拉裡的頁（`/guide`／`/tactic`／`/boss`／`/rift-shop`／`/events`／`/rewards`）都要列進
  `Base.astro` 的 `guideCurrent`**，否則下拉收合時導覽列零提示。B6 守。
- **畫面不印編號與內部 ID，但資料檔要留**：`id` 是錨點與 validate 規則的鍵，`gameId` 是對新版資料表的
  join key。T1b 量 `main` 的 `innerText`（屬性裡的 id 留著是對的）。
- **外觀用共用元件（`.btn`／`.seg`／`.step`／`.panel`）**，不要寫回 `#board-tools button`、`#sim-toolbar button`
  這種 id 選擇器——(1,0,1) 會安靜壓過 (0,1,0) 的共用 class。長相由 `board-look.spec.ts`、S30／S31 守。
- **新增或移除一個頁面（含每場活動）要改 `tests/e2e/seo.spec.ts` 的 `PAGES`**：它跟 sitemap `<loc>` 完全相等比對。
- **量圖有沒有載到不要用 `naturalWidth`**（`loading="lazy"` 畫面外還沒載）；B5 逐個網址發請求。

## /tree

選節點時畫布緩動平移把節點帶到水平中央，卡片貼在節點**正上方或正下方**（手機是底部抽屜，本段不適用）。
渲染在 `src/components/NodeDetail.ts`，擺位／堆疊／動畫／歷史在 `src/scripts/tree-canvas.ts`。

- **決策：擺上或擺下由 `sideLeastCovered()` 算，不要寫死一邊**——五個分支生長方向不同，寫死任一邊都有兩系
  前置鏈被整條蓋掉。高度上限用「卡片那一側到畫面邊緣」算（不是整窗），低於 `MIN_PANEL_H` 才換邊；置中多留
  `CENTER_SLACK` 吸收打字長高。
- **節點螢幕位置一律問 `tree.nodeScreenRect(id)`**（canvas 裡沒有節點元素）；畫布每動一幀經 `onViewChange()`
  重新定位卡片。
- 置中平移期間卡片釘在終點；`cancelCenterPan()` 只掛在真的會動畫布的路徑上。桌機卡片橫式兩欄
  （`.node-body > .col`／`.col.chain`），手機單欄。
- E2E：**N**（置中＋垂直緊鄰）、**N2**（不蓋前置鏈）、**N3**（平移期間卡片不動）、**N4**（兩欄）、
  **N5**（Enter 也置中）、**N6**（打字與拖曳不壓到節點）。

### 詳情面板＝視圖堆疊

**決策：點 `#關鍵字`／「骰子覺醒」是同一張卡片裡左滑換頁，不是浮動彈出層，也不是自動搜尋**（舊的 `keywordSearch` 與雙用途 class `.kw-clickable` 已移除，搜尋改成詞彙頁上看得見的「搜尋 #X」按鈕；不要加回）（手機抽屜沒有彈出空間，換頁位置不變、
巢狀關鍵字同一機制）。事件全委派在 `#detail`（每次整段重寫 innerHTML）；**系統上一頁＝卡片返回鍵**（每推一層
`pushState`，網址不變）。以下每條都有 E2E **Z／Z2／Z3／Z4** 釘著，成因在 `tree-canvas.ts` 註解：

1. 退歷史一律走 `afterHistoryUnwind(run)`（`history.go()` 非同步，且每筆紀錄記著推入時的網址）。
2. 上一段動畫的收尾必須在決定 from／to 之前跑。
3. 換頁後 `focusView()`；E2E 驗「焦點所在視圖的**標題**」，不是「焦點在某張視圖裡」。
4. 面板重繪走 `resetViewStack()` → `afterHistoryUnwind(syncUrl, depth)`；**驗這件事一定要驗網址**，只驗
   `history.state` 深度看不出來。
5. 換節點用 `abortSlide()` 不是 `finishSlideNow()`，但 `panel-sliding` 一定要拿掉；驗它用**當下讀一次**的
   `getAttribute('class')`，不用重試型的 `not.toHaveClass()`。
6. 抽屜的 Esc 監聽要 `stopImmediatePropagation()`（`stopPropagation` 不夠）。

**換頁過渡不抖的五個條件**（Z4 逐條守）：`.sliding` 在量起始高度前掛上且只由 `slide()` 掛；`overflow: hidden`
常駐在 `.stack`；動畫幀同時 `positionPanel({ assumeHeight })`；餵給 `positionPanel` 的是**整張卡片**高度不是
`.stack` 的；終點高度用 `getBoundingClientRect().height` 不用 `offsetHeight`（整數化會越過落點，Z4 門檻 0.3px）。
驗這類事要**頁面內 rAF 逐幀取樣**，同時驗「不越過頭尾」與「逐格同方向」。`#detail` 兩軸 overflow 都要非
visible（`overflow-x: hidden` 明寫，`detail.css`）。

## /dice 與 /guide

- **決策：`/dice` 只收骰子本體（`type === 'dice'`）**，符文／被動／支援不進圖鑑（不要改回）——它們是強化，
  混進網格會稀釋真正的骰子。
- **卡片圖是 3D 立體骰子圖（`data/dice3-icons/`，規則 30），不是節點圖**。`<img width/height>` 寫的是 CSS 方框
  （`src/lib/dice-icon.ts` 的 `DICE_CARD_ICON_PX`，與 `dice.css` 的 `3rem` 由 `tests/styles/dice-icon.test.ts` 比對），
  不是圖檔尺寸。縮圖上限走 `DICE3_ICON_TARGET_PX`，**不要沿用 `/board` 的 240**——這頁不在規則 12 的效能預算裡，
  漲了沒人會說話。
- **`/guide/keywords` 是全部詞彙一頁、上方按鈕切分類**；舊四頁由 `public/_redirects` 301 到 `?tab=<slug>`
  （`serve dist` 不讀 `_redirects`，只能在正式站驗；KW5 只驗產物）。站內 `#關鍵字` 一律連
  `/guide/keywords#<code>`，頁面腳本要從錨點反查分類（初次載入與 `hashchange` 都要）。
- **分類依據是官方色碼**（`keywords.json` 的 `color`，清單 `src/lib/glossary-groups.ts`）；頁面要註明分組不是
  本站判斷、只有組名是。沒見過的顏色 `buildGlossary()` 直接丟例外（不要放行）。算條數不要用 `index.byTerm.size`
  （別名指到同一筆）。
- **關鍵字顏色查 `index.byTerm` 不查 `displayGlossary()`**（後者不含別名）；`usedBy` 先把別名收斂成本尊再去重。
- **斷詞器只有一份**：`src/lib/markup.ts` 的 `renderTaggedText()`，差別由呼叫端傳 `renderTerm`。不要複製第二份。
- **卡片裡點 `#關鍵字` 就地換成解釋、不跳頁**：卡片高度不動（同列卡片會被推動）、不列出用到的節點（只給
  `/tree?q=<詞>`）。解釋在建置期渲染進 `#codex-terms`，放在 `<div hidden>` 的文字內容裡，**不是
  `<script type="application/json">`**（`</a>` 會讓 Astro build 失敗）。
- 卡片本文包在 `.dice-card-main`，CSS **不可用 `.dice-card > header` 這種子代選擇器**；裁切靠 `.dice-card` 與
  `.card-term` 兩層 `overflow: hidden`（C3）。同時只准開一張卡片的詞彙層（`dice.astro` 的 `openCard`，C3c）。
  量過場要在動畫進行中取樣（收尾後 `transitionDuration` 恆為 `0s`）。
- **決策：數值面板是純 CSS（`.dice-stats:has(input:checked)` ＋ radio），不要改成 JS**（理由見 `DiceCard.astro`
  註解：文字進 HTML、不跳版、一組 radio 一個 Tab 停留點）。不變量：
  - radio `name` 帶節點 id（`stat-mode-${node.id}`），否則全頁變同一組。C10 守。
  - `@supports not (selector(:has(*)))` 只留基礎值、收掉切換鈕。
  - 固定項目只印一份（`.stat-fixed`，`isFixed()`）。
  - 四個值疊在同一 grid 格（`.stat-v { display: inline-grid }` ＋ `grid-area: 1/1` ＋ `visibility`），**不可改回
    `display: none`**——那是 pill 寬度穩定的唯一來源，改了會撐高同列鄰居。**C8 掃全部卡片 × 四檔位**；量高度
    不要用 `toBe`（浮點尾數）。
- 圖鑑卡片是 `DiceCard.astro`，刻意不重用 `/tree` 的 `nodeViewHtml()`。這幾頁建置期直接讀 `data/`，不吃
  `tree.json` 的 gzip 預算。

## /board

內容不可索引，價值全在互動。**刻意不做（不要「順手補回」）**：戰鬥／機率模擬、合成、網址編碼、**寫入**
`localStorage`（`board.astro` 開頭同一份注解）。重整回到空骰盤、強化 Lv 回 1 是刻意的。局外加成**唯讀** `/sim` 的存檔。

- **數值卡片**：依「該格骰點 × 同種骰子的局內強化 Lv」算，參數從 `dice-stats.json` 四檔反推（`src/lib/dice-calc.ts`，
  規則 23(i) 守）。強化 Lv 以**骰子種類**為鍵（`spLevels`），不是槽位。開卡片不綁 click，在 `endDrag()` 判斷
  「從格子起手、沒超過位移門檻」；鍵盤走 `focusin`＋`:focus-visible`；卡片 `pointer-events: none`。
- **局外加成**：`#offgame-mode` 三段「不含｜我的 /sim｜全滿」；「我的 /sim」走 `/sim` 同一支 `deserializeSim()`
  （吃 `SaveContext`），建置期用 `src/lib/sim-save-lite.ts` 壓成索引編碼嵌進頁面。`/sim` 存檔換鍵名 → `/board`
  退回「不含」是預期。攻擊力格式照遊戲面板 `局內值 (+加成)`；「不含」且無盤面加成時卡片與一期逐字相同（單元測試釘住）。
  `/sim` 在頁面開著時改存檔會跟上但不自動切模式（B33）。
- **明細面板 `#dice-detail`**：寬桌機在骰盤右側、手機在最底。`.board-stage` 在手機是 `display: contents`（骰盤與
  工具列要參與 `.board-page` 的 flex `order`）；寬桌機面板 `contain: size`；`.detail-box` 用
  `max-height: min(100%, …)` 否則 sticky 失效（B32）。
- **盤面加成**：`src/lib/board-buffs.ts` 算，合進卡片同一個 `(+x)`（`bonusCardModel()` 的 `BoardBonus`）。不受局外
  「不含」影響，但盤面符文跟著模式。施加者數值一律讀施加者自己局外加成後的值（`rowValue()`）。隨機方向／種類的
  角標（`.cell-badge`）走 `cycleAt()`，**不可走 `renderBoard()`**（會收掉卡片）。
- **合作模式**：跨盤排序方向兩盤相反（隊友盤 ↓、我的盤 ↑），方向由呼叫端傳 `BuffInput.partner.crossDir`（**沒有預設**）；
  兩份傳同一值會有一盤靜靜不生效。
- **骰子圖是「純骰子圖」，跟節點圖平行的另一條資產路徑**：`data/board-icons/` ＋ `data/board-icons.json`，
  `npm run add-icon -- --board <id> <png>` 一次更新兩邊，`tools/lib/icons.ts` 的 `buildBoardIcon()` 轉 webp，規則 21 守。刻意不套
  `withGutter()`（那是 canvas 圖集取樣用的）。
- **四個顯示點**（`.board-cell img`／`.deck-dice img`／`.picker-dice img`／`.drag-ghost`）`object-fit: contain`，
  `tests/lib/board-image.test.ts` 讀 `board.css` 釘住。分享圖（`board-export.ts`）用 `src/lib/board-image.ts` 的
  `iconRect()` 等比置中；`imgW`／`imgH` 刻意必填；`ratio` 預設 0.78 與 `.board-cell img { width: 78% }` 由測試比對。
- `board.ts` 的 `diceMeta` 從 `#dice-picker` 的 `<img src>` 讀回，不維護第二份路徑。

## /tactic 與 /boss

戰術與 Boss 都不是骰子樹節點，資料與圖示各走平行路徑（規則 24／25）。建置期直接讀 `data/`，`tree.json` 不變。
`/boss` 分一般／困難兩組各一個 h2，Boss 名稱是 **h3**（`/tactic` 是 h2，共用 `.battle-name` 所以字級不變）。
**lede 的數量從資料算**。B1／B1b 守。

- **決策：入口在「遊戲介紹」下拉，不在導覽列頂層**（它們是「遊戲有什麼」的說明，不是互動工具）。
- **決策：橫列清單不是卡片網格**（效果文字長度差很多，網格會讓同列高度參差）。
- **模式是三個原生 radio：合作一般／合作困難／對戰，預設合作一般，永遠單選**。可用與否只看 `availability`
  （`src/lib/tactics.ts` 的 `tacticMatches()`，頁面與腳本共用），選中模式寫進 `#tactic-page` 的 `data-mode`；
  兩段文本都進 HTML，CSS 看 `data-mode` 決定顯示哪段。卡片只印階段不印模式。T4、T5 守（T5 量可見性與可見條數）。
- **四個階段是獨立 checkbox 預設全選**；「全部」只在四個都勾時亮，按下去是全選時清空、否則全開
  （`toggleAllTacticStages()`），不是逐項反轉。T6 守。`#tactic-empty` 是篩到零筆的提示。
- **`69` 的子選項收在父卡裡的原生 `<details>`**，不另算筆數、沒有自己的階段；計數與篩選只看 `#tactic-list` 的
  直屬子項。T7 守。
- `.battle-icon` `object-fit: contain`，B5 守。

## /rewards

**決策：純瀏覽——不追蹤個人進度、沒有勾選或輸入框、不寫 localStorage（不要補回來）。**

- 每個分類頂端印「全部領完可獲得」：`src/lib/rewards.ts` 的 `modeRewardTotals()` 建置期加總，拆固定貨幣與收藏型；
  收藏品照類別排、類內保留首次出現次序，多件才印 `×N`。重複性獎勵不印總計。
- **門檻由小到大**（`sortedRewardTiers()`，遊戲領取順序）。
- 分類切換：桌機左側按鈕、≤720px 原生 `<select>`，切同一個面板。**HTML 裡的面板全部不帶 `hidden`**（沒 JS 時全攤開，
  CSS 看 `.rewards-page[data-js]`）。RW9 守。
- **`RewardGrant.astro` 整段 `aria-hidden`**，讀屏數量靠外層：階段列 `<li aria-label>`、總計 `<dd>` 裡的 `.sr-only`。
  改版面兩條都要留。
- 單件收藏品不印「1」（`rewardAmountVisible()`），貨幣一律印數量。每日任務等 `<details>` 預設收起。
- 成就群組的表頭要用同寬 `margin-inline` 對齊清單多出的 `--space-2` 內距。RW8 守。

## /rift-shop

合作困難模式的局內商店，依**階級**分三組，版面共用 `battle.css`、分組抄 `/boss`（規則 27）。沒有模式切換鈕。

- **價格逐條印**（同階級有不同價）；組標題印該組價格集合（`[...new Set()]`）。
- **決策：權重只印在組標題**（同階級固定值）；`weight` 仍留在資料檔（規則 27(i) 的鍵）。
- 篩選選擇器要指名 `.battle-group-head[data-grade], .battle-list[data-grade]`，不能只寫 `[data-grade]`
  （每條 `.battle-item` 也帶 `data-grade`）。
- 討伐硬幣圖走 `currencyIcon('tacticcoin')`，不另寫 `<img>`。

## /events

`/events` 是索引（一場一張小卡），內容表在 `/events/<id>`（`src/pages/events/[id].astro`）。

- **決策：分頁不是就地展開**——`<details>` 收合只是視覺，索引會跟著每場活動變重。**EV2 守：索引頁 HTML 不准出現
  `<table>` 或任何一格內容。**
- 新增／移除活動要改 `seo.spec.ts` 的 `PAGES`（見跨頁共通）。
- 版面不知道每一欄的語意（通用表格），沒有篩選器，新活動只加資料。**資料出處不上站**（檔期只印日期）。
- `.event-table-wrap` 要有 `max-width`；窄螢幕捲的是表格容器自己且要 `tabindex="0"`（同 `/board` 的 B13）。EV8 守（自己撐寬一格再量）。
- 「同一欄有沒有圖」建置期算（`iconCols` → `.pad-icon`），不是 `:has()`。
- `<img width/height>` 從資料讀（`EventShot.width`／`height`），不寫死。索引縮圖 `alt=""`（裝飾）＋ `object-fit: cover`；
  內容頁同一張 `alt`＝圖說。

## /sim

逐顆解鎖、調等級，即時算核心／金幣／超越核心，對照玩家填的**持有資源**列出差額（輸入框 `sim-limit-*` 由 `sim.astro`
依 `MYTHIC_CORES` 產生，id 沿用舊名；`resourceGap()` 收 `SimHoldings`，`#sim-gap` 只列有填的）。

- **刻意不做**：戰鬥／機率模擬、骰子強度評分、網址編碼分享、分支點數統計。
- **決策：進度存 `localStorage['rd2-sim-v1']`**（與 `/board` 刻意不存相反）。格式改了就換鍵名，不寫遷移。
  另兩份：`rd2-wiki:sim-holdings`、`rd2-wiki:sim-panel-h`——**不要塞進 `rd2-sim-v1`**（`/board` 讀那份）。
  跨分頁靠 `storage` 事件、bfcache 靠 `pageshow`。S44／S45 守。
- **算術全在純函式層**（`src/lib/sim.ts`／`sim-io.ts`／`upgrade-tiers.ts`），`src/scripts/sim.ts` 只畫與翻事件；
  每個操作回傳新狀態，undo／redo 推整份狀態。`maxSelectableLevel()` 只查 `ctx.caps`——要改哪些節點能升級改
  `levelTableFor()`，兩頁一起跟上。
- **畫布與 `/tree` 共用 `mountCanvasTree(host, data, { obscurers })`，沒有「這是 /sim」的參數**（`obscurers` 各頁量自己的浮層，量法共用 `src/lib/canvas/obscurers.ts` 的 `visibleRects()`）。差異全部由 `setState({ sim })`（`SimPaint`）
  表達——**不要在 `painter.ts` 開分支，也不要在 `MountOptions` 加旗標**。`/tree` 專屬行為在 `tree-canvas.ts`。
- 狀態色與邊在 `src/lib/canvas/state.ts`（`nodeAlpha`／`edgeAlpha`／`edgeColor`）；`nodeAlpha()` 裡搜尋淡出要排在
  選取與未取得**前面**。等級牌是畫的，透明度吃 `nodeAlpha()` 不寫死 1。
- **決策：「可取得」的節點不發光不變亮**（會誤導成已取得）；下一步只由 `ready` 邊表達。
- **邊三階**：沒到手暗、兩端都在手上正常亮度（`edgeIsLinked`）、真的走過再加金色（`edgeWasUsed`，前者的子集）。
  `src/lib/sim.ts` 測試守包含關係，畫面由 S18 守。
- **可選初始骰子只能勾、不能在樹上點**，判準從資料推導（`unlockVia` 非 cost 非 default 且無 `unlockPaid`），不硬編 id。
  「一鍵點亮」遇到沒勾的初始骰子**一顆都不解**（`pathTo()` 回 `need: []`）。
- 能力彙總的分組判準是「這個名稱在整份資料裡跨不跨系」，不是目前解了哪幾顆；沒有 `growth` 的節點不硬湊數字。
- **決策：持有資源只算、不擋**（`applyState()` 不看持有量，差額只在 `renderTotals()` 畫進 `#sim-gap`）。不要加回擋操作。
  S6、S16 守。
- 點了還不能取得的節點，畫面仍要跟著 `selected` 重畫。S20 守。
- **拖曳等級滑桿時不可重建面板**：`input` 走 `applyState()` ＋ `updateLevelReadout()`，`change` 才推 undo 並完整重畫。
  驗要用**真滑鼠拖曳**（`fill()` ＋ `dispatchEvent('input')` 繞過這條路徑，S3 因此假綠過）：S17 真滑鼠、S17b 驗元素沒被換掉；手機觸控拖曳原生 range
  Playwright 驅動不了，只能真機驗。
- 焦點框畫在互動層（`painter.ts` 的 `focusRingPath()`，宣告形狀的近似框）；透明度走 `focusAlpha()` 不走
  `nodeAlpha()`，狀態造成的暗不吃掉焦點框。S15 ＋ `painter.test.ts` 守。
- **`#sim-toast` 是唯一的 `role="status"`，不可以用 `hidden` 收放**（清空 `textContent` ＋ CSS `:empty`）。S19 守；
  手機版浮在抽屜上緣之上（S26）。
- 鍵盤與讀屏：`aria-description`／`aria-current` 寫在 `sim.ts` 的 `syncButtons()`，**不動 `a11y.ts` 與 aria-label**
  （/tree 共用、也是 E2E 選取器）。S35／S38 守。
- 桌機側欄寬只有一份 `--sim-panel-w`（`#sim-panel` 寬與 `#sim-toolbar` `max-width` 都讀它，S36）；`fitAll()` 扣掉側欄（S37）。
- **匯出圖片**：內容版面 `src/lib/sim-image.ts`、畫圖 `src/scripts/sim-export-image.ts`；完整版直接呼叫 `drawStatic()`，
  狀態走 `simPaintFor()` ＋ `exportPaintState()`，**不要為匯出在 `painter.ts` 開分支**，走過的邊只改
  `src/lib/sim-paint.ts`。出圖前 `AssetStore.settled()`；像素要 < `IOS_MAX_CANVAS_AREA`（`sim-image.test.ts`）。S32–S34 守。
- **E2E 挑節點挑「初始就可解鎖」那幾顆**（前置只有起始骰子），座標問 `window.__tree.nodeScreenRect(id)` 再用真滑鼠點；
  安全點擊區兩個方向都要算，且只扣現在真的看得見的遮蔽物（`sim.spec.ts` 註解）。

### /sim 手機版（≤720px）

畫布佔比由 **S24** 釘住（360／390／414 三視口）。

- **工具列＝從下緣升起的 sheet**，入口是右下兩顆浮動鍵（🔍 只升搜尋列、⋯ 升整份）；DOM 順序與桌機相同。**不准**改成
  `overflow-x: auto` 橫捲列。過場只掛在 `.is-open` 那一側（`visibility` 進 transition 過不了 `tokens.test.ts`）。
- `.sim-menu-body` `max-width` 夾到視口，手機版 `position: static` 就地展開。S25 守。
- **側欄＝可拖曳高度的抽屜**：下限是**量**把手的實際高度（不在 JS 寫第二份），上限 `panelMaxH()`（80dvh 且留得下浮動鍵，S40）。
  偏好存兩個值 `{h, open}`（`writePanelPref`），記憶體 `openPanelH` 與存檔分別驗。S27 守（含「收合 → 重整 → 展開」）。
  抽屜直接子項 `flex: none`；下內距放最後一個孩子。
- 選了節點撐到剛好露出主按鈕（`revealDetail()`），只長不縮、**不寫回偏好**；底下只留 `CTA_BOTTOM_GAP`，不加
  `panelMinH()`；夾到上限時用捲動補。**S26 在 375×568 掃全部節點**，不寫死 id。撐高後被選節點由 `revealSelected()` 用 `tree.visibleShift()` ＋
  `src/lib/canvas/animate-pan.ts` 挪開（S39）；系統撐出的高度不記成展開高度（`systemOpened`，S42）。
- 浮動鍵 `bottom` 綁 `--sim-panel-h`；**S27 用 `elementFromPoint` 驗點得到**，不是 `.click()` 沒 timeout。
- `#sim-scrim` 的 `z-index` 必須低於 `#sim-fabs`、高於抽屜。S29 守。
- 著作權在 ≤720px 由 `syncCredit()` 搬進抽屜最底；S12 驗「在抽屜裡、捲到底讀得到」（刻意推翻舊斷言，不是回歸）。
- **拖曳刻意不用 `setPointerCapture()`**，所以兩件事不能省：接 `pointercancel`（S28 用合成事件守）、`pointermove`／`pointerup`
  比對 `pointerId`。
- E2E 碰工具列控制項前先 `openTools(page)`；`tapNode()` 會自己 `closeTools()`。`chrome.spec.ts` 的 D18 取樣排除
  `#sim-sheet-close` 並先升起 sheet。
