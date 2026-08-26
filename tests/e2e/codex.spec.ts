// 骰子圖鑑、遊戲介紹與首頁更新日誌的端對端驗證（2026-08-22）。
//
// 這一份存在的理由跟 seo.spec.ts 同一族：這幾件事壞掉的時候，站台**逛起來完全正常**。
// 圖鑑最核心的承諾是「文字進得了 HTML」——那件事在瀏覽器裡看不出差別（有沒有 JS 渲染，
// 畫面長得一模一樣），只有去讀伺服器回的原始 HTML 才會說話。所以第一條測試刻意用
// `request.get()` 而不是 `page.goto()`：後者拿到的是 JS 跑完之後的 DOM，驗不到這件事。
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { resolveColor, settleEnter } from './probe';

const tree = JSON.parse(
  readFileSync(new URL('../../src/generated/tree.json', import.meta.url), 'utf8'),
) as {
  nodes: { id: string; type: string; branch: string; name: string; description: string }[];
  meta: { gameVersion: string; gameBundle: string; updated: string };
};

const dice = tree.nodes.filter(n => n.type === 'dice');

test('C1. /dice 的骰子名稱與效果是伺服器輸出的 HTML，不是瀏覽器渲染出來的', async ({ request }) => {
  const res = await request.get('/dice');
  expect(res.status()).toBe(200);
  const html = await res.text();

  // 這是 #22 要解掉的症狀：2026-08-20 實測 dist/tree/index.html 的可索引文字只有 194 個
  // 字元，239 個節點名一個字都沒進 HTML。圖鑑必須把 41 顆骰子全部寫進去。
  expect(dice.length).toBe(41);
  const missing = dice.filter(d => !html.includes(d.name));
  expect(missing.map(d => d.name)).toEqual([]);

  // 名字有了不代表內容有了——描述才是玩家搜尋時會命中的東西。抽第一顆與最後一顆驗全文。
  for (const d of [dice[0]!, dice.at(-1)!]) {
    // 描述裡的 `#關鍵字` 會被包成連結，所以比對純文字的第一段就好（不含 # 的部分）。
    const plain = d.description.split('#')[0]!.trim();
    expect(html, `${d.name} 的描述沒進 HTML`).toContain(plain);
  }

  // 骰子以外的節點不該出現在圖鑑（Yuki 2026-08-22 指定：只要骰子本體）。
  const rune = tree.nodes.find(n => n.type === 'rune')!;
  expect(html).not.toContain(`>${rune.name}<`);
});

test('C2. 圖鑑篩選會隱藏卡片並更新計數；全部取消勾選＝不篩，不是一片空白', async ({ page }) => {
  await page.goto('/dice');
  const cards = page.locator('.dice-card');
  const count = page.locator('#codex-count');
  await expect(cards).toHaveCount(dice.length);
  await expect(count).toHaveText(String(dice.length));

  const natureCount = dice.filter(d => d.branch === 'nature').length;
  await page.uncheck('#codex-filters input[value="nature"]');
  await expect(count).toHaveText(String(dice.length - natureCount));
  await expect(page.locator('.dice-card[data-branch="nature"]:visible')).toHaveCount(0);

  // 全部取消勾選是使用者最容易踩到、又最像「站台壞了」的狀態：一個維度全不勾＝該維度不篩。
  for (const box of await page.locator('#codex-filters input[type=checkbox]').all()) {
    await box.uncheck();
  }
  await expect(count).toHaveText(String(dice.length));
  await expect(cards.first()).toBeVisible();
});

test('C3. 卡片裡的 #關鍵字 就地換頁：左右滑動過場、卡片高度不變、可以往下疊、← 與 Esc 都退得掉', async ({ page }) => {
  await page.goto('/dice');
  // 第一張「描述或覺醒裡有關鍵字」的卡片。底下的命中測試是在頁面內自己 click 的
  // （要在同一個 task 裡連續取樣），兩邊都用「第一個含 kw-link 的卡片」這個定義。
  const card = page.locator('.dice-card').filter({ has: page.locator('a.kw-link') }).first();
  const stage = card.locator('.card-term');
  const top = card.locator('.card-term-view[data-active]');
  const link = card.locator('a.kw-link').first();
  const term = (await link.getAttribute('data-term'))!;

  // 高度是這個設計唯一的硬性要求：41 張卡片排在 CSS grid 裡，任何一張改高度都會推動整列。
  // ⚠️ 先等進場動畫收掉再量：動畫期間卡片掛著 transform，boundingBox 會帶次像素誤差，
  // 底下那條嚴格相等會假紅（2026-08-26 實測 368.8124694824219 vs 368.8125）。見 probe.ts。
  await settleEnter(page);
  const box = (await card.boundingBox())!;
  const before = box.height;
  await expect(stage).toBeHidden();

  // 過場真的有跑，用 transitionrun 事件證明，不去猜某個時間點該量到多少位移——
  // --slide-ease 的前段很快，靠取樣位移來斷言必然是不穩定的測試。
  await page.evaluate(() => {
    (window as unknown as { slides: string[] }).slides = [];
    document.addEventListener('transitionrun', event => {
      const el = event.target as HTMLElement;
      const kind = el.classList.contains('card-term-view') ? 'view'
        : el.classList.contains('dice-card-main') ? 'main' : '';
      if (kind) (window as unknown as { slides: string[] }).slides.push(`${kind}:${(event as TransitionEvent).propertyName}`);
    }, true);
  });

  // 過場全程都待在卡片裡：進場那一層是從卡片右緣外 100% 滑進來的，靠 overflow: hidden 裁掉。
  // 少了任一層裁切，滑入的內容會蓋到隔壁那張卡片上。取樣**必須緊接在 click 之後**、而且在
  // 動畫這 280ms 內連續抓——等其他斷言跑完再抓就已經停在原位，那條斷言會變成永遠為真的死碼。
  // 用命中測試而不是截圖：它會 respect 裁切，也不必去猜某個時間點畫面該長什麼樣。
  const probe = await page.evaluate(([x1, x2, y]) => new Promise<{ hits: string[]; durs: string[] }>(resolve => {
    const hits: string[] = [];
    const durs: string[] = [];
    const name = (el: Element | null) => (el ? `${el.className}` : 'null');
    const t0 = performance.now();
    const tick = () => {
      hits.push(name(document.elementFromPoint(x1, y)), name(document.elementFromPoint(x2, y)));
      const view = document.querySelector<HTMLElement>('.dice-card .card-term-view[data-active]');
      if (view) durs.push(getComputedStyle(view).transitionDuration);
      if (performance.now() - t0 < 300) requestAnimationFrame(tick);
      else resolve({ hits, durs });
    };
    const card = [...document.querySelectorAll('.dice-card')].find(c => c.querySelector('a.kw-link'))!;
    card.querySelector<HTMLElement>('a.kw-link')!.click();
    requestAnimationFrame(tick);
  }), [box.x + box.width + 12, box.x - 12, box.y + box.height / 2] as const);

  expect(probe.hits.length).toBeGreaterThan(10);
  for (const hit of probe.hits) {
    expect(hit, '過場的內容跑到卡片外面了').not.toContain('card-term-view');
    expect(hit, '過場的內容跑到卡片外面了').not.toContain('dice-card-main');
  }
  // 過場真的掛上去了。這一條是 2026-08-22 踩過的坑的防線：把 `.dice-card .slide-anim` 的
  // transition 改成 none，畫面就變成「起始位移停一格再瞬間跳回」，看起來像卡片內容飛出去，
  // 而標題、高度、焦點那些斷言全部照樣綠。⚠️ 一定要在動畫**進行中**取樣：收尾會把
  // `.slide-anim` 拿掉，事後再量一定是 0s，那樣寫出來的是一條永遠會紅的死斷言。
  expect(probe.durs.some(d => d !== '0s'), 'slide-anim 沒有掛上 transition，過場等於沒有').toBe(true);

  await expect(stage).toBeVisible();
  await expect(top.locator('.card-term-title')).toHaveText(`#${term}`);
  expect(page.url(), '就地換頁不該離開 /dice').toContain('/dice');

  // 進場的那一層與退場的卡片本文都要跑 transform 過場（跟 /tree 的面板同一種左右切換）。
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { slides: string[] }).slides))
    .toEqual(expect.arrayContaining(['view:transform', 'main:transform']));
  // 過場結束後停在原位，沒有殘留的 inline transform。
  await expect
    .poll(() => page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('.dice-card .card-term-view[data-active]')!;
      return new DOMMatrixReadOnly(getComputedStyle(el).transform).m41;
    }))
    .toBe(0);
  expect((await card.boundingBox())!.height).toBe(before);
  // 「哪些節點用到」不列在這裡，只給一個把玩家帶去骰子樹的入口。
  await expect(stage).not.toContainText('個節點用到');

  // 解釋裡再引用到的詞可以繼續往下疊，← 一層層退回來（跟 /tree 的面板同一種操作感）。
  const nested = top.locator('a.kw-link').first();
  if (await nested.count() > 0) {
    const nestedTerm = (await nested.getAttribute('data-term'))!;
    await nested.click();
    await expect(top.locator('.card-term-title')).toHaveText(`#${nestedTerm}`);
    // 疊到第二層時，畫面上只能有一個「現在這層」。
    await expect(card.locator('.card-term-view[data-active]')).toHaveCount(1);
    expect((await card.boundingBox())!.height).toBe(before);
    await top.locator('.card-term-back').click();
    await expect(top.locator('.card-term-title')).toHaveText(`#${term}`);
  }

  // Esc 一次關掉整疊，而且焦點回到原本那個連結。
  await page.keyboard.press('Escape');
  await expect(stage).toBeHidden();
  await expect(link).toBeFocused();
  expect((await card.boundingBox())!.height).toBe(before);
});

test('C3b. 沒有 JS 時 #關鍵字 仍然是一條連得到詞條頁的連結', async ({ request }) => {
  // 就地換頁是 JS 攔下來的（preventDefault），底下的 href 一定要是真的——不然關掉 JS
  // 或腳本還沒載入時，那些標記就是一堆點不動的字。
  const html = await (await request.get('/dice')).text();
  const hrefs = [...html.matchAll(/class="kw-link" href="([^"]+)" data-term="([^"]+)"/g)];
  expect(hrefs.length).toBeGreaterThan(0);
  for (const [, href] of hrefs) {
    expect(href).toMatch(/^\/guide\/(mechanics|summons|status|monsters)#[A-Za-z][A-Za-z0-9_-]*$/);
  }
  // 每一個標記都要有官方色。別名（播種／傳送）曾經是全站唯二沒有顏色的標記——
  // renderTaggedText 給的詞彙表不含別名，查不到就不上色，看起來像另一種東西。
  const uncoloured = [...html.matchAll(/<a class="kw-link"[^>]*>(#[^<]+)<\/a>/g)]
    .filter(m => !m[0].includes('style="color:'))
    .map(m => m[1]);
  expect(uncoloured, '這些標記沒有官方色').toEqual([]);

  // 隨手挑一條真的去打，確認錨點落在一個存在的詞條上。
  const [, first, term] = hrefs[0]!;
  const [path, anchor] = first!.split('#');
  const page = await (await request.get(path!)).text();
  expect(page, `${term} 的錨點 ${anchor} 在 ${path} 上不存在`).toContain(`id="${anchor}"`);
});

test('C3c. 同時只開一張卡片：換一張會收掉前一張，Esc 關的是使用者正在看的那張', async ({ page }) => {
  // 先前的寫法是「抓 DOM 裡第一張開著的卡片」，於是在第二張按 Esc，關掉的是第一張、
  // 焦點還被丟到第一張的連結上（2026-08-22 code review 抓到）。與其去猜使用者在看哪一張，
  // 不如讓「開著的」永遠只有一張。
  await page.goto('/dice');
  const withKw = page.locator('.dice-card').filter({ has: page.locator('a.kw-link') });
  const first = withKw.nth(0);
  const second = withKw.nth(1);
  const secondLink = second.locator('a.kw-link').first();

  await first.locator('a.kw-link').first().click();
  await expect(first.locator('.card-term')).toBeVisible();

  await secondLink.click();
  await expect(second.locator('.card-term')).toBeVisible();
  await expect(first.locator('.card-term'), '換一張卡片時前一張要收掉').toBeHidden();
  // 前一張要真的回到本文狀態，不是只把舞台藏起來——本文若留在 visibility:hidden，那張卡片
  // 會變成一塊空白。
  await expect(first.locator('.dice-card-main')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(second.locator('.card-term')).toBeHidden();
  await expect(secondLink, 'Esc 之後焦點要回到剛才點的那個連結').toBeFocused();
});

test('C4. 導覽列的「遊戲介紹」選單能用鍵盤開、Esc 關，且焦點回到觸發它的地方', async ({ page }) => {
  await page.goto('/');
  const menu = page.locator('#site-nav .nav-menu');
  const summary = menu.locator('summary');

  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(menu).toHaveAttribute('open', '');
  await expect(menu.locator('a[href="/guide/status"]')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(menu).not.toHaveAttribute('open', '');
  // 焦點掉回 <body> 的話，下一次 Tab 會從整頁最上面重新開始，鍵盤使用者等於被丟回原點。
  await expect(summary).toBeFocused();
});

test('C5. 首頁的更新日誌顯示最新 3 筆，且資料條目的版本戳記與資料正本一致', async ({ page }) => {
  await page.goto('/');
  const entries = page.locator('.home-changelog .log-entry');
  await expect(entries).toHaveCount(3);

  // 規則 20 在 CI 擋的是同一件事，但那是對著檔案驗的；這一條驗的是「玩家真的看得到」。
  const stamp = page.locator('.home-changelog .log-stamp').first();
  await expect(stamp).toContainText(`v${tree.meta.gameVersion}`);
  // 資源包版本 2026-08-22 起不上頁面（Yuki 指定：玩家不需要知道資料抄自哪一版資源包）。
  // 它仍然在 data/changelog.json 裡給規則 20 用——這條反向守著「別又把它印回去」。
  await expect(stamp).not.toContainText(tree.meta.gameBundle);
  await expect(entries.first().locator('time')).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}$/);
});

test('C6. 篩選切換鈕外觀是按鈕、骨子裡仍是 checkbox：鍵盤操作得動，「全部」把五系開回來', async ({ page }) => {
  await page.goto('/dice');
  const count = page.locator('#codex-count');
  const all = page.locator('#codex-all');
  await expect(all).toHaveAttribute('data-active', '');

  for (const v of ['nature', 'magic', 'chaos']) {
    await page.uncheck(`#codex-filters input[value="${v}"]`);
  }
  await expect(count).not.toHaveText(String(dice.length));
  await expect(all).not.toHaveAttribute('data-active', '');

  await all.click();
  await expect(count).toHaveText(String(dice.length));
  await expect(all).toHaveAttribute('data-active', '');

  // ⚠️ 這一段守的是「切換鈕不能只有滑鼠能用」。checkbox 被 CSS 攤平成整顆鈕的大小、
  // opacity: 0——它必須還在 Tab 順序裡、按 Space 還要切換得動。改成 display: none 或
  // visibility: hidden 就會在這裡紅。
  const nature = page.locator('#codex-filters input[value="nature"]');
  await nature.focus();
  await expect(nature).toBeFocused();
  await page.keyboard.press(' ');
  await expect(nature).not.toBeChecked();
  await expect(count).toHaveText(String(dice.length - dice.filter(d => d.branch === 'nature').length));

  // 焦點框要畫在整顆鈕上：checkbox 自己是透明的，框在它身上等於看不見。
  const chip = page.locator('.chip[data-branch="nature"]');
  const outline = await chip.evaluate(el => getComputedStyle(el).outlineStyle);
  expect(outline, '鍵盤焦點時整顆鈕沒有外框').not.toBe('none');

  // 選中與否要看得出來：開著的鈕邊框走該分支的顏色。
  await page.keyboard.press(' ');
  await expect(nature).toBeChecked();
  const branch = await resolveColor(page, '--nature');
  // ⚠️ 一定要 poll。邊框色有 120ms 的過場，按完 Space 立刻讀會讀到中途的混色
  // （實測 rgb(151,79,97)，介於 --border 與 --nature 之間），寫成一次性斷言會偶爾紅。
  await expect
    .poll(() => chip.evaluate(el => getComputedStyle(el).borderTopColor), {
      message: '開啟中的切換鈕沒有走分支色',
    })
    .toBe(branch);
});

// ---------------------------------------------------------------------------
// 官方數值面板（2026-08-24）
//
// ⚠️ 這一塊的斷言一律要加 `useInnerText`：`toHaveText` 預設讀 textContent，而四個檔位的值
// 全部都是真的文字節點（只有一個被 CSS 顯示出來）。不加的話拿到的是「攻擊力 15075022502850」
// ——而它**仍然會通過** /攻擊力\s*150/ 這種樣式，等於什麼都沒驗。
//
// 這一塊的實作是**純 CSS**（四個檔位的值都是真的文字節點，`:has()` ＋ radio 決定顯示哪一個），
// 所以它會壞的地方跟 JS 版完全不同：不是「腳本沒跑」，而是「選擇器沒選中」「radio 分組錯了」
// 「值沒進 HTML」。單元測試看得到 statValue()／isFixed()，看不到這三件的任何一件。
// ---------------------------------------------------------------------------

test('C7. 41 顆骰子的四個檔位數值全部是伺服器輸出的 HTML', async ({ request }) => {
  const res = await request.get('/dice');
  const html = await res.text();

  // 抽三顆有代表性的：火骰子（四檔都不同）、鐵甲骰子（sheet3 獨有的第 4 項）、
  // 原子骰子（官方自己沒填值的兩格）。四檔的值都必須真的在 HTML 裡，不是靠 JS 算出來的
  // ——用 JS 換 textContent 的話另外三檔搜尋引擎一個字都拿不到，而那正是這一頁存在的理由。
  for (const v of ['150', '750', '2250', '2850']) expect(html, `火骰子攻擊力 ${v}`).toContain(`>${v}<`);
  expect(html, '鐵甲骰子的首領傷害倍率（只在官方強化分頁上，不在基本面板）').toContain('首領傷害倍率');
  expect(html, '原子骰子官方未填值的格子照原文寫「待實測」').toContain('待實測');

  // 目標與備註也要在，那是基本面板的一部分。
  expect(html).toContain('高生命值');
  expect(html).toContain('技能物件型，無標準基本攻擊');

  // 反向斷言：官方分頁的備註欄混了一條**資料表作者自己的校訂記錄**（D401 吞噬骰子的
  // 「原始目標文本：範圍前」＝官方原文寫「範圍前」、那一欄被正規化成「範圍內」）。
  // 那是給維護者看的，印在卡片上對玩家只會像個錯字（2026-08-24 Yuki 回報）。
  // 這條守著「別又把整欄照抄回去」。
  expect(html, '資料表的校訂記錄不可以印給玩家').not.toContain('原始目標文本');
  expect(html, '吞噬骰子的目標是正規化過的「範圍內」').toContain('範圍內');
});

test('C8. 切檔只換數字：41 張卡片的 pill 區塊高度在四個檔位全都不動', async ({ page }) => {
  await page.goto('/dice');
  const card = page.locator('.dice-card').filter({ hasText: '火骰子' }).first();
  const pills = card.locator('.stat-pill');

  // 先驗一次真的使用者動線：點下去、數字換掉、pill 數量與卡片高度不變。
  const before = { count: await pills.count(), h: (await card.boundingBox())!.height };
  await expect(pills.first()).toHaveText(/攻擊力\s*150/, { useInnerText: true });
  await card.locator('.stat-modes input[value="lv15dice7"]').check();
  await expect(pills.first()).toHaveText(/攻擊力\s*2850/, { useInnerText: true });
  expect(await pills.count(), 'pill 數量不可以隨檔位改變').toBe(before.count);
  // ⚠️ 這裡不可以用 toBe：boundingBox 回的是裝置像素換算後的浮點數，同一個版面重量一次就會
  // 差到 3e-5（實測 424.625 vs 424.6249694824219）。用嚴格相等的話這一行會在版面完全沒變時
  // 隨機紅，而且會**搶在下面那段全站掃描之前**紅掉——真正的成因反而看不到。
  expect((await card.boundingBox())!.height, '卡片高度不可以隨檔位改變').toBeCloseTo(before.h, 1);
  await card.locator('.stat-modes input[value="base"]').check();

  // ⚠️ 上面那一張擋不住這條規則真正會壞的地方。2026-08-24 的 /code-review 實測：**火骰子
  // 從來不會 reflow**（四個檔位都是 2 列），而真正會的是尖刺骰子（攻擊力 750 → 15750 讓
  // pill 區塊 68px → 106px）。卡片排在 CSS grid 的同一列裡，它一變高就把火骰子與花骰子
  // 一起從 424.6px 撐到 462.7px——**使用者根本沒去動那兩張**。只量一張卡片＝假通過。
  //
  // 所以掃全部 41 張 × 四個檔位。用 page.evaluate 直接改 checked 而不是 41×4 次 Playwright
  // 點擊：後者在這套測試裡要跑兩分鐘。（沒有 JS 也切得動這件事由 C11 守。）
  const result = await page.evaluate(() => {
    const modes = ['base', 'dice7', 'lv15', 'lv15dice7'];
    const bad: string[] = [];
    let measured = 0;
    let anyValueChanged = false;
    for (const c of document.querySelectorAll('.dice-card')) {
      const block = c.querySelector('.stat-pills');
      if (block === null) continue;
      measured++;
      const first = c.querySelector('.stat-v') as HTMLElement | null;
      const seen = new Set<string>();
      const heights = new Set<number>();
      for (const m of modes) {
        (c.querySelector(`.stat-modes input[value="${m}"]`) as HTMLInputElement).checked = true;
        heights.add(Math.round(block.getBoundingClientRect().height));
        const shown = first?.querySelector(`[data-m="${m}"]`)?.textContent;
        if (shown !== undefined && shown !== null) seen.add(shown);
      }
      if (seen.size > 1) anyValueChanged = true;
      (c.querySelector('.stat-modes input[value="base"]') as HTMLInputElement).checked = true;
      if (heights.size > 1) {
        bad.push(`${c.querySelector('h3')?.textContent} ${[...heights].join('→')}`);
      }
    }
    return { bad, measured, anyValueChanged };
  });

  // 前提斷言：真的掃到 41 張，而且四個檔位真的有值在變。少了這兩行，選擇器哪天改名之後
  // 這條測試會掃到 0 張卡片、然後「通過」。
  expect(result.measured, '應該掃到 41 張卡片').toBe(41);
  expect(result.anyValueChanged, '四個檔位應該真的有值不一樣，否則這條在量一個不會動的東西').toBe(true);
  expect(result.bad, 'pill 區塊高度隨檔位改變的卡片').toEqual([]);
});

test('C9. 不隨骰點或強化改變的項目，切到別的檔會淡下去', async ({ page }) => {
  await page.goto('/dice');
  const card = page.locator('.dice-card').filter({ hasText: '火骰子' }).first();
  const fixed = card.locator('.stat-pill.is-fixed').first();   // 目標
  const scaling = card.locator('.stat-pill:not(.is-fixed)').first(); // 攻擊力

  // 基礎檔＝遊戲內面板的樣子，所有項目一律等重。
  await expect(fixed).toHaveCSS('opacity', '1');

  await card.locator('.stat-modes input[value="dice7"]').check();
  // 「這幾項剛才沒有跟著變」靠淡化講，不另外寫字。
  await expect(fixed).not.toHaveCSS('opacity', '1');
  await expect(scaling).toHaveCSS('opacity', '1');
});

test('C10. 每張卡片是獨立的一組：切一張不會動到別張', async ({ page }) => {
  await page.goto('/dice');
  const fire = page.locator('.dice-card').filter({ hasText: '火骰子' }).first();
  const poison = page.locator('.dice-card').filter({ hasText: '毒骰子' }).first();

  await fire.locator('.stat-modes input[value="lv15dice7"]').check();

  // radio 的 name 要是全頁唯一的。忘了帶節點 id 的話 41 張卡片會變成同一組，
  // 切一張把其他 40 張的選取狀態一起清掉——而畫面上「數字沒變」跟「這顆本來就不會變」
  // 長得一模一樣，只有另一張卡片的 checked 狀態會說話。
  await expect(poison.locator('.stat-modes input[value="base"]')).toBeChecked();
  await expect(poison.locator('.stat-pill').first()).toHaveText(/攻擊力\s*100/, { useInnerText: true });
  await expect(fire.locator('.stat-pill').first()).toHaveText(/攻擊力\s*2850/, { useInnerText: true });
});

test('C11. 沒有 JS 時檔位照樣切得動（整塊是純 CSS）', async ({ browser }) => {
  // 這一頁的其他互動（篩選、#關鍵字 就地視圖）沒有 JS 就不會動，數值面板刻意不是那樣：
  // 它是這一頁唯一一個「沒有腳本也完整可用」的控制項。有人哪天把它改成 JS 換 textContent，
  // 畫面上完全看不出差別，只有這條會紅。
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto('/dice');
  const card = page.locator('.dice-card').filter({ hasText: '火骰子' }).first();

  await expect(card.locator('.stat-pill').first()).toHaveText(/攻擊力\s*150/, { useInnerText: true });
  await card.locator('.stat-modes input[value="lv15dice7"]').check();
  await expect(card.locator('.stat-pill').first()).toHaveText(/攻擊力\s*2850/, { useInnerText: true });
  await ctx.close();
});

test('C12. 卡片頂緣的分支色線：真的畫得出來，翻到關鍵字頁也不會被蓋掉', async ({ page }) => {
  // 那條線是 `.dice-card::after`（PR ④）。偽元素在 DOM 裡沒有節點，`toBeVisible()` 之類
  // 的斷言一條都用不上——只有量像素會說話。
  //
  // ⚠️ 第二段（翻到關鍵字頁之後再量一次）才是這條測試存在的理由：`.card-term` 是
  // `inset: 0; z-index: 1` 的覆蓋層，::after 少了 `z-index: 2` 就會被它整條蓋掉。而那個
  // 失效模式**只在翻頁之後**才看得到，卡片正面完全正常，其餘 11 條 /dice 測試一條都不會紅。
  await page.goto('/dice');

  // 挑一張「有 #關鍵字 可以翻頁」而且掛了分支的卡片，分支色從它自己的屬性讀，不要寫死。
  const card = page.locator('.dice-card[data-branch]').filter({ has: page.locator('a.kw-link') }).first();
  await card.scrollIntoViewIfNeeded();
  const branch = await card.getAttribute('data-branch');
  const [r0, g0, b0] = (await resolveColor(page, `--${branch}`))
    .match(/\d+/g)!.slice(0, 3).map(Number) as [number, number, number];

  const box = (await card.boundingBox())!;
  // 取樣範圍只取左上角一小塊：漸層在 70% 處就透明了，右半邊本來就該是卡片底色。
  // 高度 8 CSS px 蓋得住 1px 上邊框 ＋ 3px 色線，還留了餘裕給裝置像素的四捨五入。
  //
  // ⚠️ x 從 box.x + 12 起算，避開左上角的圓角與 1px 邊框。這個偏移原本是為了避開
  // `border-left: 3px solid var(--branch)`（跟頂緣同色，從 box.x 起算會量到它，把 ::after
  // 整條刪掉也照樣綠——反例沒紅才抓到）。那條左緣色線 2026-08-26 已經拿掉，偏移留著只是
  // 避開圓角；**不要因為理由變了就把它改回 box.x**，圓角那幾格是卡片底色。
  const clip = { x: box.x + 12, y: box.y, width: 48, height: 8 };
  const near = async () => {
    const { data, info } = await sharp(await page.screenshot({ clip })).raw()
      .toBuffer({ resolveWithObject: true });
    let best = 999;
    for (let i = 0; i < data.length; i += info.channels) {
      const d = Math.abs(data[i]! - r0) + Math.abs(data[i + 1]! - g0) + Math.abs(data[i + 2]! - b0);
      if (d < best) best = d;
    }
    return best;
  };

  // 正向控制：沒有這一段，下面那條在「根本沒畫那條線」時也會綠（兩次都找不到，但只斷言
  // 第二次的話就看不出差別）。門檻 40 是三個通道的曼哈頓距離，容得下反鋸齒與漸層起點的
  // 一點點混色，但容不下「整條線不存在」（那裡會是 --surface-1，距離 200 以上）。
  const before = await near();
  expect(before, `卡片正面就找不到 --${branch} 的頂緣色線，這條測試等於沒守`).toBeLessThan(40);

  // 翻到 #關鍵字 的就地視圖，等過場停下來再量。
  await card.locator('a.kw-link').first().click();
  await expect(card.locator('.card-term-view[data-active]')).toBeVisible();
  await page.waitForTimeout(400); // --slide-ms 是 280ms
  const after = await near();
  expect(after, `翻到關鍵字頁之後頂緣色線被 .card-term 蓋掉了（::after 的 z-index 沒贏）`)
    .toBeLessThan(40);

  // 它橫跨整張卡片的頂緣，不能吃掉底下的點擊。
  expect(await card.evaluate(el => getComputedStyle(el, '::after').pointerEvents)).toBe('none');
});
