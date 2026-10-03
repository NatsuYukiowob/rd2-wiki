// 戰術（/tactic）與 Boss（/boss）的端對端驗證（2026-08-26）。
//
// 跟 codex.spec.ts 同一族的理由：這兩頁最核心的承諾是「文字進得了 HTML」，而那件事在
// 瀏覽器裡看不出差別（有沒有 JS 渲染，畫面長得一模一樣）——只有去讀伺服器回的原始 HTML
// 才會說話。所以前幾條刻意用 `request.get()` 而不是 `page.goto()`。
//
// ⚠️ 合作模式那一段也一樣：它是 CSS 收放的真文字，不是 JS 換上去的。用 `page.goto()` ＋
// `toHaveText` 驗的話，`textContent` 會把 `display: none` 的另一段一起讀進來（dice.css 的
// 數值面板為此吃過虧，斷言拿到「攻擊力 15075022502850」還照樣通過）——這裡量的是
// **可見性**與**伺服器 HTML**，不是 textContent。
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { Tactic } from '../../src/lib/types';

const tactics = JSON.parse(
  readFileSync(new URL('../../data/tactics.json', import.meta.url), 'utf8'),
) as Tactic[];

const bosses = JSON.parse(
  readFileSync(new URL('../../data/boss.json', import.meta.url), 'utf8'),
) as { id: string; name: string; effect: string; gameId: string; kind: string; difficulty: string }[];

const riftShop = JSON.parse(
  readFileSync(new URL('../../data/rift-shop.json', import.meta.url), 'utf8'),
) as { id: string; name: string; grade: string; cost: number; weight: number; effect: string; gameId: string; icon: string }[];

/** /rift-shop 的三組。⚠️ 條數一律從資料算，理由同上面 BOSS_DIFFICULTIES。 */
const GRADES = ['一般', '稀有', '傳說'] as const;
const shopBy = (grade: string) => riftShop.filter(e => e.grade === grade);

/** /boss（怪物圖鑑）的三組，順序＝畫面順序。⚠️ 條數一律從資料算：寫死 10／11 的話，收一批新怪物時
    這條會自己變紅，而它該說的是「畫面漏了誰」不是「數字又要改一次」（2026-09-06 B1 就是這樣被寫死成 10）。 */
const BOSS_GROUPS = [
  { kind: '一般怪物', difficulty: '一般', title: '一般怪物' },
  { kind: '首領', difficulty: '一般', title: '首領・一般' },
  { kind: '首領', difficulty: '困難', title: '首領・困難' },
] as const;
const bossesBy = (g: (typeof BOSS_GROUPS)[number]) => bosses.filter(b => b.kind === g.kind && b.difficulty === g.difficulty);

test('T1. 名稱、兩模式文本與 Augment 都在伺服器 HTML', async ({ request }) => {
  const res = await request.get('/tactic');
  expect(res.status()).toBe(200);
  const html = await res.text();
  for (const t of tactics) {
    expect(html).toContain(t.name);
    for (const text of [t.versus, t.coop]) if (text) expect(html).toContain(text);
    for (const option of t.options ?? []) {
      expect(html).toContain(option.name);
      expect(html).toContain(option.text);
    }
  }
});

test('T1b. 玩家文字不印編號、內部 ID 或重複模式標籤', async ({ page }) => {
  await page.goto('/tactic');
  await page.locator('#t69 summary').click();
  const text = await page.locator('main').innerText();
  for (const t of tactics.flatMap(t => [t, ...(t.options ?? [])])) expect(text).not.toContain(t.gameId);
  const heads = await page.locator('.battle-head').allInnerTexts();
  expect(heads.filter(text => /\d/.test(text))).toEqual([]);
  await expect(page.locator('.battle-tag').filter({ hasText: /對戰|合作/ })).toHaveCount(0);
});

test('T3. 15 個未啟用 ID 不出現在 HTML', async ({ page }) => {
  await page.goto('/tactic');
  for (const id of ['2','3','4','5','8','13','15','58','59','60','61','63','65','66','70']) {
    await expect(page.locator(`#t${id}`)).toHaveCount(0);
  }
});

test('T4. 無 JS 仍顯示合作一般文字且可原生展開 69', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL: testInfo.project.use.baseURL });
  try {
    const page = await context.newPage();
    await page.goto('/tactic');
    await expect(page.locator('#tactic-list > .battle-item:visible')).toHaveCount(tactics.filter(t => t.availability.coopNormal).length);
    await expect(page.locator('#t7 .battle-text[data-mode=coop]')).toBeVisible();
    await expect(page.locator('#t7 .battle-text[data-mode=versus]')).toBeHidden();
    await page.locator('#t69 summary').click();
    await expect(page.locator('#t69-1')).toBeVisible();
  } finally {
    await context.close();
  }
});

test('T5. 三模式單選與完整可用池、文字切換 @mobile', async ({ page }) => {
  await page.goto('/tactic');
  await expect(page.locator('input[name=tactic-mode]:checked')).toHaveValue('coopNormal');
  const expected: Record<string, string[]> = {
    coopNormal: ['35', '50'],
    coopHard: ['1', '6'],
    versus: ['6', '17', '21', '22', '24', '35', '50'],
  };
  for (const mode of ['coopNormal', 'coopHard', 'versus'] as const) {
    await page.locator(`input[name=tactic-mode][value=${mode}]`).check();
    await expect(page.locator('input[name=tactic-mode]:checked')).toHaveCount(1);
    const pool = tactics.filter(t => t.availability[mode]);
    await expect(page.locator('#tactic-list > .battle-item:visible')).toHaveCount(pool.length);
    const ids = await page.locator('#tactic-list > .battle-item:visible').evaluateAll(els => els.map(el => el.getAttribute('data-id')));
    expect(ids).toEqual(pool.map(t => t.id));
    for (const id of ['1', '6', '17', '21', '22', '24', '35', '50']) {
      if (expected[mode]!.includes(id)) await expect(page.locator(`#t${id}`)).toBeVisible();
      else await expect(page.locator(`#t${id}`)).toBeHidden();
    }
    await expect(page.locator('#t7 .battle-text[data-mode=coop]'))[mode === 'versus' ? 'toBeHidden' : 'toBeVisible']();
    await expect(page.locator('#t7 .battle-text[data-mode=versus]'))[mode === 'versus' ? 'toBeVisible' : 'toBeHidden']();
    await expect(page.locator('#tactic-count')).toHaveText(String(pool.length));
  }
});

test('T6. 四階段多選與全部總控制 @mobile', async ({ page }) => {
  await page.goto('/tactic');
  const all = page.locator('#tactic-all');
  const boxes = page.locator('input[name=stage]');
  await expect(boxes).toHaveCount(4);
  await expect(page.locator('input[name=stage][value=選項]')).toHaveCount(0);
  await expect(all).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('input[name=stage]:checked')).toHaveCount(4);
  const early = page.locator('input[name=stage][value=前期]');
  await early.uncheck();
  await expect(all).toHaveAttribute('aria-pressed', 'false');
  await expect(all).not.toHaveAttribute('data-active');
  await early.check();
  await expect(all).toHaveAttribute('aria-pressed', 'true');
  await expect(all).toHaveAttribute('data-active');
  await all.click();
  await expect(page.locator('input[name=stage]:checked')).toHaveCount(0);
  await expect(page.locator('#tactic-list > .battle-item:visible')).toHaveCount(0);
  await expect(page.locator('#tactic-count')).toHaveText('0');
  await expect(page.locator('#tactic-empty')).toBeVisible();
  await early.check();
  await all.click();
  await expect(page.locator('input[name=stage]:checked')).toHaveCount(4);
  await expect(all).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#tactic-empty')).toBeHidden();
  for (const stage of ['前期', '中期', '終盤']) await page.locator(`input[name=stage][value=${stage}]`).uncheck();
  await expect(page.locator('#tactic-list > .battle-item:visible')).toHaveCount(tactics.filter(t => t.availability.coopNormal && t.stage === '後期').length);
});

test('T7. 69 在前期父卡內展開／收起三個 Augment @mobile', async ({ page }) => {
  await page.goto('/tactic');
  const parent = page.locator('#t69');
  await expect(parent).toBeVisible();
  await expect(parent.locator('.battle-tag')).toHaveText('前期');
  await expect(parent.locator('summary')).toHaveText('查看 3 個選項');
  await expect(page.locator('#t69-1')).toBeHidden();
  const count = await page.locator('#tactic-count').innerText();
  await parent.locator('summary').click();
  for (const option of tactics.find(t => t.id === '69')!.options!) {
    const row = page.locator(`#t${option.id}`);
    await expect(row).toBeVisible();
    await expect(row.locator('.battle-name')).toHaveText(option.name);
    await expect(row.locator('.battle-text')).toHaveText(option.text);
    await expect(row.locator('img')).toHaveAttribute('src', `/assets/tactic-icons/${option.icon}.webp`);
  }
  await expect(page.locator('#tactic-count')).toHaveText(count);
  await parent.locator('summary').click();
  await expect(page.locator('#t69-1')).toBeHidden();
  await parent.locator('summary').click();
  await page.locator('input[name=stage][value=前期]').uncheck();
  await expect(parent).toBeHidden();
  await expect(page.locator('#t69-1')).toBeHidden();
});

test('T8. ID 9 與 40 實際引用同一圖', async ({ page }) => {
  await page.goto('/tactic');
  expect(await page.locator('#t9 > img').getAttribute('src')).toBe(await page.locator('#t40 > img').getAttribute('src'));
});

test('T9. 所有模式及展開內容 desktop / mobile 無水平溢出 @mobile', async ({ page }) => {
  await page.goto('/tactic');
  for (const mode of ['coopNormal', 'coopHard', 'versus']) {
    await page.locator(`input[name=tactic-mode][value=${mode}]`).check();
    await page.locator('#t69 details').evaluate((el: HTMLDetailsElement) => { el.open = true; });
    const overflow = await page.locator('main').evaluate(el => el.scrollWidth > el.clientWidth + 1);
    expect(overflow).toBe(false);
    const outside = await page.locator('#tactic-list .battle-item:visible').evaluateAll(els => els.filter(el => {
      const rect = el.getBoundingClientRect();
      return rect.left < 0 || rect.right > document.documentElement.clientWidth + 1;
    }).map(el => el.id));
    expect(outside).toEqual([]);
  }
});

test('B1. /boss 的名稱與效果全文是伺服器輸出的 HTML', async ({ request }) => {
  const res = await request.get('/boss');
  expect(res.status()).toBe(200);
  const html = await res.text();

  // ⚠️ 兩組**分別**驗，不是驗總數：只驗 `bosses.length` 的話，渲染端漏掉整個「困難」那一組
  // （例如分組條件寫成 `gameId.endsWith('_hard')` 而上游改了命名）仍然可以綠——那批名稱還
  // 在資料檔裡，而測試比對的是資料檔自己。
  for (const g of BOSS_GROUPS) {
    const group = bossesBy(g);
    expect(group.length, `資料裡沒有任何「${g.title}」`).toBeGreaterThan(0);
    expect(group.filter(b => !html.includes(b.name)).map(b => b.name), `${g.title} 這一組有名稱沒進 HTML`).toEqual([]);
  }
  // 每一隻都要被分進三組其中之一，否則它在畫面上會整筆消失（CI 規則 25 守同一件事）。
  expect(bosses.filter(b => !BOSS_GROUPS.some(g => g.kind === b.kind && g.difficulty === b.difficulty)).map(b => b.id)).toEqual([]);

  for (const b of bosses) {
    // 蛇王的效果含 `#一般怪物`，會被包成連結——比對 `#` 前面那一段就好。
    const plain = b.effect.split('#')[0]!.trim();
    expect(html, `${b.name} 的效果沒進 HTML`).toContain(plain);
  }
});

test('B1b. /boss 分成一般怪物、一般首領、困難首領三組，每組的條數等於資料裡該組的筆數', async ({ page }) => {
  await page.goto('/boss');
  const heads = page.locator('.battle-group-head');
  await expect(heads).toHaveCount(BOSS_GROUPS.length);

  for (let i = 0; i < BOSS_GROUPS.length; i++) {
    const g = BOSS_GROUPS[i]!;
    await expect(heads.nth(i)).toContainText(g.title);
    // ⚠️ 量的是**該組那一份清單**底下的條數，不是整頁的 `.battle-item` 總數：後者只要總和
    // 對得上就會綠，兩組的界線畫錯（例如一隻困難的排進一般那一組）完全看不出來。
    await expect(page.locator('.battle-list').nth(i).locator('.battle-item')).toHaveCount(bossesBy(g).length);
  }

  // 錨點跟著條目走，不因為多了組標題而改變（`#b1` 是既有的外部連結目標，B2–B4 也靠它）。
  for (const b of bosses) await expect(page.locator(`#b${b.id}`)).toHaveCount(1);
});

test('B2. 蛇王的 #一般怪物 是關鍵字標記，不是裸的 #', async ({ page }) => {
  // ⚠️ 這條守的是一件曾經誤判過的事：那個 `#` 一度被當成上游漏填的佔位符而差點被砍掉。
  // 它是這個 repo 既有的關鍵字標記，該渲染成帶官方色、指向詞條頁的連結。
  await page.goto('/boss');
  const link = page.locator('#b1 .kw-link[data-term="一般怪物"]');
  await expect(link).toHaveText('#一般怪物');
  await expect(link).toHaveAttribute('href', /\/guide\/keywords#[A-Z_]+/);
  // 顏色要是官方色，不是掉回內文色——別名／查不到的詞才會沒有顏色。
  await expect(link).toHaveCSS('color', 'rgb(160, 167, 184)');
});

test('B3. 點 #關鍵字 就地展開解釋，不跳頁', async ({ page }) => {
  await page.goto('/boss');
  const panel = page.locator('#b1 .battle-term[data-term="一般怪物"]');
  // 有 JS 時預設收起（沒有 JS 時它一直顯示著——見 B4）。
  await expect(panel).toBeHidden();
  await page.locator('#b1 .kw-link[data-term="一般怪物"]').click();
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('最基本的怪物');
  // 就地展開＝網址不變。跳頁的話這條會紅。
  expect(new URL(page.url()).pathname.replace(/\/+$/, '')).toBe('/boss');
  // 再點一次收回去。
  await page.locator('#b1 .kw-link[data-term="一般怪物"]').click();
  await expect(panel).toBeHidden();
});

test('B4. 沒有 JS 時解釋直接顯示，而且 #關鍵字 是一條通的連結', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/boss');
  // 收起的動作寫在腳本裡，所以沒有 JS 時解釋就一直在——比「點了沒反應」好。
  await expect(page.locator('#b1 .battle-term[data-term="一般怪物"]')).toBeVisible();
  await page.locator('#b1 .kw-link[data-term="一般怪物"]').click();
  await expect(page).toHaveURL(/\/guide\//);
  await context.close();
});

test('B5. 兩頁的圖示都是等比縮放不裁切，而且每一張都真的存在', async ({ page, request }) => {
  for (const [path, count] of [['/tactic', tactics.flatMap(t => [t, ...(t.options ?? [])]).length], ['/boss', bosses.length]] as const) {
    await page.goto(path);
    const imgs = page.locator('.battle-icon');
    await expect(imgs).toHaveCount(count);
    // ⚠️ contain 不是排版偏好：來源圖的長寬比不統一（戰術 176×206 與 164×166 都有），
    // cover 會把圖裁角，而 CI 會全綠——跟 /board 那四個顯示點是同一條不變量。
    await expect(imgs.first()).toHaveCSS('object-fit', 'contain');

    // ⚠️ **不要用 naturalWidth 驗「載得到」**：這些 <img> 是 loading="lazy"，畫面外的那幾十張
    // 本來就還沒開始載，`complete` 是 false ——量到的是捲軸位置，不是圖存不存在
    // （第一版就是這樣紅在「29 張載不到」）。改成直接對每個網址發請求。
    const srcs = await imgs.evaluateAll(els => els.map(el => (el as HTMLImageElement).getAttribute('src') ?? ''));
    expect(srcs.filter(s => !s)).toEqual([]);
    const bad: string[] = [];
    for (const src of srcs) {
      const res = await request.get(src);
      if (!res.ok()) bad.push(`${src} → ${res.status()}`);
    }
    expect(bad, `${path} 有載不到的圖示`).toEqual([]);
  }
});

test('B6. 兩個新入口收在「遊戲介紹」下拉裡，而且整個下拉會標成目前分頁', async ({ page }) => {
  for (const [path, label] of [['/tactic', '戰術'], ['/boss', '怪物圖鑑']] as const) {
    await page.goto(path);
    // 入口在下拉裡，不在導覽列頂層（Yuki 2026-08-26 指定）。
    await expect(page.locator(`#site-nav .nav-menu-items a:text-is("${label}")`)).toHaveAttribute('aria-current', 'page');
    await expect(page.locator(`#site-nav > a:text-is("${label}")`)).toHaveCount(0);
    // ⚠️ 下拉本身也要亮：它預設是收起來的，裡面那條 aria-current 使用者根本看不到，
    // 只驗裡面那條的話「站在戰術頁時導覽列零提示」會是綠的。
    await expect(page.locator('#site-nav .nav-menu > summary')).toHaveAttribute('aria-current', 'page');
  }
});

// --- 裂縫商店（/rift-shop，2026-09-06）---
//
// 跟 /tactic、/boss 同一族：核心承諾是「文字進得了 HTML」，所以前兩條讀伺服器回的原始 HTML。
// ⚠️ 這一頁的資料跟 /tactic 是客戶端同一張表的**兩批不重疊的列**（Use vs Store），
// 所以下面刻意驗「兩邊的內部ID 沒有交集」——併錯批在畫面上看起來完全正常。

test('RS1. /rift-shop 的名稱、階級、價格與效果全文是伺服器輸出的 HTML', async ({ request }) => {
  const res = await request.get('/rift-shop');
  expect(res.status()).toBe(200);
  const html = await res.text();

  expect(riftShop.length).toBeGreaterThan(0);
  expect(riftShop.filter(e => !html.includes(e.name)).map(e => e.name)).toEqual([]);
  // 名字有了不代表內容有了——效果全文才是玩家搜尋時會命中的東西。
  // 這 55 條目前一個 `#關鍵字` 標記都沒有（2026-09-06 實測），所以可以整句直接比對。
  expect(riftShop.filter(e => !html.includes(e.effect)).map(e => e.id)).toEqual([]);
  // 價格也要在 HTML 裡：傳說階級有 100 與 200 兩種，只看組標題會把奇蹟之石當成 100。
  expect(riftShop.filter(e => !html.includes(`>${e.cost}<`)).map(e => e.id)).toEqual([]);
});

test('RS1b. /rift-shop 與 /tactic 是兩批不重疊的資料', async () => {
  // 客戶端 TacticsEffectTable 同一張表：Use=True 是每波輪替池（/tactic），
  // Store=True 是商店池（這一頁）。併錯批的話兩頁都會多出對方的內容而畫面完全正常。
  const shared = riftShop.filter(e => tactics.some(t => t.gameId === e.gameId));
  expect(shared.map(e => e.gameId)).toEqual([]);
});

test('RS2. 三組的條數等於資料裡該階級的筆數，篩到只剩傳說時計數跟著變', async ({ page }) => {
  await page.goto('/rift-shop');
  for (const grade of GRADES) {
    await expect(page.locator(`ul.battle-list[data-grade="${grade}"] > li`)).toHaveCount(shopBy(grade).length);
  }
  await expect(page.locator('#rift-count')).toHaveText(String(riftShop.length));

  for (const grade of ['一般', '稀有']) {
    await page.locator(`#rift-filters input[name=grade][value="${grade}"]`).uncheck();
  }
  await expect(page.locator('#rift-count')).toHaveText(String(shopBy('傳說').length));
  // 組標題要跟著它管的清單一起藏，否則畫面上會剩兩個孤零零的標題。
  await expect(page.locator('h2.battle-group-head[data-grade="一般"]')).toBeHidden();
  await expect(page.locator('ul.battle-list[data-grade="一般"]')).toBeHidden();
  await expect(page.locator('h2.battle-group-head[data-grade="傳說"]')).toBeVisible();

  // 傳說階級的兩種價格都要看得到（200 的那兩條是這一頁唯一的例外）。
  const legendary = shopBy('傳說');
  const pricey = legendary.filter(e => e.cost === 200);
  expect(pricey.length).toBeGreaterThan(0);
  for (const e of pricey) {
    await expect(page.locator(`#r${e.id} .battle-tag`).first()).toContainText('200');
  }
});

test('RS3. 沒有 JS 時全部裂縫效果仍然完整顯示', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/rift-shop');
  await expect(page.locator('.battle-item')).toHaveCount(riftShop.length);
  // 沒有 JS 時 apply() 沒跑過，三組都要是可見的（篩選是漸進增強，不是顯示的前提）。
  for (const grade of GRADES) {
    await expect(page.locator(`ul.battle-list[data-grade="${grade}"]`)).toBeVisible();
  }
  await context.close();
});

test('RS4. 圖示等比縮放不裁切；35 張圖對 55 筆是刻意的，每一張都載得到', async ({ page, request }) => {
  await page.goto('/rift-shop');
  const imgs = page.locator('.battle-icon');
  await expect(imgs).toHaveCount(riftShop.length);
  await expect(imgs.first()).toHaveCSS('object-fit', 'contain');

  const srcs = await imgs.evaluateAll(els => els.map(el => (el as HTMLImageElement).getAttribute('src') ?? ''));
  expect(srcs.filter(s => !s)).toEqual([]);
  // ⚠️ 這一頁的 src 本來就會重複（同名的三個檔位共用一張圖，客戶端只給 *Low 畫圖）。
  // 去重之後的張數要剛好等於資料裡的唯一雜湊數——多了代表有人替某個檔位另外加了圖，
  // 少了代表兩個不同的效果撞到同一張（規則 27(g) 會擋，這裡是畫面端的第二道）。
  expect(new Set(srcs).size).toBe(new Set(riftShop.map(e => e.icon)).size);

  const bad: string[] = [];
  for (const src of new Set(srcs)) {
    const res = await request.get(src);
    if (!res.ok()) bad.push(`${src} → ${res.status()}`);
  }
  expect(bad, '/rift-shop 有載不到的圖示').toEqual([]);
});

test('RS5. 入口收在「遊戲介紹」下拉裡，而且整個下拉會標成目前分頁', async ({ page }) => {
  await page.goto('/rift-shop');
  await expect(page.locator('#site-nav .nav-menu-items a:text-is("裂縫商店")')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#site-nav > a:text-is("裂縫商店")')).toHaveCount(0);
  // ⚠️ 下拉本身也要亮，理由同 B6：它預設收起來，裡面那條 aria-current 使用者看不到。
  await expect(page.locator('#site-nav .nav-menu > summary')).toHaveAttribute('aria-current', 'page');
});

test('RS6. 三個階級全部取消勾選時要說話，不是留一片空白', async ({ page }) => {
  await page.goto('/rift-shop');
  // 全不勾＝該維度不篩（等同全勾），跟 /tactic 的 apply()、/dice 的 picked() 同一個判準
  // ——所以這一頁走不到「零筆」，`#rift-empty` 是為了「哪天篩選維度變多」而存在的防線。
  for (const grade of GRADES) {
    await page.locator(`#rift-filters input[name=grade][value="${grade}"]`).uncheck();
  }
  await expect(page.locator('#rift-count')).toHaveText(String(riftShop.length));
  await expect(page.locator('#rift-empty')).toBeHidden();

  // 「全部」按下去要把三個都勾回來。
  await page.locator('#rift-all').click();
  for (const grade of GRADES) {
    await expect(page.locator(`#rift-filters input[name=grade][value="${grade}"]`)).toBeChecked();
  }
});
