# rd2-wiki

《Random Dice 2》骰子樹非官方（fan-made）玩家攻略站。收錄全部節點（骰子、骰子符文、
玩家被動、支援效果）、解鎖成本與前置關係，讓玩家在花費核心／金幣解鎖前，先看清楚整棵樹再規劃路線。

本站與遊戲開發商 111%（111 Percent Inc.）無隸屬關係，詳見〈授權〉一節。

## 現況

純靜態站台（Astro 5）。資料管線、站台骨架與骰子樹畫布（`/tree`：平移縮放、選取／前置鏈高亮、
搜尋篩選、詳情面板、手機版面）皆已完成並合併，[線上編輯器](https://rd2-wiki.pages.dev/edit) 也已上線——
**不需要安裝任何東西**，開瀏覽器就能修正資料、加節點、換圖示，一鍵送出 PR。

## 開發

需求：Node ≥ 24（ESM、TypeScript strict）。

```bash
npm install
npm run dev      # 先產生資料，再啟動本機開發伺服器
```

`npm run dev` 與 `npm run build` 都會先執行 `npm run build:data`，把 `data/dice-tree.svg`
與 `data/icons/` 解析、轉換成網站實際使用的產物：

- `src/generated/tree.json`——節點與連線的結構化資料
- `public/assets/sprite.webp`、`public/assets/icons/*.webp`——圖示資產

這些產物不進 repo（見 `.gitignore`），每次建置都會重新產生。

### 常用指令

| 指令 | 用途 |
|---|---|
| `npm run dev` | 本機開發伺服器 |
| `npm run build` | 產出 `dist/`（先跑 `build:data` 再 `astro build`） |
| `npm run test` | 執行單元測試（Vitest） |
| `npm run e2e` | 執行端對端測試（Playwright，第一次跑前需 `npx playwright install --with-deps chromium`） |
| `npm run validate` | 跑 CI 會用的同一套資料驗證規則 |
| `npm run normalize` | 把 Inkscape 等 GUI 工具重寫過的 `dice-tree.svg` 攤平回正規形式 |
| `npm run add-icon <path>` | 新增圖示，自動用內容雜湊命名歸檔進 `data/icons/` |

## 資料從哪裡來

網站呈現的骰子樹資料，正本只有兩處，也是唯二需要手動維護的地方：

- `data/dice-tree.svg`——整棵骰子樹的節點與連線（239 個節點）
- `data/icons/`——對應的圖示 PNG（202 張，檔名為內容 sha256 雜湊前 12 碼）

其餘資料（`data/keywords.json` 效果關鍵字白名單、`data/unlock-exceptions.json` 解鎖規則例外）
是輔助這兩份正本的設定檔。想動手修正資料或新增節點，請先讀
[`CONTRIBUTING.md`](./CONTRIBUTING.md)——它同時是貢獻指南，也是網站
[/about](/about) 頁面的內容來源。

## CI 與部署

PR 送出後會自動跑資料驗證、單元測試、建置、效能預算與端對端測試，並在 PR 底下貼「資料差異
摘要」留言（詳見 [`CONTRIBUTING.md`](./CONTRIBUTING.md) 第 5、6 節）；`main` 分支的變更會
自動部署到 Cloudflare Pages。Cloudflare Pages 專案本身要在網頁介面手動建立，設定步驟見
維護者自行保存的部署文件。

## 授權

- **程式碼**：[MIT License](./LICENSE)
- **`data/` 內的遊戲圖示與效果文字**：著作權屬 111 Percent Inc.，詳見
  [`data/NOTICE.md`](./data/NOTICE.md)。本站僅整理呈現遊戲內公開內容，不主張這些素材的著作權。
