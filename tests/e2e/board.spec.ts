// 骰盤擺放編輯器的端對端驗證。
//
// 這一頁跟 /dice 不同，內容不是拿來被搜尋引擎索引的——它的價值全在互動。所以測試的重心
// 是「拖曳之後狀態對不對」與「不用滑鼠也能用」，而不是 HTML 裡有沒有字。
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { cellRect } from '../../src/lib/board-image';

/**
 * B8／B8b／B8c／B8d 專用的較寬時限。
 *
 * ⚠️ 端對端流程（點擊 → 產圖 → 顯示）偶爾（非每次）會飆到數秒才完成，**機制目前沒有
 * 完全查明**。已經插樁量測過、可以排除的是 `canvas.toBlob()` 與 `document.fonts.ready`
 * ——不要再往這兩個地方查：
 *
 *   閒置 toBlob (75 樣本)         median 5ms, max 7.7ms
 *   端對端點擊流程 (45 樣本)       median 51-60ms, max 125ms
 *   B8c mobile 連跑 30 次          2 次飆到 7.4s（可重現）
 *   插樁追查那 2 次                toBlob 全程 <213ms（含 4 路平行負載）
 *                                document.fonts.ready 全程 <25ms
 *
 * 延遲尖峰是真的，但卡在別的地方（推測是瀏覽器行程層級的排程／停頓，未證實）。
 * 預設的 5000ms 斷言時限離觀測到的最壞情形（7.4s）太近，放寬到這個值只是等真正的條件
 * 成立，不是猜一個數字掩蓋問題。
 */
const EXPORT_TIMEOUT = 15000;

const tree = JSON.parse(
  readFileSync(new URL('../../src/generated/tree.json', import.meta.url), 'utf8'),
) as { nodes: { id: string; type: string; name: string; icon: string }[] };

const dice = tree.nodes.filter(n => n.type === 'dice');

// /board 的骰子圖示改用「純骰子圖」（不含底板），跟正本 SVG 引用的節點圖示（`.icon`，
// `/assets/icons/`）是平行的一條資產路徑，對照表在 data/board-icons.json（節點 id -> hash）。
const boardIcons = JSON.parse(
  readFileSync(new URL('../../data/board-icons.json', import.meta.url), 'utf8'),
) as Record<string, string>;
const boardIconSrc = (id: string): string => `/assets/board-icons/${boardIcons[id]}.webp`;

test('B0. 骰盤頁的骨架：15 格、5 個組合槽、41 顆可挑選的骰子', async ({ page }) => {
  await page.goto('/board');
  await expect(page.locator('#board-grid .board-cell')).toHaveCount(15);
  await expect(page.locator('#deck-row .deck-slot')).toHaveCount(5);
  await expect(page.locator('#dice-picker .picker-dice')).toHaveCount(41);
  expect(dice).toHaveLength(41);

  // 正面證明這三個選擇器抓得到東西——B0b 的「不存在」斷言全靠它們沒打錯字。
  await expect(page.locator('#deck-row .pips-row')).toHaveCount(5);
  await expect(page.locator('#deck-row .pips-inc')).toHaveCount(5);
  await expect(page.locator('#deck-row .pips-dec')).toHaveCount(5);
  await expect(page.locator('#deck-row .pips-value')).toHaveCount(5);

  // 格子的 data-index 必須是 0..14 且不重複——後面每一條測試都靠它定位。
  const idx = await page.locator('#board-grid .board-cell').evaluateAll(
    els => els.map(e => Number(e.getAttribute('data-index'))));
  expect(idx).toEqual([...Array(15).keys()]);

  // live region 必須存在，而且**真的還在無障礙樹裡**。
  // ⚠️ 只驗 class 字串是不夠的：`.sr-only` 的 CSS 被改成 display:none、或別的規則把
  // #board-live 藏掉，class 仍然對得上，而播報從此無聲。後面 B6／B7 用的 toContainText
  // 讀的是 textContent，不要求可見（實測 hidden 與 display:none 都照樣通過），
  // 所以整份測試裡只有這一條看得到這件事。
  const live = page.locator('#board-live');
  await expect(live).toHaveAttribute('role', 'status');
  await expect(live).toHaveClass(/sr-only/);
  const style = await live.evaluate(el => {
    const cs = getComputedStyle(el);
    return { display: cs.display, visibility: cs.visibility, clipPath: cs.clipPath };
  });
  expect(style.display).not.toBe('none');
  expect(style.visibility).not.toBe('hidden');
  expect(style.clipPath).not.toBe('none');
  await expect(live).not.toHaveAttribute('hidden', /.*/);
});

test('B0b. 決策 2／5：骰盤只放組合內的骰子，格子上不提供等級控制項', async ({ page }) => {
  // 兩條都寫在 spec 的「已拍板的決策」表裡，但沒有任何斷言守。
  await page.goto('/board');
  // 骰盤格裡不得出現等級控制項——等級是組合列那一槽的屬性（決策 5）。
  await expect(page.locator('#board-grid .pips-inc, #board-grid .pips-dec, #board-grid .pips-row')).toHaveCount(0);
  // 骰盤上也不得直接嵌入 41 顆的挑選入口（決策 2：只能放組合內的）。
  await expect(page.locator('#board-grid .picker-dice')).toHaveCount(0);
});

test('B0c. 導覽列有「骰盤」入口且在本頁標成目前分頁', async ({ page }) => {
  await page.goto('/board');
  const link = page.locator('#site-nav a[href="/board"]');
  await expect(link).toHaveText('骰盤');
  await expect(link).toHaveAttribute('aria-current', 'page');
});

test('B0d. 41 顆骰子的挑選圖示都指向純骰子圖，而且每一張都真的載得到', async ({ page }) => {
  // 換掉節點圖示（帶底板）之後這是第一道防線：src 對得上正則不代表圖真的存在——路徑打錯
  // 一個字或 build:data 漏轉一張，畫面上就是一個 41 分之一的破圖，naturalWidth 會是 0。
  await page.goto('/board');
  // 圖示是 loading="lazy"，而挑選網格關閉時整個容器是 display:none——不打開的話瀏覽器
  // 根本不會發起請求，量到的 naturalWidth 只會是「還沒載入」而不是「載入失敗」。
  await page.locator('.deck-dice[data-slot="0"]').click();
  await expect(page.locator('#dice-picker')).toBeVisible();

  const imgs = page.locator('#dice-picker .picker-dice img');
  await expect(imgs).toHaveCount(41);

  const srcs = await imgs.evaluateAll(els => els.map(el => el.getAttribute('src')));
  expect(srcs).toHaveLength(41);
  for (const src of srcs) {
    expect(src, `${src} 沒有指向 /board 專用的純骰子圖路徑`).toMatch(/^\/assets\/board-icons\/[0-9a-f]{12}\.webp$/);
  }

  // 挑選網格是 max-height: 60vh 的捲動容器，41 張圖大半在可視範圍外，loading="lazy" 只會
  // 載入靠近可視範圍的那幾張——強制全部 eager，純粹是為了讓斷言測得到「檔案真的存在」，
  // 不是在驗「鏡頭外的圖片會不會被瀏覽器延後載入」（那是瀏覽器原生行為，不是這頁的邏輯）。
  await imgs.evaluateAll(els => { for (const el of els) (el as HTMLImageElement).loading = 'eager'; });
  await expect.poll(() => imgs.evaluateAll(els => els.every(el => (el as HTMLImageElement).complete))).toBe(true);

  const widths = await imgs.evaluateAll(els => els.map(el => (el as HTMLImageElement).naturalWidth));
  for (let i = 0; i < widths.length; i++) {
    // complete === true 但 naturalWidth === 0 正是「請求發出去了、但圖是破的（404 等）」的訊號。
    expect(widths[i], `第 ${i} 張（src=${srcs[i]}）naturalWidth 是 0——圖沒有真的載到，是破圖`).toBeGreaterThan(0);
  }
});

test('B1. 挑一顆骰子進組合槽，並用 ◀ ▶ 調整骰面點數（夾在 1–7）', async ({ page }) => {
  await page.goto('/board');

  // 一開始挑選網格是收起來的。
  await expect(page.locator('#dice-picker')).toBeHidden();
  await page.locator('.deck-dice[data-slot="0"]').click();
  await expect(page.locator('#dice-picker')).toBeVisible();

  // 挑第一顆骰子（火骰子，id 1001）。
  const first = dice[0]!;
  await page.locator(`.picker-dice[data-dice-id="${first.id}"]`).click();
  await expect(page.locator('#dice-picker')).toBeHidden();

  const slot0 = page.locator('.deck-dice[data-slot="0"]');
  await expect(slot0.locator('img')).toHaveAttribute('src', boardIconSrc(first.id));
  await expect(page.locator('.pips-value[data-slot="0"]')).toHaveText('1');

  // ▶ 加到上限就停住，不會跑到 8。
  for (let i = 0; i < 9; i++) await page.locator('.pips-inc[data-slot="0"]').click();
  await expect(page.locator('.pips-value[data-slot="0"]')).toHaveText('7');

  // ◀ 減到下限停在 1。
  for (let i = 0; i < 9; i++) await page.locator('.pips-dec[data-slot="0"]').click();
  await expect(page.locator('.pips-value[data-slot="0"]')).toHaveText('1');

  // 沒有骰子的槽，等級鈕是 disabled——不能對空槽調等級。
  await expect(page.locator('.pips-inc[data-slot="1"]')).toBeDisabled();
  await expect(page.locator('.pips-inc[data-slot="0"]')).toBeEnabled();

});

test('B1b. 挑選網格可以用 Esc 關掉，焦點回到原本那個槽', async ({ page }) => {
  await page.goto('/board');
  await page.locator('.deck-dice[data-slot="2"]').click();
  await expect(page.locator('#dice-picker')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#dice-picker')).toBeHidden();
  await expect(page.locator('.deck-dice[data-slot="2"]')).toBeFocused();
});

test('B1c. 換骰子時保留該槽已調好的骰面點數', async ({ page }) => {
  await page.goto('/board');
  const first = dice[0]!;
  const second = dice[1]!;

  await page.locator('.deck-dice[data-slot="0"]').click();
  await page.locator(`.picker-dice[data-dice-id="${first.id}"]`).click();
  for (let i = 0; i < 4; i++) await page.locator('.pips-inc[data-slot="0"]').click();
  await expect(page.locator('.pips-value[data-slot="0"]')).toHaveText('5');

  // 換成另一顆骰子——等級不該被打回 1。
  await page.locator('.deck-dice[data-slot="0"]').click();
  await page.locator(`.picker-dice[data-dice-id="${second.id}"]`).click();

  await expect(page.locator('.deck-dice[data-slot="0"] img')).toHaveAttribute('src', boardIconSrc(second.id));
  await expect(page.locator('.pips-value[data-slot="0"]')).toHaveText('5');
});

test('B1d. 已填的組合槽：Space 開挑選網格換骰子，Enter 拿起而不開網格（I4）', async ({ page }) => {
  // 全分支 review I4（Yuki 拍板）：已填槽以前 Enter／Space 兩鍵都被攔下改成「拿起」，click
  // 從此不再派發、挑選網格永遠打不開——純鍵盤使用者填滿 5 槽之後再也換不掉任何一顆骰子，
  // 而 aria-label 還寫著「按下更換」。現在 Space 開挑選網格換骰子，Enter 維持「拿起」不變。
  await page.goto('/board');
  await pickInto(page, 0, dice[0]!.id, 3);

  const slot0 = page.locator('.deck-dice[data-slot="0"]');
  await expect(slot0).toHaveAttribute('aria-label', /Enter 拿起，Space 更換/);

  // Space：開挑選網格。
  await slot0.focus();
  await page.keyboard.press(' ');
  await expect(page.locator('#dice-picker')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#dice-picker')).toBeHidden();

  // Enter：拿起，不開挑選網格。
  await slot0.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#dice-picker')).toBeHidden();
  await expect(page.locator('#board-live')).toContainText('拿起');

  // 拿起是真的有效（不是被吃掉的按鍵）：放到骰盤上驗證整條鍵盤流程仍然通。
  await page.locator('.board-cell[data-index="0"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.board-cell[data-index="0"] img')).toBeVisible();
});

/**
 * 用滑鼠把來源元素拖到目標元素。
 *
 * ⚠️ 一定要分段移動：`mouse.move(x, y)` 一次跳到終點只會送一個 pointermove，
 * 中途完全沒有事件，而落點判定是靠 pointermove 期間的 elementFromPoint 做的。
 * `steps` 讓 Playwright 把位移切成多個中間事件。
 */
async function drag(page: import('@playwright/test').Page, from: string, to: string): Promise<void> {
  const src = await page.locator(from).boundingBox();
  const dst = await page.locator(to).boundingBox();
  if (!src || !dst) throw new Error(`拖曳的來源或目標量不到位置：${from} → ${to}`);
  await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
  await page.mouse.down();
  await page.mouse.move(dst.x + dst.width / 2, dst.y + dst.height / 2, { steps: 12 });
  await page.mouse.up();
}

/** 選一顆骰子進指定組合槽，並把等級調到 pips。 */
async function pickInto(page: import('@playwright/test').Page, slot: number, diceId: string, pips: number): Promise<void> {
  await page.locator(`.deck-dice[data-slot="${slot}"]`).click();
  await page.locator(`.picker-dice[data-dice-id="${diceId}"]`).click();
  for (let i = 1; i < pips; i++) await page.locator(`.pips-inc[data-slot="${slot}"]`).click();
  await expect(page.locator(`.pips-value[data-slot="${slot}"]`)).toHaveText(String(pips));
}

test('B2. 從組合列拖進空格：格子出現該骰子與等級', async ({ page }) => {
  await page.goto('/board');
  const fire = dice[0]!;
  await pickInto(page, 0, fire.id, 3);

  await drag(page, '.deck-dice[data-slot="0"]', '.board-cell[data-index="6"]');

  const cell = page.locator('.board-cell[data-index="6"]');
  await expect(cell.locator('img')).toHaveAttribute('src', boardIconSrc(fire.id));
  await expect(cell.locator('.cell-pips')).toHaveText('3');
  // 組合列的那一槽不會被拿走——它是來源，不是庫存。
  await expect(page.locator('.deck-dice[data-slot="0"] img')).toBeVisible();
});

test('B3. 格與格互拖＝兩格真的對調', async ({ page }) => {
  await page.goto('/board');
  // ⚠️ 一定要用**兩顆不同**的骰子、不同等級。用同種同等的兩顆去驗「交換」，交換前後的
  // 畫面一模一樣——`endDrag` 的 else 分支寫成「什麼都不做」或寫成 place（＝複製而非搬移）
  // 都照樣全綠。那條路徑在 spec §5 的落點表裡是獨立的一條，必須自己有斷言。
  const fire = dice[0]!;
  const wind = dice[1]!;
  await pickInto(page, 0, fire.id, 2);
  await pickInto(page, 1, wind.id, 5);

  await drag(page, '.deck-dice[data-slot="0"]', '.board-cell[data-index="0"]');
  await drag(page, '.deck-dice[data-slot="1"]', '.board-cell[data-index="1"]');

  await drag(page, '.board-cell[data-index="0"]', '.board-cell[data-index="1"]');

  await expect(page.locator('.board-cell[data-index="0"] img')).toHaveAttribute('src', boardIconSrc(wind.id));
  await expect(page.locator('.board-cell[data-index="0"] .cell-pips')).toHaveText('5');
  await expect(page.locator('.board-cell[data-index="1"] img')).toHaveAttribute('src', boardIconSrc(fire.id));
  await expect(page.locator('.board-cell[data-index="1"] .cell-pips')).toHaveText('2');
  await expect(page.locator('#board-grid img')).toHaveCount(2);
});

test('B3b. 同種同等疊在一起不會合成（決策 5）', async ({ page }) => {
  await page.goto('/board');
  const fire = dice[0]!;
  await pickInto(page, 0, fire.id, 2);
  await drag(page, '.deck-dice[data-slot="0"]', '.board-cell[data-index="0"]');
  await drag(page, '.deck-dice[data-slot="0"]', '.board-cell[data-index="1"]');

  await drag(page, '.board-cell[data-index="0"]', '.board-cell[data-index="1"]');

  // 兩顆都還在、等級都還是 2——沒有合成成 3，也沒有少一顆。
  await expect(page.locator('#board-grid img')).toHaveCount(2);
  await expect(page.locator('.board-cell[data-index="0"] .cell-pips')).toHaveText('2');
  await expect(page.locator('.board-cell[data-index="1"] .cell-pips')).toHaveText('2');
});

test('B3c. 拖曳結束不會順手打開挑選網格', async ({ page }) => {
  // 這條守的是一個實測過的 bug：pointerdown 的 preventDefault() 擋不掉 click，
  // 而 setPointerCapture 會把那一發 click 的 target 導回來源元素。沒有這條，
  // 每次拖曳都會展開挑選網格、把骰盤往下推 400px，而 B2–B5 只看格子內容，全部躲過。
  await page.goto('/board');
  await pickInto(page, 0, dice[0]!.id, 1);
  const before = (await page.locator('#board-grid').boundingBox())!;

  await drag(page, '.deck-dice[data-slot="0"]', '.board-cell[data-index="0"]');

  await expect(page.locator('#dice-picker')).toBeHidden();

  // 但「原地點一下」仍然要能開——判準是有沒有位移，不是有沒有按下過。
  await page.locator('.deck-dice[data-slot="0"]').click();
  await expect(page.locator('#dice-picker')).toBeVisible();

  // ⚠️ 這才是活的斷言：picker **展開時**骰盤不准被推走。
  // （原本那條「拖曳之後 y 沒變」是死的——picker 是 position: fixed，開了也不會動到版面。）
  const opened = (await page.locator('#board-grid').boundingBox())!;
  expect(Math.abs(opened.y - before.y)).toBeLessThanOrEqual(1);
});

test('B3f. 格↔格拖曳不會弄髒 justDragged：之後點組合槽一次就開得了挑選網格', async ({ page }) => {
  // 這條守一個實測過的 bug：justDragged 只有 #deck-row 的 click 委派會消費，
  // 從格子起手的拖曳若也寫入它，旗標會卡在 true，使用者下一次點組合列要點兩次。
  // 鍵盤 Enter 更嚴重：完全不經過 pointerdown，startDrag 的重置永遠跑不到。
  await page.goto('/board');
  await pickInto(page, 0, dice[0]!.id, 2);
  await pickInto(page, 1, dice[1]!.id, 5);
  await drag(page, '.deck-dice[data-slot="0"]', '.board-cell[data-index="0"]');
  await drag(page, '.deck-dice[data-slot="1"]', '.board-cell[data-index="1"]');

  // 從格子起手的拖曳。
  await drag(page, '.board-cell[data-index="0"]', '.board-cell[data-index="1"]');

  // 滑鼠：點空槽一次就要開。
  await page.locator('.deck-dice[data-slot="2"]').click();
  await expect(page.locator('#dice-picker')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#dice-picker')).toBeHidden();

  // 鍵盤：再拖一次格↔格，然後用 Enter 開空槽，一次就要開。
  // ⚠️ 這裡故意用空槽（slot 2）而不是已填的 slot 0：Task 5 之後 `#deck-row` 的
  // keydown 監聽器對「已放骰子」的槽會攔下 Enter（拿起骰子，不開挑選網格），那是刻意的新
  // 行為（見 src/scripts/board.ts）。這條測試原本要守的是 justDragged／click 委派那條路徑，
  // 只有空槽仍然會走那條路，所以改成用空槽驗證同一件事。
  await drag(page, '.board-cell[data-index="0"]', '.board-cell[data-index="1"]');
  await page.locator('.deck-dice[data-slot="2"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#dice-picker')).toBeVisible();
});

test('B3g. 滑鼠只移動幾個 px 仍算原地點一下：不會被誤判成拖曳（I1 成因 B）', async ({ page }) => {
  // 全分支 review 實測：pointermove 一發就把 moved 設成 true，沒有任何位移門檻——滑鼠按下
  // 後只抖 1px 也會被判成拖曳過，endDrag() 把 justDragged 設成 true，吃掉緊接著那發原本該
  // 開挑選網格的 click，要多點一次才開得了。現有的 drag() helper 用 .click()，down/up 之間
  // 完全不送 move（Playwright 的實作），測不到這個位移門檻，所以這裡手動分段送 mouse 事件。
  await page.goto('/board');
  await pickInto(page, 0, dice[0]!.id, 3);
  await expect(page.locator('#dice-picker')).toBeHidden();

  const box = (await page.locator('.deck-dice[data-slot="0"]').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  // 2px：遠低於 5px 門檻，卻足以觸發沒有門檻時的舊 bug。
  await page.mouse.move(cx + 2, cy + 1);
  await page.mouse.up();

  // 沒有第二次點擊——這一次按放本身就該打開挑選網格。
  await expect(page.locator('#dice-picker')).toBeVisible();
});

test('B3h. 觸控拖曳結束後緊接著的按下：justDragged 不會卡住（I1 成因 A）', async ({ page, isMobile }) => {
  // 觸控拖曳結束後瀏覽器根本不送 click（拖曳不是 tap），justDragged 若只靠 startDrag()
  // 內部重置就會卡在 true，直到下一次真的觸發 startDrag() 才清得掉——點空槽（getPayload()
  // 回 null，startDrag 不會跑）永遠清不掉它。用真觸控（CDP Input.dispatchTouchEvent）
  // 驅動拖曳，才踩得到「觸控拖曳結束後沒有 click」這個瀏覽器行為；只在 mobile project 跑，
  // desktop 的 Chrome context 沒有 hasTouch。
  //
  // ⚠️ 緊接著那次互動改用 Playwright 的滑鼠 .click()，不是第二次 CDP 觸控 tap：實測這個
  // headless 環境裡「CDP 觸控 tap 之後瀏覽器合不合成 click」本身就會隨機（同一支腳本、同一台
  // 機器連續跑會忽真忽假，屬於 CDP 觸控模擬的既有限制，不是這裡要守的東西）。justDragged
  // 的重置本來就與 pointerType 無關（見 src/scripts/board.ts 的 pointerdown handler），
  // 用滑鼠點擊驗證同一段程式碼一樣有效，且不會被那個已知的模擬限制干擾出假紅。
  test.skip(!isMobile, '僅手機版（需要真觸控事件）');
  await page.goto('/board');
  await pickInto(page, 0, dice[0]!.id, 2);

  const client = await page.context().newCDPSession(page);
  const src = (await page.locator('.deck-dice[data-slot="0"]').boundingBox())!;
  const dst = (await page.locator('.board-cell[data-index="6"]').boundingBox())!;
  const x0 = src.x + src.width / 2, y0 = src.y + src.height / 2;
  const x1 = dst.x + dst.width / 2, y1 = dst.y + dst.height / 2;

  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  const STEPS = 8;
  for (let i = 1; i <= STEPS; i++) {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x0 + (x1 - x0) * (i / STEPS), y: y0 + (y1 - y0) * (i / STEPS) }],
    });
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('.board-cell[data-index="6"] img')).toBeVisible();

  // 緊接著點空的組合槽（slot 2），一次就要打開，不必點第二次。
  await page.locator('.deck-dice[data-slot="2"]').click();
  await expect(page.locator('#dice-picker')).toBeVisible();
});

test('B3i. 兩指同時拖曳：落地的是第一根手指拖的骰子，沒有殘留的拖曳影像（I3）', async ({ page, isMobile }) => {
  // 全分支 review 實測：dragging 是單一模組變數，第二根手指的 startDrag 會覆蓋第一根的
  // 參照——第一根手指落地時用到第二根手指的 payload，第一個 .drag-ghost 永遠沒人 remove()
  // （重整才消失）。只在 mobile project 跑：需要真正的多點觸控。
  test.skip(!isMobile, '僅手機版（需要真觸控多點）');
  await page.goto('/board');
  const fire = dice[0]!;
  const wind = dice[1]!;
  await pickInto(page, 0, fire.id, 2);
  await pickInto(page, 1, wind.id, 5);

  const client = await page.context().newCDPSession(page);
  const slot0 = (await page.locator('.deck-dice[data-slot="0"]').boundingBox())!;
  const slot1 = (await page.locator('.deck-dice[data-slot="1"]').boundingBox())!;
  const cell0 = (await page.locator('.board-cell[data-index="0"]').boundingBox())!;
  const cell4 = (await page.locator('.board-cell[data-index="4"]').boundingBox())!;

  const a = { x0: slot0.x + slot0.width / 2, y0: slot0.y + slot0.height / 2, x1: cell0.x + cell0.width / 2, y1: cell0.y + cell0.height / 2 };
  const b = { x0: slot1.x + slot1.width / 2, y0: slot1.y + slot1.height / 2, x1: cell4.x + cell4.width / 2, y1: cell4.y + cell4.height / 2 };

  // 手指 A（來自槽 0）先落下；手指 B（來自槽 1）在 A 還按著時落下——CDP 的多點觸控用
  // touchPoints 陣列表示「目前所有還按著的點」，id 用來跨事件辨識同一根手指。
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x0, y: a.y0, id: 0 }] });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: a.x0, y: a.y0, id: 0 }, { x: b.x0, y: b.y0, id: 1 }],
  });
  const STEPS = 8;
  for (let i = 1; i <= STEPS; i++) {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: a.x0 + (a.x1 - a.x0) * (i / STEPS), y: a.y0 + (a.y1 - a.y0) * (i / STEPS), id: 0 },
        { x: b.x0 + (b.x1 - b.x0) * (i / STEPS), y: b.y0 + (b.y1 - b.y0) * (i / STEPS), id: 1 },
      ],
    });
  }
  // 手指 A 先放（陣列裡只剩手指 B＝還按著），再放手指 B。
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: b.x1, y: b.y1, id: 1 }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

  await expect(page.locator('.board-cell[data-index="0"] img')).toHaveAttribute('src', boardIconSrc(fire.id));
  await expect(page.locator('.board-cell[data-index="4"] img')).toHaveCount(0);
  await expect(page.locator('#board-grid img')).toHaveCount(1);
  await expect(page.locator('.drag-ghost')).toHaveCount(0);
});

test('B3d. 工具列與組合列的尺寸不隨擺放狀態改變', async ({ page }) => {
  // spec §4 的硬要求，對應 /tree 既有的 O2。沒有這條的話「按鈕文字固定不變」
  // 「三個元素永遠都在」就只是註解——註解不會在有人改壞時說話。
  await page.goto('/board');
  const box = async (sel: string) => (await page.locator(sel).boundingBox())!;
  const t0 = await box('#board-tools');
  const d0 = await box('#deck-row');

  // ⚠️ 這一步刻意**不**點 `#board-export`：那顆按鈕的 handler 要到 Task 7 才接上，
  // 在這裡點它 `#board-export-out` 永遠不會出現，測試必紅。
  // 「產生分享圖之後工具列尺寸也不變」由 Task 7 的 B8d 接手。
  await pickInto(page, 0, dice[0]!.id, 4);
  await drag(page, '.deck-dice[data-slot="0"]', '.board-cell[data-index="0"]');

  const t1 = await box('#board-tools');
  const d1 = await box('#deck-row');
  expect(Math.round(t1.width)).toBe(Math.round(t0.width));
  expect(Math.round(t1.height)).toBe(Math.round(t0.height));
  // 組合列：空槽與有骰子的槽必須一樣大（等級鈕是 disabled 不是消失）。
  expect(Math.round(d1.width)).toBe(Math.round(d0.width));
  expect(Math.round(d1.height)).toBe(Math.round(d0.height));
});

test('B3e. 等級的夾制發生在狀態層，不是只在顯示層', async ({ page }) => {
  // B1 驗過「按 9 次 ▶ 顯示停在 7」。但夾制若只寫在 renderDeck（`String(Math.min(7, pips))`）
  // 而 setDeckSlot 不夾，狀態裡是 10——拖進骰盤的格子與分享圖都會印出 10，而 B1 全綠。
  await page.goto('/board');
  await page.locator('.deck-dice[data-slot="0"]').click();
  await page.locator(`.picker-dice[data-dice-id="${dice[0]!.id}"]`).click();
  for (let i = 0; i < 9; i++) await page.locator('.pips-inc[data-slot="0"]').click();

  await drag(page, '.deck-dice[data-slot="0"]', '.board-cell[data-index="0"]');
  await expect(page.locator('.board-cell[data-index="0"] .cell-pips')).toHaveText('7');
});

test('B4. 拖出骰盤＝移除；拖到已有骰子的格＝覆蓋', async ({ page }) => {
  await page.goto('/board');
  const fire = dice[0]!;
  const wind = dice[1]!;
  await pickInto(page, 0, fire.id, 1);
  await pickInto(page, 1, wind.id, 4);

  await drag(page, '.deck-dice[data-slot="0"]', '.board-cell[data-index="3"]');
  await expect(page.locator('#board-grid img')).toHaveCount(1);

  // 覆蓋
  await drag(page, '.deck-dice[data-slot="1"]', '.board-cell[data-index="3"]');
  await expect(page.locator('.board-cell[data-index="3"] img')).toHaveAttribute('src', boardIconSrc(wind.id));
  await expect(page.locator('.board-cell[data-index="3"] .cell-pips')).toHaveText('4');
  await expect(page.locator('#board-grid img')).toHaveCount(1);

  // 拖到骰盤外＝移除。⚠️ 盤上要先有第二顆：只有一顆的話，實作寫成
  // `board = emptyBoard()`（清空整盤）也會讓 count 變 0 而全綠。
  await drag(page, '.deck-dice[data-slot="0"]', '.board-cell[data-index="8"]');
  await expect(page.locator('#board-grid img')).toHaveCount(2);

  await drag(page, '.board-cell[data-index="3"]', 'h1');
  await expect(page.locator('#board-grid img')).toHaveCount(1);
  await expect(page.locator('.board-cell[data-index="3"] img')).toHaveCount(0);
  await expect(page.locator('.board-cell[data-index="8"] img')).toBeVisible();
});

test('B4b. 從組合列拖到骰盤外＝什麼都不做（不清空該槽、不動骰盤）', async ({ page }) => {
  await page.goto('/board');
  await pickInto(page, 0, dice[0]!.id, 3);
  await drag(page, '.deck-dice[data-slot="0"]', 'h1');

  await expect(page.locator('#board-grid img')).toHaveCount(0);
  await expect(page.locator('.deck-dice[data-slot="0"] img')).toBeVisible();
  await expect(page.locator('.pips-value[data-slot="0"]')).toHaveText('3');
  // 那一槽仍然是活的來源。
  await drag(page, '.deck-dice[data-slot="0"]', '.board-cell[data-index="0"]');
  await expect(page.locator('.board-cell[data-index="0"] .cell-pips')).toHaveText('3');
});

test('B5. 清空骰盤', async ({ page }) => {
  await page.goto('/board');
  await pickInto(page, 0, dice[0]!.id, 1);
  await drag(page, '.deck-dice[data-slot="0"]', '.board-cell[data-index="0"]');
  await drag(page, '.deck-dice[data-slot="0"]', '.board-cell[data-index="1"]');
  await expect(page.locator('#board-grid img')).toHaveCount(2);

  await page.locator('#board-clear').click();
  await expect(page.locator('#board-grid img')).toHaveCount(0);

  // 清空的是骰盤不是組合。⚠️ 只看 `.deck-dice img` 還在是不夠的：handler 若順手把 deck
  // 也清成 emptyDeck() 卻沒重畫組合列，DOM 裡上一次留下的 <img> 照樣在。再拖一次才證得出
  // 那一槽仍然是活的來源。
  await expect(page.locator('.deck-dice[data-slot="0"] img')).toBeVisible();
  await drag(page, '.deck-dice[data-slot="0"]', '.board-cell[data-index="7"]');
  await expect(page.locator('.board-cell[data-index="7"] img')).toBeVisible();
});

test('B6. 純鍵盤也能放骰子：Enter 拿起、方向鍵移動、Enter 放下，並且會播報', async ({ page }) => {
  await page.goto('/board');
  const fire = dice[0]!;
  await pickInto(page, 0, fire.id, 2);

  // 從組合列那一槽拿起。
  await page.locator('.deck-dice[data-slot="0"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#board-live')).toContainText('拿起');

  // 焦點移到骰盤第 0 格，往右兩格、往下一格＝index 7。
  await page.locator('.board-cell[data-index="0"]').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.board-cell[data-index="7"]')).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(page.locator('.board-cell[data-index="7"] img')).toBeVisible();
  await expect(page.locator('.board-cell[data-index="7"] .cell-pips')).toHaveText('2');
  await expect(page.locator('#board-live')).toContainText('第 2 列第 3 格');
});

test('B7. 方向鍵在骰盤邊界不會跑出去，Delete 清掉當前格', async ({ page }) => {
  await page.goto('/board');
  await pickInto(page, 0, dice[0]!.id, 1);

  await page.locator('.deck-dice[data-slot="0"]').focus();
  await page.keyboard.press('Enter');
  await page.locator('.board-cell[data-index="0"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.board-cell[data-index="0"] img')).toBeVisible();

  // ⚠️ 不要只測左上角：i=0 按 ArrowLeft 就算實作寫成無條件 `i - 1`，focusCell(-1) 也只是
  // querySelector 回 null、`?.focus()` 靜默 no-op，焦點留在原地 → 假綠。真正會出事的是
  // **列間繞行**（i=4 往右變成第 2 列第 1 格），那幾格的越界索引是**存在的格子**。
  await page.locator('.board-cell[data-index="4"]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.board-cell[data-index="4"]')).toBeFocused();

  await page.locator('.board-cell[data-index="5"]').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.board-cell[data-index="5"]')).toBeFocused();

  await page.locator('.board-cell[data-index="0"]').focus();
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('.board-cell[data-index="0"]')).toBeFocused();
  await page.locator('.board-cell[data-index="12"]').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.board-cell[data-index="12"]')).toBeFocused();

  // 骰子放在 index 0，邊界檢查的最後一步卻停在 index 12——Delete 清的是「當前聚焦格」，
  // 所以要先把焦點移回真正放了骰子的那一格。
  await page.locator('.board-cell[data-index="0"]').focus();
  await page.keyboard.press('Delete');
  await expect(page.locator('#board-grid img')).toHaveCount(0);
  await expect(page.locator('#board-live')).toContainText('已移除');
});

test('B7b. 鍵盤也能做格→格交換，Space 與 Backspace 跟 Enter／Delete 等價', async ({ page }) => {
  // 鍵盤路徑的 `held.from !== null` 分支（＝交換）在 B6／B7 完全沒被走到：那兩條都是從
  // 組合列拿起（from === null，走 place）。把 swap 那一支寫成 place（＝複製）也全綠。
  await page.goto('/board');
  const fire = dice[0]!;
  const wind = dice[1]!;
  await pickInto(page, 0, fire.id, 2);
  await pickInto(page, 1, wind.id, 5);
  await drag(page, '.deck-dice[data-slot="0"]', '.board-cell[data-index="0"]');
  await drag(page, '.deck-dice[data-slot="1"]', '.board-cell[data-index="1"]');

  // 用 Space 拿起（實作同時吃 Enter 與 ' '，兩個都要有測試）。
  await page.locator('.board-cell[data-index="0"]').focus();
  await page.keyboard.press(' ');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press(' ');

  await expect(page.locator('.board-cell[data-index="0"] img')).toHaveAttribute('src', boardIconSrc(wind.id));
  await expect(page.locator('.board-cell[data-index="1"] img')).toHaveAttribute('src', boardIconSrc(fire.id));
  await expect(page.locator('#board-grid img')).toHaveCount(2);

  // Backspace 與 Delete 等價。
  await page.locator('.board-cell[data-index="1"]').focus();
  await page.keyboard.press('Backspace');
  await expect(page.locator('#board-grid img')).toHaveCount(1);
});

test('B7c. 鍵盤拿起之後改用滑鼠操作，held 會失效而不是播報假訊息', async ({ page }) => {
  // 守一個實測過的 bug：held 只在鍵盤自己的三條路徑被清空，startDrag() 與 #board-clear
  // 都不碰它。拿起後改用滑鼠完成別的操作、再按鍵盤 Enter，live region 會唸出一個
  // 完全不存在的擺放結果——比沒有播報更糟。
  await page.goto('/board');
  await pickInto(page, 0, dice[0]!.id, 2);
  await drag(page, '.deck-dice[data-slot="0"]', '.board-cell[data-index="0"]');

  // 鍵盤拿起第 0 格。
  await page.locator('.board-cell[data-index="0"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#board-live')).toContainText('拿起');

  // 改用滑鼠把它拖到第 5 格（held 應該就此失效）。
  await drag(page, '.board-cell[data-index="0"]', '.board-cell[data-index="5"]');
  await expect(page.locator('.board-cell[data-index="5"] img')).toBeVisible();

  // 回到鍵盤，在空的第 3 格按 Enter：不該放下任何東西，也不該播報「放到」。
  await page.locator('.board-cell[data-index="3"]').focus();
  await page.keyboard.press('Enter');

  await expect(page.locator('.board-cell[data-index="3"] img')).toHaveCount(0);
  await expect(page.locator('#board-grid img')).toHaveCount(1);
  // 第 3 格是空的，Enter 應該是「這格沒東西可拿」→ live 不該出現「放到第 1 列第 4 格」。
  await expect(page.locator('#board-live')).not.toContainText('第 1 列第 4 格');
});

test('B7d. 清空骰盤也會讓 held 失效', async ({ page }) => {
  await page.goto('/board');
  await pickInto(page, 0, dice[0]!.id, 2);
  await drag(page, '.deck-dice[data-slot="0"]', '.board-cell[data-index="0"]');

  await page.locator('.board-cell[data-index="0"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#board-live')).toContainText('拿起');

  await page.locator('#board-clear').click();
  await expect(page.locator('#board-grid img')).toHaveCount(0);

  // 清空之後 held 指著的那顆已經不存在，按 Enter 不該把它變回來。
  // ⚠️ 光看 img 數量不夠：held.from（0）與目標（3）都指向已清空的 null 格，
  // swap(null, null) 雖然沒有可見變化，卻仍會回傳一個新陣列參照（[...board] 淺拷貝），
  // 讓 `next !== board` 判斷成立而照樣播報一句假的「放到」——board-grid 的圖片數量在這種
  // no-op 交換前後完全看不出差異，只有 live region 的文字才騙不過去。
  await page.locator('.board-cell[data-index="3"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#board-grid img')).toHaveCount(0);
  await expect(page.locator('#board-live')).not.toContainText('第 1 列第 4 格');
});

test('B8. 產生分享圖：輸出區塊出現，圖是 1200×900 且不是一片空白', async ({ page }) => {
  await page.goto('/board');
  const fire = dice[0]!;
  await pickInto(page, 0, fire.id, 5);
  await drag(page, '.deck-dice[data-slot="0"]', '.board-cell[data-index="0"]');

  await expect(page.locator('#board-export-out')).toBeHidden();
  await page.locator('#board-export').click();
  await expect(page.locator('#board-export-out')).toBeVisible({ timeout: EXPORT_TIMEOUT });

  const img = page.locator('#board-export-img');
  await expect(img).toHaveAttribute('src', /^blob:/, { timeout: EXPORT_TIMEOUT });
  // 等圖真的解碼完再量尺寸，否則 naturalWidth 是 0。
  await expect.poll(async () => img.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: EXPORT_TIMEOUT }).toBe(1200);
  await expect.poll(async () => img.evaluate((el: HTMLImageElement) => el.naturalHeight), { timeout: EXPORT_TIMEOUT }).toBe(900);

  // ⚠️ 取樣要比「**有骰子的格** vs **空的格**」，不是「格子 vs 背景」。
  // renderShareImage 對每一格都無條件填一次 --surface-1 再決定要不要畫骰子，所以
  // 「格中心 vs 畫布空白處」在**完全沒畫骰子**時也不同色——實測把 drawImage 那段整個刪掉，
  // 格中心 58,51,88 / 背景 47,41,66，斷言照樣通過。兩點都取在格子上，差別才來自骰子。
  // 座標用 cellRect 現算，不要寫死：常數一改（例如 CELL 140→100）寫死值會掉到背景上。
  // ⚠️ 直接取「格子本身」的中心點，不必再算 iconRect 的內框——不管圖示是不是正方形，
  // 內框都跟格子共用同一個中心點，取哪一個中心都會落在圖示範圍內。
  const p0 = cellRect(0);
  const p14 = cellRect(14);
  const colors = await img.evaluate((el: HTMLImageElement, pts: { x: number; y: number }[]) => {
    const c = document.createElement('canvas');
    c.width = el.naturalWidth;
    c.height = el.naturalHeight;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(el, 0, 0);
    return pts.map(pt => [...ctx.getImageData(Math.round(pt.x), Math.round(pt.y), 1, 1).data].join(','));
  }, [
    { x: p0.x + p0.w / 2, y: p0.y + p0.h / 2 },     // 第 0 格：有骰子
    { x: p14.x + p14.w / 2, y: p14.y + p14.h / 2 }, // 第 14 格：空的
  ]);
  expect(colors[0], '有骰子的格與空格顏色相同＝骰子根本沒畫進去').not.toBe(colors[1]);
});

test('B8b. 連按兩次產生分享圖，第二張仍然顯示得出來', async ({ page }) => {
  // 守 revokeObjectURL 的用法。寫成「撤銷剛建立的那一個」會讓第二張直接破圖，
  // 而只按一次的測試永遠看不到——B8／B8b 都只按一次。
  await page.goto('/board');
  await page.locator('#board-export').click();
  const first = await page.locator('#board-export-img').getAttribute('src');
  await page.locator('#board-export').click();
  // ⚠️ click() resolve 只代表事件已送達，不保證 handler 跑完：canvas.toBlob() 有真的
  // （非同步、實測約 10–20ms）回呼延遲，直接讀 attribute 會跟這段非同步賽跑，讀到「還沒
  // 換圖」的舊值——跟 revokeObjectURL 寫得對不對無關，單純是讀太早。等 src 真的換掉再比對
  // （2026-08-22 實測：不 poll 直接讀，desktop／mobile 兩個 project 都會間歇性讀到跟
  // first 相同的字串，機率隨並行 worker 數上升）。
  await expect.poll(() => page.locator('#board-export-img').getAttribute('src'), { timeout: EXPORT_TIMEOUT }).not.toBe(first);
  const second = await page.locator('#board-export-img').getAttribute('src');
  expect(second).not.toBe(first);
  await expect.poll(async () =>
    page.locator('#board-export-img').evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: EXPORT_TIMEOUT }).toBe(1200);
});

test('B8d. 產生分享圖之後，工具列與組合列的尺寸仍然不變', async ({ page }) => {
  // B3d 在 Task 4 驗過「挑骰子＋拖曳不會改變工具列尺寸」，但那時 #board-export 的 handler
  // 還不存在。這一條接手另一半：輸出區塊出現時只准把 footer 往下推，不准動到工具列。
  await page.goto('/board');
  const box = async (sel: string) => (await page.locator(sel).boundingBox())!;
  const t0 = await box('#board-tools');
  const d0 = await box('#deck-row');

  await pickInto(page, 0, dice[0]!.id, 4);
  await drag(page, '.deck-dice[data-slot="0"]', '.board-cell[data-index="0"]');
  await page.locator('#board-export').click();
  await expect(page.locator('#board-export-out')).toBeVisible({ timeout: EXPORT_TIMEOUT });

  const t1 = await box('#board-tools');
  const d1 = await box('#deck-row');
  expect(Math.round(t1.width)).toBe(Math.round(t0.width));
  expect(Math.round(t1.height)).toBe(Math.round(t0.height));
  expect(Math.round(d1.width)).toBe(Math.round(d0.width));
  expect(Math.round(d1.height)).toBe(Math.round(d0.height));
});

test('B8c. 空骰盤也能產圖，不會丟例外', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/board');
  await page.locator('#board-export').click();
  await expect(page.locator('#board-export-img')).toHaveAttribute('src', /^blob:/, { timeout: EXPORT_TIMEOUT });
  expect(errors).toEqual([]);
});

test('B8e. 匯出流程有效能天花板：連續多次取中位數不超過門檻', async ({ page }) => {
  // B8／B8b／B8c／B8d 只驗「有沒有做對」，沒有一條驗「快不快」——5s 到 15s（EXPORT_TIMEOUT）
  // 之間是一段會被靜默吃掉的迴歸空間：匯出哪天真的退化到 8 秒（對使用者是災難，早就以為
  // 壞了），舊的 5s 門檻會紅，但現在放寬後的 EXPORT_TIMEOUT 只用來讓斷言等到條件成立，
  // 15000ms 太寬，退化到 8 秒也還是綠燈，沒有任何東西會說話。
  //
  // 門檻不能只單次量，理由見 EXPORT_TIMEOUT 上面那段插樁數字：端對端點擊流程 median
  // 51–60ms、max 125ms，但整段流程偶爾（B8c mobile 連跑 30 次中 2 次）會飆到 7.4s，
  // 機制未查明。單次斷言遇到尖峰就會變成隨機紅；改成連續量 N 次取中位數，只要尖峰不是
  // 佔多數樣本就不會把中位數推過門檻。THRESHOLD_MS = 2500，離實測 median（~60ms）留了
  // 四十倍餘裕、離觀測到的尖峰（7.4s）也還有安全距離——真的要把中位數推過 2500ms，
  // 至少要 N 次裡有一半以上都退化，那已經是「匯出真的變慢」不是「單次尖峰」。
  test.setTimeout(60_000); // 保險絲：即使少數樣本個別撞到 EXPORT_TIMEOUT 也不會被外層測試逾時打斷。
  const THRESHOLD_MS = 2500;
  const N = 7;

  await page.goto('/board');
  const durations: number[] = [];
  let prevSrc: string | null = null;
  for (let i = 0; i < N; i++) {
    const t0 = Date.now();
    await page.locator('#board-export').click();
    await expect.poll(
      () => page.locator('#board-export-img').getAttribute('src'),
      { timeout: EXPORT_TIMEOUT },
    ).not.toBe(prevSrc);
    durations.push(Date.now() - t0);
    prevSrc = await page.locator('#board-export-img').getAttribute('src');
  }

  const sorted = [...durations].sort((a, b) => a - b);
  const median = sorted[Math.floor(N / 2)]!;
  expect(median, `連續 ${N} 次匯出耗時（ms，已排序）＝${sorted.join(', ')}`).toBeLessThan(THRESHOLD_MS);
});

test('B9. 手機寬度下版面不橫向捲，骰盤的 touch-action 是 none', async ({ page, isMobile }) => {
  // ⚠️ 用 test.skip 而不是 `if (isMobile) { … }`，跟 tree.spec.ts:191 的 J／W／Y 一致。
  // 包在 if 裡的話，desktop project 跑的是一條「開一頁、零斷言、回報 passed」的測試——
  // 而且無法自證它有跑過：mobile project 哪天被移除或改名，兩邊都綠、手機版面零覆蓋。
  // （這條測試的第一個斷言之前沒有別的斷言，所以 test.skip 放最前面是安全的。）
  test.skip(!isMobile, '僅手機版');
  await page.goto('/board');

  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  // 沒有這個屬性，手機上一拖就變成捲頁而不是拖骰子。骰盤與組合列**兩邊都要**。
  for (const sel of ['#board-grid', '#deck-row']) {
    const ta = await page.locator(sel).evaluate(el => getComputedStyle(el).touchAction);
    expect(ta, `${sel} 少了 touch-action: none`).toBe('none');
  }

  // 組合列在骰盤下方（拇指區）。
  const grid = (await page.locator('#board-grid').boundingBox())!;
  const deck = (await page.locator('#deck-row').boundingBox())!;
  expect(deck.y).toBeGreaterThan(grid.y);
});

test('B10. 兩個小標與其下方內容區塊一起置中，標題與說明文字維持靠左', async ({ page }) => {
  // 置中量的是各元素自己的框相對 <main> 的左右留白，不是它們「裡面」的東西有沒有置中——
  // 後者只要 justify-content: center 就能造假：元素本身仍貼齊頁面兩側（留白 0），
  // 量出來的數字會騙過「留白相等」這條斷言。
  await page.goto('/board');
  const main = (await page.locator('main').boundingBox())!;
  const gapsFromBox = (box: { x: number; width: number }) =>
    ({ left: box.x - main.x, right: main.x + main.width - (box.x + box.width) });
  const gaps = async (sel: string) => gapsFromBox((await page.locator(sel).boundingBox())!);

  const deckGap = await gaps('#deck-row');
  expect(Math.abs(deckGap.left - deckGap.right), `#deck-row 左右留白 ${deckGap.left} / ${deckGap.right}`).toBeLessThanOrEqual(2);

  const gridGap = await gaps('#board-grid');
  expect(Math.abs(gridGap.left - gridGap.right), `#board-grid 左右留白 ${gridGap.left} / ${gridGap.right}`).toBeLessThanOrEqual(2);

  // 標題與說明文字仍然靠左：跟頁面的內距左緣對齊，彼此的左邊界完全相同
  // （置中的是 .board-h2／#deck-row／#board-grid 這三塊，不是整個 .board-page）。
  const h1x = (await page.locator('h1').boundingBox())!.x;
  const ledeX = (await page.locator('.lede').boundingBox())!.x;
  expect(ledeX).toBe(h1x);

  // 兩個 .board-h2（「我的隊伍」「骰盤」）改成置中，判準跟 #deck-row／#board-grid 一致
  // （量左右留白相等，容差 ≤2px）；另外還要驗小標真的對齊在它下面那一塊的正上方，
  // 不是只對到頁面中心——#deck-row 是 width: fit-content、#board-grid 是 max-width，
  // 兩種置中機制的框寬本來就不同，只驗「小標自己留白相等」測不出小標飄到另一個中線去了。
  // ⚠️ .board-h2 在手機（觸控）版面上刻意 display:none（既有設計，見 global.css 的
  // 「兩個 h2 在手機上是多餘的」註解），這時 getBoundingClientRect() 全部回 0，
  // 不是「沒有置中」——所以只在它可見時才驗。
  const h2s = await page.locator('.board-h2').all();
  const rows = ['#deck-row', '#board-grid'];
  for (let i = 0; i < h2s.length; i++) {
    const h2 = h2s[i]!;
    if (!(await h2.isVisible())) continue;

    const h2Box = (await h2.boundingBox())!;
    const h2Gap = gapsFromBox(h2Box);
    expect(Math.abs(h2Gap.left - h2Gap.right), `.board-h2[${i}] 左右留白 ${h2Gap.left} / ${h2Gap.right}`).toBeLessThanOrEqual(2);
    // ⚠️ 光「左右留白相等」擋不住「整條 h2 還是滿版、文字沒有真的置中」這種假綠：
    // .page 左右內距對稱，一個滿版 box 量出來的左右留白本來就必然相等（都等於那個內距），
    // 跟裡面的文字是靠左還是置中無關。所以另外驗 h2 自己的框有沒有真的收縮並往中線靠攏——
    // 兩個標題文字都遠短於整頁內容寬度，置中之後左邊界一定明顯落在標題／說明文字的左邊界
    // 右側，不會兩者重合。
    expect(h2Box.x, `.board-h2[${i}] 左邊界 ${h2Box.x} 跟標題 ${h1x} 一樣，看起來還是滿版沒真的置中`).toBeGreaterThan(h1x);

    const rowBox = (await page.locator(rows[i]!).boundingBox())!;
    const h2Center = h2Box.x + h2Box.width / 2;
    const rowCenter = rowBox.x + rowBox.width / 2;
    expect(Math.abs(h2Center - rowCenter), `.board-h2[${i}] 中心 ${h2Center} 與 ${rows[i]} 中心 ${rowCenter} 對不齊`).toBeLessThanOrEqual(2);
  }

  // 靠左的東西應該比置中內容的左邊界更靠近頁面邊緣（除非兩者剛好一樣寬，那種情況也不算錯，
  // 用 toBeLessThanOrEqual 涵蓋）。
  const deckBox = (await page.locator('#deck-row').boundingBox())!;
  expect(h1x).toBeLessThanOrEqual(deckBox.x);
});

test('B11. 「隱藏星數」切換 .cell-pips 顯示，且不改變工具列尺寸', async ({ page }) => {
  await page.goto('/board');
  const box = async (sel: string) => (await page.locator(sel).boundingBox())!;

  await pickInto(page, 0, dice[0]!.id, 4);
  await drag(page, '.deck-dice[data-slot="0"]', '.board-cell[data-index="0"]');

  const t0 = await box('#board-tools');
  const pips = page.locator('.board-cell[data-index="0"] .cell-pips');
  await expect(pips).toBeVisible();

  const toggle = page.locator('#board-hide-pips');
  await expect(toggle).toHaveText('隱藏星數');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle).toHaveText('隱藏星數'); // ⚠️ 文字固定不變，不是「顯示星數」
  await expect(pips).toBeHidden();
  await expect(page.locator('#board-live')).toContainText('隱藏');

  const t1 = await box('#board-tools');
  expect(Math.round(t1.width)).toBe(Math.round(t0.width));
  expect(Math.round(t1.height)).toBe(Math.round(t0.height));

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(pips).toBeVisible();
  await expect(page.locator('#board-live')).toContainText('顯示');

  const t2 = await box('#board-tools');
  expect(Math.round(t2.width)).toBe(Math.round(t0.width));
  expect(Math.round(t2.height)).toBe(Math.round(t0.height));
});

test('B12. 隱藏星數之後產生的分享圖，骰盤格取樣像素跟顯示狀態不同', async ({ page }) => {
  // 只驗骰盤格——組合列（我的隊伍）的數字是等級控制項本身，不受這顆切換鈕影響，
  // 見 ExportInput.hidePips 的說明與 board.ts 呼叫 renderShareImage 那段註解。
  await page.goto('/board');
  await pickInto(page, 0, dice[0]!.id, 5);
  await drag(page, '.deck-dice[data-slot="0"]', '.board-cell[data-index="0"]');

  const img = page.locator('#board-export-img');
  const c0 = cellRect(0);
  const rect = { x: Math.round(c0.x + c0.w - 30), y: Math.round(c0.y + c0.h - 30), w: 30, h: 30 };
  const sample = () => img.evaluate((el: HTMLImageElement, r: typeof rect) => {
    const c = document.createElement('canvas');
    c.width = el.naturalWidth;
    c.height = el.naturalHeight;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(el, 0, 0);
    return [...ctx.getImageData(r.x, r.y, r.w, r.h).data].join(',');
  }, rect);

  await page.locator('#board-export').click();
  await expect(img).toHaveAttribute('src', /^blob:/, { timeout: EXPORT_TIMEOUT });
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: EXPORT_TIMEOUT }).toBe(1200);
  const visible = await sample();

  const prevSrc = await img.getAttribute('src');
  await page.locator('#board-hide-pips').click();
  await page.locator('#board-export').click();
  await expect.poll(() => img.getAttribute('src'), { timeout: EXPORT_TIMEOUT }).not.toBe(prevSrc);
  const hidden = await sample();

  expect(hidden, '隱藏星數後分享圖的骰盤格取樣沒有變化＝ hidePips 沒有真的傳進 renderShareImage').not.toBe(visible);
});

test('B13. I5：組合列在 320／360／390／412px 都排成 5 個不折行', async ({ page, isMobile }) => {
  // 只在 mobile project 跑：CSS 用 `(hover: none) and (pointer: coarse)` 判斷，跟 D9／O2
  // 那批既有測試同一套判準（畫面寬度不是判準，觸控能力才是）。desktop project 的瀏覽器
  // context 沒有觸控能力，這裡的媒體查詢永遠不成立，測了也只是空跑。
  test.skip(!isMobile, '僅手機版（CSS 用 hover:none/pointer:coarse 判斷，desktop project 不會觸發）');
  await page.goto('/board');

  for (const w of [320, 360, 390, 412]) {
    await page.setViewportSize({ width: w, height: 900 });
    const ys = await page.locator('.deck-slot').evaluateAll(
      els => els.map(e => Math.round(e.getBoundingClientRect().y)));
    expect(new Set(ys).size, `寬度 ${w}px 時組合列的 5 個槽分成 ${new Set(ys).size} 列`).toBe(1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `寬度 ${w}px 時出現橫向捲動`).toBeLessThanOrEqual(0);
  }

  // ◀／▶ 縮小之後仍然點得到：在最窄的 320px 挑一顆骰子進槽、按一次 ▶，確認狀態真的變了
  // （不是只量框大小 > 0——那證明不了按鍵盤或觸控真的按得到）。
  await page.setViewportSize({ width: 320, height: 900 });
  await page.locator('.deck-dice[data-slot="0"]').click();
  await page.locator('.picker-dice').first().click();
  await page.locator('.pips-inc[data-slot="0"]').click();
  await expect(page.locator('.pips-value[data-slot="0"]')).toHaveText('2');
});

// M1（review 抓到）：分享圖的圖示過去是「拉伸貼滿」，不是等比縮放。/board 換成純骰子圖之後
// 這批圖的長寬比不再統一（寬 147–174、高 171–186），舊行為的破綻會被放大成看得見的變形。
test('B14. 分享圖等比：長寬比最極端的骰子（0.847）畫出來不是被拉滿的正方形', async ({ page }) => {
  await page.goto('/board');
  // 貪婪骰子（5006）是這批純骰子圖裡長寬比最極端的一張（寬 149、高 176 ≈ 0.847）。
  const greed = dice.find(d => d.name === '貪婪骰子')!;
  await pickInto(page, 0, greed.id, 1);
  await drag(page, '.deck-dice[data-slot="0"]', '.board-cell[data-index="0"]');

  await page.locator('#board-export').click();
  const img = page.locator('#board-export-img');
  await expect(img).toHaveAttribute('src', /^blob:/, { timeout: EXPORT_TIMEOUT });
  await expect.poll(async () => img.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: EXPORT_TIMEOUT }).toBe(1200);

  const cell = cellRect(0);
  // 在畫出來的分享圖上，沿格子的縱向中線／橫向中線各掃一次，找出「跟背景色不一樣」的像素
  // 範圍——那就是圖示實際佔用的寬與高。掃描範圍刻意留 10px 的邊界，避開格子本身的圓角
  // 描邊（見 renderShareImage 的 roundRect+stroke），背景參考色就近取在掃描起點，
  // 不假設任何寫死的顏色。
  const { w: iconW, h: iconH } = await img.evaluate((el: HTMLImageElement, cell: { x: number; y: number; w: number; h: number }) => {
    const c = document.createElement('canvas');
    c.width = el.naturalWidth;
    c.height = el.naturalHeight;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(el, 0, 0);

    const at = (x: number, y: number) => [...ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data];
    const diff = (a: number[], b: number[]) => Math.abs(a[0]! - b[0]!) + Math.abs(a[1]! - b[1]!) + Math.abs(a[2]! - b[2]!);
    const THRESHOLD = 30;
    const MARGIN = 10;

    const midY = cell.y + cell.h / 2;
    const bgRow = at(cell.x + MARGIN, midY);
    let minX = -1, maxX = -1;
    for (let x = MARGIN; x < cell.w - MARGIN; x++) {
      if (diff(at(cell.x + x, midY), bgRow) > THRESHOLD) { if (minX < 0) minX = x; maxX = x; }
    }

    const midX = cell.x + cell.w / 2;
    const bgCol = at(midX, cell.y + MARGIN);
    let minY = -1, maxY = -1;
    for (let y = MARGIN; y < cell.h - MARGIN; y++) {
      if (diff(at(midX, cell.y + y), bgCol) > THRESHOLD) { if (minY < 0) minY = y; maxY = y; }
    }

    return { w: maxX - minX, h: maxY - minY };
  }, cell);

  expect(iconW, `量到的圖示寬 ${iconW}／高 ${iconH}——量不到任何差異，掃描本身可能有問題`).toBeGreaterThan(0);
  expect(iconH).toBeGreaterThan(0);

  // 拉伸成正方形的舊行為會讓 w === h（都吃滿 78% 內框）；等比縮放之後寬必須明顯小於高
  // （容忍反鋸齒與掃描量測誤差，但拉滿正方形的話這裡一定會超過 0.93）。
  const ratio = iconW / iconH;
  expect(ratio, `寬高比 ${ratio.toFixed(3)}——太接近 1 代表圖被拉伸貼滿了內框，不是等比縮放`).toBeLessThan(0.93);
  // 也不能矯枉過正縮到跟來源比例（0.847）差太遠，那代表掃描量到了別的東西。
  expect(ratio).toBeGreaterThan(0.6);
});
