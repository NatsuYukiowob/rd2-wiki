// 活動（`/events` 索引 ＋ `/events/<id>` 內容頁）的端對端驗證（2026-09-21）。
//
// 跟 battle.spec.ts 同一族的理由：這兩頁最核心的承諾是「活動的內容進得了 HTML」，而那件事
// 在瀏覽器裡看不出差別——只有去讀伺服器回的原始 HTML 才會說話，所以前幾條用 `request.get()`。
//
// ⚠️ 表格的列數與內容一律**從資料算**，不寫死 24／10／2／6：下一場活動進來時這些數字都會變，
// 而這幾條該說的是「畫面漏了什麼」不是「數字又要改一次」（B1 為此被寫死過一次）。
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

type Cell = string | { icon: string; text: string };
type GameEvent = {
  id: string;
  name: string;
  version: string;
  period: { begin: string; finish: string } | null;
  screenshots?: { file: string; caption: string }[];
  summary: string;
  currencies: { kind: string; name: string; note: string }[];
  sections: { title: string; note?: string; columns: string[]; rows: Cell[][] }[];
};

const events = JSON.parse(
  readFileSync(new URL('../../data/events.json', import.meta.url), 'utf8'),
) as GameEvent[];

const cellText = (c: Cell) => (typeof c === 'string' ? c : c.text);
const rowCount = (ev: GameEvent) => ev.sections.reduce((n, s) => n + s.rows.length, 0);

test('EV1. 每一場活動在索引上各有一張卡片，連到自己那一頁', async ({ page }) => {
  await page.goto('/events');
  await expect(page.locator('.event-card-link')).toHaveCount(events.length);
  for (const ev of events) {
    const card = page.locator(`.event-card-link[href="/events/${ev.id}"]`);
    await expect(card).toHaveCount(1);
    await expect(card.locator('.event-badge')).toHaveText(`${ev.version} 客戶端`);
    // 「N 項內容」是從資料算的，不是寫死在版面上。
    await expect(card.locator('.event-more')).toHaveText(`${rowCount(ev)} 項內容`);
    await expect(card.locator('.event-more svg.icon'), '「N 項內容」後面沒有箭頭圖示').toHaveCount(1);
  }
});

test('EV2. 索引頁不含任何一場活動的內容表——分頁的重點就是不把重量留在索引上', async ({ request }) => {
  // ⚠️ 這條守的是「為什麼不做成就地展開」：`<details>` 那種收合只是視覺的，整份內容
  // 仍然在索引的 HTML 裡，活動一多索引就跟著變重。
  const html = await (await request.get('/events')).text();
  expect(html).not.toContain('<table');
  const anyCell = events[0]!.sections[0]!.rows[0]!.map(cellText).join('');
  expect(html).not.toContain(anyCell);
});

test('EV3. 內容頁的每一格文字都是伺服器輸出的 HTML', async ({ request }) => {
  for (const ev of events) {
    const res = await request.get(`/events/${ev.id}`);
    expect(res.status(), ev.id).toBe(200);
    const html = await res.text();
    expect(html).toContain(ev.name);
    // 名字有了不代表內容有了——表格裡的每一格才是玩家搜尋時會命中的東西。
    const missing = ev.sections.flatMap(s => s.rows.flatMap(r => r.map(cellText))).filter(t => !html.includes(t));
    expect(missing, ev.id).toEqual([]);
  }
});

test('EV4. 內容頁的表格列數與資料一致，每一列的格數都等於表頭欄數', async ({ page }) => {
  for (const ev of events) {
    await page.goto(`/events/${ev.id}`);
    // ⚠️ 這條是規則 29(h) 在畫面上的對應：格數對不上時版面照畫，只是欄位錯開。
    expect(await page.locator('.event-table tbody tr').count()).toBe(rowCount(ev));
    for (const [i, sec] of ev.sections.entries()) {
      const table = page.locator('.event-section').nth(i).locator('.event-table');
      await expect(table.locator('thead th')).toHaveCount(sec.columns.length);
      expect(await table.locator('tbody tr').first().locator('th, td').count()).toBe(sec.columns.length);
    }
  }
});

test('EV5. 貨幣圖與遊戲內截圖都真的載得到', async ({ page, request }) => {
  const ev = events[0]!;
  await page.goto(`/events/${ev.id}`);
  const srcs = await page.locator('.currency-icon, .event-shots img').evaluateAll(
    els => [...new Set(els.map(e => (e as HTMLImageElement).getAttribute('src') ?? ''))],
  );
  expect(srcs.length).toBeGreaterThan(0);
  // ⚠️ 不用 naturalWidth：這些圖不見得都在視窗裡，量到的會是捲軸位置不是圖存不存在（B5 的教訓）。
  for (const src of srcs) {
    expect((await request.get(src)).status(), src).toBe(200);
  }
  // 截圖是內容不是裝飾，alt 必須是圖說本身。
  for (const shot of ev.screenshots ?? []) {
    await expect(page.locator(`.event-shots img[src="/events/${shot.file}"]`)).toHaveAttribute('alt', shot.caption);
  }
});

test('EV6. 檔期有值才印，沒有的話畫面上不會冒出一個日期', async ({ page }) => {
  for (const ev of events) {
    await page.goto(`/events/${ev.id}`);
    // period 是 null 時整個 `.event-period` 不該存在——猜來的檔期跟查證過的日期長得一模一樣。
    await expect(page.locator('.event-period')).toHaveCount(ev.period ? 1 : 0);
    if (ev.period) {
      await expect(page.locator('.event-period')).toHaveText(`${ev.period.begin} ～ ${ev.period.finish}`);
    }
  }
});

test('EV7. 兩頁的入口都在「遊戲介紹」下拉裡，而且整個下拉會亮起來', async ({ page }) => {
  // ⚠️ 下拉預設是收起來的：只有裡面那條 aria-current 的話，導覽列上等於零提示（B6 同一條）。
  for (const path of ['/events', `/events/${events[0]!.id}`]) {
    await page.goto(path);
    await expect(page.locator('#site-nav .nav-menu > summary'), path).toHaveAttribute('aria-current', 'page');
  }
  await page.goto('/events');
  await expect(page.locator('#site-nav a[href="/events"]')).toHaveAttribute('aria-current', 'page');
});

test('EV8. 窄螢幕上超寬的表格由容器自己吸收，不讓整份文件橫捲', async ({ page }) => {
  // ⚠️ 讓整份文件橫捲是 /board 的 B13 已經守過的一條，這一頁用可捲動的表格容器換掉它。
  await page.setViewportSize({ width: 360, height: 720 });
  await page.goto(`/events/${events[0]!.id}`);

  const wrap = page.locator('.event-table-wrap').first();
  // 捲動容器要拿得到鍵盤焦點，否則只有滑鼠使用者捲得動。
  await expect(wrap).toHaveAttribute('tabindex', '0');
  await expect(wrap).toHaveCSS('overflow-x', 'auto');

  // ⚠️ 現在這幾張表在 360px 下剛好放得下，所以「有沒有捲軸」驗不到任何東西——真正要守的是
  // 「表格比容器寬的時候，多出來的寬度由容器吸收」。所以這裡自己撐寬一格再量：
  // 下一場活動的欄位多兩欄就會真的走到這條路徑上。
  await wrap.locator('tbody td, tbody th').first().evaluate(el => {
    el.textContent = '撐寬用的長字串'.repeat(20);
  });
  const after = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    scrollable: (() => {
      const el = document.querySelector('.event-table-wrap')!;
      return el.scrollWidth > el.clientWidth;
    })(),
  }));
  expect(after.scrollable).toBe(true);
  expect(after.doc).toBeLessThanOrEqual(1);
});
