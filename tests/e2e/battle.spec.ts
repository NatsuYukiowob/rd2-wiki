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

const tactics = JSON.parse(
  readFileSync(new URL('../../data/tactics.json', import.meta.url), 'utf8'),
) as { id: string; name: string; stage: string; mode: string; versus: string; coop?: string; gameId: string }[];

const bosses = JSON.parse(
  readFileSync(new URL('../../data/boss.json', import.meta.url), 'utf8'),
) as { id: string; name: string; effect: string; gameId: string; difficulty: string }[];

const coopOnly = tactics.filter(t => t.coop);
const versusOnly = tactics.filter(t => !t.coop);

/** /boss 的兩組。⚠️ 條數一律從資料算：寫死 10／11 的話，收一批新 Boss 時這條會自己變紅，
    而它該說的是「畫面漏了誰」不是「數字又要改一次」（2026-09-06 B1 就是這樣被寫死成 10）。 */
const BOSS_DIFFICULTIES = ['一般', '困難'] as const;
const bossesBy = (difficulty: string) => bosses.filter(b => b.difficulty === difficulty);

test('T1. /tactic 的名稱與對戰效果全文是伺服器輸出的 HTML', async ({ request }) => {
  const res = await request.get('/tactic');
  expect(res.status()).toBe(200);
  const html = await res.text();

  expect(tactics.length).toBeGreaterThan(0);
  expect(tactics.filter(t => !html.includes(t.name)).map(t => t.name)).toEqual([]);
  // 名字有了不代表內容有了——效果全文才是玩家搜尋時會命中的東西。
  // 戰術文字目前沒有任何 `#關鍵字` 標記（2026-08-26 實測），所以可以整句直接比對；
  // 哪天有了，`renderStaticText` 會把標記包成連結，這裡要改成比對第一段。
  expect(tactics.filter(t => !html.includes(t.versus)).map(t => t.id)).toEqual([]);
});

test('T1b. 編號與內部ID 一個都不准出現在畫面上', async ({ page }) => {
  // ⚠️ 這兩個是拿本站對官方資料表用的，玩家在遊戲裡看不到（Yuki 2026-08-26）。
  // 資料檔仍然留著它們（`id` 是錨點與 CI 規則 24 的鍵、`gameId` 是對新版資料表的 join key），
  // 所以「刪掉欄位」不是解法——這條驗的是**渲染端沒有印出來**。
  for (const path of ['/tactic', '/boss'] as const) {
    await page.goto(path);
    // 量的是使用者看得到的文字，不是原始 HTML：`id` 還在 `id="t6"` 這種屬性裡是對的。
    const text = await page.locator('main').innerText();
    const leaked = [
      ...tactics.filter(t => text.includes(t.gameId)).map(t => `戰術 ${t.id} 的 ${t.gameId}`),
      ...bosses.filter(b => text.includes(b.gameId)).map(b => `Boss ${b.id} 的 ${b.gameId}`),
    ];
    expect(leaked, `${path} 印出了內部代碼`).toEqual([]);

    // ⚠️ **編號要另外驗**：`t.id` 是 `6`／`69-1` 這種短數字，直接拿去比對整頁文字會被
    // 「持續60秒」這類效果文字誤判（第一版只驗了 gameId，把編號印回標題列照樣是綠的
    // ——2026-08-26 code review 抓到）。改成驗標題列**一個數字都不准有**：
    // 標題列只放名稱與階段／模式標籤，而 58＋10 個名稱裡沒有任何一個含數字（實測）。
    const headsWithDigits = await page.locator('.battle-head').evaluateAll(
      els => els.map(el => (el as HTMLElement).innerText).filter(t => /\d/.test(t)),
    );
    expect(headsWithDigits, `${path} 的標題列印出了編號`).toEqual([]);
  }
});

test('T2. 合作模式的效果文字也在伺服器 HTML 裡，不是 JS 換上去的', async ({ request }) => {
  const html = await (await request.get('/tactic')).text();
  // 只驗「跟對戰不同」的那幾條：其餘的合作文字跟對戰逐字相同，就算整段沒輸出也會通過。
  const differing = coopOnly.filter(t => t.coop !== t.versus);
  expect(differing.length).toBeGreaterThan(0);
  expect(differing.filter(t => !html.includes(t.coop!)).map(t => t.id)).toEqual([]);
});

test('T3. 「未啟用」的戰術一條都不該出現在站上', async ({ page }) => {
  await page.goto('/tactic');
  // 官方資料表有 74 條，站上刻意只收已啟用的（Yuki 2026-08-26 裁決）。
  // 抽兩條未啟用的名字來驗——它們一旦冒出來，代表匯入腳本的篩選條件被改掉了。
  for (const name of ['豐盛開局', '死神格子']) {
    await expect(page.locator('.battle-name', { hasText: name }), `未啟用的「${name}」不該出現在 /tactic`).toHaveCount(0);
  }
  // ⚠️ 不能對整份 HTML 做 `not.toContain('未啟用')`：頁面上那句說明本來就寫著
  // 「資料表裡標示『未啟用』的不列入」。要驗的是**沒有任何一條戰術掛著那個模式標籤**。
  await expect(page.locator('.battle-tag', { hasText: '未啟用' })).toHaveCount(0);
});

test('T4. 沒有 JS 時，對戰模式的全部戰術仍然完整顯示', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/tactic');
  await expect(page.locator('.battle-item')).toHaveCount(tactics.length);
  // 每一條都看得見（沒有 JS 就沒有任何篩選被套用），而合作那一段預設收在 CSS 後面。
  await expect(page.locator('.battle-item').first()).toBeVisible();
  await expect(page.locator('.battle-item').last()).toBeVisible();
  await expect(page.locator(`.battle-text[data-mode="coop"]`).first()).toBeHidden();
  await context.close();
});

test('T5. 切到合作模式：對戰專用的那幾條整條消失，剩下的換成合作文字', async ({ page }) => {
  await page.goto('/tactic');
  const items = page.locator('.battle-item');
  await expect(items).toHaveCount(tactics.length);

  const sample = coopOnly.find(t => t.coop !== t.versus)!;
  const sampleItem = page.locator(`#t${sample.id}`);
  await expect(sampleItem.locator('.battle-text[data-mode="versus"]')).toBeVisible();
  await expect(sampleItem.locator('.battle-text[data-mode="coop"]')).toBeHidden();

  // 按下之前，鈕上寫的是**目前**在看的模式。
  await expect(page.locator('#tactic-coop')).toHaveText('對戰模式');
  await page.locator('#tactic-coop').click();
  await expect(page.locator('#tactic-coop')).toHaveAttribute('aria-pressed', 'true');
  // ⚠️ 三件事要一起換：可見文字、aria-label（無障礙名稱）、data-mode。只換其中一件的話
  // 畫面與螢幕閱讀器會各說各話，而兩邊都不會報錯。
  await expect(page.locator('#tactic-coop')).toHaveText('合作模式');
  await expect(page.locator('#tactic-coop')).toHaveAttribute('aria-label', /目前顯示合作模式/);

  // ⚠️ 驗的是可見數不是元素數：兩段文字與那 11 條都還在 DOM 裡（它們是伺服器輸出的真文字），
  // 切換只改看得見哪一個。用 count 驗會永遠是同一個數字＝什麼都沒驗到。
  await expect(page.locator('.battle-item:visible')).toHaveCount(coopOnly.length);
  await expect(sampleItem.locator('.battle-text[data-mode="versus"]')).toBeHidden();
  await expect(sampleItem.locator('.battle-text[data-mode="coop"]')).toBeVisible();
  await expect(page.locator('#tactic-count')).toHaveText(String(coopOnly.length));

  // 對戰專用的那幾條在合作模式下不該還在畫面上。
  expect(versusOnly.length).toBeGreaterThan(0);
  await expect(page.locator(`#t${versusOnly[0]!.id}`)).toBeHidden();
});

test('T6. 階段篩選：只留一個階段時，計數與可見條數一致', async ({ page }) => {
  await page.goto('/tactic');
  const boxes = page.locator('#tactic-filters input[name=stage]');
  await expect(boxes).toHaveCount(4);

  // 只留「後期」：取消其餘三個。
  for (const stage of ['前期', '中期', '選項']) {
    await page.locator(`#tactic-filters label:has-text("${stage}") input`).uncheck();
  }
  const late = tactics.filter(t => t.stage === '後期').length;
  expect(late).toBeGreaterThan(0);
  await expect(page.locator('.battle-item:visible')).toHaveCount(late);
  await expect(page.locator('#tactic-count')).toHaveText(String(late));

  // 全部取消勾選＝該維度不篩（等同全勾）。畫面一片空白是最容易踩到、又最像壞掉的狀態。
  await page.locator('#tactic-filters label:has-text("後期") input').uncheck();
  await expect(page.locator('.battle-item:visible')).toHaveCount(tactics.length);
});

test('T6b. 母條目被篩掉時，子選項也跟著收掉（不留孤兒箭頭）', async ({ page }) => {
  // 69「選擇由我決定」是前期，它底下三個子選項的階段是「選項」——只勾「選項」的話，
  // 畫面上會出現三條縮排、掛著 `↳` 卻找不到母條目的孤兒（編號拿掉之後更看不出屬於誰）。
  await page.goto('/tactic');
  for (const stage of ['前期', '中期', '後期']) {
    await page.locator(`#tactic-filters label:has-text("${stage}") input`).uncheck();
  }
  const subs = tactics.filter(t => t.id.includes('-'));
  expect(subs.length).toBe(3);
  await expect(page.locator(`#t${subs[0]!.id}`)).toBeHidden();
  await expect(page.locator('.battle-item:visible')).toHaveCount(0);
  // 篩到零筆，那段提示就該出現——這也是它第一條走得到的路徑。
  await expect(page.locator('#tactic-empty')).toBeVisible();

  // 把母條目那個階段勾回來，三條子選項要跟著回來。
  await page.locator('#tactic-filters label:has-text("前期") input').check();
  await expect(page.locator(`#t${subs[0]!.id}`)).toBeVisible();
});

test('T7. 篩到零筆時要說話，不是留一片空白', async ({ page }) => {
  await page.goto('/tactic');
  await expect(page.locator('#tactic-empty')).toBeHidden();

  // ⚠️ **目前的資料走不到零筆**：四個階段在合作模式下各自都還有東西（最少的「選項」也有 3 條），
  // 所以只靠點按鈕到不了這個狀態。這裡直接把每一條的 data-stage 改成一個不存在的值再重新
  // 套用篩選——測的是「shown 為 0 時畫面會說話」這條分支，不是某個使用者操作序列。
  // 資料哪天真的出現空組合（例如某個階段的戰術全變成對戰專用），那時使用者看到的就是這一段。
  await page.evaluate(() => {
    for (const item of document.querySelectorAll<HTMLElement>('.battle-item')) item.dataset.stage = '不存在的階段';
    document.querySelector<HTMLInputElement>('#tactic-filters input[name=stage]')!
      .dispatchEvent(new Event('change', { bubbles: true }));
  });

  await expect(page.locator('#tactic-empty')).toBeVisible();
  await expect(page.locator('#tactic-count')).toHaveText('0');
});

test('B1. /boss 的名稱與效果全文是伺服器輸出的 HTML', async ({ request }) => {
  const res = await request.get('/boss');
  expect(res.status()).toBe(200);
  const html = await res.text();

  // ⚠️ 兩組**分別**驗，不是驗總數：只驗 `bosses.length` 的話，渲染端漏掉整個「困難」那一組
  // （例如分組條件寫成 `gameId.endsWith('_hard')` 而上游改了命名）仍然可以綠——那批名稱還
  // 在資料檔裡，而測試比對的是資料檔自己。
  for (const difficulty of BOSS_DIFFICULTIES) {
    const group = bossesBy(difficulty);
    expect(group.length, `資料裡沒有任何「${difficulty}」Boss`).toBeGreaterThan(0);
    expect(group.filter(b => !html.includes(b.name)).map(b => b.name), `${difficulty} 這一組有名稱沒進 HTML`).toEqual([]);
  }
  // 每一隻都要被分進兩組其中之一，否則它在畫面上會整筆消失（CI 規則 25 守同一件事）。
  expect(bosses.filter(b => !(BOSS_DIFFICULTIES as readonly string[]).includes(b.difficulty)).map(b => b.id)).toEqual([]);

  for (const b of bosses) {
    // 蛇王的效果含 `#一般怪物`，會被包成連結——比對 `#` 前面那一段就好。
    const plain = b.effect.split('#')[0]!.trim();
    expect(html, `${b.name} 的效果沒進 HTML`).toContain(plain);
  }
});

test('B1b. /boss 分成一般與困難兩組，每組的條數等於資料裡該難度的筆數', async ({ page }) => {
  await page.goto('/boss');
  const heads = page.locator('.battle-group-head');
  await expect(heads).toHaveCount(BOSS_DIFFICULTIES.length);

  for (let i = 0; i < BOSS_DIFFICULTIES.length; i++) {
    const difficulty = BOSS_DIFFICULTIES[i]!;
    await expect(heads.nth(i)).toContainText(difficulty);
    // ⚠️ 量的是**該組那一份清單**底下的條數，不是整頁的 `.battle-item` 總數：後者只要總和
    // 對得上就會綠，兩組的界線畫錯（例如一隻困難的排進一般那一組）完全看不出來。
    await expect(page.locator('.battle-list').nth(i).locator('.battle-item')).toHaveCount(bossesBy(difficulty).length);
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
  await expect(link).toHaveAttribute('href', /\/guide\/[a-z]+#[A-Z_]+/);
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
  for (const [path, count] of [['/tactic', tactics.length], ['/boss', bosses.length]] as const) {
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
  for (const [path, label] of [['/tactic', '戰術'], ['/boss', 'Boss']] as const) {
    await page.goto(path);
    // 入口在下拉裡，不在導覽列頂層（Yuki 2026-08-26 指定）。
    await expect(page.locator(`#site-nav .nav-menu-items a:text-is("${label}")`)).toHaveAttribute('aria-current', 'page');
    await expect(page.locator(`#site-nav > a:text-is("${label}")`)).toHaveCount(0);
    // ⚠️ 下拉本身也要亮：它預設是收起來的，裡面那條 aria-current 使用者根本看不到，
    // 只驗裡面那條的話「站在戰術頁時導覽列零提示」會是綠的。
    await expect(page.locator('#site-nav .nav-menu > summary')).toHaveAttribute('aria-current', 'page');
  }
});
