// 全站外框（導覽列、表面層次、版面級距）的端對端驗證（2026-08-22 精緻化）。
//
// 這一份守的東西有個共同點：**壞掉的時候站台照樣能用**，只是變醜或變得不好操作，所以
// 沒有任何既有測試會說話。2026-08-22 那一輪改動跑完 143 條測試全綠，卻同時帶著兩個
// 人工看圖才發現的 bug（下拉箭頭被拉成一條金槓、短頁面的 footer 停在畫面中間）——
// 這一份就是把那類東西釘住。
import { test, expect } from '@playwright/test';
import { resolveColor, settleEnter } from './probe';

test('D1. 導覽列沾在視窗頂端，圖鑑的篩選列沾在導覽列正下方，兩者都不被卡片蓋掉', async ({ page }) => {
  await page.goto('/dice');
  const nav = page.locator('#site-nav');
  const filters = page.locator('.filters');
  const navH = (await nav.boundingBox())!.height;

  await page.evaluate(() => window.scrollTo(0, 1500));
  await page.waitForTimeout(100);

  const navBox = (await nav.boundingBox())!;
  const filterBox = (await filters.boundingBox())!;
  // 捲了 1500px 之後兩者都還在原位：導覽列貼齊視窗頂端，篩選列緊接在它下面。
  expect(navBox.y, '導覽列沒有沾在視窗頂端').toBeLessThanOrEqual(1);
  expect(Math.abs(filterBox.y - (navBox.y + navBox.height)), '篩選列沒有貼齊導覽列下緣').toBeLessThan(2);

  // 位置對不代表看得到——`toBeVisible()` 不檢查有沒有被別的元素蓋住（K 那條測試踩過同一個坑）。
  // 實際打點：這兩條列的中心點打下去，接到的必須是它們自己裡面的東西，不能是底下捲過來的卡片。
  const hit = await page.evaluate(([nx, ny, fx, fy]) => {
    const name = (el: Element | null) => (el?.closest('#site-nav') ? 'nav'
      : el?.closest('.filters') ? 'filters'
      : el?.closest('.dice-card') ? 'card' : 'other');
    return {
      nav: name(document.elementFromPoint(nx!, ny!)),
      filters: name(document.elementFromPoint(fx!, fy!)),
    };
  }, [navBox.x + 20, navBox.y + navH / 2, filterBox.x + 20, filterBox.y + filterBox.height / 2]);
  expect(hit.nav).toBe('nav');
  expect(hit.filters).toBe('filters');
});

test('D2. --nav-h 在 /tree 以外的頁面也量得到，不是停在 CSS 的 fallback', async ({ page }) => {
  // 篩選列的 `top`、html 的 scroll-padding-top 全都吃這個值。2026-08-22 之前它只有
  // /tree 會被寫入（量測寫在 tree-canvas.ts 裡），搬到 src/lib/nav-height.ts 由
  // Base.astro 全站安裝。搬回去的話這條會紅。
  await page.goto('/dice');
  const navH = (await page.locator('#site-nav').boundingBox())!.height;
  const varValue = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--nav-h').trim());
  expect(varValue, '--nav-h 沒有被寫入').not.toBe('');
  expect(Math.abs(parseFloat(varValue) - navH), '--nav-h 與導覽列實際高度對不上').toBeLessThan(1);
});

test('D3. 目前分頁標 aria-current，而且沒有把下拉選單的 ▾ 箭頭吃掉', async ({ page }) => {
  await page.goto('/dice');
  await expect(page.locator('#site-nav a[href="/dice"][aria-current="page"]')).toHaveCount(1);
  await expect(page.locator('#site-nav a[href="/tree"][aria-current="page"]')).toHaveCount(0);

  await page.goto('/guide/mechanics');
  const summary = page.locator('#site-nav .nav-menu > summary');
  await expect(summary).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.nav-menu-items a[href="/guide/mechanics"][aria-current="page"]')).toHaveCount(1);

  // ⚠️ 這一段是 2026-08-22 實際發生過的 bug 的守門。
  // 目前分頁的金線一度也畫在 ::after 上，跟下拉箭頭撞在同一個偽元素——而箭頭那條選擇器
  // 具體度比較高，於是 content 仍是 ▾、卻吃到金線那條的絕對定位，箭頭被拉成一條金色橫槓
  // 掉到導覽列外面。金線必須待在 ::before。
  const pseudo = await summary.evaluate(el => ({
    afterContent: getComputedStyle(el, '::after').content,
    afterPosition: getComputedStyle(el, '::after').position,
    beforeContent: getComputedStyle(el, '::before').content,
    beforeBg: getComputedStyle(el, '::before').backgroundColor,
  }));
  expect(pseudo.afterContent, '下拉箭頭不見了').toContain('▾');
  expect(pseudo.afterPosition, '下拉箭頭被拉出正常排版').toBe('static');
  expect(pseudo.beforeContent, '目前分頁的金線沒畫出來').toBe('""');
  expect(pseudo.beforeBg).toBe(await resolveColor(page, '--gold'));
});

test('D4. 骰子卡頂緣是所屬分支的顏色，五系各驗一張', async ({ page }) => {
  // 2026-08-26 之前這條量的是 `border-left`；分支色條那時改到頂緣的 `.dice-card::after`
  // （Yuki 拍板拿掉左緣那條），所以這裡改量偽元素的漸層。
  // ⚠️ 順便守「左緣不准再長回來」：兩條同色的線圍成「⌐」正是被拿掉的東西，只驗頂緣的話
  // 有人把 border-left 加回去這條照樣綠。
  await page.goto('/dice');
  for (const branch of ['nature', 'engineering', 'magic', 'order', 'chaos']) {
    const card = page.locator(`.dice-card[data-branch="${branch}"]`).first();
    await expect(card, `${branch} 沒有任何骰子卡`).toHaveCount(1);
    const style = await card.evaluate(el => ({
      top: getComputedStyle(el, '::after').backgroundImage,
      topH: getComputedStyle(el, '::after').height,
      leftW: getComputedStyle(el).borderLeftWidth,
      leftColor: getComputedStyle(el).borderLeftColor,
    }));
    const expected = await resolveColor(page, `--${branch}`);
    expect(style.top, `${branch} 的頂緣色線不是分支色（讀到 ${style.top}）`).toContain(expected);
    expect(style.topH, `${branch} 的頂緣色線沒有高度`).toBe('3px');
    expect(style.leftW, '左緣的分支色條長回來了（2026-08-26 拿掉的）').toBe('1px');
    expect(style.leftColor, '左緣的分支色條長回來了（2026-08-26 拿掉的）')
      .toBe(await resolveColor(page, '--border'));
  }
});

test('D5. 鍵盤 Tab 過去的元素一定有焦點框（全站共用的那一條規則）', async ({ page }) => {
  await page.goto('/dice');
  // 從頁面最上面開始 Tab，第一個可聚焦的東西就是導覽列的站名。
  await page.keyboard.press('Tab');
  const ring = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const s = getComputedStyle(el);
    return { tag: el.tagName, style: s.outlineStyle, width: s.outlineWidth };
  });
  expect(ring, 'Tab 之後沒有任何東西拿到焦點').not.toBeNull();
  expect(ring!.tag).toBe('A');
  expect(ring!.style, '焦點框被關掉了').not.toBe('none');
  expect(parseFloat(ring!.width), '焦點框寬度是 0').toBeGreaterThan(0);
});

/**
 * ⚠️ 這條 2026-08-26 從 `test.skip(scrollable, …)` 改成「自己指定一個夠高的視窗 ＋ 硬斷言」。
 *
 * 舊寫法在 mobile 專案上**從一開始就沒驗到任何東西**：Pixel 7 的視窗高 839，而 /guide 在
 * 那個寬度下 scrollHeight 是 1076——條件成立，整條直接跳過，list reporter 上只是一行灰字。
 * desktop 那邊更驚險：/guide 的 scrollHeight 剛好 720、視窗也剛好 720，餘裕是 **0**，任何
 * 讓 /guide 多長一行的改動都會讓它跟著靜靜跳過，而不是紅。
 *
 * 換句話說，一條「內容不滿一屏」的測試，它的前提條件是自己不能控制的頁面高度——那不是
 * 條件式跳過，那是假綠。現在把視窗高度寫死成 1600，前提就由測試自己保證；哪天 /guide 真的
 * 長到 1600 以上，會**紅在下面那句 expect**（附說明），而不是消失。
 */
test('D6. 內容不滿一屏時 footer 沉到視窗底部，不會停在畫面中間', async ({ page }) => {
  const VH = 1600;
  await page.setViewportSize({ width: page.viewportSize()!.width, height: VH });
  await page.goto('/guide');
  const sh = await page.evaluate(() => document.documentElement.scrollHeight);
  expect(sh, `/guide 在 ${VH}px 高的視窗下已經捲得動（scrollHeight=${sh}），`
    + '這條測試需要一個「內容不滿一屏」的頁面——把上面的 VH 加大，不要改回 test.skip')
    .toBeLessThanOrEqual(VH + 1);
  const foot = (await page.locator('footer').boundingBox())!;
  expect(Math.abs(foot.y + foot.height - VH), 'footer 沒有沉到視窗底部').toBeLessThan(2);
});

test('D7. 卡片換頁的過場時間吃 --slide-ms；使用者要求減少動態時整組關掉', async ({ page }) => {
  await page.goto('/dice');
  // 直接量一個掛上 .slide-anim 的探針，不要去點真的關鍵字：那條路徑的腳本會先問
  // matchMedia 再決定走不走動畫，量到的是腳本的判斷，不是這裡要守的 CSS。
  const probe = () => page.evaluate(() => {
    const card = document.querySelector('.dice-card') as HTMLElement;
    const el = document.createElement('div');
    el.className = 'slide-anim';
    card.appendChild(el);
    const out = {
      slide: getComputedStyle(el).transitionDuration,
      card: getComputedStyle(card).transitionDuration,
      slideMs: getComputedStyle(document.documentElement).getPropertyValue('--slide-ms').trim(),
    };
    el.remove();
    return out;
  });

  const normal = await probe();
  // transition 列了 transform 與 opacity 兩個屬性，computed 值就會是兩份時間。
  // 每一份都必須等於 --slide-ms——寫死成 '0.28s' 的話，改 token 時這裡不會說話。
  // 一律換算成毫秒再比，不要比字串：--slide-ms 原始碼寫的是 `280ms`，computed value
  // 是 `.28s`（連前導 0 都被吃掉），transitionDuration 又是 `0.28s`——三種寫法同一個值。
  const ms = (v: string) => (v.trim().endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000);
  const want = ms(normal.slideMs);
  expect(want, '--slide-ms 讀不到').toBeGreaterThan(0);
  expect(normal.slide.split(',').map(ms), '換頁過場沒有吃 --slide-ms').toEqual([want, want]);
  expect(Math.min(...normal.card.split(',').map(ms)), 'hover 抬升沒有過場').toBeGreaterThan(0);

  // ⚠️ 用 emulateMedia() 而不是 test.use({ reducedMotion })：後者在這個版本的 Playwright
  // 裡沒有傳進 page（實測 matchMedia('(prefers-reduced-motion: reduce)').matches 仍是
  // false），測試會安靜地變成「在沒有減少動態的情況下驗減少動態」——永遠綠、什麼都沒守到。
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reduced = await probe();
  expect(reduced.slide, '卡片換頁的過場沒有被關掉').toBe('0s');
  expect(reduced.card, 'hover 抬升的過場沒有被關掉').toBe('0s');
});

test('D9. 導覽列永遠是一行：每一項都在同一列，高度不吃掉畫面', async ({ page }) => {
  // 沾頂的導覽列一換行就等於永久佔掉畫面。手機寬度下中文會在任意兩字之間斷開，
  // 實測 Pixel 7 上「rd2-wiki」「骰子樹」「圖鑑」各折成兩行，nav 高到 190px。
  await page.goto('/dice');
  const nav = page.locator('#site-nav');
  const box = (await nav.boundingBox())!;
  expect(box.height, '導覽列不只一行').toBeLessThan(64);

  const rows = await nav.evaluate(el =>
    [...el.querySelectorAll(':scope > a, :scope > .nav-menu > summary')]
      .map(n => Math.round(n.getBoundingClientRect().top)));
  expect(new Set(rows).size, `導覽列的項目落在 ${new Set(rows).size} 列上`).toBe(1);
});

test('D10. 錨點跳轉只加一次導覽列的偏移量', async ({ page }) => {
  // `html { scroll-padding-top }` 與 `.kw-entry { scroll-margin-top }` 一度同時帶著同一個
  // 算式，瀏覽器兩個都算，目標卡片停在導覽列下方 74px 而不是 12px（2026-08-22 review 抓到）。
  await page.goto('/guide/status');
  const id = await page.locator('.kw-entry').first().getAttribute('id');
  expect(id, '詞條卡片沒有 id，錨點跳轉無從測起').toBeTruthy();

  await page.goto(`/guide/status#${id}`);
  await page.waitForTimeout(300);
  const gap = await page.evaluate(anchor => {
    const target = document.getElementById(anchor!)!;
    const nav = document.getElementById('site-nav')!;
    return Math.round(target.getBoundingClientRect().top - nav.getBoundingClientRect().bottom);
  }, id);
  // 預期就是一個 --space-3（12px）。放寬到 4–24 吸收捲動的次像素，但 74 那種「加了兩次」
  // 一定會落在外面。
  expect(gap, `目標卡片離導覽列 ${gap}px，偏移量被加了不只一次`).toBeGreaterThanOrEqual(4);
  expect(gap, `目標卡片離導覽列 ${gap}px，偏移量被加了不只一次`).toBeLessThanOrEqual(24);
});

test('D11. 下拉選單的目前分頁：金線與金字都要有', async ({ page }) => {
  // `#site-nav .nav-menu > summary { color: var(--fg) }` 的具體度 (1,1,1) 贏過
  // `#site-nav [aria-current='page']` 的 (1,1,0)，於是「遊戲介紹」拿得到金線卻拿不到金字
  // ——又一次「兩條規則各贏一半」（2026-08-22 review 抓到）。
  await page.goto('/guide/mechanics');
  const summary = page.locator('#site-nav .nav-menu > summary');
  await expect(summary).toHaveAttribute('aria-current', 'page');
  const gold = await resolveColor(page, '--gold');
  expect(await summary.evaluate(el => getComputedStyle(el).color), '目前分頁的下拉標題沒有轉金色').toBe(gold);
  // 反向：不在 /guide 底下時就不該是金色，否則上面那條「永遠金色」也會過。
  await page.goto('/dice');
  expect(await summary.evaluate(el => getComputedStyle(el).color)).not.toBe(gold);
});

test('D12. 篩選切換鈕換行時列與列之間有縫，而且焦點框不被分組裁掉', async ({ page }) => {
  // 兩個都是把 <fieldset><legend> 換成 flex 分組之前的老問題（2026-08-22 review）：
  // 分組用 `gap: 0` ＋ 只有水平 margin，換行後兩列的 1px 邊框直接貼在一起；而為了收住浮動的
  // <legend> 加的 `overflow: hidden` 會把切換鈕的焦點框裁掉（outline 由祖先的 overflow 裁切）。
  await page.setViewportSize({ width: 420, height: 900 });
  await page.goto('/dice');
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('#codex-filters .chip')].map(c => {
      const r = c.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
    }));
  const tops = [...new Set(rows.map(r => r.top))].sort((a, b) => a - b);
  expect(tops.length, '這個寬度下切換鈕沒有換行，測不到列距').toBeGreaterThan(1);
  const firstRowBottom = rows.find(r => r.top === tops[0])!.bottom;
  expect(tops[1]! - firstRowBottom, '換行的兩列之間沒有縫').toBeGreaterThanOrEqual(4);

  // 焦點框畫在切換鈕外 4px（outline 2px ＋ offset 2px），分組不能把它裁掉。
  const clip = await page.evaluate(() => {
    const chip = document.querySelector('.chip[data-branch="nature"]')!;
    const group = chip.closest('.filter-group')!;
    return { overflow: getComputedStyle(group).overflow, groupOverflowX: getComputedStyle(group).overflowX };
  });
  expect(clip.overflow, '分組會裁掉切換鈕的焦點框').toBe('visible');
  expect(clip.groupOverflowX).toBe('visible');
});

test('D13. 窄螢幕：導覽列自己橫向捲動，不換行也不把整份文件推寬', async ({ page, isMobile }) => {
  // 2026-08-23 加了第六個入口「骰子樹-模擬器(beta)」之後，六項在 320px 要 389px，塞不下。
  // 裁決（Yuki 指定）是「讓他可以左右拖動即可」——但捲的必須是**導覽列自己**：
  // 讓整份文件橫捲會踩到 /board 的 B13（320／360／390／412 都不得出現橫向捲動），
  // 而 D9 的「永遠一行」也還要成立。
  test.skip(!isMobile, '桌機寬度本來就塞得下，這條測的是行動版的捲動策略');
  await page.goto('/board');
  for (const w of [320, 360, 412]) {
    await page.setViewportSize({ width: w, height: 900 });
    const r = await page.evaluate(() => {
      const nav = document.getElementById('site-nav')!;
      return {
        docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        navScrollable: nav.scrollWidth > nav.clientWidth,
        rows: new Set([...nav.querySelectorAll(':scope > a, :scope > .nav-menu > summary')]
          .map(n => Math.round(n.getBoundingClientRect().top))).size,
      };
    });
    expect(r.docOverflow, `寬度 ${w}px 時整份文件出現橫向捲動`).toBeLessThanOrEqual(0);
    expect(r.navScrollable, `寬度 ${w}px 時導覽列自己捲不動，後面的入口就摸不到了`).toBe(true);
    expect(r.rows, `寬度 ${w}px 時導覽列折成 ${r.rows} 列`).toBe(1);
  }

  // ⚠️ `overflow-x` 一設，`overflow-y` 就會被算成 auto，而「遊戲介紹」的下拉是絕對定位
  // 掛在 nav 底下的——不明確寫 `overflow-y: visible` 的話它會被整個裁掉。
  await page.setViewportSize({ width: 320, height: 900 });
  await page.locator('#site-nav .nav-menu > summary').click();
  const menu = (await page.locator('#site-nav .nav-menu-items').boundingBox())!;
  const nav = (await page.locator('#site-nav').boundingBox())!;
  expect(menu.y + menu.height, '下拉選單被導覽列的 overflow 裁掉了').toBeGreaterThan(nav.y + nav.height);
  await expect(page.locator('#site-nav .nav-menu-items a').first()).toBeVisible();
});

test('D14. 減少動態的規則拆到各檔之後沒有漏掉任何一條', async ({ page }) => {
  // 2026-08-26 把舊的 `global.css` 檔尾那張 reduce 總表拆散到四個檔之後補的。
  // 拆散之前只有 .dice-card 與 .dice-card .slide-anim 兩條有 E2E 在守（D7）。這裡要接住
  // 剩下的每一條「選擇器＋宣告」，拆錯檔會靜默失效——沒有任何東西會說話。
  // 2026-08-26 code review 加註：初版只挑了 6 條，.dice-card:hover／.home-card:hover／
  // .guide-card:hover 三條 transform 與 #detail 整份三條完全零守備，跟這條測試自己的註解
  // 「防拆錯檔靜默失效」自相矛盾——現在補齊。三種形狀分開處理，別硬套同一套斷言：
  //   (1) 平常就有 transition 的元素／偽元素，直接讀 computed transitionDuration。
  //   (2) 只有 :hover 才生效的 transform，要先真的觸發 hover 再讀（實測 el.hover() 在
  //       desktop／mobile 兩個 project 都能正確觸發 :hover 並在 reduce 之下變回 none，
  //       不必額外跳過任何一邊）。
  //   (3) #detail 底下的過場：不驅動真的換頁動畫（脆），改用跟 D7 同款的合成探針——塞一個
  //       帶目標 class 的 div 進 #detail 量完就丟掉。#detail 平常帶 hidden 屬性，但
  //       transitionDuration 這種不依賴版面的 computed 值即使在 display:none 下也讀得到
  //       （已用獨立腳本驗證過，讀到的是 CSS 宣告的值不是 0）。
  //   (4) #filters.animating（篩選面板寬度過場，tree.astro:188）：同一套合成探針，但這條
  //       過場的宣告直接掛在 #filters 本體上（不像 #detail 那三條要塞子元素），所以探針
  //       改成直接在既有的 #filters 上切 class 量、量完立刻拿掉。
  // 全部用 expect.soft：多個檔案同時壞掉時要一次看到全部，不要卡在陣列裡第一個失敗的案例
  // 就中止（Step 9 反例控制撞過：預期紅在 .chip，實際卡在陣列排更前面的 .home-card）。
  // 2026-08-26 code review 二輪加註：#filters.animating（tree.astro:188）不在被拆散的那張
  // 總表裡，是 tree.astro 自己既有的獨立區塊，但 D14 的標題是「沒有漏掉任何一條」——
  // 留一個已知缺口在裡面就是這條測試自己在防的假守門，補上形狀 (4)。

  // --- 形狀一：直接讀元素／偽元素的 transitionDuration ---
  const SIMPLE_CASES = [
    { path: '/', selector: '.home-card' },
    { path: '/guide', selector: '.guide-card' },
    { path: '/dice', selector: '.chip' },
    { path: '/dice', selector: '.chip .branch-dot' },
    { path: '/dice', selector: '#site-nav a' },
    { path: '/dice', selector: '#site-nav .nav-menu > summary' },
    // 2026-08-26 PR ⑥ 新增：這兩個檔在那之前**一條 transition 都沒有**，所以也沒有 reduce
    // 區塊；按壓回饋加進去之後才需要。新元件加動效時要記得補同一件事。
    { path: '/board', selector: '#board-tools button' },
    { path: '/sim', selector: '#sim-toolbar button' },
    // ⚠️ #filters-toggle 本體（tree.astro:279）沒有 transition，過場在 ::after
    // （:297 transform）與 ::before（:310 background-color）兩個偽元素上。讀元素本身的話
    // 正向控制會直接紅，而且是假紅——所以這兩列指定讀虛擬元素。
    { path: '/tree', selector: '#filters-toggle', pseudo: '::after' },
    { path: '/tree', selector: '#filters-toggle', pseudo: '::before' },
  ] as const;
  for (const c of SIMPLE_CASES) {
    const pseudo = 'pseudo' in c ? c.pseudo : null;
    await page.emulateMedia({ reducedMotion: null });
    await page.goto(c.path);
    const el = page.locator(c.selector).first();
    await expect.soft(el, `${c.path} 上找不到 ${c.selector}`).toBeAttached();
    // ⚠️ 2026-08-26 code review 抓到：上面那條 expect.soft 選擇器不匹配時只記一筆，不會中止；
    // 但緊接著的 el.evaluate() 是無條件跑的，選擇器一旦真的落空，它會在 30 秒 locator timeout
    // 之後拋出並中止整個 test——其餘案例全部不會跑，剛好打掉這條測試自己的註解講的
    // 「expect.soft 是為了多個檔案同時壞掉時一次看到全部」。找不到就跳過這個 case，不要硬跑。
    if (!(await el.count())) continue;
    const read = (p: string | null) =>
      el.evaluate((n, pp) => getComputedStyle(n, pp).transitionDuration, p);
    const selector = c.selector + (pseudo ?? '');
    const path = c.path;
    // 正向控制：這個元素平常真的有過場，下面那條斷言才有意義。
    const normal = await read(pseudo);
    expect.soft(normal, `${selector} 平常就沒有過場，這條斷言等於沒守`).not.toBe('0s');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    const reduced = await read(pseudo);
    expect.soft(reduced.split(',').map(v => v.trim()).every(v => v === '0s'),
      `${path} 的 ${selector} 在 reduce 之下過場沒有被關掉（讀到 ${reduced}）`).toBe(true);
  }

  // --- 形狀二：只有 :hover 才生效的 transform，要真的觸發 hover 才量得到 ---
  const HOVER_CASES = [
    { path: '/dice', selector: '.dice-card' },
    { path: '/', selector: '.home-card' },
    { path: '/guide', selector: '.guide-card' },
  ] as const;
  for (const c of HOVER_CASES) {
    await page.emulateMedia({ reducedMotion: null });
    await page.goto(c.path);
    // ⚠️ 一定要等進場動畫收掉再量（2026-08-26 code review 抓到）。`[data-enter]` 期間
    // `animation: rise … both` 的結束值會壓過 `:hover` 的 transform，讀到的是
    // `matrix(1, 0, 0, 1, 0, 0)`——那不是字串 'none'，所以底下的**正向控制照樣通過**，
    // 而它通過的是動畫的填充值不是 hover。把 `.dice-card:hover { transform }` 整條刪掉，
    // 這個 case 仍然全綠。三個 path 都要等：/ 與 /guide 的卡片同樣掛著進場動畫。
    await settleEnter(page);
    const el = page.locator(c.selector).first();
    await expect.soft(el, `${c.path} 上找不到 ${c.selector}`).toBeAttached();
    // 同上一個形狀的理由：找不到就跳過，不要讓 el.hover() 卡 30 秒把整個 test 中止掉。
    if (!(await el.count())) continue;
    // --face-lift 的下緣硬邊：`calc(2px + var(--p-lift))`，hover 時該從 2px 長到 4px。
    // ⚠️ 一定要等過場跑完再讀（--t-fast 是 90ms），否則讀到的是 2.33px 這種中間值。
    const edge = (shadow: string) =>
      shadow.match(/rgba?\([^)]*\)\s+0px\s+([\d.]+)px\s+0px\s+0px(?!\s+inset)/)?.[1];
    const shadowOf = () => el.evaluate(n => getComputedStyle(n).boxShadow);
    const restEdge = edge(await shadowOf());

    await el.hover();
    const normal = await el.evaluate(n => getComputedStyle(n).transform);
    // 正向控制：hover 之後真的有 transform，下面那條斷言才有意義。
    expect.soft(normal, `${c.selector}:hover 平常沒有 transform，這條斷言等於沒守`).not.toBe('none');
    await page.waitForTimeout(200);
    const hoverEdge = edge(await shadowOf());
    // 正向控制：硬邊平常真的會跟著 hover 長大，下面那條斷言才有意義。
    expect.soft(hoverEdge, `${c.selector}:hover 的下緣硬邊沒有跟著長大（都是 ${restEdge}px），`
      + '下面那條 reduce 斷言等於沒守').not.toBe(restEdge);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await el.hover();
    const reduced = await el.evaluate(n => getComputedStyle(n).transform);
    expect.soft(reduced,
      `${c.path} 的 ${c.selector}:hover 在 reduce 之下 transform 沒有被關掉（讀到 ${reduced}）`).toBe('none');
    // 2026-08-26 code review 追加：transform 關掉還不夠。硬邊沒一起壓平的話，卡片不動而
    // 影子往下掉 2px——影子脫離了它應該在追的那個元素。修法在 tokens.css 的
    // `@media (prefers-reduced-motion: reduce) :root` 重新宣告 --face-lift；**不能**寫在
    // 元件的 reduce 區塊裡覆寫 --p-lift（自訂屬性在宣告它的元素上就代換完了，實測無效）。
    await page.waitForTimeout(200);
    expect.soft(edge(await shadowOf()),
      `${c.path} 的 ${c.selector}:hover 在 reduce 之下下緣硬邊仍然跟著長大（靜止 ${restEdge}px），`
      + '卡片不動而影子往下掉').toBe(restEdge);
  }

  // --- 形狀三：#detail 系列，合成探針量，不驅動真的換頁動畫 ---
  await page.emulateMedia({ reducedMotion: null });
  await page.goto('/tree');
  // ⚠️ 2026-08-26 code review 抓到同一族問題：probeDetail() 內部用 `getElementById('detail')!`
  // 非空斷言，`#detail` 一旦被改名，evaluate() 裡就是對 null 呼叫 .classList 而直接拋錯——
  // 比形狀一／二更糟：連 expect.soft 都沒有，會立刻中止整個 test，形狀四（#filters.animating）
  // 也不會跑到。這裡先用 locator 軟性確認 #detail 存在，不存在就跳過整組 DETAIL_CASES。
  const detailAttached = await page.locator('#detail').count();
  await expect.soft(detailAttached > 0, '/tree 上找不到 #detail').toBeTruthy();
  const probeDetail = (which: 'view' | 'stack' | 'panel') => page.evaluate((w) => {
    const detail = document.getElementById('detail')!;
    if (w === 'panel') {
      detail.classList.add('panel-sliding');
      const out = getComputedStyle(detail).transitionDuration;
      detail.classList.remove('panel-sliding');
      return out;
    }
    const el = document.createElement('div');
    el.className = w === 'view' ? 'view slide-anim' : 'stack animating';
    detail.appendChild(el);
    const out = getComputedStyle(el).transitionDuration;
    el.remove();
    return out;
  }, which);

  const DETAIL_CASES = [
    { selector: '#detail .view.slide-anim', which: 'view' },
    { selector: '#detail .stack.animating', which: 'stack' },
    { selector: '#detail.panel-sliding', which: 'panel' },
  ] as const;
  for (const c of DETAIL_CASES) {
    if (!detailAttached) continue;
    await page.emulateMedia({ reducedMotion: null });
    const normal = await probeDetail(c.which);
    expect.soft(normal, `${c.selector} 平常就沒有過場，這條斷言等於沒守`).not.toBe('0s');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    const reduced = await probeDetail(c.which);
    expect.soft(reduced.split(',').map(v => v.trim()).every(v => v === '0s'),
      `/tree 的 ${c.selector} 在 reduce 之下過場沒有被關掉（讀到 ${reduced}）`).toBe(true);
  }

  // --- 形狀四：#filters.animating，過場宣告直接掛在本體上，探針不必另外塞子元素 ---
  const probeFilters = () => page.evaluate(() => {
    const filters = document.getElementById('filters')!;
    filters.classList.add('animating');
    const out = getComputedStyle(filters).transitionDuration;
    filters.classList.remove('animating');
    return out;
  });

  await page.emulateMedia({ reducedMotion: null });
  const filtersNormal = await probeFilters();
  expect.soft(filtersNormal, '#filters.animating 平常就沒有過場，這條斷言等於沒守').not.toBe('0s');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const filtersReduced = await probeFilters();
  expect.soft(filtersReduced.split(',').map(v => v.trim()).every(v => v === '0s'),
    `/tree 的 #filters.animating 在 reduce 之下過場沒有被關掉（讀到 ${filtersReduced}）`).toBe(true);
});

/**
 * D15. 自架的 Archivo 真的載進來、也真的掛在該掛的四個位置上（2026-08-26 PR ⑤）。
 *
 * 這條同時守三種「宣告了但沒生效」——三種都不會讓任何既有測試說話：
 *  (一) **檔案 404**：`public/assets/` 整個在 .gitignore（那是 build:data 的產出目錄），
 *       字型放進去在本機看得到、CI 與線上是 404。@font-face 找不到檔不會報錯，只會靜靜
 *       退回系統字型。所以這裡攔的是 woff2 的**回應狀態碼**，不是「有沒有發出請求」。
 *  (二) **選擇器沒吃到**：`.game-id` 是 <code>，base.css 的 `code, pre` 會把它拉去
 *       ui-monospace——實作時就踩到了，computed 是 ui-monospace 而不是 Archivo。
 *  (三) **字型檔在、名字也對，但裡面沒有要用的字符**：computed fontFamily 只是把 CSS 的
 *       字串照抄回來，字型檔壞掉、subset 砍掉數字，它照樣回「Archivo」。這一種靠底下的
 *       寬度探針攔。
 *
 * ⚠️ 寬度探針的基準線**一定要是一個不存在的字型名**，不能拿 --font 的成員當基準。
 * 第一版寫成「Archivo 對上 'Noto Sans TC', sans-serif」，反例（把字型 subset 成沒有數字）
 * **照樣綠**：Archivo 缺字時那串數字是逐字退回瀏覽器預設字型，而基準線量的是 Noto Sans TC，
 * 兩者本來就不同寬，差值永遠 > 1。改成不存在的字型名之後，兩邊在「Archivo 沒有數字」時
 * 會落在同一個預設字型上，差值變 0，反例才會紅（2026-08-26 兩個方向都實跑過）。
 */
test('D15. 自架的 Archivo 載得到，而且掛在數字與代號那四個位置上', async ({ page }) => {
  const fontResponses: string[] = [];
  page.on('response', r => {
    if (r.url().includes('.woff2')) fontResponses.push(`${r.status()} ${r.url().split('/').pop()}`);
  });
  await page.goto('/dice');
  await page.evaluate(() => document.fonts.ready);

  expect(fontResponses, 'Archivo 的 woff2 沒有被下載，或不是 200（檢查 public/fonts/ 的路徑）')
    .toEqual(['200 archivo-latin-500-700.woff2']);

  const r = await page.evaluate(() => {
    const family = (sel: string) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el).fontFamily.split(',')[0]!.replace(/['"]/g, '') : `${sel} 不存在`;
    };
    // 同一串數字量兩次：一次指名 Archivo、一次指名一個**不存在**的字型名。後者一定落在
    // 瀏覽器預設字型上；Archivo 真的帶著這些字符時，前者不會落在同一個地方，兩者寬度不同。
    const width = (stack: string) => {
      const s = document.createElement('span');
      s.textContent = '1234567890';
      s.style.cssText = `position:absolute;visibility:hidden;font:600 40px ${stack}`;
      document.body.appendChild(s);
      const w = s.getBoundingClientRect().width;
      s.remove();
      return w;
    };
    return {
      loaded: document.fonts.check('600 16px Archivo'),
      families: {
        gameId: family('.game-id'),
        statV: family('.stat-v'),
        meta: family('.dice-card .meta'),
      },
      wArchivo: width("Archivo"),
      wMissing: width("__this_font_does_not_exist__"),
    };
  });

  expect(r.loaded, 'document.fonts 說 Archivo 沒有可用').toBe(true);
  expect(r.families, '有位置沒吃到 --font-num（.game-id 特別容易被 base.css 的 `code` 搶走）')
    .toEqual({ gameId: 'Archivo', statV: 'Archivo', meta: 'Archivo' });
  expect(Math.abs(r.wArchivo - r.wMissing),
    `指名 Archivo 與指名一個不存在的字型量到一樣寬（${r.wArchivo}px），代表那串數字並沒有`
    + '用 Archivo 畫出來——字型檔壞了，或 subset 把數字砍掉了（見 public/fonts/README.md '
    + '的 --unicodes）').toBeGreaterThan(1);
});

/**
 * D15b. subset **真的蓋得住畫面上那些字**——問瀏覽器實際用了哪些字型來畫，不是問 CSS 寫了什麼。
 *
 * 為什麼需要這一條：`pyftsubset` 對「來源字型沒有的碼位」是靜靜跳過的，`--layout-features`
 * 給錯也是靜靜生效。2026-08-26 這張 PR 一次踩到兩個——`--unicodes` 裡的 `U+2192` 上游根本
 * 沒有、`--layout-features=''` 把 kern 與 tnum 全砍了——而當時所有測試都是綠的。
 * 缺字時瀏覽器是**逐字**退回系統字型，畫面上看起來只是那一個字寬度不太對，沒有任何既有斷言
 * 會說話。`CSS.getPlatformFontsForNode` 是唯一能問到「這個節點實際用了幾種字型、各畫了幾個
 * 字形」的地方。
 *
 * ⚠️ 只挑**純拉丁**的節點驗。`.meta`／`.nav-updated` 是中英混排，中文本來就會退回系統字型，
 * 那裡回兩種字型是正確行為（而且退到哪一個隨作業系統變，CI 上是 WenQuanYi、Yuki 的 Windows
 * 上是別的，不能斷言名字）。
 */
test('D15b. Archivo 蓋得住純拉丁的節點，沒有任何一個字偷偷退回系統字型', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'CSS.getPlatformFontsForNode 是 CDP，只有 Chromium 有');
  await page.goto('/dice');
  await page.evaluate(() => document.fonts.ready);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument');

  // `.game-id` 是 `D000`、`.stat-v` 的基礎檔是純數字——兩個都不含任何中文。
  for (const selector of ['.game-id', '.stat-v > [data-m="base"]']) {
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    expect(nodeId, `找不到 ${selector}`).toBeTruthy();
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    const names = fonts.map(f => `${f.familyName}×${f.glyphCount}`).join(' + ');
    expect(fonts, `${selector} 用了不只一種字型（${names}）——有字符不在 subset 裡，`
      + '被逐字退回系統字型了。檢查 public/fonts/README.md 的 --unicodes').toHaveLength(1);
    // familyName 是實例名（'Archivo SemiBold'），不是 CSS 裡寫的那個字串，所以只比前綴。
    expect(fonts[0]!.familyName, `${selector} 畫出來的不是 Archivo，而是 ${fonts[0]!.familyName}`)
      .toMatch(/^Archivo/);
    expect(fonts[0]!.isCustomFont, `${selector} 用的是系統裝的 Archivo，不是我們自架的那個檔`).toBe(true);
    expect(fonts[0]!.glyphCount, `${selector} 一個字形都沒畫`).toBeGreaterThan(0);
  }
});

/**
 * D16. `.nav-updated` 的日期也走 Archivo——它在**手機版是 display:none**，所以要單獨驗，
 * 而且要在桌機專案上驗才有意義（mobile 專案跑到這裡會直接跳過，見底下的 skip 說明）。
 *
 * ⚠️ 這裡**刻意不驗 `font-variant-numeric`**。第一版斷言 computed 的 `fontVariantNumeric`
 * 是 `'tabular-nums'`——那只是把 CSS 的字串抄回來，字型做不做得到跟它無關，是一句同語反覆
 * （2026-08-26 code review 抓到）。而「換一天寬度不變」這個**真正想守的性質，實測是不成立的**：
 * Chromium 把字形前進寬度四捨五入到整數像素，16px 下 Archivo 的數字仍然是 9px／10px 兩種，
 * `2026-08-23` 90px、`1111-11-11` 84px，開不開 tabular-nums 都一樣。既然斷言不了，就不要
 * 留一條看起來有在守、其實什麼都沒守的斷言。理由與量測寫在 chrome.css 該處。
 */
test('D16. 導覽列的「上次更新」日期走 Archivo', async ({ page, isMobile }) => {
  test.skip(isMobile, '手機版刻意把 .nav-updated 收掉（chrome.css 的 720px 媒體查詢），沒有東西可量');
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  const family = await page.locator('.nav-updated')
    .evaluate(el => getComputedStyle(el).fontFamily.split(',')[0]!.replace(/['"]/g, ''));
  expect(family, '.nav-updated 沒吃到 --font-num').toBe('Archivo');
});

/**
 * D17. 進場動畫：staggered、夾得住上限、跑完會自己關掉、reduce 之下整組不跑。
 *
 * 四件事各自壞掉時畫面都還能看，所以四條都要驗：
 *  (一) 沒夾上限 → /dice 第 41 張卡片要等 41 × 80ms ＝ 3.64 秒才浮出來（spec §2 決策 3）。
 *  (二) `data-enter` 沒被移除 → /dice 用 `[hidden]` 篩選，卡片切回來時 animation 會**重播**。
 *  (三) reduce 之下沒關掉 → 使用者會看到一頁慢慢補齊的空白格，比動畫本身更糟。
 *  (四) 動畫根本沒掛上 → 上面三條全部「通過」，因為它們驗的都是「不要有」。所以每一條
 *       都先做正向控制。
 */
test('D17. 卡片進場是 staggered 的，延遲夾得住上限，跑完自己關掉', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: null });
  // ⚠️ 用 domcontentloaded 不是 load：`data-enter` 大約一秒後就被腳本移掉了，等 load
  // （含 41 張卡片的圖）很可能已經來不及。
  await page.goto('/dice', { waitUntil: 'domcontentloaded' });

  const read = (n: number) => page.locator('.dice-card').nth(n).evaluate(el => {
    const cs = getComputedStyle(el);
    return { name: cs.animationName, delay: cs.animationDelay, fill: cs.animationFillMode };
  });

  // 正向控制：動畫真的掛上去了，底下三條才有意義。
  const first = await read(0);
  expect(first.name, '第一張卡片沒有進場動畫——底下三條都會變成「不要有」的空斷言').toBe('rise');
  expect(first.fill, 'fill-mode 不是 both，帶延遲的卡片在延遲跑完前不會停在起點').toBe('both');
  expect(first.delay, '第一張卡片不該有延遲').toBe('0s');

  const stagger = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--p-stagger')));
  const max = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--p-stagger-max')));
  const ms = (delay: string) => Math.round(parseFloat(delay) * 1000);

  expect(ms((await read(1)).delay), '第二張卡片的延遲不是一階 --p-stagger').toBe(stagger);
  // 夾上限：第 max 張與最後一張（第 41 張）必須是同一個延遲。
  const capped = stagger * max;
  expect(ms((await read(max)).delay), `第 ${max} 張的延遲不是上限值`).toBe(capped);
  expect(ms((await read(40)).delay),
    `第 41 張的延遲沒有被夾住（上限應該是 ${capped}ms）——不夾的話它要等 ${41 * stagger}ms`)
    .toBe(capped);

  // 跑完之後 data-enter 要消失，否則 [hidden] 篩選切回來時動畫會重播。
  await expect.poll(
    () => page.evaluate(() => document.documentElement.hasAttribute('data-enter')),
    { timeout: 5000, message: 'data-enter 一直沒被移除，/dice 篩選切回來時卡片會重播進場' },
  ).toBe(false);
  expect((await read(0)).name, 'data-enter 移掉之後卡片還掛著動畫').toBe('none');
});

/**
 * D17c. `data-enter` 不准在動畫還沒跑完就被拿掉。
 *
 * D17 只驗「它最後有被拿掉」，**拿掉的時機對不對完全沒有守**。2026-08-26 code review 抓到
 * 一個只在**建置產物**裡發生的 bug：`Base.astro` 用裸的 `parseFloat` 讀 `--t-slow`，而 Astro
 * 的 CSS 壓縮把 `440ms` 改寫成 `.44s`——`parseFloat('.44s')` 是 **0.44**，計時器因此短了整整
 * 一個動畫長度。實測那一格 **41 張卡片有 36 張的 rise 還沒跑完**，規則一消失它們直接跳到終點。
 * `astro dev` 不壓縮，所以本機開發與任何靜態檢查都看不出來。
 *
 * ⚠️ 這條要在頁面裡逐幀取樣，不能事後 `page.evaluate` 量一次：`data-enter` 消失之後
 * `getAnimations()` 就回空陣列，什麼都量不到了。
 */
test('D17c. data-enter 是在全部卡片的進場動畫跑完之後才被拿掉', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: null });
  await page.addInitScript(() => {
    (window as unknown as { __enterLog: unknown[] }).__enterLog = [];
    const log = (window as unknown as { __enterLog: unknown[] }).__enterLog;
    const t0 = performance.now();
    const tick = () => {
      const has = document.documentElement.hasAttribute('data-enter');
      const rise = document.getAnimations()
        .filter(a => (a as CSSAnimation).animationName === 'rise');
      log.push({ t: Math.round(performance.now() - t0), has, n: rise.length,
        unfinished: rise.filter(a => a.playState !== 'finished').length });
      if (has || performance.now() - t0 < 3000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.goto('/dice', { waitUntil: 'domcontentloaded' });
  await expect.poll(
    () => page.evaluate(() => document.documentElement.hasAttribute('data-enter')),
    { timeout: 6000, message: 'data-enter 一直沒被移除' },
  ).toBe(false);

  type Frame = { t: number; has: boolean; n: number; unfinished: number };
  const log = await page.evaluate(
    () => (window as unknown as { __enterLog: Frame[] }).__enterLog,
  ) as Frame[];
  const held = log.filter(f => f.has);
  // 正向控制：真的取樣到「動畫還掛著」的畫面，而且卡片數是 41——取樣器沒跑或選擇器過期時
  // 底下那條會是「空陣列的最後一筆」而永遠通過。
  expect(held.length, '一格都沒取樣到 data-enter 還在的狀態，這條斷言等於沒守')
    .toBeGreaterThan(3);
  const last = held[held.length - 1]!;
  expect(last.n, `取樣到的 rise 動畫只有 ${last.n} 個，不是 41 張卡片`).toBe(41);
  expect(last.unfinished,
    `data-enter 在 ${last.t}ms 被拿掉，但那一刻還有 ${last.unfinished} 張卡片的進場動畫沒跑完，`
    + '它們會直接跳到終點。八成是 Base.astro 沒用 cssMs() 讀長度（壓縮後的 CSS 是 .44s 不是 440ms）')
    .toBe(0);
});

test('D17b. 減少動態：進場整組不跑，而且卡片是看得見的', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/dice', { waitUntil: 'domcontentloaded' });
  const s = await page.locator('.dice-card').nth(20).evaluate(el => {
    const cs = getComputedStyle(el);
    return { name: cs.animationName, opacity: cs.opacity };
  });
  // 關動畫的寫法若是「長度歸零」而不是 `animation: none`，`both` 仍然成立，帶延遲的卡片會
  // 停在 opacity: 0，使用者看到的是一頁慢慢補齊的空白格。**攔住那個寫法的是這一條**
  // （animation-duration: 0s 之下 animationName 仍然是 rise，2026-08-26 反例實跑確認）。
  expect(s.name, 'reduce 之下進場動畫沒關掉').toBe('none');
  // 底下這條是結果面的保險，不是上面那條的替代品：它驗的是「使用者真的看得到卡片」。
  // ⚠️ 老實說今天它抓不到任何上面那條抓不到的東西——opacity: 0 只存在於 keyframes 裡，
  // 動畫一關就不可能留下。留著是因為「reduce 之下整頁不准是空白」這個性質值得有一條寫死的
  // 斷言，將來起點若改成寫在元素上（**不要那樣做**，見 base.css 的說明）它就是唯一的防線。
  expect(s.opacity, 'reduce 之下卡片停在透明').toBe('1');
});

/**
 * D18. 按下去要有回饋（2026-08-26 PR ⑥）。這張 PR 之前全站**一條 :active 規則都沒有**，
 * 手機上從按下去到頁面反應之間完全沒有任何回應。
 *
 * ⚠️ 卡片是 `<a>`，在原地放開會觸發 click 導航掉、元素就不見了——所以放開前一定要先把
 * 游標移開（實測過：不移開的話讀「放開後」那一步會在 locator timeout 掛掉）。
 */
test('D18. 按住時縮一下，放開回原狀；reduce 之下整組關掉', async ({ page }) => {
  const CASES = [
    { path: '/', selector: '.home-card' },
    { path: '/dice', selector: '.chip' },
    { path: '/board', selector: '#board-tools button' },
    { path: '/tree', selector: '#filters-toggle' },
    // ⚠️ /sim 一定要列進來：它的 reduce 覆寫 2026-08-26 少了 `:not(:disabled)`，具體度
    // 輸給正常那條、按壓在 reduce 之下照樣縮，而當時 D18 沒有涵蓋這一頁、D14 涵蓋了卻只
    // 驗 transition-duration 不驗 transform——兩條加起來還是漏。
    { path: '/sim', selector: '#sim-toolbar button:not(:disabled)' },
  ] as const;

  const pressed = async (selector: string) => {
    const el = page.locator(selector).first();
    await el.scrollIntoViewIfNeeded();
    const box = (await el.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    // 等過場跑完再讀：--t-press 是 80ms，按下去立刻讀會讀到中途的 0.99x。
    await page.waitForTimeout(200);
    const held = await el.evaluate(n => getComputedStyle(n).transform);
    await page.mouse.move(2, 2);
    await page.mouse.up();
    await page.waitForTimeout(200);
    return { held, released: await el.evaluate(n => getComputedStyle(n).transform) };
  };

  const scaleOf = (transform: string) => {
    const m = transform.match(/^matrix\(([\d.]+),/);
    return m ? parseFloat(m[1]!) : null;
  };

  for (const c of CASES) {
    await page.emulateMedia({ reducedMotion: null });
    await page.goto(c.path);
    // ⚠️ 等進場動畫收掉再測：那段期間 animation 的 both 填充會壓過 :active 的 transform。
    await expect.poll(() => page.evaluate(() => !document.documentElement.hasAttribute('data-enter')),
      { timeout: 5000 }).toBe(true);

    const normal = await pressed(c.selector);
    expect.soft(scaleOf(normal.held), `${c.path} 的 ${c.selector} 按住時沒有縮`).toBeLessThan(1);
    expect.soft(normal.released, `${c.path} 的 ${c.selector} 放開後沒有回原狀`).toBe('none');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(c.path);
    const reduced = await pressed(c.selector);
    expect.soft(reduced.held, `reduce 之下 ${c.path} 的 ${c.selector} 按住時仍然會縮`).toBe('none');
  }
});
