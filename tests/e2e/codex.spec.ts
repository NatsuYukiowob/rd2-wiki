// 骰子圖鑑、遊戲介紹與首頁更新日誌的端對端驗證（2026-08-22）。
//
// 這一份存在的理由跟 seo.spec.ts 同一族：這幾件事壞掉的時候，站台**逛起來完全正常**。
// 圖鑑最核心的承諾是「文字進得了 HTML」——那件事在瀏覽器裡看不出差別（有沒有 JS 渲染，
// 畫面長得一模一樣），只有去讀伺服器回的原始 HTML 才會說話。所以第一條測試刻意用
// `request.get()` 而不是 `page.goto()`：後者拿到的是 JS 跑完之後的 DOM，驗不到這件事。
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolveColor } from './probe';

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
