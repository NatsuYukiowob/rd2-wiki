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
