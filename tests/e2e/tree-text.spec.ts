import { test, expect, type Page } from './fixtures';
import { readTree } from '../helpers/read-tree';

// 描述、覺醒、關鍵字解釋在另一包（tree-text.json → /_astro/tree-text.*.js），比 /tree、/sim 的腳本晚到
// （src/lib/tree-client.ts）。這裡把那一包擋住再放行，驗「還沒到」與「到了之後」各自的畫面；
// 單元測試（tests/scripts/tree-canvas.test.ts）守同一件事的邏輯，這裡守真的打包、真的分開載。

const tree = readTree();
const DICE = tree.nodes.find(n => n.id === '1002')!;   // 有覺醒的骰子

const ready = (page: Page) => page.waitForFunction(() => Boolean(window.__tree));

/** 擋住文字包；回傳的函式放行。順帶記下有沒有真的攔到（檔名改了這支就會靜靜失效）。 */
async function holdTreeText(page: Page): Promise<{ release: () => void; hits: () => number }> {
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  let hits = 0;
  await page.route('**/_astro/tree-text.*.js', async route => {
    hits += 1;
    await gate;
    await route.continue();
  });
  return { release, hits: () => hits };
}

test('TX1. /tree 帶 ?node= 進站：文字包沒到時樹與選取先有、卡片不開；到了才開，描述與覺醒入口都在', async ({ page }) => {
  const text = await holdTreeText(page);
  await page.goto(`/tree/?node=${DICE.id}`);
  await ready(page);
  expect(await page.evaluate(() => window.__tree.count().nodes)).toBe(tree.nodes.length);
  await expect.poll(text.hits).toBe(1);
  // 選取、前置鏈、網址不等文字；只有卡片還沒開
  const st = await page.evaluate(() => window.__tree.state() as { selected: string | null; chain: string[] });
  expect(st.selected).toBe(DICE.id);
  expect(st.chain.length).toBeGreaterThan(0);
  await expect(page.locator('#detail')).toBeHidden();

  text.release();
  await expect(page.locator('#detail')).toBeVisible();
  await expect(page.locator('#detail h2').first()).toHaveText(DICE.name);
  await expect(page.locator('#detail .desc').first()).not.toBeEmpty();
  await expect(page.locator('#detail [data-detail-awakening]')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`node=${DICE.id}`));
});

test('TX2. /sim 帶 ?node= 落地：文字包沒到時選取已在、詳情面板還是空的；到了才畫，描述在', async ({ page }) => {
  const text = await holdTreeText(page);
  await page.goto(`/sim/?node=${DICE.id}`);
  await ready(page);
  await expect.poll(text.hits).toBe(1);
  // /sim 的選取不在 `__tree.state()` 裡（見 sim.spec.ts 檔頭），問無障礙按鈕上的 aria-current。
  await expect(page.locator(`button[data-id="${DICE.id}"]`)).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('#sim-detail')).toHaveClass(/empty/);

  text.release();
  await expect(page.locator('#sim-detail h3')).toHaveText(DICE.name);
  await expect(page.locator('#sim-detail .desc')).not.toBeEmpty();
});

test('TX3. 文字包載不到：頁面照常運作，卡片開得起來，只是沒有描述', async ({ page }) => {
  await page.route('**/_astro/tree-text.*.js', route => route.abort());
  await page.goto(`/tree/?node=${DICE.id}`);
  await ready(page);
  await expect(page.locator('#detail')).toBeVisible();
  await expect(page.locator('#detail h2').first()).toHaveText(DICE.name);
  await expect(page.locator('#detail .desc').first()).toBeEmpty();
  // 搜尋名稱還能用
  await page.locator('#search').fill(DICE.name);
  await expect.poll(() => page.evaluate(id => (window.__tree.state() as { filteredOut: string[] }).filteredOut.includes(id), DICE.id)).toBe(false);
});
