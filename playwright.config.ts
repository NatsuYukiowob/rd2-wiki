// Playwright 端對端測試設定（Task 18）。
// webServer 直接吃 `npm run build` 產出的 dist/，用 `serve` 起一個純靜態伺服器——
// E2E 驗證的是「建置後、真實瀏覽器裡」的行為，不是 dev server（astro dev 有額外的
// HMR/中介層，跟正式環境不完全一樣）。
import { defineConfig, devices } from '@playwright/test';

/**
 * E2E 用的埠，可用 `E2E_PORT` 覆蓋。
 *
 * ⚠️ 為什麼要能覆蓋：`reuseExistingServer: true` 加上寫死的埠，等於「只要 4321 上有人在聽，
 * 就拿它當受測站台」——**不管那是不是你自己建的 dist**。2026-08-19 實際咬到人：這台機器上
 * 同時有兩個工作區（主 checkout 與一個 git worktree），前者留了一個沒收掉的 `serve dist`，
 * 後者跑 E2E 時 Playwright 直接重用了它，於是測到的是**別份產物**。
 *
 * 症狀非常有誤導性：測試紅在「element(s) not found」，看起來完全像自己的程式沒輸出那個元素。
 * 破案的是 `curl localhost:4321 | grep -c <自己的東西>` 回 0。
 *
 * 這跟 CLAUDE.md 記的「`npx playwright test` 不會重新建置」是同一族的坑——
 * **都是「你以為在測自己的東西，其實不是」**：一個測到舊產物，一個測到別人的產物。
 *
 * 平行開兩個工作區時，其中一邊 `E2E_PORT=4399 npm run e2e` 就互不干擾。CI 上沒有這個變數，
 * 行為與先前完全相同。
 */
const PORT = Number(process.env.E2E_PORT ?? 4321);

export default defineConfig({
  testDir: 'tests/e2e',
  // 這台機器是 headless CI 環境，沒有互動式終端機可以看報表；用 list 印在終端機就好，
  // 不用預設可能觸發的 html reporter（測試失敗時會提示 `npx playwright show-report`，
  // 那個指令本身不會自動開瀏覽器，但這裡刻意明講清楚，避免日後改成 html 誤以為要開視窗）。
  reporter: 'list',
  // forbidOnly：CI 上如果不小心 commit 了 test.only()，讓建置直接失敗而不是悄悄只跑那一個
  // test、其餘全部被跳過卻回報全綠。retries：目前這個環境本地跑很穩定（沒有 CI 就不重試，
  // 失敗要立刻看到、不要被重試蓋過去），但 process.env.CI 若之後接進真的 CI，給 1 次重試
  // 吸收單次網路/排程抖動造成的偶發失敗，避免非戰之罪的紅燈。這兩個欄位 brief 原文沒寫，
  // 純粹加固，不影響 brief 給定的其他欄位。
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  webServer: {
    command: `npx serve dist -l ${PORT}`,
    port: PORT,
    // reuseExistingServer：本機重跑時不必每次重起 server。
    // ⚠️ 它跟「埠寫死」合起來會咬人——見檔案開頭 PORT 的說明。
    reuseExistingServer: true,
  },
  use: {
    baseURL: `http://localhost:${PORT}`,
    // 失敗時留痕跡：截圖、trace 都只在失敗時才存，成功案例不佔空間（test-results/ 已在
    // .gitignore，這些產物本來就不進 repo，純粹方便事後除錯）。
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
