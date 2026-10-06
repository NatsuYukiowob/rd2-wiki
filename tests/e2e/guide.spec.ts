import { test, expect } from './fixtures';
import { readFileSync } from 'node:fs';

const readData = (name: string) => JSON.parse(readFileSync(new URL(`../../data/${name}.json`, import.meta.url), 'utf8'));

test('GI1. 總覽卡片與「遊戲介紹」下拉一一對應、資料計數、卡片網格', { tag: '@mobile' }, async ({ page, isMobile }, testInfo) => {
  await page.goto('/guide');
  await expect(page).toHaveTitle('Random Dice 2 wiki | 總覽');
  await expect(page.locator('h1')).toHaveText('總覽');
  const content = page.locator('.guide-cards');
  await expect(content).toHaveCount(1);
  // 卡片＝下拉選單除了「總覽」以外的每一項，順序與連結都相同。
  const menu = await page.locator('.nav-menu-items a').evaluateAll(links =>
    links.map(a => [a.getAttribute('href'), a.textContent!.trim()]).filter(([href]) => href !== '/guide'));
  const cards = await content.locator('.guide-card').evaluateAll(links =>
    links.map(a => [a.getAttribute('href'), a.querySelector('h2')!.textContent!.trim()]));
  expect(cards).toEqual(menu);
  const rewards = readData('rewards');
  const keywords = readData('keywords') as Record<string, { aliasOf?: string }>;
  for (const [href, count, unit] of [
    ['/guide/keywords', Object.values(keywords).filter(k => !k.aliasOf).length, '條'],
    ['/tactic', readData('tactics').length, '條'], ['/boss', readData('boss').length, '種'],
    ['/rift-shop', readData('rift-shop').length, '種'], ['/events', readData('events').length, '場'],
    ['/rewards', rewards.modes.length + (rewards.repeatable ? 1 : 0), '類'],
  ] as const) {
    await expect(content.locator(`a[href="${href}"] .note`)).toContainText(`${count} ${unit}`);
  }
  for (const width of isMobile ? [412, 360] : [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const boxes = await content.locator('.guide-card').evaluateAll(cards => cards.map(card => {
      const rect = card.getBoundingClientRect();
      return { width: rect.width, left: rect.left, index: getComputedStyle(card).getPropertyValue('--i') };
    }));
    expect(Math.max(...boxes.map(box => box.width)) - Math.min(...boxes.map(box => box.width))).toBeLessThan(0.5);
    expect(boxes.map(box => Number(box.index))).toEqual([0, 1, 2, 3, 4, 5]);
    if (isMobile) expect(boxes.every(box => Math.abs(box.left - boxes[0]!.left) < 0.5)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  }
  await content.scrollIntoViewIfNeeded();
  await expect(content.locator('.guide-card').last()).toHaveCSS('opacity', '1');
  await page.screenshot({ path: testInfo.outputPath('overview.png') });
  await content.locator('a[href="/rewards"]').click();
  await expect(page).toHaveURL(/\/rewards\/?$/);
  await expect(page).toHaveTitle('Random Dice 2 wiki | 獎勵系統');
  await expect(page.locator('h1')).toHaveText('獎勵系統');
  await expect(page.locator('.rewards-page > .lede')).toContainText('全部領完可拿到的資源總量');
  await expect(page.locator('#site-nav .nav-menu > summary')).toHaveAttribute('aria-current', 'page');
  await page.locator('#site-nav .nav-menu').evaluate(node => node.setAttribute('open', ''));
  await expect(page.locator('#site-nav a[href="/rewards"]')).toHaveText('獎勵系統');
  await expect(page.locator('#site-nav a[href="/rewards"]')).toHaveAttribute('aria-current', 'page');
});
