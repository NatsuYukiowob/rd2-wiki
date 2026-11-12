// 賽季（/season）。靜態頁：時間表進得了 HTML、逐格等於資料。
import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures';
import type { Seasons } from '../../src/lib/types';

const seasons: Seasons = JSON.parse(readFileSync(new URL('../../data/seasons.json', import.meta.url), 'utf8'));

test('SE1. /season 的時間表是伺服器輸出的 HTML，逐格等於資料，時區印在頁面上', async ({ page, request }) => {
  const html = await (await request.get('/season')).text();
  expect(seasons.eras.filter(e => !html.includes(e.period.finish)).map(e => e.id)).toEqual([]);

  await page.goto('/season');
  const rows = await page.locator('[aria-labelledby="season-schedule"] tbody tr')
    .evaluateAll(trs => trs.map(tr => [...tr.children].map(td => td.textContent!.trim())));
  expect(rows).toEqual(seasons.eras.map(e => [e.name, e.period.begin, e.period.finish]));
  await expect(page.locator('#season-page')).toContainText(seasons.eras[0]!.period.tz);
  await expect(page.locator('.lede')).toContainText(seasons.unlockKills.toLocaleString('en-US'));
});

test('SE2. 入口收在「遊戲介紹」下拉裡，下拉會標成目前分頁', async ({ page }) => {
  await page.goto('/season');
  await expect(page.locator('#site-nav .nav-menu-items a:text-is("賽季")')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#site-nav .nav-menu > summary')).toHaveAttribute('aria-current', 'page');
});

test('SE3. 320px 寬不撐出橫捲', { tag: '@mobile' }, async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/season');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});
