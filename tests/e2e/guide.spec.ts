import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const readData = (name: string) => JSON.parse(readFileSync(new URL(`../../data/${name}.json`, import.meta.url), 'utf8'));

test('GI1. 總覽階層、資料計數、卡片網格及獎勵導覽', { tag: '@mobile' }, async ({ page, isMobile }, testInfo) => {
  await page.goto('/guide');
  await expect(page).toHaveTitle('Random Dice 2 wiki | 總覽');
  await expect(page.locator('h1')).toHaveText('總覽');
  await expect(page.locator('.guide-h2.sec-title')).toHaveText(['遊戲介紹', '遊戲內容']);
  const intro = page.locator('section[aria-labelledby="guide-intro-heading"]');
  await expect(intro.locator('.lede')).toContainText('骰子描述裡那些帶');
  await expect(intro.locator('.guide-card')).toHaveCount(4);
  const content = page.locator('section[aria-labelledby="guide-content-heading"]');
  await expect(content.locator('h3')).toHaveText(['戰術', 'Boss', '裂縫商店', '活動', '獎勵系統']);
  await expect(content.locator('p.note').first()).toHaveText('不是關鍵字詞彙，是對戰與合作模式裡會遇到的東西。');
  const rewards = readData('rewards');
  for (const [href, count, unit] of [
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
      return { width: rect.width, left: rect.left, top: rect.top, index: getComputedStyle(card).getPropertyValue('--i') };
    }));
    expect(Math.max(...boxes.map(box => box.width)) - Math.min(...boxes.map(box => box.width))).toBeLessThan(0.5);
    expect(boxes.map(box => Number(box.index))).toEqual([4, 5, 6, 7, 8]);
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
  await expect(page.locator('.rewards-page > .lede')).toContainText('可重複取得的獎勵則提供資料查閱');
  await expect(page.locator('#site-nav .nav-menu > summary')).toHaveAttribute('aria-current', 'page');
  await page.locator('#site-nav .nav-menu').evaluate(node => node.setAttribute('open', ''));
  await expect(page.locator('#site-nav a[href="/rewards"]')).toHaveText('獎勵系統');
  await expect(page.locator('#site-nav a[href="/rewards"]')).toHaveAttribute('aria-current', 'page');
});
