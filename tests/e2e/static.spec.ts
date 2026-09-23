import { test, expect } from '@playwright/test';

/**
 * 骰桌 PR ②（2026-09-23）：靜態頁共用元件。
 * ST1 守「共用 class 真的掛上去了」——後面每個 task 的 CSS 都掛在這些 class 上，
 * 漏掛一頁的話那一頁安靜地維持舊樣子，而那一頁的既有測試照樣全綠。
 */
const PAGES: { path: string; secTitle: number; card?: string; rowCard?: boolean; filterBar?: boolean }[] = [
  { path: '/', secTitle: 1, card: '.home-card' },
  { path: '/dice', secTitle: 0, card: '.dice-card', filterBar: true },
  { path: '/guide', secTitle: 1, card: '.guide-card' },
  { path: '/guide/status', secTitle: 1 },
  { path: '/events', secTitle: 0, rowCard: true },
  { path: '/tactic', secTitle: 0, rowCard: true, filterBar: true },
  { path: '/boss', secTitle: 2, rowCard: true },
  { path: '/rift-shop', secTitle: 3, rowCard: true, filterBar: true },
];

for (const p of PAGES) {
  test(`ST1. ${p.path} 掛著共用元件的 class`, async ({ page }) => {
    await page.goto(p.path);
    await expect(page.locator('h1'), '每頁只有一個 h1').toHaveCount(1);
    await expect(page.locator('h1.page-head'), 'h1 沒掛 .page-head').toHaveCount(1);
    const sec = await page.locator('.sec-title').count();
    expect(sec, '.sec-title 數量').toBeGreaterThanOrEqual(p.secTitle);
    if (p.card) {
      const [all, carded] = await Promise.all([
        page.locator(p.card).count(), page.locator(`${p.card}.card`).count()]);
      expect(all, `${p.card} 一張都沒有`).toBeGreaterThan(0);
      expect(carded, `${p.card} 有 ${all - carded} 張沒掛 .card`).toBe(all);
    }
    if (p.rowCard) {
      const n = await page.locator('.event-card-link, .battle-item').count();
      expect(n).toBeGreaterThan(0);
      expect(await page.locator('.event-card-link.row-card, .battle-item.row-card').count()).toBe(n);
    }
    if (p.filterBar) {
      await expect(page.locator('.filter-bar')).toHaveCount(1);
      await expect(page.locator('.filters'), '.filters 已改名成 .filter-bar').toHaveCount(0);
    }
  });
}

test('ST1b. /dice 的數值 pill 全部掛著 .pill', async ({ page }) => {
  await page.goto('/dice');
  const all = await page.locator('.stat-pill').count();
  expect(all).toBeGreaterThan(0);
  expect(await page.locator('.stat-pill.pill').count()).toBe(all);
});

test('ST2. 頁首 h1 是 900 字重帶 --ink 字影；段落標題前面是一顆旋轉 45° 的金色菱形、沒有左邊金線', async ({ page }) => {
  for (const path of ['/', '/guide', '/boss', '/events/chuseok-2026']) {
    await page.goto(path);
    const h1 = await page.locator('h1.page-head').evaluate(el => {
      const s = getComputedStyle(el);
      return { weight: s.fontWeight, shadow: s.textShadow };
    });
    expect(h1.weight, `${path} h1 字重`).toBe('900');
    expect(h1.shadow, `${path} h1 沒有字影`).not.toBe('none');

    const sec = await page.locator('.sec-title').first().evaluate(el => {
      const b = getComputedStyle(el, '::before');
      const probe = document.createElement('i');
      probe.style.color = 'var(--gold)';
      el.appendChild(probe);
      const gold = getComputedStyle(probe).color;
      probe.remove();
      return { content: b.content, bg: b.backgroundColor, transform: b.transform, gold,
        borderLeft: getComputedStyle(el).borderLeftWidth };
    });
    expect(sec.content, `${path} .sec-title 沒有 ::before`).not.toBe('none');
    expect(sec.bg, `${path} 菱形不是金色`).toBe(sec.gold);
    // rotate(45deg) 的 matrix 是 (cos45, sin45, -sin45, cos45, 0, 0)
    expect(sec.transform, `${path} 菱形沒有轉 45°`).toMatch(/^matrix\(0\.707/);
    expect(sec.borderLeft, `${path} 舊的左邊金線還在`).toBe('0px');
  }
});

test('ST2b. /rift-shop 篩掉的階級，它的段落標題真的消失（.sec-title 的 display:flex 不能壓過 [hidden]）', async ({ page }) => {
  await page.goto('/rift-shop');
  const first = page.locator('#rift-filters input[name="grade"]').first();
  const grade = await first.getAttribute('value');
  await first.uncheck();
  await expect(page.locator(`.battle-group-head[data-grade="${grade}"]`)).toBeHidden();
});

test('ST3. 卡片頭有分支色漸層：/dice 各系不同、首頁與遊戲介紹用中性紫；圓角 12px', async ({ page }) => {
  await page.goto('/dice');
  const heads = await page.evaluate(() => {
    const bg = (sel: string) => getComputedStyle(document.querySelector(sel)!).backgroundImage;
    return { nature: bg('.dice-card[data-branch="nature"]'), chaos: bg('.dice-card[data-branch="chaos"]'),
      radius: getComputedStyle(document.querySelector('.dice-card')!).borderTopLeftRadius };
  });
  expect(heads.nature, '/dice 卡片沒有頭部漸層').toContain('linear-gradient');
  expect(heads.nature, '自然與渾沌的卡片頭同色——分支色沒接上').not.toBe(heads.chaos);
  expect(heads.radius).toBe('12px');

  for (const [path, sel] of [['/', '.home-card'], ['/guide', '.guide-card']] as const) {
    await page.goto(path);
    const bg = await page.locator(sel).first().evaluate(el => getComputedStyle(el).backgroundImage);
    expect(bg, `${sel} 沒有頭部漸層`).toContain('linear-gradient');
  }
});

test('ST3b. 按住圖鑑卡片裡的檔位切換鈕，整張卡片不跟著縮', async ({ page, isMobile }) => {
  test.skip(isMobile, '桌機量到就夠：:active 的規則兩邊一樣');
  await page.goto('/dice');
  const card = page.locator('.dice-card').first();
  const chip = card.locator('.chip-xs').nth(1);
  const box = (await chip.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(150);
  const t = await card.evaluate(el => getComputedStyle(el).transform);
  await page.mouse.up();
  // hover 時卡片會抬升（translateY），所以不能要求 none；要求的是「沒有縮放」：matrix 的 a、d 都是 1。
  const m = t === 'none' ? [1, 0, 0, 1] : t.match(/matrix\(([^)]+)\)/)![1]!.split(',').map(Number);
  expect([m[0], m[3]], `按住卡片裡的切換鈕時整張卡片被縮放了（${t}）`).toEqual([1, 1]);
});

const HOME_ENTRIES = ['/tree', '/dice', '/board', '/sim', '/events', '/guide'];

test('ST4. 首頁 6 張入口依序排好、stagger 連號，320px 不撐出橫捲；有 GitHub 原始碼連結', async ({ page }) => {
  await page.goto('/');
  const cards = page.locator('.home-links .home-card');
  await expect(cards).toHaveCount(6);
  const info = await cards.evaluateAll(els => els.map(el => ({
    href: el.getAttribute('href'), i: (el as HTMLElement).style.getPropertyValue('--i').trim(),
  })));
  expect(info.map(x => x.href)).toEqual(HOME_ENTRIES);
  expect(info.map(x => x.i), '進場 stagger 的 --i 要 0–5 連號').toEqual(['0', '1', '2', '3', '4', '5']);

  const repo = page.locator('a[href="https://github.com/NatsuYukiowob/rd2-wiki"]');
  await expect(repo).toHaveCount(1);
  await expect(repo).toBeVisible();

  await page.setViewportSize({ width: 320, height: 700 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, '320px 下首頁撐出橫捲').toBeLessThanOrEqual(0);
});

test('ST4b. 靜態頁的可見文字裡沒有文字箭頭 → ←，改成 SVG 圖示', async ({ page }) => {
  for (const path of ['/', '/guide', '/guide/status', '/dice', '/events', '/events/chuseok-2026', '/no-such-page']) {
    await page.goto(path);
    const text = await page.locator('main, section').first().innerText();
    expect(text, `${path} 還有文字箭頭`).not.toMatch(/[→←]/);
  }
  // /dice 卡片裡點開關鍵字，「在骰子樹搜尋」那條是 JS 生出來的，上面掃不到。
  await page.goto('/dice');
  // 同 codex.spec.ts 的 C3：第一張含 `a.kw-link` 的卡片、點它的第一個關鍵字。
  const card = page.locator('.dice-card').filter({ has: page.locator('a.kw-link') }).first();
  await card.locator('a.kw-link').first().click();
  const search = card.locator('.card-term-search').first();
  await expect(search).toBeVisible();
  expect(await search.innerText()).not.toMatch(/→/);
  await expect(search.locator('svg.icon')).toHaveCount(1);
});

test('ST5. 篩選鈕：8px 圓角、選中＝金框、選中的色點有該分支色的光暈、沒選中的沒有；/tactic 與 /rift-shop 晶片之間有間距', async ({ page }) => {
  await page.goto('/dice');
  const r = await page.evaluate(() => {
    const probe = (v: string) => { const i = document.createElement('i'); i.style.color = `var(${v})`; document.body.appendChild(i); const c = getComputedStyle(i).color; i.remove(); return c; };
    const on = document.querySelector('#codex-filters .chip[data-branch="nature"]')!;
    return { gold: probe('--gold'), nature: probe('--nature'),
      radius: getComputedStyle(on).borderTopLeftRadius, border: getComputedStyle(on).borderTopColor,
      dotShadow: getComputedStyle(on.querySelector('.branch-dot')!).boxShadow };
  });
  expect(r.radius).toBe('8px');
  expect(r.border, '選中的篩選鈕不是金框').toBe(r.gold);
  expect(r.dotShadow, '選中的色點沒有分支色光暈').toContain(r.nature);

  await page.uncheck('#codex-filters input[value="nature"]');
  await expect.poll(() => page.locator('#codex-filters .chip[data-branch="nature"] .branch-dot')
    .evaluate(el => getComputedStyle(el).boxShadow)).toBe('none');

  for (const path of ['/tactic', '/rift-shop']) {
    await page.goto(path);
    const gap = await page.locator('.filter-bar [role="group"]').first().evaluate(el => getComputedStyle(el).columnGap);
    expect(gap, `${path} 的晶片黏在一起`).not.toBe('normal');
  }
});

test('ST6. 列式卡片圓角 12px、有實體厚度；數值 pill 沒有可見邊框、是凹槽', async ({ page }) => {
  for (const [path, sel] of [['/events', '.event-card-link'], ['/boss', '.battle-item']] as const) {
    await page.goto(path);
    const s = await page.locator(sel).first().evaluate(el => {
      const c = getComputedStyle(el); return { radius: c.borderTopLeftRadius, shadow: c.boxShadow };
    });
    expect(s.radius, `${sel} 圓角`).toBe('12px');
    expect(s.shadow, `${sel} 沒有實體厚度`).toMatch(/0px 3px 0px 0px/);
  }
  await page.goto('/dice');
  const pill = await page.locator('.stat-pill').first().evaluate(el => {
    const c = getComputedStyle(el); return { border: c.borderTopColor, shadow: c.boxShadow };
  });
  expect(pill.border, 'pill 還有可見邊框').toBe('rgba(0, 0, 0, 0)');
  expect(pill.shadow, 'pill 沒有內凹陰影').toContain('inset');
});

test('ST4c. 箭頭圖示只在靠文字那一側留間距：返回箭頭在前（右側留）、前進箭頭在後（左側留）', async ({ page }) => {
  const margins = (sel: string) => page.locator(sel).first().evaluate(el => {
    const s = getComputedStyle(el); return [s.marginLeft, s.marginRight];
  });
  await page.goto('/events/chuseok-2026');
  expect(await margins('.event-back a .icon'), '「← 活動」的返回箭頭').toEqual(['0px', '4px']);
  await page.goto('/dice');
  expect(await margins('.card-link .icon'), '「在骰子樹查看前置鏈 →」的箭頭').toEqual(['4px', '0px']);
});
