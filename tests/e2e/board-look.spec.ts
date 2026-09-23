import { test, expect, type Page } from '@playwright/test';

/**
 * 骰桌 PR ③（2026-09-23）：/board 換成共用元件。
 * 這一頁的舊樣式幾乎全是 id 選擇器（具體度 (1,x,x)），共用 class 只有 (0,1,0)——舊宣告沒刪乾淨的話
 * 新樣式**安靜地不生效**，而 board.spec 照樣全綠（它們驗行為與尺寸，不驗長相）。
 * 這個檔驗的就是「共用元件真的接上了」。
 */

/** 把 CSS 變數解成 computed 的顏色字串（跟 getComputedStyle 比對用）。 */
async function tokenColor(page: Page, name: string): Promise<string> {
  return page.evaluate(n => {
    const i = document.createElement('i');
    i.style.color = `var(${n})`;
    document.body.appendChild(i);
    const c = getComputedStyle(i).color;
    i.remove();
    return c;
  }, name);
}

test('BL1. /board 頁首是 .page-head、小標是 .sec-title；頁首左緣與骰盤左緣在同一條線上', async ({ page }) => {
  await page.goto('/board');
  await expect(page.locator('h1.page-head')).toHaveCount(1);
  // 三個 .board-h2：隊友的隊伍（預設 hidden）、我的隊伍、骰盤。明細面板的標題是 .detail-h，不算。
  const h2 = await page.locator('.board-h2').count();
  expect(await page.locator('.board-h2.sec-title').count(), '.board-h2 沒有全部掛上 .sec-title').toBe(h2);

  const left = (sel: string) => page.locator(sel).first().evaluate(el => el.getBoundingClientRect().left);
  const [h1, lede, grid] = [await left('h1'), await left('.lede'), await left('#board-grid')];
  expect(Math.abs(h1 - lede), '標題與說明的左緣不一致').toBeLessThanOrEqual(0.5);
  expect(Math.abs(h1 - grid), `頁首左緣 ${h1} 與骰盤左緣 ${grid} 不在同一條對齊軸上`).toBeLessThanOrEqual(1);
});
