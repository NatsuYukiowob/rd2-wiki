# rd2-wiki

《Random Dice 2》互動式骰子樹攻略站。Astro 靜態站，部署在 Cloudflare Pages
（https://rd2-wiki.pages.dev/），GitHub `NatsuYukiowob/rd2-wiki`（public）。

## 這個專案的核心概念

資料正本是 **`data/dice-tree.svg`**——一份帶 `data-*` 屬性的 SVG（239 節點 / 248 邊），
外加 `data/icons/`（202 張 PNG，檔名 = 內容 sha256 前 12 碼）。由社群發 PR 維護，
CI 是唯一防線（維護者不可能逐行 review SVG 的 diff）。

核心功能：點一個節點 → 高亮它在 DAG 上的**所有祖先聯集**（去重、含自身、多重前置視為 AND）
→ 算出解鎖成本。

## 指令

```bash
npm run validate    # 資料驗證（9 條規則，CI 守門員）
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
- 效能預算硬斷言：`tree.json` gzip ≤ 20KB（目前 16.7KB）、sprite ≤ 400KB（目前 106KB）

## 踩過的坑

### ⚠️ 寫死的版面偏移量咬過三次

`#branch-nav` 曾寫死 `top: 6rem` 假設工具列恆 3rem 高；`#tree-controls`／`#detail` 曾寫死
`top: 3rem` 假設 nav 恆 48px 高（實際 50.59px，差 2.59px 造成右上角 1px 突出）。

**現在都改成量實際高度**（`tree-canvas.ts` 量 nav 寫進 CSS 變數 `--nav-h`）。
**動版面時不要再引入新的固定偏移量**，並且驗收要用**幾何斷言**（兩個矩形不相交、
top 差距 < 0.5px），不是看截圖。

### 資料解析

- 成本字串的分隔符是**全形斜線 `／`**（U+FF0F），全檔 0 個半形 `/`
- SVG 屬性裡的換行是 XML 實體 `&#10;`，經 DOM 解析後才變 `\n`
- **玩家被動的等級上限在 `<title>` 的最後一行**（`最高等級：N`），不在 `data-cost`；
  取「第二行」會在多行描述的節點上靜默算錯
- `#關鍵字` 標記**沒有結束符**，中文無分詞 → 必須用 `data/keywords.json` 白名單
  最長優先比對，不可用正則貪婪抓
- `stroke` 不在固定元素上：骰子在 `<rect>`、符文/支援在 `<polygon>`、被動在 `<circle>`
- 成長值單位有 `%` / 秒 / 次 / 個 / **倍** / 無單位六種，且有負值加雙符號 `(+-0.2秒)`

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

1. **節點標籤字太小**（桌機約 5px、會重疊）——可讀性下限目前是拿「圖示尺寸」當指標，
   但真正決定辨識度的是標籤。修法待 Yuki 看畫面後決定
2. **只在 Chromium 驗過**，核心渲染用 `<pattern>` 這條冷門 SVG 路徑，iOS Safari 未驗
3. `slug` 已從 v1 移除，v2 做 `/dice` 圖鑑時要依 spec §7 重新設計（含人工名稱對照表）
