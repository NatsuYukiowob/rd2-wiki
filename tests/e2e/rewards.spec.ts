import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { modeRewardTotals } from '../../src/lib/rewards';
import type { RewardCatalog } from '../../src/lib/types';

// /rewards 是純瀏覽（2026-09-27 Yuki 裁決）：沒有勾選、沒有輸入框、不寫 localStorage；
// 每個分類頂端印「全部領完可獲得」的總量，門檻由小到大。
const catalog = JSON.parse(readFileSync(new URL('../../data/rewards.json', import.meta.url), 'utf8')) as RewardCatalog;
const activePanel = (page: Page) => page.locator('[data-reward-mode-panel]:visible');

async function selectMode(page: Page, id: string) {
  const selector = page.locator('[data-reward-mode-select]');
  if (await selector.isVisible()) await selector.selectOption(id);
  else await page.locator(`[data-reward-mode-option="${id}"]`).click();
  await expect(page.locator('[data-rewards-page]')).toHaveAttribute('data-active-mode', id);
}

test('RW1. 七個分類都切得到，每頁只顯示自己的面板；整頁沒有任何輸入元件、不寫 storage', { tag: '@mobile' }, async ({ page, isMobile }) => {
  await page.goto('/rewards');
  const names = [...catalog.modes.map(mode => mode.name), catalog.repeatable!.name];
  await expect(page.locator('[data-reward-mode-select] option')).toHaveText(names);
  await expect(page.locator('[data-reward-mode-option]')).toHaveText(names);
  await expect(page.locator(isMobile ? '.reward-mode-nav' : '[data-reward-mode-select]')).toBeHidden();
  for (const mode of [...catalog.modes, catalog.repeatable!]) {
    await selectMode(page, mode.id);
    await expect(page.locator('[data-reward-mode-panel]:visible')).toHaveCount(1);
    await expect(activePanel(page).locator('.reward-mode-heading h2')).toHaveText(mode.name);
  }
  await expect(page.locator('main input, main textarea, main dialog')).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('rd2-rewards')))).toEqual([]);
});

test('RW2. 門檻由小到大排列（討伐一般、困難皆然）', async ({ page }) => {
  await page.goto('/rewards');
  for (const mode of catalog.modes) {
    if (mode.kind !== 'threshold') continue;
    await selectMode(page, mode.id);
    const requirements = (await activePanel(page).locator('[data-reward-tier]').evaluateAll(rows =>
      rows.map(row => Number((row as HTMLElement).dataset.requirement))));
    expect(requirements).toHaveLength(mode.tiers.length);
    expect(requirements).toEqual([...requirements].sort((a, b) => a - b));
  }
});

test('RW3. 每個分類的總計＝全部階段相加，貨幣印數量、收藏品多件才印 ×N', async ({ page }) => {
  await page.goto('/rewards');
  for (const mode of catalog.modes) {
    await selectMode(page, mode.id);
    const expected = modeRewardTotals(mode);
    const summary = page.locator(`[data-reward-summary="${mode.id}"]`);
    await expect(summary).toBeVisible();
    await expect(summary.locator('h3')).toHaveText('全部領完可獲得');
    await expect(summary.locator('[data-reward-totals="currency"] [data-total-reward]'))
      .toHaveCount(expected.currency.length);
    await expect(summary.locator('[data-reward-totals="collectible"] [data-total-reward]'))
      .toHaveCount(expected.collectible.length);
    for (const { key, amount } of expected.currency) {
      await expect(summary.locator(`[data-total-reward="${key}"] strong`)).toHaveText(amount.toLocaleString('en-US'));
      // 畫面上的數字在 aria-hidden 裡，讀屏要靠 dd 裡另外那段 sr-only（code review 2026-09-27）。
      await expect(summary.locator(`[data-total-reward="${key}"] dd > .sr-only`)).toHaveText(amount.toLocaleString('en-US'));
    }
    for (const { key, amount } of expected.collectible) {
      const item = summary.locator(`[data-total-reward="${key}"]`);
      await expect(item.locator('.reward-collected-count')).toHaveCount(amount > 1 ? 1 : 0);
      if (amount > 1) await expect(item.locator('.reward-collected-count')).toHaveText(`×${amount.toLocaleString('en-US')}`);
    }
  }
  // 重複性獎勵沒有「領完」這回事，不印總計。
  await selectMode(page, catalog.repeatable!.id);
  await expect(activePanel(page).locator('[data-reward-summary]')).toHaveCount(0);
});

test('RW4. 單件收藏不顯示數量，貨幣仍顯示數量', async ({ page }) => {
  await page.goto('/rewards');
  for (const mode of catalog.modes) {
    await selectMode(page, mode.id);
    const grants = activePanel(page).locator('.reward-grants .reward-grant-content');
    expect(await grants.evaluateAll(nodes => nodes.every(node => {
      const label = node.querySelector('.reward-collectible-label');
      return label ? node.querySelector('strong')?.textContent !== '1' : !!node.querySelector('strong');
    }))).toBe(true);
  }
});

test('RW5. 每日任務預設收起，展開後顯示正式點數', { tag: '@mobile' }, async ({ page }) => {
  await page.goto('/rewards');
  for (const mode of catalog.modes) {
    if (mode.kind !== 'threshold' || !mode.taskDays?.length) continue;
    await selectMode(page, mode.id);
    const tasks = page.locator(`[data-reward-task-panel="${mode.id}"]`);
    await expect(tasks).not.toHaveAttribute('open');
    await tasks.locator('summary').click();
    await expect(tasks.locator('.reward-task-day')).toHaveCount(mode.taskDays.length);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  }
  await selectMode(page, catalog.repeatable!.id);
  const daily = page.locator(`[data-reward-task-panel="${catalog.repeatable!.id}"]`);
  await expect(daily).not.toHaveAttribute('open');
  await daily.locator('summary').click();
  await expect(daily.locator('[data-reward-task]')).toHaveCount(catalog.repeatable!.dailyTasks.tasks.length);
  await expect(daily.locator('[data-reward-task]').first()).toContainText('登入 ×1');
});

test('RW6. 重複性獎勵：連勝表逐列配圖、每日累積獎勵 5 階', async ({ page }) => {
  await page.goto('/rewards');
  await selectMode(page, catalog.repeatable!.id);
  const panel = activePanel(page);
  const streak = panel.locator('[data-repeatable-section="arena-streak"]');
  await expect(streak.locator('[data-repeatable-tier]')).toHaveCount(6);
  for (let wins = 0; wins <= 5; wins++) {
    await expect(streak.locator('[data-repeatable-tier]').nth(wins).locator('img.reward-reference-image'))
      .toHaveAttribute('src', `/rewards/reference/${wins}_pig.png`);
  }
  const dailyRewards = panel.locator('[data-repeatable-daily-rewards]');
  await expect(dailyRewards.locator('[data-repeatable-tier]')).toHaveCount(5);
  await expect(dailyRewards.locator('[data-repeatable-tier]').nth(2).locator('img'))
    .toHaveAttribute('src', '/currency/luckyDiceTicket.png');
});

test('RW7. 鯊魚造型及三種表情使用正式完整圖片，總計也帶圖', async ({ page }) => {
  await page.goto('/rewards');
  await selectMode(page, 'hunt-event');
  const shark = activePanel(page).getByLabel('吞噬骰子－鯊魚造型 1');
  await expect(shark.locator('img')).toHaveAttribute('src', '/rewards/cosmetic/Dice_Predator3_skin1.png');
  expect((await page.request.get('/rewards/cosmetic/Dice_Predator3_skin1.png')).ok()).toBe(true);
  const collected = page.locator('[data-reward-summary="hunt-event"] [data-reward-totals="collectible"]');
  await expect(collected).toContainText('target 表情');
  await expect(collected).toContainText('吞噬骰子－鯊魚造型');
  await selectMode(page, 'raid-hard');
  for (const name of ['STOP', 'NO_SIGN']) {
    const reward = activePanel(page).getByLabel(`${name} 表情 1`);
    await expect(reward.locator('img')).toHaveAttribute('src', `/rewards/emote/${name}.png`);
    await expect(reward.locator('.reward-collectible-fallback')).toHaveCount(0);
  }
});

test('RW8. 表頭與資料列同欄對齊、列高一致，窄螢幕不橫向溢出', { tag: '@mobile' }, async ({ page, isMobile }, testInfo) => {
  await page.goto('/rewards');
  for (const width of isMobile ? [412, 360] : [1280]) {
    await page.setViewportSize({ width, height: 800 });
    for (const mode of catalog.modes) {
      await selectMode(page, mode.id);
      // 直接設 open：點 summary 是切換，第二個寬度再點一次會把它收回去。
      if (mode.kind === 'achievement') await activePanel(page).locator('[data-reward-achievement-group]').first().evaluate(d => { (d as HTMLDetailsElement).open = true; });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
      const aligned = await activePanel(page).locator('.reward-list-head:visible').first().evaluate(head => {
        const row = head.nextElementSibling!.querySelector('.reward-tier')!;
        return [...head.children].every((cell, index) =>
          Math.abs(cell.getBoundingClientRect().left - row.children[index]!.getBoundingClientRect().left) < 0.5);
      });
      expect(aligned, `${mode.id} @${width}`).toBe(true);
    }
  }
  await selectMode(page, 'raid-normal');
  await activePanel(page).locator('[data-reward-tier]').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('rows.png') });
});

test('RW9. 沒有 JS 時七個分類全部攤開、切換選單不出現', { tag: '@mobile' }, async ({ browser }, testInfo) => {
  const context = await browser.newContext({ ...testInfo.project.use, javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/rewards');
  await expect(page.locator('[data-reward-mode-panel]:visible')).toHaveCount(catalog.modes.length + 1);
  await expect(page.locator('.reward-mode-nav')).toBeHidden();
  await expect(page.locator('[data-reward-mode-select]')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  await context.close();
});
