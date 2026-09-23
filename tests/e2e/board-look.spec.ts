import { test, expect, type Page } from '@playwright/test';

/**
 * 骰桌 PR ③（2026-09-23）：/board 換成共用元件。
 * 這一頁的舊樣式幾乎全是 id 選擇器（具體度 (1,x,x)），共用 class 只有 (0,1,0)——舊宣告沒刪乾淨的話
 * 新樣式**安靜地不生效**，而 board.spec 照樣全綠（它們驗行為與尺寸，不驗長相）。
 * 這個檔驗的就是「共用元件真的接上了」。
 */

/** 把 CSS 變數解成 computed 的顏色字串（跟 getComputedStyle 比對用）。 */
async function tokenColor(page: Page, name: string): Promise<string> {
  return page.evaluate(n => {
    const i = document.createElement('i');
    i.style.color = `var(${n})`;
    document.body.appendChild(i);
    const c = getComputedStyle(i).color;
    i.remove();
    return c;
  }, name);
}

test('BL1. /board 頁首是 .page-head、小標是 .sec-title；頁首左緣與骰盤左緣在同一條線上', async ({ page }) => {
  await page.goto('/board');
  await expect(page.locator('h1.page-head')).toHaveCount(1);
  // 三個 .board-h2：隊友的隊伍（預設 hidden）、我的隊伍、骰盤。明細面板的標題是 .detail-h，不算。
  const h2 = await page.locator('.board-h2').count();
  expect(await page.locator('.board-h2.sec-title').count(), '.board-h2 沒有全部掛上 .sec-title').toBe(h2);

  const left = (sel: string) => page.locator(sel).first().evaluate(el => el.getBoundingClientRect().left);
  const [h1, lede, grid] = [await left('h1'), await left('.lede'), await left('#board-grid')];
  expect(Math.abs(h1 - lede), '標題與說明的左緣不一致').toBeLessThanOrEqual(0.5);
  expect(Math.abs(h1 - grid), `頁首左緣 ${h1} 與骰盤左緣 ${grid} 不在同一條對齊軸上`).toBeLessThanOrEqual(1);
});

test('BL2. 工具列：分享圖是金色主按鈕、其餘是次按鈕；10px 圓角、3px 實體厚度；按住只縮放並收掉厚度', async ({ page, isMobile }) => {
  await page.goto('/board');
  const look = (sel: string) => page.locator(sel).evaluate(el => {
    const s = getComputedStyle(el);
    return { img: s.backgroundImage, color: s.color, radius: s.borderTopLeftRadius, shadow: s.boxShadow };
  });
  const pri = await look('#board-export');
  expect(pri.img, '分享圖按鈕沒有金色漸層').toContain('linear-gradient');
  expect(pri.color, '主按鈕字色不是 --btn-pri-fg').toBe(await tokenColor(page, '--btn-pri-fg'));
  expect(pri.radius).toBe('10px');
  expect(pri.shadow, '主按鈕沒有實體厚度').toMatch(/0px 3px 0px 0px/);
  for (const id of ['#board-clear', '#board-hide-pips']) {
    const alt = await look(id);
    expect(alt.img, `${id} 不是次按鈕的紫色漸層`).toContain('linear-gradient');
    expect(alt.color, `${id} 字色`).toBe(await tokenColor(page, '--fg'));
    expect(alt.radius).toBe('10px');
  }

  // 「隱藏星數」開著＝金框（選中狀態），關著不是。
  const border = () => page.locator('#board-hide-pips').evaluate(el => getComputedStyle(el).borderTopColor);
  const gold = await tokenColor(page, '--gold');
  expect(await border()).not.toBe(gold);
  await page.locator('#board-hide-pips').click();
  await expect(page.locator('#board-hide-pips')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(border, { message: '隱藏星數開著時不是金框' }).toBe(gold);

  if (isMobile) return; // 按住的量法用滑鼠；觸控的 :active 規則是同一條。
  const btn = page.locator('#board-export');
  // ⚠️ 工具列在 1280×720 的視窗外，page.mouse 用的是原始座標、不會自己捲動。
  await btn.scrollIntoViewIfNeeded();
  const box = (await btn.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(150);
  const held = await look('#board-export');
  await page.mouse.move(0, 0);
  await page.mouse.up();
  expect(held.shadow, '按住時厚度沒有收掉').not.toMatch(/0px 3px 0px 0px/);
});

test('BL2b. 按住時整顆按鈕縮放（不是只有厚度變）', async ({ page, isMobile }) => {
  test.skip(isMobile, '滑鼠量法');
  await page.goto('/board');
  const btn = page.locator('#board-clear');
  await btn.scrollIntoViewIfNeeded(); // 理由同 BL2
  const box = (await btn.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(150);
  const t = await btn.evaluate(el => getComputedStyle(el).transform);
  await page.mouse.move(0, 0);
  await page.mouse.up();
  const m = t === 'none' ? [1] : t.match(/matrix\(([^)]+)\)/)![1]!.split(',').map(Number);
  expect(m[0], `按住時沒有縮放（${t}）`).toBeLessThan(1);
});

test('BL3. 三列切換鈕是 .seg：凹槽容器、選中＝金框、切換不改寬度；沒有存檔的「我的 /sim」無回饋；高對比下選中分得出來', async ({ page, isMobile }) => {
  await page.goto('/board');
  const gold = await tokenColor(page, '--gold');
  const muted = await tokenColor(page, '--muted');
  await expect(page.locator('#board-coop-mode .seg, #offgame-mode .seg, #partner-offgame-mode .seg')).toHaveCount(3);
  const radius = await page.locator('#offgame-mode .seg').evaluate(el => getComputedStyle(el).borderTopLeftRadius);
  expect(radius).toBe('10px');

  const border = (sel: string) => page.locator(sel).evaluate(el => getComputedStyle(el).borderTopColor);
  expect(await border('#board-coop-mode button[data-coop="off"]'), '選中的不是金框').toBe(gold);
  expect(await border('#board-coop-mode button[data-coop="on"]'), '沒選中的框應該是透明').toBe('rgba(0, 0, 0, 0)');

  const width = (sel: string) => page.locator(sel).evaluate(el => el.getBoundingClientRect().width);
  const before = [await width('#board-coop-mode'), await width('#offgame-mode')];
  await page.locator('#board-coop-mode button[data-coop="on"]').click();
  await expect(page.locator('#board-coop-mode button[data-coop="on"]')).toHaveAttribute('aria-pressed', 'true');
  const after = [await width('#board-coop-mode'), await width('#offgame-mode')];
  expect(Math.abs(after[0]! - before[0]!), '模式切換改變了寬度').toBeLessThanOrEqual(0.5);
  expect(Math.abs(after[1]! - before[1]!), '局外加成列的寬度跟著模式變了').toBeLessThanOrEqual(0.5);

  // 這個 context 是乾淨的，沒有 /sim 存檔 ⇒「我的 /sim」是 aria-disabled。
  const sim = page.locator('#offgame-mode button[data-mode="sim"]');
  await expect(sim).toHaveAttribute('aria-disabled', 'true');
  expect(await sim.evaluate(el => getComputedStyle(el).color), '沒有存檔的「我的 /sim」不是 --muted').toBe(muted);
  if (!isMobile) {
    await sim.scrollIntoViewIfNeeded(); // page.mouse 不會自己捲動（同 BL2）
    const b = (await sim.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(150);
    const t = await sim.evaluate(el => getComputedStyle(el).transform);
    await page.mouse.move(0, 0);
    await page.mouse.up();
    expect(t, '按不了的鈕按下去仍然縮了').toBe('none');
  }

  await page.emulateMedia({ forcedColors: 'active' });
  const on = await border('#board-coop-mode button[data-coop="on"]');
  const off = await border('#board-coop-mode button[data-coop="off"]');
  expect(on, '高對比模式下選中與沒選中的框色一樣').not.toBe(off);
});
