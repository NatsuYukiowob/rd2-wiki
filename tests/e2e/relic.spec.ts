// 神器（/relic）。跟 /rift-shop 同一族的靜態頁：核心承諾是「文字進得了 HTML」。
import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures';
import { costRows, critBands, potRows, relicUnit, rewardText } from '../../src/lib/relic';
import type { Relic, RelicCrystal, RelicLevels } from '../../src/lib/types';

const relics: Relic[] = JSON.parse(readFileSync(new URL('../../data/relics.json', import.meta.url), 'utf8'));
const levels: RelicLevels = JSON.parse(readFileSync(new URL('../../data/relic-levels.json', import.meta.url), 'utf8'));
const crystal: RelicCrystal = JSON.parse(readFileSync(new URL('../../data/relic-crystal.json', import.meta.url), 'utf8'));

test('RL1. /relic 的名稱與每一級的數值是伺服器輸出的 HTML（收合的逐級表也在）', async ({ request }) => {
  const res = await request.get('/relic');
  expect(res.status()).toBe(200);
  const html = await res.text();

  expect(relics.length).toBeGreaterThan(0);
  expect(relics.filter(r => !html.includes(r.name)).map(r => r.name)).toEqual([]);
  // 逐級表收在 <details> 裡，但格子本身要在 HTML 裡——搜尋引擎與 Ctrl+F 才找得到。
  // 這裡只驗「在不在 HTML」；「每一種的表裝的是不是自己的數值」由 RL1b 逐表比對
  // （數值在神器之間大量重複，整頁 includes 分不出表接錯）。
  expect(html).toContain(`>${relics[0]!.values[0]![1]}${relicUnit(relics[0]!.effect, 0)}<`);
});

test('RL1b. 每一種神器自己的逐級表：欄名、列數與每一格都等於資料', async ({ page }) => {
  await page.goto('/relic');
  for (const r of relics) {
    const table = page.locator(`#r${r.id} table`);
    const head = await table.locator('thead th').evaluateAll(els => els.map(el => el.textContent!.trim()));
    expect(head, r.name).toEqual(['等級', ...(r.valueLabels ?? ['數值'])]);
    const cells = await table.locator('tbody tr').evaluateAll(rows => rows.map(row => [...row.children].map(c => c.textContent!.trim())));
    const want = r.values[0]!.map((_, lv) => [String(lv + 1), ...r.values.map((list, k) => `${list[lv]}${relicUnit(r.effect, k)}`)]);
    expect(cells, r.name).toEqual(want);
  }
  // 佔位一定要全部填掉（只看內容區的字，不掃 inline script）。
  expect(await page.locator('main').evaluate(el => el.textContent ?? '')).not.toMatch(/\{\d+\}|undefined|NaN/);
});

test('RL2. 圖示格照遊戲順序排，每一格連到同一頁那一種神器的說明', { tag: '@mobile' }, async ({ page, isMobile }) => {
  await page.goto('/relic');
  const cells = page.locator('.relic-grid .relic-cell');
  await expect(cells).toHaveCount(relics.length);
  expect(await cells.evaluateAll(els => els.map(el => el.textContent!.trim()))).toEqual(relics.map(r => r.name));
  for (const r of relics) await expect(page.locator(`#r${r.id} .battle-name`)).toHaveText(r.name);
  expect(await cells.evaluateAll(els => els.map(el => el.getAttribute('href')))).toEqual(relics.map(r => `#r${r.id}`));

  // 欄數：手機 4 欄（＝遊戲內），桌機 6 欄。量同一列的格數，不量 CSS 字串。
  const tops = await cells.evaluateAll(els => els.map(el => Math.round(el.getBoundingClientRect().top)));
  expect(tops.filter(t => t === tops[0]).length).toBe(isMobile ? 4 : 6);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('RL3. 每一張神器圖都真的存在，格子與說明用同一張，而且不裁切', async ({ page, request }) => {
  await page.goto('/relic');
  const gridSrcs = await page.locator('.relic-cell img').evaluateAll(els => els.map(el => el.getAttribute('src') ?? ''));
  const listSrcs = await page.locator('.battle-icon').evaluateAll(els => els.map(el => el.getAttribute('src') ?? ''));
  expect(gridSrcs).toEqual(relics.map(r => `/assets/relic-icons/${r.icon}.webp`));
  expect(listSrcs).toEqual(gridSrcs);
  await expect(page.locator('.relic-cell img').first()).toHaveCSS('object-fit', 'contain');
  // 不用 naturalWidth（loading="lazy"），逐個網址發請求，理由同 battle.spec 的 B5。
  const bad: string[] = [];
  for (const src of gridSrcs) if ((await request.get(src)).status() !== 200) bad.push(src);
  expect(bad).toEqual([]);
});

test('RL4. 升級花費與收藏等級兩張表的列數與累計等於資料算出來的', async ({ page }) => {
  await page.goto('/relic');
  const costs = costRows(levels.pieces, levels.gold);
  const costTable = page.locator('[aria-labelledby="relic-cost"] tbody tr');
  await expect(costTable).toHaveCount(costs.length);
  const last = costs[costs.length - 1]!;
  await expect(costTable.last()).toContainText(last.sumGold.toLocaleString('en-US'));
  await expect(costTable.last()).toContainText(last.sumPieces.toLocaleString('en-US'));

  const bands = critBands(levels.critDamage, levels.critStep);
  const bandTable = page.locator('[aria-labelledby="relic-collection"] tbody tr');
  await expect(bandTable).toHaveCount(bands.length);
  await expect(bandTable.last()).toContainText(`+${bands[bands.length - 1]!.total.toLocaleString('en-US')}%`);
});

test('RL5. 入口收在「遊戲介紹」下拉裡，下拉會標成目前分頁', async ({ page }) => {
  await page.goto('/relic');
  await expect(page.locator('#site-nav .nav-menu-items a:text-is("神器")')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#site-nav .nav-menu > summary')).toHaveAttribute('aria-current', 'page');
});

test('RL6. 逐級數值預設收合，展開後看得到 20 級', async ({ page }) => {
  await page.goto('/relic');
  const first = page.locator(`#r${relics[0]!.id}`);
  await expect(first.locator('tbody')).toBeHidden();
  await first.locator('summary').click();
  await expect(first.locator('tbody tr')).toHaveCount(relics[0]!.values[0]!.length);
  await expect(first.locator('tbody tr').last()).toBeVisible();
});

test('RL7. 覺醒之甕與神器通行證兩張表逐格等於資料', async ({ page }) => {
  await page.goto('/relic');
  const cells = (id: string) => page.locator(`[aria-labelledby="${id}"] tbody tr`)
    .evaluateAll(rows => rows.map(tr => [...tr.children].map(td => td.textContent!.trim())));
  expect(await cells('relic-pot')).toEqual(
    potRows(crystal.pot.tiers).map(t => [t.points.toLocaleString('en-US'), rewardText(t), t.total.map(rewardText).join('、')]));
  expect(await cells('relic-pass')).toEqual(crystal.pass.map(p => [p.mission, rewardText(p.free), rewardText(p.paid)]));
  // 表外的重複獎勵寫在說明文字裡。
  await expect(page.locator('#relic-pot + .note')).toContainText(`每再累積 ${crystal.pot.repeatPoints.toLocaleString('en-US')} 點可以再領 ${rewardText(crystal.pot.repeatReward)}`);
});
