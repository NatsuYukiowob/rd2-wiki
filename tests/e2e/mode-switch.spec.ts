import { test, expect, type Page } from './fixtures';
import { readTree } from '../helpers/read-tree';

// /tree ⇄ /sim 的模式切換（src/components/ModeSwitch.astro、src/lib/mode-switch.ts）。
// 「視角帶過去」的判準是**可視區中心**對同一個 world 點、倍率相同：/sim 桌機右邊常駐側欄，
// 可視區是 host 扣掉側欄，不是整個 #canvas-host。

const nodes = (readTree() as { nodes: { id: string; name: string }[] }).nodes;
const nameOf = (id: string) => nodes.find(n => n.id === id)!.name;

const ready = (page: Page) => page.waitForFunction(() => Boolean(window.__tree));

/** 節點中心相對「可視區中心」的位移（CSS px）。 */
async function offsetFromVisibleCenter(page: Page, id: string): Promise<[number, number]> {
  return page.evaluate(nodeId => {
    const host = document.getElementById('canvas-host')!.getBoundingClientRect();
    const panel = document.getElementById('sim-panel');
    const right = panel && panel.getBoundingClientRect().width > 0 && getComputedStyle(panel).position !== 'static'
      ? Math.min(host.right, panel.getBoundingClientRect().left) : host.right;
    const r = window.__tree.nodeScreenRect(nodeId)!;
    return [r.left + r.width / 2 - (host.left + right) / 2, r.top + r.height / 2 - (host.top + host.bottom) / 2];
  }, id);
}

test('MS1. 瀏覽 → 模擬：帶著選取與視角過去，只選取不取得，網址參數拿掉', async ({ page }) => {
  await page.goto('/sim/');
  await ready(page);
  const owned = await page.locator('#sim-owned-count').textContent();

  // 1201 是「前置齊了就能取得」的節點：落地若走 activate() 會直接被買下。
  await page.goto('/tree/?node=1201');
  await ready(page);
  await page.waitForTimeout(600);   // centerOnSelected 的緩動平移
  const scale = await page.evaluate(() => window.__tree.scale());
  const at = await offsetFromVisibleCenter(page, '1201');

  await page.locator('#toolbar [data-mode-switch]').click();
  await page.waitForURL(u => u.pathname === '/sim/');
  await ready(page);
  await expect(page).toHaveURL(/\/sim\/$/);
  await expect(page.locator('#sim-owned-count')).toHaveText(owned!);
  await expect(page.locator('#sim-detail h3')).toHaveText(nameOf('1201'));
  expect(await page.evaluate(() => window.__tree.scale())).toBeCloseTo(scale, 2);
  const at2 = await offsetFromVisibleCenter(page, '1201');
  expect(Math.abs(at2[0] - at[0]), `水平位移 ${at[0]} → ${at2[0]}`).toBeLessThan(2);
  expect(Math.abs(at2[1] - at[1]), `垂直位移 ${at[1]} → ${at2[1]}`).toBeLessThan(2);
});

test('MS2. 模擬 → 瀏覽：沒選節點時也帶回倍率與可視區中心，view 從網址拿掉', async ({ page }) => {
  await page.goto('/sim/');
  await ready(page);
  const host = await page.locator('#canvas-host').boundingBox();
  await page.mouse.move(host!.x + 300, host!.y + 300);
  for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(60); }
  await page.waitForTimeout(400);
  const scale = await page.evaluate(() => window.__tree.scale());
  const at = await offsetFromVisibleCenter(page, '1201');

  await page.locator('#sim-toolbar [data-mode-switch]').click();
  await page.waitForURL(u => u.pathname === '/tree/');
  await ready(page);
  await expect(page).toHaveURL(/\/tree\/$/);
  expect(await page.evaluate(() => window.__tree.scale())).toBeCloseTo(scale, 2);
  const at2 = await offsetFromVisibleCenter(page, '1201');
  expect(Math.abs(at2[0] - at[0]), `水平位移 ${at[0]} → ${at2[0]}`).toBeLessThan(2);
  expect(Math.abs(at2[1] - at[1]), `垂直位移 ${at[1]} → ${at2[1]}`).toBeLessThan(2);
});

test('MS3. 瀏覽 → 模擬 → 瀏覽：/tree 的篩選與搜尋保住（/sim 不認得它們）', async ({ page }) => {
  await page.goto('/tree/?branch=nature&q=' + encodeURIComponent('冰'));
  await ready(page);
  await page.locator('#toolbar [data-mode-switch]').click();
  await page.waitForURL(u => u.pathname === '/sim/');
  await ready(page);
  await page.locator('#sim-toolbar [data-mode-switch]').click();
  await page.waitForURL(u => u.pathname === '/tree/');
  await ready(page);
  await expect(page.locator('#search')).toHaveValue('冰');
  await expect(page.locator('#filters input[data-branch="nature"]')).toBeChecked();
  const url = new URL(page.url());
  expect(url.searchParams.get('branch')).toBe('nature');
  expect(url.searchParams.has('view')).toBe(false);
});

test('MS4. 減少動態：分段切換（含模式切換的連結）按下去不縮放', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const [url, sel] of [['/board/', '.seg > button[aria-pressed="false"]'], ['/tree/', '.seg > a[href]']] as const) {
    await page.goto(url);
    const el = page.locator(sel).first();
    const b = (await el.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    const transform = await el.evaluate(e => getComputedStyle(e).transform);
    await page.mouse.up();
    expect(transform, `${url} ${sel}`).toBe('none');
  }
});

test('MS5. 手機：瀏覽 → 模擬，選取的節點不壓在抽屜底下、主按鈕看得到', { tag: '@mobile' }, async ({ page, isMobile }) => {
  test.skip(!isMobile, '手機版抽屜');
  // 2004 在 /tree 手機版預設視角的下半部：沒把 view 對齊 host 實際尺寸時，落地後被推進抽屜底下。
  await page.goto('/tree/?node=2004');
  await ready(page);
  await page.waitForTimeout(600);
  await page.locator('#toolbar [data-mode-switch]').click();
  await page.waitForURL(u => u.pathname === '/sim/');
  await ready(page);
  await page.waitForTimeout(600);   // revealSelected 的緩動
  const { nodeBottom, panelTop, ctaBottom } = await page.evaluate(() => {
    const n = window.__tree.nodeScreenRect('2004')!;
    return {
      nodeBottom: n.top + n.height,
      panelTop: document.getElementById('sim-panel')!.getBoundingClientRect().top,
      ctaBottom: document.querySelector('#sim-detail .cta')!.getBoundingClientRect().bottom,
    };
  });
  expect(nodeBottom, '節點底緣要在抽屜上緣之上').toBeLessThanOrEqual(panelTop);
  expect(ctaBottom).toBeLessThanOrEqual(await page.evaluate(() => innerHeight));
});
