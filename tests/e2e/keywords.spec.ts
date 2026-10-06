import { test, expect, type Page } from './fixtures';
import { readFileSync } from 'node:fs';
import { GUIDE_TABS } from '../../src/lib/glossary-groups';

// /guide/keywords「遊戲名詞」：四個詞彙分類合併成一頁（2026-09-27 Yuki 裁決），按鈕切換分類。
const visiblePanels = (page: Page) => page.locator('[data-kw-panel]:visible');

test('KW1. 預設顯示第一個分類，按鈕切換後只剩該分類，網址帶 ?tab=', { tag: '@mobile' }, async ({ page }) => {
  await page.goto('/guide/keywords');
  await expect(page).toHaveTitle('Random Dice 2 wiki | 遊戲名詞');
  const buttons = page.locator('[data-kw-tab]');
  await expect(buttons).toHaveCount(GUIDE_TABS.length);
  await expect(visiblePanels(page)).toHaveCount(1);
  await expect(visiblePanels(page)).toHaveAttribute('data-kw-panel', GUIDE_TABS[0]!.slug);
  for (const tab of GUIDE_TABS) {
    await page.locator(`[data-kw-tab="${tab.slug}"]`).click();
    await expect(visiblePanels(page)).toHaveCount(1);
    await expect(visiblePanels(page)).toHaveAttribute('data-kw-panel', tab.slug);
    await expect(page.locator(`[data-kw-tab="${tab.slug}"]`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-kw-tab][aria-pressed="true"]')).toHaveCount(1);
    expect(new URL(page.url()).searchParams.get('tab')).toBe(tab.slug);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  }
  await page.reload();
  await expect(visiblePanels(page)).toHaveAttribute('data-kw-panel', GUIDE_TABS.at(-1)!.slug);
});

test('KW2. ?tab= 與 #錨點 都會切到對應分類，錨點的詞條捲進畫面', async ({ page }) => {
  await page.goto('/guide/keywords?tab=status');
  await expect(visiblePanels(page)).toHaveAttribute('data-kw-panel', 'status');

  const id = await page.locator('[data-kw-panel="monsters"] .kw-entry').first().getAttribute('id');
  await page.goto(`/guide/keywords#${id}`);
  await expect(visiblePanels(page)).toHaveAttribute('data-kw-panel', 'monsters');
  await expect(page.locator(`#${id}`)).toBeInViewport();
});

test('KW3. 詞條解釋裡連到別的分類的 #關鍵字，點下去切到那個分類', async ({ page }) => {
  await page.goto('/guide/keywords');
  // 找一條「連結目標在別的分類」的連結；資料一改就換一條，不寫死詞。
  const cross = await page.evaluate(() => {
    for (const link of document.querySelectorAll<HTMLAnchorElement>('[data-kw-panel] .kw-entry a.kw-link')) {
      const from = link.closest<HTMLElement>('[data-kw-panel]')!.dataset.kwPanel!;
      const id = new URL(link.href).hash.slice(1);
      const to = document.getElementById(id)?.closest<HTMLElement>('[data-kw-panel]')?.dataset.kwPanel;
      if (to && to !== from) return { from, to, id };
    }
    return null;
  });
  expect(cross, '全部詞條解釋裡沒有跨分類的連結，這條測試要換一種寫法').not.toBeNull();
  await page.locator(`[data-kw-tab="${cross!.from}"]`).click();
  await page.locator(`[data-kw-panel="${cross!.from}"] .kw-entry a.kw-link[href$="#${cross!.id}"]`).first().click();
  await expect(visiblePanels(page)).toHaveAttribute('data-kw-panel', cross!.to);
  await expect(page.locator(`#${cross!.id}`)).toBeInViewport();
});

test('KW4. 沒有 JS 時四個分類全部攤開、切換鈕不出現', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/guide/keywords');
  await expect(page.locator('[data-kw-tabs]')).toBeHidden();
  await expect(visiblePanels(page)).toHaveCount(GUIDE_TABS.length);
  await context.close();
});

test('KW5. 舊的四個網址都有 301 轉到新頁的對應分類', async () => {
  // 本機的 `serve dist` 不讀 _redirects（那是 Cloudflare Pages 的行為），這裡驗產物內容；
  // 正式站的驗收見 CLAUDE.md 部署一節。
  const rules = readFileSync('dist/_redirects', 'utf8').split('\n')
    .filter(line => line.trim() && !line.startsWith('#')).map(line => line.trim().split(/\s+/));
  for (const tab of GUIDE_TABS) {
    for (const from of [`/guide/${tab.slug}`, `/guide/${tab.slug}/`]) {
      expect(rules, from).toContainEqual([from, `/guide/keywords/?tab=${tab.slug}`, '301']);
    }
  }
});
