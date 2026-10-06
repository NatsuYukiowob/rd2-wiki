import { test, expect, type Page } from './fixtures';

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

test('CL1. #detail 是 .panel（桌機浮動卡片、手機抽屜仍然歸零）；#toolbar 的面是 --face-float', { tag: '@mobile' }, async ({ page, isMobile }) => {
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

  // 有篩選生效：金點亮起、寬度不變（O2 守的同一件事，換成 .btn 之後再釘一次）。
  // 用搜尋框觸發（同 O2）：先開面板再點晶片會撞上面板的展開過場——晶片還在移動、被畫布
  // 或搜尋框擋住點擊，全套平行跑時 20 次紅 8 次。
  await page.locator('#search').fill('僵硬');
  await expect(btn).toHaveClass(/active/);
  const on = await look();
  expect(Math.abs(on.w - idle.w), `篩選生效後按鈕寬度 ${idle.w} → ${on.w}`).toBeLessThanOrEqual(0.5);
  // 金點的 background-color 有 --t-fast 過場，剛勾完讀到的是過場中的 rgba()，要等它停。
  const gold = await tokenColor(page, '--gold');
  await expect.poll(() => btn.evaluate(el => getComputedStyle(el, '::before').backgroundColor), { message: '金點沒有亮' })
    .toBe(gold);
});

test('CL3. 分支跳轉鈕是 .chip＋常亮的分支色點；手機 320px 五顆塞得下', { tag: '@mobile' }, async ({ page, isMobile }) => {
  if (isMobile) await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/tree');
  const sel = isMobile ? '#branch-chips button' : '#branch-nav button';
  const btns = page.locator(sel);
  await expect(btns).toHaveCount(5);
  expect(await page.locator(`${sel}.chip`).count(), '跳轉鈕沒有全部掛上 .chip').toBe(5);
  const dots = await page.locator(`${sel} .branch-dot`).evaluateAll(els => els.map(el => getComputedStyle(el).opacity));
  expect(dots, '每顆跳轉鈕都要有色點').toHaveLength(5);
  for (const o of dots) expect(o, '跳轉鈕的色點被壓暗了（0.45 是篩選鈕「這一系沒開」的意思）').toBe('1');
  // 字色同理：`.chip` 預設的 --muted 是「沒勾選的篩選」，跳轉鈕是動作鈕，要是 --fg。
  const fg = await tokenColor(page, '--fg');
  for (const c of await btns.evaluateAll(els => els.map(el => getComputedStyle(el).color)))
    expect(c, '跳轉鈕的字是 --muted，看起來像沒開的篩選').toBe(fg);
  if (isMobile) {
    const fit = await page.locator('#branch-chips').evaluate(el => ({
      over: el.scrollWidth - el.clientWidth,
      right: el.lastElementChild!.getBoundingClientRect().right,
    }));
    expect(fit.over, '320px 下 #branch-chips 被撐出橫向捲動').toBeLessThanOrEqual(0);
    expect(fit.right, '第五顆超出視窗').toBeLessThanOrEqual(320);
  }
});

/**
 * CL4–CL6：Windows 高對比（forced-colors）下的畫布頁（2026-09-24 review P4）。
 * ⚠️ 畫布像素不會被系統重新著色，所以畫布配色只在它設計時假設的深色底上讀得到；系統色只換得了
 * DOM 元素。colorScheme: 'light' 模擬淺色高對比主題（Windows「沙漠」）——深色主題測不出這幾條。
 */
test('CL4. 淺色高對比：畫布底色維持深色（不被換成 Canvas 白），焦點文字牌仍是系統色', async ({ page }) => {
  // ⚠️ --bg 要在開高對比之前解：tokenColor() 借一個元素的 color 解色，forced-colors 下那個
  // color 會被換成 CanvasText。
  await page.goto('/tree');
  const bg = await tokenColor(page, '--bg');
  await page.emulateMedia({ forcedColors: 'active', colorScheme: 'light' });
  for (const path of ['/tree', '/sim']) {
    await page.goto(path);
    const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const hostBg = await page.locator('#canvas-host').evaluate(el => getComputedStyle(el).backgroundColor);
    expect(hostBg, `${path} 畫布底下是系統的 Canvas 色，深色主題的標籤與連線疊在上面讀不到`).toBe(bg);
    expect(hostBg).not.toBe(bodyBg);
    await page.locator('.tree-a11y-node[data-id="1001"]').focus();
    // 焦點牌在 #canvas-host 裡：host 的 forced-color-adjust: none 會繼承下來，沒接回 auto 的話
    // 牌子的 Canvas／CanvasText 也一起失效。
    const tile = await page.locator('.tree-a11y li:focus-within').evaluate(el => getComputedStyle(el).forcedColorAdjust);
    expect(tile, `${path} 焦點牌沒有接回系統色`).toBe('auto');
  }
});

test('CL5. 高對比＋窄視窗：焦點文字牌不被 /sim 抽屜與 /tree 分支列蓋住', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ forcedColors: 'active' });
  for (const path of ['/tree', '/sim']) {
    await page.goto(path);
    await page.locator('.tree-a11y-node[data-id="1001"]').focus();
    // 牌子是 pointer-events: none，elementFromPoint 本來就會穿過它——暫時打開再量最上層是誰。
    const top = await page.locator('.tree-a11y li:focus-within').evaluate(li => {
      (li as HTMLElement).style.pointerEvents = 'auto';
      const r = li.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      (li as HTMLElement).style.pointerEvents = '';
      return li.contains(hit) ? 'tile' : `${hit?.tagName}#${hit?.id}.${hit?.className}`;
    });
    expect(top, `${path} 焦點牌被蓋住`).toBe('tile');
  }
});

test('CL6. 高對比：/sim 的兩個把手（.sim-grip）看得見，不跟所在的面同色', { tag: '@mobile' }, async ({ page, isMobile }) => {
  test.skip(!isMobile, '把手只在手機版面出現');
  await page.emulateMedia({ forcedColors: 'active', colorScheme: 'light' });
  await page.goto('/sim');
  await page.locator('#sim-fab-more').click();
  for (const [grip, face] of [['#sim-sheet-close .sim-grip', '#sim-toolbar'], ['#sim-panel-handle .sim-grip', '#sim-panel']] as const) {
    const g = await page.locator(grip).evaluate(el => getComputedStyle(el).backgroundColor);
    const f = await page.locator(face).evaluate(el => getComputedStyle(el).backgroundColor);
    expect(g, `${grip} 跟 ${face} 同色，把手消失`).not.toBe(f);
  }
});
