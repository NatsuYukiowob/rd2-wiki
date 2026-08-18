# rd2-wiki

《Random Dice 2》互動式骰子樹攻略站。Astro 靜態站，部署在 Cloudflare Pages
（https://rd2-wiki.pages.dev/），GitHub `NatsuYukiowob/rd2-wiki`（public）。

## 這個專案的核心概念

資料正本是 **`data/dice-tree.svg`**——一份帶 `data-*` 屬性的 SVG（239 節點 / 248 邊），
外加 `data/icons/`（202 張 PNG，檔名 = 內容 sha256 前 12 碼）。由社群發 PR 維護，
CI 是唯一防線（維護者不可能逐行 review SVG 的 diff）。

核心功能：點一個節點 → 高亮它在 DAG 上的**所有祖先聯集**（去重、含自身、多重前置視為 AND）
→ 算出解鎖成本。

## Commit 訊息

```
<type>: <一句話>
```

單行、中文、**≤ 50 字元**（中文約 20 字）、**不寫 body**。只說「做了什麼」，**不解釋「為什麼」**
——why 寫在程式碼註解裡（這個 repo 的註解密度本來就高、刻意用註解保存踩坑成因），
commit 再寫一次是重複，而且那份重複會隨程式碼演進而過時。

type：`feat` / `fix` / `refactor` / `test` / `docs` / `ci` / `chore`

```
好    fix: encodeAttributeNewlines 跳過註解與 CDATA
太長  fix: encodeAttributeNewlines 讓狀態機認得註解／CDATA／PI／DOCTYPE，避免誤編碼元素內容換行
```

**唯一例外：把整個功能壓成一顆的 squash commit 要寫 body。** 個別 commit 被壓掉之後，
body 是這個功能唯一的內容記錄——標題仍維持一句話、≤ 50 字元，body 另起一段條列改了什麼。
格式參照 v1 的 `feat: rd2-wiki v1 — Random Dice 2 互動式骰子樹攻略站`。

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

## 線上編輯器（/edit）

- 設計文件：本機 `docs/superpowers/specs/2026-08-18-rd2-wiki-online-editor-design.md`
- **正本仍是 `data/dice-tree.svg`**，編輯器對它的「原始字串」做行區塊替換，不重新序列化
  ——整檔 diff 會讓維護者失去審查能力（CI 是唯一防線，但 CI 之後還是要有人看）
- 規則邏輯在 `src/lib/`（`svg-parse` / `build-tree` / `validate-rules`），DOM 與圖示來源都是
  注入的，Node 端在 `tools/` 各有一層薄包裝。**改規則時改 `src/lib/`，不要改 `tools/`**
- 讀「作者輸入的文字」屬性（`data-name`／`data-description`／`data-cost`⋯）一律用
  `getAttributeNode(name)?.value`，**不要用 `getAttribute(name)`**——linkedom 對具名實體
  （`&amp;`／`&lt;`）不解碼、Chromium 會解碼，兩邊讀出來的值不一樣（完整根因見
  `src/lib/svg-parse.ts` 與 `src/lib/validate-rules.ts` 開頭的註解）
- 屬性值內的換行要寫 XML 實體 `&#10;`，`<title>` 元素內容內的換行則寫字面換行——XML 規範
  要求 parser 把屬性值內的字面換行正規化成空格，Chromium 遵守、linkedom 沒有；編輯器產生
  的輸出也必須維持這個不變量（見下面「踩過的坑」的「資料解析」一節）
- 規則 0/1/3/5 對編輯器使用者不可能違反（產出即正規形式、`<title>` 由 `data-*` 生成、
  stroke 由分支反查、邊端點取自節點中心）
- **`src/lib/svg-emit.ts` 的逃逸邏輯，規格是「輸出必須逐字等於 linkedom 序列化器」，不是
  「合法 XML 就好」**——CI 的守門條件是 `normalizeSvg(檔案) === 檔案`（`.github/workflows/
  ci.yml` 的正規化定點檢查），`normalizeSvg` 內部用 linkedom 解析、重新序列化。從 XML
  規範第一原理推導逃逸字元集合（「屬性值要處理 `&``<``"`，內容只需要 `&``<`」）會漏掉
  linkedom 實際還會轉的 `>`／`U+00A0`（屬性值另外還有 `\r`，那是 `normalizeSvg()` 的
  `encodeAttributeNewlines()` 後處理層轉的）——這正是 2026-08-18 全分支審查抓到的
  Critical bug：這幾個字元在現行 239 節點資料裡出現次數皆為 0，往返測試完全遮蔽不到，
  玩家一旦在欄位打進 `>` 或貼上 NBSP，emitter 產出的檔案就不再是 CI 的定點，PR 送出後 CI
  才會失敗，玩家在編輯器裡完全看不出原因。下次要改這裡的逃逸規則：先用
  `tests/lib/svg-emit.test.ts` 的 property test（拿一組對抗性字元跑
  `normalizeSvg(out) === out`）驗證，不要只憑 XML 規範推導字元清單
- **fixpoint 不等於雙 parser 一致——這是兩個獨立的不變量，要分開驗。**
  `normalizeSvg(檔案) === 檔案` 只保證「linkedom 讀進去再寫出來不變」；它**不保證** Chromium
  與 linkedom 讀出同樣的值。字面 TAB 就是一個 fixpoint 成立、雙 parser 卻不一致的實例
  （見 `docs/v1-known-issues.md`）。`tests/lib/svg-emit.test.ts` 的 property test 只斷言
  前者，**不要把它當成後者的保證**。
- **`/edit` 的信任邊界**：`functions/api/github/submit.ts` 收到的 `body.summary`（PR 標題／
  內文摘要）完全由玩家瀏覽器算出、伺服器不重算也不驗證，任何人可用 curl 送一份「整份改寫的
  svgText ＋ 宣稱只改了 1 個節點的 summary」——`renderPrBody()` 已經在內文開頭加了一行
  「摘要未經伺服器驗證」的說明，維護者該信任的是 CI 自動貼的差異摘要留言（`tools/
  diff-summary.ts`，規則 10），不是線上編輯器組出來的 PR 內文。節流（`lastSubmitAt`）存在
  使用者自己持有的 cookie 裡，用 curl 保留舊 cookie 重放就能繞過——這只防得住「不小心連點
  兩次」，**硬性防護必須另外在 Cloudflare 儀表板對 `/api/github/submit` 設 Rate Limiting
  規則**，沒設的話濫用防護等於不存在
- `functions/api/github/*` 是 Cloudflare Pages Functions；GitHub token 只存在加密的
  HttpOnly cookie，永遠不進瀏覽器 JS
- `functions/` 與 `src/` 是兩個不同的執行環境，型別檢查分兩套：`npx tsc --noEmit`（根
  tsconfig，瀏覽器 DOM lib）與 `npm run typecheck:functions`（`functions/tsconfig.json`，
  `@cloudflare/workers-types`）。**不要把 `functions/` 併回根 tsconfig**——
  `@cloudflare/workers-types` 的全域 `Response`／`Element` 會跟瀏覽器端 DOM lib 的同名全域
  型別衝突（`functions/tsconfig.json` 開頭有完整根因記錄，實測過會讓 `src/` 的 DOM 程式碼
  炸開一堆型別錯誤）
- 本機跑 Functions：`npm run build && npm run pages:dev`（需要 `.dev.vars`，不進版控）
- 要讓 `/edit` 的「送出 PR」功能運作，必須先在 GitHub 建一個 OAuth App（Authorization
  callback URL 設成 `<部署網址>/api/github/callback`，scope 只要 `public_repo`），並在
  Cloudflare Pages 專案設四個環境變數：`GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET`、
  `SESSION_SECRET`（任意長隨機字串，加密 session cookie 用）、`UPSTREAM_REPO`（形如
  `NatsuYukiowob/rd2-wiki`）。沒設的話 `/edit` 的「下載 SVG」仍能正常使用，只有「送出 PR」
  會失敗
- **部署清單再加一項：必須在 Cloudflare 儀表板對 `/api/github/submit` 設 Rate Limiting
  規則**（I6）。這個端點自己的節流（cookie 存 `lastSubmitAt`）只防得住「不小心連點兩次」，
  對願意帶 curl 重放舊 cookie 的人完全無效——沒設這條規則，`/edit` 的送出端點事實上沒有
  硬性的濫用防護

## 踩過的坑

### ⚠️ 寫死的版面偏移量咬過三次

`#branch-nav` 曾寫死 `top: 6rem` 假設工具列恆 3rem 高；`#tree-controls`／`#detail` 曾寫死
`top: 3rem` 假設 nav 恆 48px 高（實際 50.59px，差 2.59px 造成右上角 1px 突出）。

**現在都改成量實際高度**（`tree-canvas.ts` 量 nav 寫進 CSS 變數 `--nav-h`）。
**動版面時不要再引入新的固定偏移量**，並且驗收要用**幾何斷言**（兩個矩形不相交、
top 差距 < 0.5px），不是看截圖。

### 資料解析

- 成本字串的分隔符是**全形斜線 `／`**（U+FF0F），全檔 0 個半形 `/`
- **SVG 屬性值裡的換行必須是 XML 實體 `&#10;`**（`<title>` 元素內容則是字面換行）。
  原因：XML 規範要求 parser 把屬性值內的字面換行正規化成空格，Chromium 遵守、linkedom 沒有
  ——寫成字面換行的話，Node 與瀏覽器讀出來的 `data-cost` / `data-description` 會不一樣。
  `normalizeSvg()` 的 `encodeAttributeNewlines()` 負責維持這個不變量，
  `tests/data/parser-parity.test.ts` 負責守住它。
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
- 換行不變量拆成兩支測試：`tests/data/parser-parity.test.ts`（vitest，純字串掃描、零瀏覽器
  相依，`npm test`／`verify` job 可跑）驗「不變量本身有沒有被破壞」；
  `tests/e2e/parser-parity.spec.ts`（Playwright，只有 `e2e` job 裝了瀏覽器）用雙 parser
  比對證明「為什麼這個不變量重要」。**`verify` job 沒裝瀏覽器**——之後新增測試如果需要真的
  DOM／瀏覽器 API，放進 `tests/e2e/`，不要放進 `npm test` 跑的範圍，否則乾淨的 CI runner
  會直接炸「Executable doesn't exist」

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
