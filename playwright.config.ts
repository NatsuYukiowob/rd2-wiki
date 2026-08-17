// Playwright 端對端測試設定（Task 18）。
// webServer 直接吃 `npm run build` 產出的 dist/，用 `serve` 起一個純靜態伺服器——
// E2E 驗證的是「建置後、真實瀏覽器裡」的行為，不是 dev server（astro dev 有額外的
// HMR/中介層，跟正式環境不完全一樣）。
import { defineConfig, devices } from '@playwright/test';

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
    command: 'npx serve dist -l 4321',
    port: 4321,
    reuseExistingServer: true,
  },
  use: {
    baseURL: 'http://localhost:4321',
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
