import type { Page } from '@playwright/test';

/**
 * 在頁面裡把一個 CSS 變數解析成瀏覽器正規化過的顏色字串，好跟 computed style 直接比。
 *
 * 抽出來共用：chrome.spec.ts 與 codex.spec.ts 原本各有一份逐字相同的實作。
 */
export async function resolveColor(page: Page, cssVar: string): Promise<string> {
  return page.evaluate(name => {
    const probe = document.createElement('span');
    probe.style.color = `var(${name})`;
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  }, cssVar);
}

/**
 * 等進場動畫（PR ⑥）跑完再往下量。
 *
 * `[data-enter]` 期間卡片掛著 `animation: rise … both`，而**帶 transform 的元素量出來的
 * boundingBox 會有次像素誤差**——C3 斷言「翻到關鍵字頁前後卡片高度一模一樣」用的是嚴格
 * 相等，2026-08-26 實測撞到 `368.8124694824219` vs `368.8125` 這種差 3e-5 的假紅。
 *
 * ⚠️ 這不是把測試放寬，是把它移到正確的時間點量：動畫進行中的幾何本來就不是這條測試
 * 要守的東西。凡是在 /dice、/、/guide 上量卡片幾何的測試都該先呼叫它。
 * ⚠️ 也不要改成「固定等一秒」——長度由 CSS 的 --t-slow／--p-stagger 決定，寫死就是第二份。
 */
export async function settleEnter(page: Page): Promise<void> {
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-enter'),
    undefined, { timeout: 5000 });
}
