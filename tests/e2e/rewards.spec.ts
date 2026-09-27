import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { achievementTotals, rewardTotals, rewardTotalsAcrossModes, sortedRewardTiers } from '../../src/lib/rewards';
import type { RewardAchievementMode, RewardCatalog, RewardThresholdMode } from '../../src/lib/types';

const catalog = JSON.parse(readFileSync(new URL('../../data/rewards.json', import.meta.url), 'utf8')) as RewardCatalog;
const thresholds = catalog.modes.filter((mode): mode is RewardThresholdMode => mode.kind === 'threshold');
const achievements = catalog.modes.find((mode): mode is RewardAchievementMode => mode.kind === 'achievement')!;
const normal = thresholds[0]!;
const firstGroup = achievements.groups.find(group => group.stages.length >= 2)!;
const secondGroup = achievements.groups.find(group => group.id !== firstGroup.id)!;
const activePanel = (page: Page) => page.locator('[data-reward-mode-panel]:visible');
const totalsGroup = (page: Page, scope: 'current' | 'all', kind: 'currency' | 'collectible') =>
  page.locator(`[data-reward-totals="${scope}-${kind}"]`);

test('RW11. 重複性獎勵唯讀、每日任務展開與永久總計隔離', { tag: '@mobile' }, async ({ page, isMobile }, testInfo) => {
  await page.goto('/rewards');
  await expect(page.locator('.rewards-page > .lede')).toHaveText('門檻獎勵以最高紀錄追蹤，成就依各組完成階段獨立追蹤；可重複取得的獎勵則提供資料查閱。');
  await expect(page.locator('[data-reward-mode-select] option')).toHaveText([...catalog.modes.map(mode => mode.name), '重複性獎勵']);
  await page.locator('[data-reward-progress-input]').fill('500');
  await page.locator('[data-reward-progress-form] button[type="submit"]').click();
  const saved = await page.evaluate(() => localStorage.getItem('rd2-rewards-v2'));
  const totals = rewardTotals(normal, 500);
  await selectMode(page, 'repeatable', isMobile);
  const panel = activePanel(page);
  await expect(panel.getByRole('heading', { name: '競技場連勝', exact: true })).toBeVisible();
  await expect(panel.getByRole('heading', { name: '每日任務', exact: true })).toBeVisible();
  await expect(panel.locator('input')).toHaveCount(0);
  await expect(page.locator('.reward-controls')).toBeHidden();
  await expect(page.locator('.reward-global-summary')).toBeHidden();
  await expect(page.getByRole('button', { name: '清除此頁進度' })).toHaveCount(0);
  await expect(panel.locator('[data-repeatable-section="arena-streak"] [data-repeatable-tier]')).toHaveCount(6);
  const toggle = panel.locator('[data-reward-task-toggle]');
  const daily = panel.locator('[data-reward-task-panel]');
  const dailyRewards = panel.locator('[data-repeatable-daily-rewards]');
  await expect(dailyRewards).toBeVisible();
  await expect(dailyRewards.locator('[data-repeatable-tier]')).toHaveCount(5);
  await expect(page.locator('[data-reward-mode-title]')).toBeHidden();
  await expect(page.locator('.reward-mode-heading')).toBeHidden();
  await expect(page.locator('[data-reward-mode-note]')).toHaveText('');
  expect(await page.locator('.reward-mode-heading').evaluate(node => node.getBoundingClientRect().height)).toBe(0);
  await expect(panel.locator('.sec-title')).toHaveText(['每日任務', '競技場連勝']);
  await expect(panel).not.toContainText('每日累積獎勵');
  await expect(dailyRewards.getByRole('heading', { name: '獎勵', exact: true })).toBeVisible();
  const streak = panel.locator('[data-repeatable-section="arena-streak"]');
  await expect(streak.locator('.reward-reference-card.panel')).toHaveCount(1);
  await expect(streak.locator('.reward-reference-heading img')).toHaveCount(0);
  for (let wins = 0; wins <= 5; wins++) {
    await expect(streak.locator('[data-repeatable-tier]').nth(wins).locator('img.reward-reference-image'))
      .toHaveAttribute('src', `/rewards/reference/${wins}_pig.png`);
  }
  expect(await streak.locator('.sec-title').evaluate(node => getComputedStyle(node, '::before').content)).toBe('""');
  await streak.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('arena-streak.png') });
  await expect(panel).not.toContainText('獎勵圖示待辨識');
  await expect(panel).not.toContainText('主表此區');
  await expect(daily).toBeHidden();
  await expect(toggle).toHaveText('查看每日任務與點數');
  await toggle.click();
  await expect(daily).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle).toHaveText('收起每日任務與點數');
  await expect(daily.locator('[data-reward-task]')).toHaveCount(8);
  await expect(daily.locator('.reward-task-day')).toHaveCount(0);
  await expect(daily.locator('[data-reward-task]').first()).toContainText('登入 ×1');
  await expect(daily.locator('[data-reward-task]').nth(1)).toContainText('150 點');
  await expect(daily.locator('[data-repeatable-tier]')).toHaveCount(0);
  await expect(dailyRewards.locator('[data-repeatable-tier]').nth(2)).toContainText('450');
  await expect(dailyRewards.locator('[data-repeatable-tier]').nth(2).locator('img'))
    .toHaveAttribute('src', '/currency/luckyDiceTicket.png');
  expect(await page.evaluate(() => localStorage.getItem('rd2-rewards-v2'))).toBe(saved);
  for (const width of isMobile ? [412, 360] : [1280]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    const aligned = await panel.locator('[data-repeatable-section]').evaluateAll(sections => sections.every(section => {
      const head = section.querySelector('.reward-list-head')!;
      const row = section.querySelector('[data-repeatable-tier]')!;
      return [...head.children].every((cell, index) =>
        Math.abs(cell.getBoundingClientRect().left - row.children[index]!.getBoundingClientRect().left) < 0.5);
    }));
    expect(aligned).toBe(true);
    expect(await streak.locator('[data-repeatable-tier]').evaluateAll(rows => {
      const heights = rows.map(row => row.getBoundingClientRect().height);
      return Math.max(...heights) - Math.min(...heights) < 0.5 && rows.every(row => {
        const image = row.querySelector('img.reward-reference-image')!.getBoundingClientRect();
        const rect = row.getBoundingClientRect();
        return image.width === 48 && image.height === 48
          && Math.abs((image.top + image.bottom - rect.top - rect.bottom) / 2) < 0.5;
      });
    })).toBe(true);
    const dailyBox = await dailyRewards.boundingBox();
    const streakBox = await streak.boundingBox();
    expect(dailyBox!.y + dailyBox!.height).toBeLessThan(streakBox!.y);
    const order = await dailyRewards.evaluate(card => {
      const rect = card.getBoundingClientRect();
      const button = card.querySelector('button')!.getBoundingClientRect();
      const lastRow = card.querySelector('ol')!.getBoundingClientRect();
      const tasks = card.nextElementSibling!.getBoundingClientRect();
      const style = getComputedStyle(card);
      return button.top >= lastRow.bottom && tasks.top >= rect.bottom
        && Math.abs(button.right - (rect.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth))) < 0.5;
    });
    expect(order).toBe(true);
  }
  await toggle.click();
  await expect(daily).toBeHidden();
  await selectMode(page, normal.id, isMobile);
  await expect(page.locator('[data-reward-mode-title]')).toHaveClass(/sec-title/);
  await expect(page.locator('.reward-mode-heading')).toBeVisible();
  await expectTotals(page, 'all', totals);
  await selectMode(page, 'repeatable', isMobile);
  await expect(daily).toBeHidden();
  await page.reload();
  await selectMode(page, 'repeatable', isMobile);
  await expect(daily).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('rd2-rewards-v2'))).toBe(saved);
  await toggle.click();
  await page.screenshot({ path: testInfo.outputPath('repeatable.png') });
});

test('RW13. 所有分類的单件收藏不顯示數量，貨幣仍顯示數量', { tag: '@mobile' }, async ({ page, isMobile }) => {
  await page.goto('/rewards');
  for (const mode of catalog.modes) {
    await selectMode(page, mode.id, isMobile);
    const grants = activePanel(page).locator('.reward-grant-content');
    expect(await grants.evaluateAll(nodes => nodes.every(node => {
      const label = node.querySelector('.reward-collectible-label');
      return label ? node.querySelector('strong')?.textContent !== '1' : !!node.querySelector('strong');
    }))).toBe(true);
  }
});

test('RW12. 門檻列排除 inline baseline 留白，圖示不撐高、checkbox 置中', { tag: '@mobile' }, async ({ page, isMobile }, testInfo) => {
  await page.goto('/rewards');
  const rows = activePanel(page).locator('[data-reward-tier]');
  const geometry = await rows.evaluateAll(elements => elements.slice(0, 3).map(row => {
    const rect = row.getBoundingClientRect();
    const box = row.querySelector('input')!.getBoundingClientRect();
    const chip = row.querySelector('.reward-grants li')!;
    const inner = chip.firstElementChild!;
    const style = getComputedStyle(chip);
    return {
      height: rect.height, centered: Math.abs((rect.top + rect.bottom) / 2 - (box.top + box.bottom) / 2),
      baselineGap: chip.getBoundingClientRect().height - inner.getBoundingClientRect().height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
      align: getComputedStyle(row).alignItems,
    };
  }));
  expect(geometry.every(row => row.centered < 0.5 && row.align === 'center' && Math.abs(row.baselineGap) < 0.5)).toBe(true);
  if (!isMobile) {
    expect(geometry[0]!.height).toBeLessThan(53);
    expect(Math.abs(geometry[0]!.height - geometry[1]!.height)).toBeLessThan(0.5);
    expect(Math.abs(geometry[1]!.height - geometry[2]!.height)).toBeLessThan(0.5);
  }
  expect(await rows.first().locator('.reward-collectible-icon').evaluateAll(images =>
    images.every(image => image.getBoundingClientRect().height <= 24))).toBe(true);
  for (const width of isMobile ? [412, 360] : [1280]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  }
  await rows.first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('compact-rows.png') });
});

async function expectTotals(page: Page, scope: 'current' | 'all', totals: Record<string, number>) {
  const positive = Object.entries(totals).filter(([, amount]) => amount > 0);
  const currencies = positive.filter(([key]) => key.startsWith('currency:'));
  const collectibles = positive.filter(([key]) => !key.startsWith('currency:'));
  for (const [kind, entries] of [['currency', currencies], ['collectible', collectibles]] as const) {
    await expect(page.locator(`[data-reward-summary-kind="${scope}-${kind}"]`))
      [entries.length > 0 ? 'toBeVisible' : 'toBeHidden']();
    await expect(totalsGroup(page, scope, kind).locator('[data-total-reward]')).toHaveCount(entries.length);
  }
  await expect(page.locator(`[data-reward-empty="${scope}"]`))
    [positive.length === 0 ? 'toBeVisible' : 'toBeHidden']();
  for (const [key, amount] of currencies) {
    await expect(totalsGroup(page, scope, 'currency').locator(`[data-total-reward="${key}"] strong`))
      .toHaveText(amount.toLocaleString('en-US'));
  }
  for (const [key] of collectibles) {
    const item = totalsGroup(page, scope, 'collectible').locator(`[data-total-reward="${key}"]`);
    await expect(item).toBeVisible();
    await expect(item.locator('strong')).toHaveCount(0);
    await expect(item.locator('dd')).toHaveAttribute('aria-label', /\S+/);
  }
}

async function selectMode(page: Page, id: string, mobile?: boolean) {
  // 發版時完整 mobile 也會執行共用行為測試；依可見的 selector 操作，不點隱藏側欄。
  const selector = page.locator('[data-reward-mode-select]');
  if (mobile ?? await selector.isVisible()) await selector.selectOption(id);
  else await page.locator(`[data-reward-mode-option="${id}"]`).click();
  await expect(page.locator('[data-rewards-page]')).toHaveAttribute('data-active-mode', id);
}

test('RW1. 六分類切換均顯示正式資料，全域摘要位於分類標題上方', { tag: '@mobile' }, async ({ page }) => {
  await page.goto('/rewards');
  await expect(page.locator('[data-reward-mode-option]')).toHaveText([...catalog.modes.map(mode => mode.name), '重複性獎勵']);
  await expect(page.locator('.reward-data-note')).toHaveCount(0);
  await expect(page.locator('#reward-totals-all')).toHaveText('已領取的總獎勵');
  expect(await page.locator('.reward-global-summary').evaluate(element => {
    const heading = document.querySelector('.reward-mode-heading');
    return heading !== null && Boolean(element.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING);
  })).toBe(true);
  for (const mode of catalog.modes) {
    await selectMode(page, mode.id);
    await expect(page.locator('[data-reward-mode-title]')).toHaveText(mode.name);
    if (mode.kind === 'threshold') {
      await expect(activePanel(page).locator('[data-reward-tier]')).toHaveCount(mode.tiers.length);
      await expect(activePanel(page).locator('.reward-list-head span').first()).toHaveText(mode.requirementLabel);
      const requirements = await activePanel(page).locator('[data-reward-tier]').evaluateAll(rows =>
        rows.map(row => Number((row as HTMLElement).dataset.requirement)));
      expect(requirements).toEqual(sortedRewardTiers(mode.tiers).map(tier => tier.requirement));
    } else {
      await expect(activePanel(page).locator('[data-reward-achievement-group]')).toHaveCount(39);
      await expect(page.locator('[data-reward-achievement-controls]')).toBeVisible();
      await expect(page.locator('[data-reward-threshold-controls]')).toBeHidden();
    }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
});

test('RW2. 門檻進度、圖片、收藏 fallback、跨分類總計與 reload', { tag: '@mobile' }, async ({ page }) => {
  await page.goto('/rewards');
  await page.locator('[data-reward-progress-input]').fill('7700');
  await page.locator('[data-reward-progress-form] button[type="submit"]').click();
  const normalTotals = rewardTotals(normal, 7700);
  await expectTotals(page, 'current', normalTotals);
  await expectTotals(page, 'all', normalTotals);
  await expect(page.locator('[data-reward-summary-kind="current-currency"] h5')).toHaveText('固定貨幣');
  await expect(page.locator('[data-reward-summary-kind="current-collectible"] h5')).toHaveText('收藏型獎勵');
  await expect(page.locator('[data-reward-summary-kind="all-currency"] h3')).toHaveText('固定貨幣');
  await expect(page.locator('[data-reward-summary-kind="all-collectible"] h3')).toHaveText('收藏型獎勵');
  await expect(totalsGroup(page, 'current', 'collectible')).toContainText('貪婪骰子');
  await expect(totalsGroup(page, 'all', 'collectible')).toContainText('simple 橫幅');
  await expect(page.locator('[data-reward-completed-count]')).toHaveText(
    String(normal.tiers.filter(tier => tier.requirement <= 7700).length));
  await expect(activePanel(page).locator('img[src^="/assets/dice3-icons/"]')).toHaveCount(1);
  await expect(activePanel(page).locator('img[src^="/rewards/cosmetic/"]')).toHaveCount(4);
  expect((await page.request.get('/rewards/cosmetic/Profile_Banner_simple.png')).ok()).toBe(true);
  expect((await page.request.get('/assets/dice3-icons/dfc31835bd58.webp')).ok()).toBe(true);
  await selectMode(page, 'raid-hard');
  await page.locator('[data-reward-progress-input]').fill('9000');
  await page.locator('[data-reward-progress-form] button[type="submit"]').click();
  await expect(activePanel(page).getByLabel('STOP 表情 1')).toHaveCount(1);
  await expect(activePanel(page).getByLabel('NO_SIGN 表情 1')).toHaveCount(1);
  const combined = rewardTotalsAcrossModes(catalog.modes, { 'raid-normal': 7700, 'raid-hard': 9000 });
  await expectTotals(page, 'all', combined);
  await page.reload();
  await expectTotals(page, 'all', combined);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('rd2-rewards-v2') ?? 'null')))
    .toEqual({ v: 2, currentProgress: { 'raid-hard': 9000, 'raid-normal': 7700 }, achievementProgress: {} });
});

test('RW3. 門檻高階勾選與低階取消維持單一進度，清此頁不清其他頁', { tag: '@mobile' }, async ({ page }) => {
  await page.goto('/rewards');
  const ordered = sortedRewardTiers(normal.tiers);
  const high = ordered[0]!;
  const low = ordered.at(-2)!;
  const beforeLow = ordered.at(-1)!;
  await activePanel(page).locator(`[data-reward-tier-checkbox][value="${high.requirement}"]`).check();
  await expect(page.locator('[data-reward-progress-input]')).toHaveValue(String(high.requirement));
  await activePanel(page).locator(`[data-reward-tier-checkbox][value="${low.requirement}"]`).uncheck();
  await expect(page.locator('[data-reward-progress-input]')).toHaveValue(String(beforeLow.requirement));
  await expect(activePanel(page).locator(`[data-reward-tier-checkbox][value="${high.requirement}"]`)).not.toBeChecked();
  await selectMode(page, 'arena-pass');
  await page.locator('[data-reward-progress-input]').fill('300');
  await page.locator('[data-reward-progress-form] button[type="submit"]').click();
  await selectMode(page, 'raid-normal');
  await page.locator('[data-reward-clear]').click();
  await expectTotals(page, 'current', {});
  await expectTotals(page, 'all', rewardTotals(thresholds[2]!, 300));
});

test('RW4. 成就同組階段連動、跨組獨立、總計、清此頁與 reload', { tag: '@mobile' }, async ({ page }) => {
  await page.goto('/rewards');
  await page.locator('[data-reward-progress-input]').fill('500');
  await page.locator('[data-reward-progress-form] button[type="submit"]').click();
  const thresholdTotals = rewardTotals(normal, 500);
  await selectMode(page, 'achievements');
  const group = activePanel(page).locator('[data-reward-achievement-group]').filter({ has: page.locator('summary', { hasText: firstGroup.name }) }).first();
  await group.locator('summary').click();
  await group.locator('[data-reward-stage-checkbox][value="2"]').check();
  await expect(group.locator('[data-reward-stage-checkbox][value="1"]')).toBeChecked();
  await expect(group.locator('[data-reward-group-completed]')).toHaveText('2');
  const other = activePanel(page).locator('[data-reward-achievement-group]').filter({ has: page.locator('summary', { hasText: secondGroup.name }) }).first();
  await expect(other.locator('[data-reward-group-completed]')).toHaveText('0');
  await expectTotals(page, 'current', achievementTotals(achievements, { [firstGroup.id]: 2 }));
  await expectTotals(page, 'all', rewardTotalsAcrossModes(catalog.modes, { 'raid-normal': 500 }, { [firstGroup.id]: 2 }));
  await group.locator('[data-reward-stage-checkbox][value="1"]').uncheck();
  await expect(group.locator('[data-reward-stage-checkbox][value="2"]')).not.toBeChecked();
  await group.locator('[data-reward-stage-checkbox][value="2"]').check();
  await page.reload();
  await selectMode(page, 'achievements');
  await expect(activePanel(page).locator('[data-reward-achievement-group]').first().locator('[data-reward-group-completed]'))
    .toHaveText('2');
  await page.locator('[data-reward-clear-achievements]').click();
  await expectTotals(page, 'current', {});
  await expectTotals(page, 'all', thresholdTotals);
});

test('RW5. 清除全部需確認，取消不動資料，確認後六類與舊 key 都清空', { tag: '@mobile' }, async ({ page }) => {
  await page.goto('/rewards');
  await page.locator('[data-reward-progress-input]').fill('500');
  await page.locator('[data-reward-progress-form] button[type="submit"]').click();
  await selectMode(page, 'achievements');
  const group = activePanel(page).locator('[data-reward-achievement-group]').first();
  await group.locator('summary').click();
  await group.locator('[data-reward-stage-checkbox][value="1"]').check();
  const before = await page.evaluate(() => localStorage.getItem('rd2-rewards-v2'));
  await page.locator('[data-reward-clear-all]').click();
  const dialog = page.locator('[data-reward-clear-dialog]');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '取消' }).click();
  expect(await page.evaluate(() => localStorage.getItem('rd2-rewards-v2'))).toBe(before);
  await page.locator('[data-reward-clear-all]').click();
  await dialog.getByRole('button', { name: '清除全部進度' }).click();
  await expectTotals(page, 'current', {});
  await expectTotals(page, 'all', {});
  expect(await page.evaluate(() => localStorage.getItem('rd2-rewards-v2'))).toBeNull();
  await page.reload();
  await expectTotals(page, 'all', {});
  for (const mode of catalog.modes) {
    await selectMode(page, mode.id);
    await expectTotals(page, 'current', {});
  }
});

test('RW7. 鯊魚造型及三種人工核准表情使用正式完整圖片', { tag: '@mobile' }, async ({ page }) => {
  await page.goto('/rewards');
  await selectMode(page, 'hunt-event');
  await expect(activePanel(page).getByLabel('target 表情 1')).toContainText('target 表情');
  await expect(activePanel(page).getByLabel('吞噬骰子－鯊魚造型 1')).toContainText('吞噬骰子－鯊魚造型');
  await expect(activePanel(page).getByLabel('吞噬骰子－鯊魚造型 1').locator('img'))
    .toHaveAttribute('src', '/rewards/cosmetic/Dice_Predator3_skin1.png');
  expect((await page.request.get('/rewards/cosmetic/Dice_Predator3_skin1.png')).ok()).toBe(true);
  await page.locator('[data-reward-progress-input]').fill('7000');
  await page.locator('[data-reward-progress-form] button[type="submit"]').click();
  for (const scope of ['current', 'all'] as const) {
    await expect(totalsGroup(page, scope, 'collectible')).toContainText('target 表情');
    await expect(totalsGroup(page, scope, 'collectible')).toContainText('吞噬骰子－鯊魚造型');
    await expect(totalsGroup(page, scope, 'collectible').locator('img')).toHaveCount(2);
  }
  await selectMode(page, 'raid-hard');
  await expect(activePanel(page).getByLabel('STOP 表情 1')).toContainText('STOP 表情');
  await expect(activePanel(page).getByLabel('NO_SIGN 表情 1')).toContainText('NO_SIGN 表情');
  for (const name of ['STOP', 'NO_SIGN']) {
    const reward = activePanel(page).getByLabel(`${name} 表情 1`);
    await expect(reward.locator('img')).toHaveAttribute('src', `/rewards/emote/${name}.png`);
    await expect(reward.locator('.reward-collectible-fallback')).toHaveCount(0);
  }
});

test('RW10. 完整摘要固定排序、名稱及桌機／手機換行，清除後維持正確內容', { tag: '@mobile' }, async ({ page, isMobile }) => {
  await page.goto('/rewards');
  for (const mode of thresholds) {
    await selectMode(page, mode.id, isMobile);
    await page.locator('[data-reward-progress-input]').fill('999999999');
    await page.locator('[data-reward-progress-form] button[type="submit"]').click();
  }
  const currencyOrder = ['gold', 'core', 'skinCoin', 'treeSeed', 'coopTicket', 'arenaTicket']
    .map(kind => `currency:${kind}`);
  await expect(totalsGroup(page, 'all', 'currency').locator('[data-total-reward]'))
    .toHaveCount(currencyOrder.length);
  expect(await totalsGroup(page, 'all', 'currency').locator('[data-total-reward]').evaluateAll(items =>
    items.map(item => item.getAttribute('data-total-reward')))).toEqual(currencyOrder);
  const summary = totalsGroup(page, 'all', 'collectible');
  const labels = await summary.innerText();
  for (const label of ['青兒頭像', '迪奇頭像', '里克頭像', '艾科頭像']) expect(labels).toContain(label);
  expect(labels).not.toMatch(/工程系頭像|入侵系頭像/);
  const keys = await summary.locator('[data-total-reward]').evaluateAll(items =>
    items.map(item => item.getAttribute('data-total-reward')));
  expect(keys.indexOf('cosmetic:UNIQUE:Dice_Predator3_skin1')).toBeLessThan(keys.indexOf('emote:UNIQUE:target'));
  expect(keys.indexOf('emote:UNIQUE:target')).toBeLessThan(keys.indexOf('cosmetic:RAW:Profile_Banner_simple'));
  expect(keys.indexOf('cosmetic:RAW:Profile_Banner_Hard_Clear')).toBeLessThan(keys.indexOf('cosmetic:RAW:Profile_nature'));
  expect(keys.indexOf('cosmetic:RAW:profile_arena')).toBeLessThan(keys.indexOf('cosmetic:RAW:rd2_ui_profile_rank_border_bronze'));
  await expect(summary.locator('[data-total-reward="cosmetic:UNIQUE:Dice_Predator3_skin1"] img'))
    .toHaveAttribute('src', '/rewards/cosmetic/Dice_Predator3_skin1.png');
  await expect(summary).toContainText('吞噬骰子－鯊魚造型');
  expect(labels).not.toContain('Predator3 skin1');
  for (const name of ['target', 'STOP', 'NO_SIGN']) {
    const icon = summary.locator(`img[src="/rewards/emote/${name}.png"]`);
    await expect(icon).toBeVisible();
    expect(await icon.evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
    await expect(icon.locator('xpath=ancestor::dd')).toHaveAttribute('aria-label', `${name} 表情`);
  }
  await expect(summary.locator('.reward-collectible-fallback')).toHaveCount(0);
  for (const width of isMobile ? [412, 360] : [1280]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  }
  await page.locator('[data-reward-clear]').click();
  await expectTotals(page, 'current', {});
  const remaining = Object.fromEntries(thresholds.filter(mode => mode.id !== 'hunt-event').map(mode => [mode.id, 999999999]));
  await expectTotals(page, 'all', rewardTotalsAcrossModes(catalog.modes, remaining));
  await page.locator('[data-reward-clear-all]').click();
  await page.locator('[data-reward-clear-dialog]').getByRole('button', { name: '清除全部進度' }).click();
  await expectTotals(page, 'all', {});
  await page.reload();
  await expectTotals(page, 'all', {});
});

test('RW9. 旅程與狩獵每日任務預設收起、展開顯示正式點數，不寫入 storage', { tag: '@mobile' }, async ({ page }) => {
  await page.goto('/rewards');
  for (const [modeId, dayCount, taskCount, firstDayTotal] of [
    ['journey-7day', 7, 35, '600'],
    ['hunt-event', 14, 70, '500'],
  ] as const) {
    await selectMode(page, modeId);
    const button = page.locator('[data-reward-task-toggle]:visible');
    const panel = page.locator(`[data-reward-task-panel="${modeId}"]`);
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toBeHidden();
    const storageBefore = await page.evaluate(() => localStorage.getItem('rd2-rewards-v2'));
    await button.click();
    await expect(button).toHaveText('收起每日任務與點數');
    await expect(button).toHaveAttribute('aria-controls', `reward-task-panel-${modeId}`);
    await expect(panel).toBeVisible();
    await expect(panel.locator('.reward-task-day')).toHaveCount(dayCount);
    await expect(panel.locator('[data-reward-task]')).toHaveCount(taskCount);
    await expect(panel.locator('.reward-task-day').first()).toContainText(`當日合計 ${firstDayTotal} 點`);
    await expect(panel.locator('[data-reward-task]').first()).toContainText('登入 ×1');
    await expect(panel.locator('[data-reward-task]').first()).toContainText('100 點');
    await expect(panel.locator('input[type="checkbox"]')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('rd2-rewards-v2'))).toBe(storageBefore);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    await button.click();
    await expect(panel).toBeHidden();
  }
  await page.reload();
  await selectMode(page, 'journey-7day');
  await expect(page.locator('[data-reward-task-toggle]:visible')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('[data-reward-task-panel="journey-7day"]')).toBeHidden();
});

test('RW8. 舊版 v1 討伐最高紀錄安全遷移，不把測試期 totals 留在存檔', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('rd2-rewards-v1', JSON.stringify({
    v: 1, currentProgress: { 'raid-normal': 7700, unknown: 99 }, totals: { gold: 999999 },
  })));
  await page.goto('/rewards');
  await expect(page.locator('[data-reward-progress-input]')).toHaveValue('7700');
  await expectTotals(page, 'all', rewardTotals(normal, 7700));
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('rd2-rewards-v2') ?? 'null')))
    .toEqual({ v: 2, currentProgress: { 'raid-normal': 7700 }, achievementProgress: {} });
  expect(await page.evaluate(() => localStorage.getItem('rd2-rewards-v1'))).toBeNull();
});

test('RW6. 手機六類 selector、成就操作與 360px 無水平溢出', { tag: '@mobile' }, async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', '手機版專屬驗證');
  await page.goto('/rewards');
  await expect(page.locator('[data-reward-mode-select]')).toBeVisible();
  await expect(page.locator('.reward-mode-nav')).toBeHidden();
  for (const mode of catalog.modes) {
    await selectMode(page, mode.id, true);
    await expect(page.locator('[data-reward-mode-title]')).toHaveText(mode.name);
    if (mode.id === 'journey-7day' || mode.id === 'hunt-event') {
      await expect(page.locator(`[data-reward-task-panel="${mode.id}"]`)).toBeHidden();
      await page.locator('[data-reward-task-toggle]:visible').click();
      await expect(page.locator(`[data-reward-task-panel="${mode.id}"]`)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    }
  }
  const group = activePanel(page).locator('[data-reward-achievement-group]').first();
  await group.locator('summary').click();
  await group.locator('[data-reward-stage-checkbox][value="1"]').check();
  await expect(page.locator('[data-reward-completed-count]')).toHaveText('1');
  for (const width of [412, 360]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  }
  for (const modeId of ['journey-7day', 'hunt-event']) {
    await selectMode(page, modeId, true);
    await page.locator('[data-reward-task-toggle]:visible').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    const box = await page.locator('[data-reward-task-toggle]:visible').boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
  }
});
