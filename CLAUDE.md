# rd2-wiki

《Random Dice 2》互動式骰子樹攻略站。Astro 靜態站，部署在 Cloudflare Pages
（https://rd2-wiki.pages.dev/），GitHub `NatsuYukiowob/rd2-wiki`（public）。

## 這個專案的核心概念

資料正本是 **`data/dice-tree.svg`**——一份帶 `data-*` 屬性的 SVG（239 節點 / 248 邊），
外加 `data/icons/`（202 張 PNG，檔名 = 內容 sha256 前 12 碼）與 `data/tree-center.png`
（中央樞紐的合成圖，見下）。由社群發 PR 維護，CI 是唯一防線（維護者不可能逐行 review
SVG 的 diff）。

**版面來自遊戲內的原圖**：2026-08-18 依 `RD2骰子樹 v1.0.1`（`/mnt/data/share/Yuki/
random dice 2 dice tree/RD2骰子樹v1.0.1/dice_tree_v1.0.1_fixed.svg`）重排，座標取原圖 ×0.5
（原圖節點座標全是 20 的倍數，減半後仍是 10 的倍數）。那份原圖**只有版面、沒有任何文字資料**
（0 個 `<text>` / `<title>` / `data-name`），所以它能提供的只有座標與節點尺寸，名稱／花費／
描述一律留在本正本裡。它的圖示與現行 `data/icons/` 逐像素最大只差 1（PNG 重新編碼的捨入），
**不要拿它的圖示覆蓋現有的**——換了沒有視覺收益，只會讓 191 個檔案的雜湊全部作廢。

核心功能：點一個節點 → 高亮它在 DAG 上的**所有祖先聯集**（去重、含自身、多重前置視為 AND）
→ 算出解鎖成本。

## 指令

```bash
npm run validate    # 資料驗證（規則 0–10，CI 守門員）
npm run normalize   # 攤平 Inkscape 的圖層/matrix/相對路徑（貢獻者送 PR 前必跑）
npm run add-icon    # 新增圖示，自動用內容雜湊命名
npm run build:data  # 產出 src/generated/tree.json + public/assets/
npm run build       # build:data + astro build
npm test            # 有 pretest 自動跑 build:data
npm run e2e         # 有 pree2e 自動跑 build
```

## 不變量（改動後務必重驗）

- 節點 **239**、邊 **248**、根 5 個（`1001 2001 3001 4008 5002`）、多重前置 **14** 個
- `5201` 前置鏈 = **核心 66 ／ 金幣 23,000**（spec §6.4 基準）
- 全樹解鎖成本 = **核心 1,772 ／ 金幣 6,662,000**
- `dataIssue==='placeholder'` **4** 個、`no-growth` **5** 個
- 畫布 viewBox `0 0 2000 1700`；顯示尺寸（`SIZE_BY_TYPE`，`src/lib/taxonomy.ts`）
  骰子 46×57、符文 26×29、被動 33×33、支援 45×47
- 效能預算硬斷言：`tree.json` gzip ≤ 20KB（目前 15.7KB）、sprite ≤ 400KB（目前 132KB）

### 中央樞紐 `<g class="tree-center">`

正本裡唯一一個**不是節點**的圖形群組：遊戲內的「骰子樹」本體，五顆起手骰從它放射出去。
沒有 id、沒有花費，不參與成本計算、祖先高亮與篩選（`.node` 選擇器碰不到它）。
`data-links` 列出五條放射線接到的節點 id，`<image href="tree-center.png">` 是圖，
建置期轉成 `public/assets/tree-center.webp`（不進 sprite——sprite 依節點類型的顯示尺寸分區
打包，樞紐不屬於任何類型）。整組是**選用的**：沒有這一組時 `meta.center` 是 null、站台不畫。
CI 規則 10 守它（`<svg>` 直屬、不帶 transform、圖檔存在且解析度 ≥ 顯示尺寸兩倍、
放射線終點確實落在 `data-links` 指定節點的中心；連線與根不一致只警告）。
**注意編號**：`規則 11`＝差異摘要留言、`規則 12`＝效能預算，都是 CI 步驟不是 validate 規則。

## 踩過的坑

### ⚠️ 寫死的版面偏移量咬過三次

`#branch-nav` 曾寫死 `top: 6rem` 假設工具列恆 3rem 高；`#tree-controls`／`#detail` 曾寫死
`top: 3rem` 假設 nav 恆 48px 高（實際 50.59px，差 2.59px 造成右上角 1px 突出）。

**現在都改成量實際高度**（`tree-canvas.ts` 量 nav 寫進 CSS 變數 `--nav-h`）。
**動版面時不要再引入新的固定偏移量**，並且驗收要用**幾何斷言**（兩個矩形不相交、
top 差距 < 0.5px），不是看截圖。

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

## 已知待辦

見本機 `docs/v1-known-issues.md`（30 個延後的 Minor ＋ 開發期 35 項裁決）。最需要注意的：

1. **節點標籤在密集區會重疊**——2026-08-18 換版面後字已經看得清（圖示與標籤都放大了），
   但新版面的節點間距相對節點尺寸比舊版緊（節點寬/間距從 0.30 變成 0.46，原圖本身就沒有
   標籤），符文叢集處的標籤仍會互相壓到。可讀性下限目前是拿「圖示尺寸」當指標，但真正決定
   辨識度的是標籤。可能的修法：依縮放層級決定顯不顯示標籤、或縮小字級。待 Yuki 看畫面後決定
2. **只在 Chromium 驗過**，核心渲染用 `<pattern>` 這條冷門 SVG 路徑，iOS Safari 未驗
3. `slug` 已從 v1 移除，v2 做 `/dice` 圖鑑時要依 spec §7 重新設計（含人工名稱對照表）
