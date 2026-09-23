import { test, expect, type Page } from '@playwright/test';

/**
 * 骰桌 PR ④（2026-09-23）：/tree、/sim 畫布周邊換成共用元件。
 * 這兩頁的舊樣式全是 id 選擇器（具體度 (1,x,x)），共用 class 只有 (0,1,0)——舊宣告沒刪乾淨的話
 * 新樣式**安靜地不生效**，而 tree.spec／sim.spec 照樣全綠（它們驗行為與幾何，不驗長相）。
 * /sim 的長相測試在 sim.spec.ts（S30／S31），要用那邊的 tapNode()。
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

test('CL1. #detail 是 .panel（桌機浮動卡片、手機抽屜仍然歸零）；#toolbar 的面是 --face-float', async ({ page, isMobile }) => {
  await page.goto('/tree?node=5201');
  const detail = page.locator('#detail');
  await expect(detail).toBeVisible();
  const s = await detail.evaluate(el => {
    const c = getComputedStyle(el);
    return { cls: el.className, bg: c.backgroundColor, radius: c.borderTopLeftRadius, border: c.borderTopColor, shadow: c.boxShadow };
  });
  expect(s.cls).toContain('panel');
  expect(s.bg, '#detail 不是 --surface-2').toBe(await tokenColor(page, '--surface-2'));
  if (isMobile) {
    // tree.astro 的手機抽屜規則 (1,0,0) 要贏 .panel (0,1,0)：全寬貼底的抽屜不該有圓角與陰影。
    expect(s.radius, '手機抽屜的圓角沒有歸零').toBe('0px');
    expect(s.shadow).toBe('none');
  } else {
    expect(s.radius, '#detail 不是 --r-lg').toBe('12px');
    expect(s.border, '#detail 框色不是 --border').toBe(await tokenColor(page, '--border'));
    expect(s.shadow, '#detail 沒有 --face-float 的上緣高光').toContain('inset');
  }
  // #toolbar：陰影換成 --face-float（帶 inset 高光），不是裸的 --shadow-2。
  expect(await page.locator('#toolbar').evaluate(el => getComputedStyle(el).boxShadow), '#toolbar 沒有 --face-float')
    .toContain('inset');
});
