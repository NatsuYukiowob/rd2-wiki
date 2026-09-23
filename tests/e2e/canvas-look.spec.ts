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

test('CL2. #filters-toggle 是 .btn：10px 圓角、實體厚度；有篩選時金點亮、寬度不跳', async ({ page }) => {
  await page.goto('/tree');
  const btn = page.locator('#filters-toggle');
  const look = () => btn.evaluate(el => {
    const c = getComputedStyle(el);
    return { cls: el.className, radius: c.borderTopLeftRadius, shadow: c.boxShadow, img: c.backgroundImage, w: el.getBoundingClientRect().width };
  });
  const idle = await look();
  expect(idle.cls).toContain('btn-alt');
  expect(idle.radius).toBe('10px');
  expect(idle.img, '不是次按鈕的紫色漸層').toContain('linear-gradient');
  expect(idle.shadow, '沒有實體厚度').toMatch(/0px 3px 0px 0px/);

  // 開面板、勾一個分支：金點亮起、寬度不變（O2 守的同一件事，換成 .btn 之後再釘一次）。
  await btn.click();
  await page.locator('#filters .chip[data-branch="nature"]').click();
  await expect(btn).toHaveClass(/active/);
  const on = await look();
  expect(Math.abs(on.w - idle.w), `篩選生效後按鈕寬度 ${idle.w} → ${on.w}`).toBeLessThanOrEqual(0.5);
  // 金點的 background-color 有 --t-fast 過場，剛勾完讀到的是過場中的 rgba()，要等它停。
  const gold = await tokenColor(page, '--gold');
  await expect.poll(() => btn.evaluate(el => getComputedStyle(el, '::before').backgroundColor), { message: '金點沒有亮' })
    .toBe(gold);
});

test('CL3. 分支跳轉鈕是 .chip＋常亮的分支色點；手機 320px 五顆塞得下', async ({ page, isMobile }) => {
  if (isMobile) await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/tree');
  const sel = isMobile ? '#branch-chips button' : '#branch-nav button';
  const btns = page.locator(sel);
  await expect(btns).toHaveCount(5);
  expect(await page.locator(`${sel}.chip`).count(), '跳轉鈕沒有全部掛上 .chip').toBe(5);
  const dots = await page.locator(`${sel} .branch-dot`).evaluateAll(els => els.map(el => getComputedStyle(el).opacity));
  expect(dots, '每顆跳轉鈕都要有色點').toHaveLength(5);
  for (const o of dots) expect(o, '跳轉鈕的色點被壓暗了（0.45 是篩選鈕「這一系沒開」的意思）').toBe('1');
  if (isMobile) {
    const fit = await page.locator('#branch-chips').evaluate(el => ({
      over: el.scrollWidth - el.clientWidth,
      right: el.lastElementChild!.getBoundingClientRect().right,
    }));
    expect(fit.over, '320px 下 #branch-chips 被撐出橫向捲動').toBeLessThanOrEqual(0);
    expect(fit.right, '第五顆超出視窗').toBeLessThanOrEqual(320);
  }
});
