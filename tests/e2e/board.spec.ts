// 骰盤擺放編輯器的端對端驗證。
//
// 這一頁跟 /dice 不同，內容不是拿來被搜尋引擎索引的——它的價值全在互動。所以測試的重心
// 是「拖曳之後狀態對不對」與「不用滑鼠也能用」，而不是 HTML 裡有沒有字。
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { badgeRect, cellRect } from '../../src/lib/board-image';
import { readTree } from '../helpers/read-tree';

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

const tree = readTree() as { nodes: { id: string; type: string; name: string; icon: string }[] };

const dice = tree.nodes.filter(n => n.type === 'dice');

// /board 的骰子圖示改用「純骰子圖」（不含底板），跟正本 SVG 引用的節點圖示（`.icon`，
// `/assets/icons/`）是平行的一條資產路徑，對照表在 data/board-icons.json（節點 id -> hash）。
const boardIcons = JSON.parse(
  readFileSync(new URL('../../data/board-icons.json', import.meta.url), 'utf8'),
) as Record<string, string>;
const boardIconSrc = (id: string): string => `/assets/board-icons/${boardIcons[id]}.webp`;

test('B0. 骰盤頁的骨架：15 格、5 個組合槽、43 顆可挑選的骰子', async ({ page }) => {
  await page.goto('/board');
  await expect(page.locator('#board-grid .board-cell')).toHaveCount(15);
  await expect(page.locator('#deck-row .deck-slot')).toHaveCount(5);
  await expect(page.locator('#dice-picker .picker-dice')).toHaveCount(dice.length);
  expect(dice).toHaveLength(43);

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

test('B0d. 43 顆骰子的挑選圖示都指向純骰子圖，而且每一張都真的載得到', async ({ page }) => {
  // 換掉節點圖示（帶底板）之後這是第一道防線：src 對得上正則不代表圖真的存在——路徑打錯
  // 一個字或 build:data 漏轉一張，畫面上就是一個 41 分之一的破圖，naturalWidth 會是 0。
  await page.goto('/board');
  // 圖示是 loading="lazy"，而挑選網格關閉時整個容器是 display:none——不打開的話瀏覽器
  // 根本不會發起請求，量到的 naturalWidth 只會是「還沒載入」而不是「載入失敗」。
  await page.locator('.deck-dice[data-slot="0"]').click();
  await expect(page.locator('#dice-picker')).toBeVisible();

  const imgs = page.locator('#dice-picker .picker-dice img');
  await expect(imgs).toHaveCount(dice.length);

  const srcs = await imgs.evaluateAll(els => els.map(el => el.getAttribute('src')));
  expect(srcs).toHaveLength(43);
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
  // renderShareImage 對每一格都無條件填一次 --surface-1（外加 --border 描邊）再決定要不要
  // 畫骰子，所以「格中心 vs 畫布空白處」在**完全沒畫骰子**時也不同色——把 drawImage 那段
  // 整個刪掉，格中心仍是 --surface-1、背景是 --bg，斷言照樣通過。兩點都取在格子上，
  // 差別才來自骰子。
  // ⚠️ 這裡寫 token 名不寫實測 RGB：舊版註解記的是拆檔前那組配色的數值，2026-08-26 換成
  // 炭燼之後整組作廢，而註解不會有任何東西提醒它過期（2026-08-26 code review 抓到）。
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
  // ⚠️ .board-h2 在手機（觸控）版面上刻意 display:none（既有設計，見 board.css 的
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

// ── 局內強化列（2026-09-19）──────────────────────────────────────────────
// 強化 Lv 以「骰子種類」為單位（spLevels 以骰子 id 為鍵），不是以槽位：挑選網格沒擋重複，
// 換掉槽裡的骰子也不會清掉骰盤上的舊骰子——兩件事都要有斷言，否則改成以槽位為鍵會全綠。
test('B15. 強化列：空槽 disabled、夾在 1–15、同種骰子共用、換槽保留、清空骰盤不重置', async ({ page }) => {
  await page.goto('/board');
  await expect(page.locator('.sp-inc[data-slot="0"]')).toBeDisabled();
  await expect(page.locator('.sp-value[data-slot="0"]')).toHaveText('Lv.1');

  const fire = dice[0]!;
  const other = dice[1]!;
  await pickInto(page, 0, fire.id, 1);
  await pickInto(page, 1, fire.id, 1); // 同一種骰子放兩槽（挑選網格沒擋，現況）
  await expect(page.locator('.sp-inc[data-slot="0"]')).toBeEnabled();

  for (let i = 0; i < 20; i++) await page.locator('.sp-inc[data-slot="0"]').click();
  await expect(page.locator('.sp-value[data-slot="0"]')).toHaveText('Lv.15');
  await expect(page.locator('.sp-value[data-slot="1"]')).toHaveText('Lv.15');
  for (let i = 0; i < 20; i++) await page.locator('.sp-dec[data-slot="1"]').click();
  await expect(page.locator('.sp-value[data-slot="0"]')).toHaveText('Lv.1');

  // 調到 Lv.5 → 第 1 槽換成別顆（它自己是 Lv.1）→ 第 2 槽的火骰子仍是 Lv.5 → 換回來 Lv.5 還在。
  for (let i = 1; i < 5; i++) await page.locator('.sp-inc[data-slot="0"]').click();
  await pickInto(page, 0, other.id, 1);
  await expect(page.locator('.sp-value[data-slot="0"]')).toHaveText('Lv.1');
  await expect(page.locator('.sp-value[data-slot="1"]')).toHaveText('Lv.5');
  await pickInto(page, 0, fire.id, 1);
  await expect(page.locator('.sp-value[data-slot="0"]')).toHaveText('Lv.5');

  await page.locator('#board-clear').click();
  await expect(page.locator('.sp-value[data-slot="0"]')).toHaveText('Lv.5');
});

test('B15b. 強化 Lv.1 → Lv.15 組合列尺寸不變（min-width 容得下 Lv.15）', async ({ page }) => {
  await page.goto('/board');
  await pickInto(page, 0, dice[0]!.id, 1);
  const d0 = (await page.locator('#deck-row').boundingBox())!;
  for (let i = 0; i < 14; i++) await page.locator('.sp-inc[data-slot="0"]').click();
  await expect(page.locator('.sp-value[data-slot="0"]')).toHaveText('Lv.15');
  const d1 = (await page.locator('#deck-row').boundingBox())!;
  expect(Math.round(d1.width)).toBe(Math.round(d0.width));
  expect(Math.round(d1.height)).toBe(Math.round(d0.height));
});

// 手機版 320px 每槽約 51px，扣掉 ◀ ▶ 後值只剩約 19px，放不下「Lv.15」→ 只顯示數字＋圖例
// （Yuki 2026-09-19）。只在 mobile project 跑，理由同 B13。
test('B15c. 手機版強化列只顯示數字＋圖例，320px 下不溢出槽寬、按得到', async ({ page, isMobile }) => {
  test.skip(!isMobile, '僅手機版（CSS 用 hover:none/pointer:coarse 判斷）');
  await page.goto('/board');
  await page.setViewportSize({ width: 320, height: 900 });
  await pickInto(page, 0, dice[0]!.id, 1);
  for (let i = 0; i < 14; i++) await page.locator('.sp-inc[data-slot="0"]').click();
  await expect(page.locator('.sp-value[data-slot="0"] .sp-num')).toHaveText('15');
  await expect(page.locator('.sp-value[data-slot="0"] .sp-prefix')).toBeHidden();
  await expect(page.locator('#deck-legend')).toBeVisible();
  await expect(page.locator('#deck-legend')).toHaveText('上排：骰點　下排：強化 Lv');

  const rows = await page.locator('.sp-row').evaluateAll(els => els.map(e => {
    const r = e.getBoundingClientRect();
    const s = e.parentElement!.getBoundingClientRect();
    return { left: r.left - s.left, right: s.right - r.right, overflow: e.scrollWidth - e.clientWidth };
  }));
  for (const [i, r] of rows.entries()) {
    expect(r.left, `第 ${i + 1} 槽強化列超出左緣`).toBeGreaterThanOrEqual(-0.5);
    expect(r.right, `第 ${i + 1} 槽強化列超出右緣`).toBeGreaterThanOrEqual(-0.5);
    expect(r.overflow, `第 ${i + 1} 槽強化列內容溢出`).toBeLessThanOrEqual(0);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, '320px 出現橫向捲動').toBeLessThanOrEqual(0);
});

test('B15d. 桌機版強化值帶「Lv.」前綴、不顯示圖例', async ({ page, isMobile }) => {
  test.skip(isMobile, '僅桌機版');
  await page.goto('/board');
  await expect(page.locator('.sp-value[data-slot="0"] .sp-prefix')).toBeVisible();
  await expect(page.locator('#deck-legend')).toBeHidden();
});

// ── 數值卡片（2026-09-19）────────────────────────────────────────────────
// 開卡片刻意不綁 click，改在 endDrag() 判斷「從格子起手、沒超過位移門檻」（見 src/scripts/board.ts
// 的 cardIndex 說明）。這一頁的真 bug 全出在滑鼠／觸控／鍵盤三條路徑的交互，所以每條路徑各自有斷言。

/** 卡片上某一項的值：label 完全相符的 dt 的下一個 dd。 */
function cardValue(page: import('@playwright/test').Page, label: string) {
  return page.locator('#dice-card dt')
    .filter({ hasText: new RegExp(`^${label}$`) })
    .locator('xpath=following-sibling::dd[1]');
}

test('B16. 點骰盤上的骰子開數值卡片：依該格骰點與同種骰子的強化 Lv 計算，只開在被點的那一格', async ({ page }) => {
  await page.goto('/board');
  const fire = dice[0]!;
  expect(fire.name, '下面的數字是火骰子（D000）的').toBe('火骰子');
  await pickInto(page, 0, fire.id, 3);
  for (let i = 1; i < 5; i++) await page.locator('.sp-inc[data-slot="0"]').click();
  await drag(page, '.deck-dice[data-slot="0"]', '.board-cell[data-index="6"]');
  await expect(page.locator('#dice-card'), '從組合列拖進骰盤不開卡片').toBeHidden();

  await page.locator('.board-cell[data-index="6"]').click();
  const card = page.locator('#dice-card');
  await expect(card).toBeVisible();
  await expect(card.locator('.dice-card-title')).toHaveText('火骰子 · 3 骰點 · 強化 Lv.5');
  await expect(cardValue(page, '攻擊力')).toHaveText('950');
  await expect(cardValue(page, '攻擊速度')).toHaveText('0.333 秒/次');
  await expect(cardValue(page, '範圍傷害')).toHaveText('490%');
  await expect(cardValue(page, '目標')).toHaveText('前方');
  await expect(card.locator('.dice-card-note')).toHaveText('未含骰子樹（符文／被動）加成');
  await expect(page.locator('.board-cell[aria-describedby="dice-card"]')).toHaveCount(1);
  await expect(page.locator('.board-cell[data-index="6"]')).toHaveAttribute('aria-describedby', 'dice-card');
});

test('B17. 位移門檻：抖 1px 仍開卡片；拖超過 5px 收掉卡片且骰子真的移動；點空格關閉', async ({ page }) => {
  await page.goto('/board');
  await pickInto(page, 0, dice[0]!.id, 2);
  await drag(page, '.deck-dice[data-slot="0"]', '.board-cell[data-index="0"]');
  await drag(page, '.deck-dice[data-slot="0"]', '.board-cell[data-index="1"]');

  const b0 = (await page.locator('.board-cell[data-index="0"]').boundingBox())!;
  const x = b0.x + b0.width / 2;
  const y = b0.y + b0.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 1, y + 1);
  await page.mouse.up();
  await expect(page.locator('#dice-card')).toBeVisible();

  await drag(page, '.board-cell[data-index="1"]', '.board-cell[data-index="7"]');
  await expect(page.locator('#dice-card')).toBeHidden();
  await expect(page.locator('.board-cell[data-index="7"] img')).toBeVisible();
  await expect(page.locator('.board-cell[data-index="1"] img')).toHaveCount(0);

  await page.locator('.board-cell[data-index="0"]').click();
  await expect(page.locator('#dice-card')).toBeVisible();
  await page.locator('.board-cell[data-index="12"]').click(); // 空格
  await expect(page.locator('#dice-card')).toBeHidden();
  await expect(page.locator('.board-cell[aria-describedby]')).toHaveCount(0);
});

test('B18. 卡片開著時改強化 Lv：同種骰子即時重算且卡片不關；改別種骰子不影響', async ({ page }) => {
  await page.goto('/board');
  const fire = dice[0]!;
  await pickInto(page, 0, fire.id, 1);
  await pickInto(page, 1, dice[1]!.id, 1);
  await drag(page, '.deck-dice[data-slot="0"]', '.board-cell[data-index="0"]');
  await page.locator('.board-cell[data-index="0"]').click();
  await expect(cardValue(page, '攻擊力')).toHaveText('150');

  await page.locator('.sp-inc[data-slot="0"]').click();
  await expect(page.locator('#dice-card')).toBeVisible();
  await expect(page.locator('#dice-card .dice-card-title')).toHaveText(`${fire.name} · 1 骰點 · 強化 Lv.2`);
  await expect(cardValue(page, '攻擊力')).toHaveText('300');

  await page.locator('.sp-inc[data-slot="1"]').click();
  await expect(page.locator('#dice-card')).toBeVisible();
  await expect(cardValue(page, '攻擊力')).toHaveText('300');
});

test('B19. 鍵盤：焦點停在有骰子的格子顯示卡片、方向鍵換格跟著換、Escape 關閉；held 的 Escape 仍是放下', async ({ page }) => {
  await page.goto('/board');
  const fire = dice[0]!;
  const other = dice[1]!;
  await pickInto(page, 0, fire.id, 2);
  await pickInto(page, 1, other.id, 4);
  await drag(page, '.deck-dice[data-slot="0"]', '.board-cell[data-index="0"]');
  await drag(page, '.deck-dice[data-slot="1"]', '.board-cell[data-index="1"]');

  // 先 focus 空格（index 2）再按方向鍵：方向鍵之後 focusCell() 給的焦點是 :focus-visible。
  await page.locator('.board-cell[data-index="2"]').focus();
  await page.keyboard.press('ArrowLeft');
  const card = page.locator('#dice-card');
  await expect(card).toBeVisible();
  await expect(card.locator('.dice-card-title')).toHaveText(`${other.name} · 4 骰點 · 強化 Lv.1`);
  await page.keyboard.press('ArrowLeft');
  await expect(card.locator('.dice-card-title')).toHaveText(`${fire.name} · 2 骰點 · 強化 Lv.1`);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight'); // index 2，空格
  await expect(card).toBeHidden();
  await page.keyboard.press('ArrowLeft');
  await expect(card).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();

  // held 存在時 Escape 是「放下」：不可以被卡片搶走。
  await page.keyboard.press('ArrowLeft'); // index 0
  await expect(card).toBeVisible();
  await page.keyboard.press('Enter'); // 拿起
  await page.keyboard.press('Escape');
  await expect(page.locator('#board-live')).toHaveText('已放下');
  await expect(card, 'held 的 Escape 不關卡片').toBeVisible();
});

test('B20. 觸控：點一下開卡片；觸控拖曳之後，下一次點一下仍然一次就開', async ({ page, isMobile }) => {
  // justDragged 那一族的回歸測項：觸控拖曳結束瀏覽器不送 click。開卡片不綁 click，所以不受影響——
  // 這條守的就是「不受影響」。只在 mobile project 跑（desktop context 沒有 hasTouch）。
  test.skip(!isMobile, '僅手機版（需要真觸控事件）');
  await page.goto('/board');
  await pickInto(page, 0, dice[0]!.id, 2);
  await drag(page, '.deck-dice[data-slot="0"]', '.board-cell[data-index="6"]');

  const client = await page.context().newCDPSession(page);
  const center = async (sel: string) => {
    const b = (await page.locator(sel).boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const tap = async (p: { x: number; y: number }) => {
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };

  const c6 = await center('.board-cell[data-index="6"]');
  await tap(c6);
  await expect(page.locator('#dice-card')).toBeVisible();

  const c8 = await center('.board-cell[data-index="8"]');
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c6.x, y: c6.y }] });
  const STEPS = 8;
  for (let i = 1; i <= STEPS; i++) {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: c6.x + (c8.x - c6.x) * (i / STEPS), y: c6.y + (c8.y - c6.y) * (i / STEPS) }],
    });
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('.board-cell[data-index="8"] img')).toBeVisible();
  await expect(page.locator('#dice-card')).toBeHidden();

  await tap(c8);
  await expect(page.locator('#dice-card')).toBeVisible();
  await expect(page.locator('.board-cell[data-index="8"]')).toHaveAttribute('aria-describedby', 'dice-card');
});

test('B21. 開卡片不推動版面，四個角的格子開出的卡片都完整落在視窗內（桌機與 320px）', async ({ page, isMobile }) => {
  await page.goto('/board');
  if (isMobile) await page.setViewportSize({ width: 320, height: 640 });
  await pickInto(page, 0, dice[0]!.id, 7);
  // 桌機 1280×720 預設：局外加成切換（2026-09-19）把「骰盤」那一段往下推，最底列格子的中心點
  // 因此落到首屏外。drag() 用的是原始滑鼠座標，不像 locator.click() 會自動捲動進可視區——
  // 沒有這一行，拖到第 10／14 格會因為落點在畫面外而完全沒反應。
  await page.locator('#board-grid').scrollIntoViewIfNeeded();
  for (const i of [0, 4, 10, 14]) await drag(page, '.deck-dice[data-slot="0"]', `.board-cell[data-index="${i}"]`);

  // 用頁面座標（加上捲動量）比，不用 boundingBox：點下面的格子時 Playwright 會先捲動。
  const gridRect = () => page.locator('#board-grid').evaluate(el => {
    const r = el.getBoundingClientRect();
    return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
  });
  const grid0 = await gridRect();
  for (const i of [0, 4, 10, 14]) {
    await page.locator(`.board-cell[data-index="${i}"]`).click();
    await expect(page.locator('#dice-card')).toBeVisible();
    expect(await gridRect(), `開第 ${i} 格的卡片時骰盤被推動`).toEqual(grid0);
    const c = await page.locator('#dice-card').evaluate(el => {
      const r = el.getBoundingClientRect();
      return {
        left: r.left, top: r.top, right: r.right, bottom: r.bottom,
        vw: document.documentElement.clientWidth, vh: document.documentElement.clientHeight,
        nav: document.getElementById('site-nav')!.getBoundingClientRect().bottom,
      };
    });
    // 導覽列是 sticky、z-index 40，卡片是 45：卡片上緣必須讓到導覽列之下，否則會畫在導覽列上面。
    expect(c.top, `第 ${i} 格的卡片蓋到導覽列`).toBeGreaterThanOrEqual(c.nav);
    expect(c.left, `第 ${i} 格的卡片超出左緣`).toBeGreaterThanOrEqual(0);
    expect(c.top, `第 ${i} 格的卡片超出上緣`).toBeGreaterThanOrEqual(0);
    expect(c.right, `第 ${i} 格的卡片超出右緣`).toBeLessThanOrEqual(c.vw);
    expect(c.bottom, `第 ${i} 格的卡片超出下緣`).toBeLessThanOrEqual(c.vh);
  }
});

test('B22. 卡片開著時用鍵盤開挑選網格：卡片先收掉，不會疊在挑選網格上', async ({ page }) => {
  // 跨路徑回歸：鍵盤焦點開卡片 → Shift+Tab 經過強化列（刻意留著卡片）→ 組合槽按 Space 開挑選網格。
  // 焦點離開強化列之後沒有任何 listener 會關卡片，卡片（z-index 45）就疊在挑選網格（40）上面。
  // 滑鼠走不到這條（document 的 pointerdown 會先關），所以要用鍵盤重現。
  // 用第 4 槽：它是 Shift+Tab 從骰盤往回走遇到的第一槽，有骰子時強化列的按鈕才可聚焦。
  await page.goto('/board');
  await pickInto(page, 4, dice[0]!.id, 2);
  await drag(page, '.deck-dice[data-slot="4"]', '.board-cell[data-index="0"]');

  // 同 B19：先 focus 空格再按方向鍵，焦點才是 :focus-visible。
  await page.locator('.board-cell[data-index="1"]').focus();
  await page.keyboard.press('ArrowLeft');
  const card = page.locator('#dice-card');
  await expect(card).toBeVisible();

  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('.sp-inc[data-slot="4"]')).toBeFocused();
  for (let n = 0; n < 8; n++) {
    if (await page.locator('.deck-dice[data-slot="4"]').evaluate(el => el === document.activeElement)) break;
    await page.keyboard.press('Shift+Tab');
  }
  await expect(page.locator('.deck-dice[data-slot="4"]')).toBeFocused();
  await expect(card, '前提：焦點到組合槽時卡片還開著').toBeVisible();

  await page.keyboard.press(' ');
  await expect(page.locator('#dice-picker')).toBeVisible();
  await expect(card, '挑選網格開著時卡片不可以同時開著').toBeHidden();
});

test('B22b. 挑選網格開著時 Tab 走進骰盤：不開數值卡片（互斥的另一個方向）', async ({ page }) => {
  // 挑選網格沒有焦點陷阱，而它在 DOM 裡就排在骰盤前面：從最後一顆骰子按 Tab 會落在第 0 格，
  // focusin 若照開卡片，卡片（z-index 45）就疊在網格（40）上。B22 守「開網格時收卡片」，這條守反方向。
  await page.goto('/board');
  await pickInto(page, 0, dice[0]!.id, 2);
  await drag(page, '.deck-dice[data-slot="0"]', '.board-cell[data-index="0"]');

  await page.locator('.deck-dice[data-slot="0"]').focus();
  await page.keyboard.press(' ');
  const picker = page.locator('#dice-picker');
  await expect(picker).toBeVisible();

  await page.locator('#dice-picker .picker-dice').last().focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('.board-cell[data-index="0"]'), '前提：Tab 從網格最後一顆走進骰盤第 0 格').toBeFocused();
  await expect(picker).toBeVisible();
  await expect(page.locator('#dice-card'), '挑選網格開著時卡片不可以同時開著').toBeHidden();
});

test('B22c. 挑選網格開著時點骰盤上的骰子：不開數值卡片', async ({ page }) => {
  // 指標版的 B22b：網格是貼著視窗底部的 fixed 浮層，上方露出來的格子點得到，endDrag 若照開卡片就兩個都開著。
  await page.goto('/board');
  await pickInto(page, 0, dice[0]!.id, 2);
  await drag(page, '.deck-dice[data-slot="0"]', '.board-cell[data-index="0"]');
  await page.locator('.deck-dice[data-slot="0"]').click();
  const picker = page.locator('#dice-picker');
  await expect(picker).toBeVisible();

  // 把第 0 格捲到導覽列與網格之間露出來的那一段（桌機 1280×720 預設整個骰盤都在網格底下）。
  await exposeAbovePicker(page, '.board-cell[data-index="0"]');
  const cell = page.locator('.board-cell[data-index="0"]');
  const exposed = await cell.evaluate(el => {
    const r = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
  });
  expect(exposed, '前提：第 0 格的中心沒有被挑選網格或導覽列蓋住').toBe(true);

  await cell.click();
  await expect(picker).toBeVisible();
  await expect(page.locator('#dice-card'), '挑選網格開著時卡片不可以同時開著').toBeHidden();
});

test('B17b. 開卡片的觸發點：格↔格交換之後不開卡片；門檻內放在格縫裡仍是點一下（不移除骰子）', async ({ page }) => {
  // 守 endDrag() 那段提早 return 的兩個性質，兩半各自對應一種改壞法：
  // (a) 改成綁 click：拖曳結束後 setPointerCapture 把 click 導回來源格（第 1 格），而交換之後那一格
  //     正好有骰子，卡片就會被打開。
  // (b) 把提早 return 挪到 cellUnder() 之後：門檻內的位移落在 4px 格縫裡時 cellUnder() 回 null，
  //     走「拖到骰盤外＝移除」那一支，骰子被安靜地清掉（這個分支之前就是這樣）。
  await page.goto('/board');
  await pickInto(page, 0, dice[0]!.id, 2);
  await pickInto(page, 1, dice[1]!.id, 5);
  await drag(page, '.deck-dice[data-slot="0"]', '.board-cell[data-index="0"]');
  await drag(page, '.deck-dice[data-slot="1"]', '.board-cell[data-index="1"]');

  // (a) 真滑鼠拖曳 1 → 0，**按在格子自己的內距上**（左上角內縮 6px，不是圖示）。
  // ⚠️ 不可以用 drag() 從格子中心起手：中心按到的是 <img>，endDrag() 的 renderBoard() 把它拆掉之後
  // Chromium 根本不送 click（2026-09-19 插樁實測：pointerdown→IMG、pointerup→board-cell[1]、沒有 click），
  // 綁 click 的實作也照樣全綠。按在內距上，pointerdown 的目標是格子本身（交換後仍在 DOM 裡），
  // 就會收到被 setPointerCapture 導回第 1 格的那發 click（實測 click→board-cell[1]）。
  const c1 = (await page.locator('.board-cell[data-index="1"]').boundingBox())!;
  const c0 = (await page.locator('.board-cell[data-index="0"]').boundingBox())!;
  const pressedOnCell = await page.evaluate(([px, py]) => {
    const el = document.elementFromPoint(px!, py!);
    return el?.matches('.board-cell[data-index="1"]') ?? false;
  }, [c1.x + 6, c1.y + 6]);
  expect(pressedOnCell, '前提：按下的點是第 1 格本身，不是它裡面的圖示或骰點').toBe(true);
  await page.mouse.move(c1.x + 6, c1.y + 6);
  await page.mouse.down();
  await page.mouse.move(c0.x + c0.width / 2, c0.y + c0.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('.board-cell[data-index="1"] img')).toHaveAttribute('src', boardIconSrc(dice[0]!.id));
  await expect(page.locator('#dice-card'), '交換之後不開卡片').toBeHidden();
  await expect(page.locator('.board-cell[aria-describedby]')).toHaveCount(0);

  // (b) 在第 0 格右緣內 1px 按下，往右 3px（< 5px 門檻）進到格縫，放開。
  const b0 = (await page.locator('.board-cell[data-index="0"]').boundingBox())!;
  const x = b0.x + b0.width - 1;
  const y = b0.y + b0.height / 2;
  const inGap = await page.evaluate(([px, py]) => document.elementFromPoint(px!, py!)?.closest('.board-cell') ?? null, [x + 3, y]);
  expect(inGap, '前提：放開的位置真的在格縫裡，不在任何格子上').toBeNull();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 3, y);
  await page.mouse.up();
  await expect(page.locator('.board-cell[data-index="0"] img'), '門檻內放在格縫裡不可以移除骰子').toBeVisible();
  await expect(page.locator('.board-cell[data-index="0"]')).toHaveAttribute('aria-describedby', 'dice-card');
});

test('B19b. 鍵盤 Enter 放下（交換）之後，卡片跟著焦點格的新內容重開', async ({ page }) => {
  // 放下會 renderBoard()（收掉卡片），而焦點本來就在目標格——focus() 不會再觸發 focusin，
  // 所以 held 放下那一段要自己 syncCardToFocus()。少了它，交換後卡片就消失、要再按一次方向鍵才回來。
  await page.goto('/board');
  const a = dice[0]!;
  const b = dice[1]!;
  await pickInto(page, 0, a.id, 2);
  await pickInto(page, 1, b.id, 4);
  await drag(page, '.deck-dice[data-slot="0"]', '.board-cell[data-index="0"]');
  await drag(page, '.deck-dice[data-slot="1"]', '.board-cell[data-index="1"]');

  await page.locator('.board-cell[data-index="2"]').focus();
  await page.keyboard.press('ArrowLeft'); // 第 1 格，骰子 B
  const card = page.locator('#dice-card');
  await expect(card.locator('.dice-card-title')).toHaveText(`${b.name} · 4 骰點 · 強化 Lv.1`);
  await page.keyboard.press('Enter'); // 拿起 B
  await page.keyboard.press('ArrowLeft'); // 第 0 格，骰子 A
  await expect(card.locator('.dice-card-title')).toHaveText(`${a.name} · 2 骰點 · 強化 Lv.1`);
  await page.keyboard.press('Enter'); // 放下＝交換，第 0 格現在是 B
  await expect(page.locator('.board-cell[data-index="0"]')).toBeFocused();
  await expect(card, '放下之後卡片要跟著焦點格重開').toBeVisible();
  await expect(card.locator('.dice-card-title')).toHaveText(`${b.name} · 4 骰點 · 強化 Lv.1`);
});

test('B15e. 組合列已經沒有這種骰子了，骰盤上留下的那顆仍然帶著最後的強化 Lv', async ({ page }) => {
  // spLevels 以骰子種類為鍵、換槽不清（見 src/scripts/board.ts 的說明）：組合列換掉之後，
  // 骰盤上的舊骰子是「孤兒」，它的卡片仍要算 Lv.5，不可以因為找不到所在的槽就回到 Lv.1。
  await page.goto('/board');
  const fire = dice[0]!;
  const other = dice[1]!;
  await pickInto(page, 0, fire.id, 1);
  for (let i = 1; i < 5; i++) await page.locator('.sp-inc[data-slot="0"]').click();
  await expect(page.locator('.sp-value[data-slot="0"]')).toHaveText('Lv.5');
  await drag(page, '.deck-dice[data-slot="0"]', '.board-cell[data-index="6"]');

  // 唯一的那一槽換成別顆：火骰子從此不在任何一槽。
  await pickInto(page, 0, other.id, 1);
  await expect(page.locator('.sp-value[data-slot="0"]')).toHaveText('Lv.1');

  await page.locator('.board-cell[data-index="6"]').click();
  await expect(page.locator('#dice-card .dice-card-title')).toHaveText(`${fire.name} · 1 骰點 · 強化 Lv.5`);
});

test('B23. 局外加成切換在「我的隊伍」標題下、隊伍列正上方；三顆按鈕與群組名稱', async ({ page, isMobile }) => {
  await page.goto('/board');
  const group = page.locator('#offgame-mode');
  await expect(group).toHaveAttribute('role', 'group');
  await expect(group).toHaveAttribute('aria-label', '局外加成');
  await expect(group.locator('button[data-mode]')).toHaveText(['不含', '我的 /sim', '全滿']);
  const g = (await group.boundingBox())!;
  const deck = (await page.locator('#deck-row').boundingBox())!;
  expect(g.y + g.height, '切換要在隊伍列上方').toBeLessThanOrEqual(deck.y);
  if (isMobile) {
    // 手機：「我的隊伍」小標不顯示，隊伍區整塊沉到骰盤下方，切換跟著一起。
    const grid = (await page.locator('#board-grid').boundingBox())!;
    expect(g.y, '手機：切換在骰盤下方').toBeGreaterThanOrEqual(grid.y + grid.height);
  } else {
    const h2 = (await page.locator('.board-h2').first().boundingBox())!;
    expect(g.y, '切換要在「我的隊伍」標題下方').toBeGreaterThanOrEqual(h2.y + h2.height);
  }
});

test('B24. 明細面板：寬桌機在骰盤右側且骰盤仍以 main 置中；窄視窗在工具列下方；手機在頁面最底', async ({ page, isMobile }) => {
  await page.goto('/board');
  const panel = page.locator('#dice-detail');
  await expect(panel).toHaveAttribute('aria-label', '加成明細');
  await expect(panel.locator('.detail-h')).toHaveText('加成明細');
  await expect(panel.locator('.detail-empty')).toHaveText('點骰盤上的骰子看加成來源');
  await expect(panel.locator('.detail-body')).toBeHidden();
  const box = async (sel: string) => (await page.locator(sel).boundingBox())!;

  if (isMobile) {
    const p = await box('#dice-detail');
    for (const sel of ['#board-grid', '#deck-row', '#board-tools']) {
      const b = await box(sel);
      expect(p.y, `手機：面板要排在 ${sel} 之後`).toBeGreaterThanOrEqual(b.y + b.height);
    }
    return;
  }

  // Desktop Chrome 預設 1280 寬：三欄，面板在骰盤右邊、跟骰盤同一段高度。
  const p = await box('#dice-detail');
  const grid = await box('#board-grid');
  expect(p.x, '面板在骰盤右側').toBeGreaterThanOrEqual(grid.x + grid.width);
  expect(p.y, '面板跟骰盤並排').toBeLessThan(grid.y + grid.height);
  const main = await box('main');
  const left = grid.x - main.x;
  const right = main.x + main.width - (grid.x + grid.width);
  expect(Math.abs(left - right), `骰盤仍以 <main> 置中（${left} / ${right}）`).toBeLessThanOrEqual(2);

  // 窄視窗的桌機：一般區塊，面板在工具列正下方。
  await page.setViewportSize({ width: 900, height: 800 });
  const p2 = await box('#dice-detail');
  const tools = await box('#board-tools');
  expect(p2.y, '窄視窗：面板在工具列下方').toBeGreaterThanOrEqual(tools.y + tools.height);
});

/**
 * 一份真實的 /sim 存檔：從起始骰子一路解到 1201（子彈傷害%增加）與 1102（所有骰子傷害），兩顆練到 Lv.50；
 * 路徑上順帶解開 1006（光骰子）與 1109（所有骰子傷害，Lv.1）。用 src/lib/sim.ts 的 pathTo() 產生後照抄——
 * 骰子樹改版讓這條路徑不成立時，deserializeSim() 會修掉它，B26 會紅，那是要重產這份存檔的訊號。
 */
const SIM_SAVE = JSON.stringify({ v: 1, unlocked: ['1006', '1102', '1109', '1201'], levels: { '1102': 50, '1201': 50 }, initial: [] });

async function withSave(page: import('@playwright/test').Page, text: string): Promise<void> {
  await page.addInitScript(t => { localStorage.setItem('rd2-sim-v1', t); }, text);
}

const modeBtn = (page: import('@playwright/test').Page, mode: string) =>
  page.locator(`#offgame-mode button[data-mode="${mode}"]`);

/** 火骰子 7 骰點放在第 6 格，點開它的卡片。 */
async function openFire7(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/board');
  await pickInto(page, 0, dice[0]!.id, 7);
  await drag(page, '.deck-dice[data-slot="0"]', '.board-cell[data-index="6"]');
  await page.locator('.board-cell[data-index="6"]').click();
  await expect(page.locator('#dice-card')).toBeVisible();
}

test('B25. 沒有 /sim 存檔：預設「不含」、「我的 /sim」停用並提示；卡片跟一期一樣沒有括號', async ({ page }) => {
  await openFire7(page);
  await expect(modeBtn(page, 'none')).toHaveAttribute('aria-pressed', 'true');
  await expect(modeBtn(page, 'sim')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('#offgame-nosave')).toBeVisible();
  await expect(page.locator('#offgame-nosave a')).toHaveAttribute('href', '/sim');
  await expect(cardValue(page, '攻擊力')).toHaveText('750');
  await expect(page.locator('#dice-card .bonus')).toHaveCount(0);
  await expect(page.locator('#dice-card dt.bullet')).toHaveCount(0);
  await expect(page.locator('#dice-card .dice-card-note')).toHaveText('未含骰子樹（符文／被動）加成');

  // 按停用的「我的 /sim」：不切換、播報原因、卡片不收。
  // ⚠️ 這顆按鈕刻意用 aria-disabled 不用 disabled（board.astro 的理由：保留在 Tab 順序讓鍵盤使用者
  // 看得到它為什麼不能按）。Playwright ≥1.36 的 actionability 檢查把 aria-disabled="true" 當成
  // 「not enabled」，一般 .click() 會一路等到逾時；用 force 繞過那層檢查，這裡要驗的正是「原生 click
  // 事件送達時 handler 怎麼處理」，不是「使用者能不能用滑鼠點到它」（那是別的斷言在守）。
  await modeBtn(page, 'sim').click({ force: true });
  await expect(modeBtn(page, 'none')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#board-live')).toHaveText('沒有找到 /sim 的存檔');
  await expect(page.locator('#dice-card')).toBeVisible();

  // 鍵盤路徑：選 aria-disabled 不用 disabled 的理由就是它還在 Tab 順序裡、按 Enter 聽得到原因。
  // 先清掉 live region，確定下面那句播報真的是這次 Enter 觸發的，不是上面那一下留下來的。
  await page.locator('#board-live').evaluate(el => { el.textContent = ''; });
  await modeBtn(page, 'sim').focus();
  await expect(modeBtn(page, 'sim')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(modeBtn(page, 'none')).toHaveAttribute('aria-pressed', 'true');
  await expect(modeBtn(page, 'sim')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#board-live')).toHaveText('沒有找到 /sim 的存檔');
});

test('B26. 讀得到 /sim 存檔：預設「我的 /sim」，攻擊力照遊戲面板格式、多一行子彈實際，明細面板列出來源', async ({ page }) => {
  await withSave(page, SIM_SAVE);
  await openFire7(page);
  await expect(modeBtn(page, 'sim')).toHaveAttribute('aria-pressed', 'true');
  await expect(modeBtn(page, 'sim')).not.toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('#offgame-nosave')).toBeHidden();
  await expect(cardValue(page, '攻擊力')).toHaveText('750 (+554)');
  await expect(cardValue(page, '子彈實際')).toHaveText('4121');
  await expect(cardValue(page, '攻擊速度')).toHaveText('0.143 秒/次');
  await expect(page.locator('#dice-card .dice-card-note')).toHaveText('局外加成：我的 /sim 存檔');
  expect((await page.locator('#dice-card dt').allTextContents()).slice(0, 2), '子彈實際緊接在攻擊力下面')
    .toEqual(['攻擊力', '子彈實際']);

  const detail = page.locator('#dice-detail');
  await expect(detail.locator('.detail-empty')).toBeHidden();
  await expect(detail.locator('.detail-title')).toHaveText('火骰子 · 7 骰點 · 強化 Lv.1');
  await expect(detail.locator('.detail-offgame li')).toHaveText(['所有骰子傷害 ×2：攻擊 +73.8%', '子彈傷害%增加 Lv.50：子彈 ×3.16']);
  await expect(detail.locator('.detail-mechanic')).toBeHidden();
  await expect(detail.locator('.detail-nothing')).toBeHidden();
});

test('B27. 切「全滿」：卡片不收、數字即時更新並播報；切回「不含」回到一期的數字', async ({ page }) => {
  await withSave(page, SIM_SAVE);
  await openFire7(page);
  await modeBtn(page, 'max').click();
  await expect(page.locator('#dice-card')).toBeVisible();
  await expect(modeBtn(page, 'max')).toHaveAttribute('aria-pressed', 'true');
  await expect(modeBtn(page, 'sim')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#board-live')).toHaveText('局外加成：全滿');
  await expect(cardValue(page, '攻擊力')).toHaveText('750 (+8588)');
  await expect(cardValue(page, '子彈實際')).toHaveText('29509');
  await expect(cardValue(page, '攻擊速度')).toHaveText('0.143 秒/次 (−0.04)');
  await expect(page.locator('#dice-card .dice-card-note')).toHaveText('局外加成：全部練滿');

  const offgame = page.locator('#dice-detail .detail-offgame');
  for (const line of [
    '所有骰子傷害 ×15：攻擊 +1026%', '自然骰子傷害 ×2：攻擊 +119%', '自然骰子攻擊速度 ×2：攻速 +38.5%',
    '自然骰子暴擊率 Lv.10：暴擊率 +4.55%', '子彈傷害%增加 Lv.50：子彈 ×3.16',
  ]) await expect(offgame).toContainText(line);
  await expect(page.locator('#dice-detail .detail-mechanic li')).toHaveText([
    '火焰射程增加：範圍傷害套用範圍大幅增加',
    '獲得燙傷：基本攻擊擊中時，賦予燙傷 7骰點為2倍的燙傷傷害',
  ]);

  await modeBtn(page, 'none').click();
  await expect(cardValue(page, '攻擊力')).toHaveText('750');
  await expect(page.locator('#dice-card dt.bullet')).toHaveCount(0);
  await expect(page.locator('#dice-detail .detail-nothing')).toHaveText('局外加成設為「不含」');
  await expect(page.locator('#dice-detail .detail-offgame')).toBeHidden();
});

test('B28. 鍵盤：卡片開著時焦點移到局外加成切換，卡片不收；Enter 切換後即時重算', async ({ page }) => {
  await withSave(page, SIM_SAVE);
  await page.goto('/board');
  await pickInto(page, 0, dice[0]!.id, 7);
  await drag(page, '.deck-dice[data-slot="0"]', '.board-cell[data-index="6"]');
  await page.locator('.board-cell[data-index="5"]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#dice-card')).toBeVisible();
  await modeBtn(page, 'max').focus();
  await expect(page.locator('#dice-card'), '焦點移到切換鈕，卡片不收').toBeVisible();
  await page.keyboard.press('Enter');
  await expect(cardValue(page, '攻擊力')).toHaveText('750 (+8588)');
  await expect(page.locator('#dice-card')).toBeVisible();
});

test('B29. 存檔壞掉：當作沒有存檔，頁面照常運作', async ({ page }) => {
  await withSave(page, '{壞掉的 JSON');
  await openFire7(page);
  await expect(modeBtn(page, 'none')).toHaveAttribute('aria-pressed', 'true');
  await expect(modeBtn(page, 'sim')).toHaveAttribute('aria-disabled', 'true');
  await expect(cardValue(page, '攻擊力')).toHaveText('750');
});

test('B29b. localStorage 一讀就丟例外（無痕模式、關掉網站資料）：沒有未捕捉的例外，照常運作', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException('blocked', 'SecurityError'); };
  });
  await openFire7(page);
  await expect(modeBtn(page, 'sim')).toHaveAttribute('aria-disabled', 'true');
  await expect(cardValue(page, '攻擊力')).toHaveText('750');
  expect(errors).toEqual([]);
});

test('B30. 明細面板：卡片收起後保留最後那顆；改強化 Lv 跟著更新；那顆被移走就回到空狀態', async ({ page }) => {
  await withSave(page, SIM_SAVE);
  await openFire7(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('#dice-card')).toBeHidden();
  const title = page.locator('#dice-detail .detail-title');
  await expect(title).toHaveText('火骰子 · 7 骰點 · 強化 Lv.1');
  await page.locator('.sp-inc[data-slot="0"]').click();
  await expect(title).toHaveText('火骰子 · 7 骰點 · 強化 Lv.2');
  await drag(page, '.board-cell[data-index="6"]', '.board-cell[data-index="7"]');
  await expect(page.locator('#dice-detail .detail-empty')).toBeVisible();
  await expect(page.locator('#dice-detail .detail-body')).toBeHidden();
});

test('B31. 條件式加成不顯示：冰骰子全滿時明細沒有「冰凍增幅」，機制符文照列', async ({ page }) => {
  await page.goto('/board');
  await pickInto(page, 0, '1007', 1);
  await drag(page, '.deck-dice[data-slot="0"]', '.board-cell[data-index="0"]');
  await page.locator('.board-cell[data-index="0"]').click();
  await modeBtn(page, 'max').click();
  await expect(page.locator('#dice-detail .detail-body')).toBeVisible();
  await expect(page.locator('#dice-detail .detail-offgame')).not.toContainText('冰凍增幅');
  await expect(page.locator('#dice-detail .detail-mechanic'))
    .toContainText('週期性暴風雪：每5秒根據冰骰子總骰點等比產生暴風雪，對冰凍怪物造成基本攻擊力相當傷害');
});

test('B32. 寬桌機：全滿時明細再長，面板也不超出右欄（sticky 才黏得住），工具列不動', async ({ page, isMobile }) => {
  test.skip(isMobile, '三欄版面只在寬桌機（滑鼠、68rem 以上）');
  // 巨石骰子（1004）全滿時的明細是最長的幾顆之一：盒子若比 #dice-detail 高，sticky 黏不住，
  // 往下捲時標題會捲到導覽列底下。
  await page.goto('/board');
  await pickInto(page, 0, '1004', 1);
  await drag(page, '.deck-dice[data-slot="0"]', '.board-cell[data-index="0"]');
  await page.locator('.board-cell[data-index="0"]').click();
  await expect(page.locator('#dice-detail .detail-body')).toBeVisible();
  // 頁面座標（加上捲動量）：點格子、點切換鈕時 Playwright 可能會先捲動。
  const pageY = (sel: string) => page.locator(sel).evaluate(el => {
    const r = el.getBoundingClientRect();
    return { top: r.top + scrollY, bottom: r.bottom + scrollY };
  });
  const toolsNone = await pageY('#board-tools');

  await modeBtn(page, 'max').click();
  await expect(page.locator('#dice-detail .detail-offgame')).toBeVisible();
  const box = await pageY('#dice-detail .detail-box');
  const panel = await pageY('#dice-detail');
  expect(box.bottom, `明細盒（底 ${box.bottom}）超出面板（底 ${panel.bottom}）`).toBeLessThanOrEqual(panel.bottom + 0.5);
  const toolsMax = await pageY('#board-tools');
  expect(Math.abs(toolsMax.top - toolsNone.top), '切到全滿，工具列被推動').toBeLessThanOrEqual(0.5);
});

test('B33. 頁面開著時 /sim 存了檔（兩個分頁、或 bfcache 回上一頁）：「我的 /sim」跟著可用，但不自動切過去', async ({ page, context }) => {
  // A 頁：沒有存檔。
  await page.goto('/board');
  await expect(modeBtn(page, 'sim')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('#offgame-nosave')).toBeVisible();

  // B 頁（同一個 context＝同一份 localStorage）替 /sim 寫入存檔 → A 頁收到 storage 事件。
  const other = await context.newPage();
  await other.goto('/board');
  await other.evaluate(t => { localStorage.setItem('rd2-sim-v1', t); }, SIM_SAVE);

  await expect(modeBtn(page, 'sim')).not.toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('#offgame-nosave')).toBeHidden();
  await expect(modeBtn(page, 'none'), '不自動切到「我的 /sim」').toHaveAttribute('aria-pressed', 'true');
  await expect(modeBtn(page, 'sim')).toHaveAttribute('aria-pressed', 'false');
});

test('B34. /board 永遠不寫 localStorage：挑骰、拖曳、開卡片、三種模式、改強化 Lv 都不寫', async ({ page }) => {
  // ⚠️ Playwright 不保證多支 addInitScript 的執行順序，所以「帶存檔進頁面」與「包計數」寫在同一支裡：
  // 先用原本的 setItem 寫存檔、再包一層——計數只看得到之後的呼叫，也就是 /board 自己的腳本。
  // 只數 localStorage（this === localStorage）：sessionStorage 不在這條約束裡。
  await page.addInitScript(save => {
    localStorage.setItem('rd2-sim-v1', save);
    const w = window as unknown as { __lsWrites: string[] };
    w.__lsWrites = [];
    for (const name of ['setItem', 'removeItem', 'clear'] as const) {
      const orig = Storage.prototype[name] as (...a: unknown[]) => unknown;
      (Storage.prototype as unknown as Record<string, unknown>)[name] = function (this: Storage, ...args: unknown[]) {
        if (this === window.localStorage) w.__lsWrites.push(`${name}(${args.map(String).join(', ')})`);
        return orig.apply(this, args);
      };
    }
  }, SIM_SAVE);
  await openFire7(page);
  await expect(modeBtn(page, 'sim'), '存檔真的有帶進來').toHaveAttribute('aria-pressed', 'true');
  for (const mode of ['none', 'sim', 'max']) {
    await modeBtn(page, mode).click();
    await expect(modeBtn(page, mode)).toHaveAttribute('aria-pressed', 'true');
  }
  await page.locator('.sp-inc[data-slot="0"]').click();
  await expect(page.locator('#dice-card .dice-card-title')).toHaveText('火骰子 · 7 骰點 · 強化 Lv.2');
  // 盤面加成的角標（2b）也不寫。
  await pickInto(page, 1, ALIGN, 3);
  await drag(page, '.deck-dice[data-slot="1"]', '.board-cell[data-index="7"]');
  await pressBadge(page, 7);
  await expect(badge(page, 7)).toHaveText('↑');
  expect(await page.evaluate(() => (window as unknown as { __lsWrites: string[] }).__lsWrites)).toEqual([]);
});

// ── 盤面加成的角標（2b，2026-09-19）───────────────────────────────────────
// 7 骰點以下的排序骰子（方向）與齒輪二階（種類）在格子左上角有一個角標：點一下（或格子有焦點時按 R）循環。
// 判定跟開卡片同一條路：endDrag() 裡「從格子起手、沒超過門檻」，按下的點在角標上＝循環、不開卡片。

const ALIGN = '4007';
const GEAR2 = '2503';
const LIGHT = '1006';

/** 第 i 格的角標。 */
function badge(page: import('@playwright/test').Page, i: number) {
  return page.locator(`.board-cell[data-index="${i}"] .cell-badge`);
}

/**
 * 在第 i 格的角標中心原地按下放開。⚠️ 先確認那個點真的是角標本身（B17b 的教訓：按到的元素不對，
 * 測到的就不是這條路徑）；這裡用的是原始滑鼠座標，所以先把角標捲進視窗。
 */
async function pressBadge(page: import('@playwright/test').Page, i: number): Promise<void> {
  await badge(page, i).scrollIntoViewIfNeeded();
  const b = (await badge(page, i).boundingBox())!;
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  const onBadge = await page.evaluate(([px, py]) => document.elementFromPoint(px!, py!)?.matches('.cell-badge') ?? false, [x, y]);
  expect(onBadge, `前提：第 ${i} 格角標的中心點按到的是角標本身`).toBe(true);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
}

/** 挑選網格（貼著視窗底部的 fixed 浮層）開著時，把 sel 捲到導覽列與網格之間露出來的那一段（同 B22c）。 */
async function exposeAbovePicker(page: import('@playwright/test').Page, sel: string): Promise<void> {
  await page.evaluate(s => {
    const navBottom = document.getElementById('site-nav')!.getBoundingClientRect().bottom;
    const pickerTop = document.getElementById('dice-picker')!.getBoundingClientRect().top;
    const r = document.querySelector(s)!.getBoundingClientRect();
    window.scrollBy(0, r.top + r.height / 2 - (navBottom + pickerTop) / 2);
  }, sel);
}

test('B35. 角標只在 7 骰點以下的排序／齒輪二階上；點角標循環並播報、不開卡片，點格子其他地方照舊開卡片', async ({ page }) => {
  await page.goto('/board');
  await pickInto(page, 0, ALIGN, 3);
  await pickInto(page, 1, GEAR2, 2);
  await pickInto(page, 2, ALIGN, 7);
  await pickInto(page, 3, dice[0]!.id, 3);
  await drag(page, '.deck-dice[data-slot="0"]', '.board-cell[data-index="7"]');
  await drag(page, '.deck-dice[data-slot="1"]', '.board-cell[data-index="5"]');
  await drag(page, '.deck-dice[data-slot="2"]', '.board-cell[data-index="8"]');
  await drag(page, '.deck-dice[data-slot="3"]', '.board-cell[data-index="9"]');

  await expect(badge(page, 7)).toHaveText('?');
  await expect(badge(page, 5)).toHaveText('?');
  await expect(badge(page, 8), '7 骰點的排序四向全開，不需要角標').toHaveCount(0);
  await expect(badge(page, 9), '別種骰子沒有角標').toHaveCount(0);
  const cell7 = page.locator('.board-cell[data-index="7"]');
  await expect(cell7).toHaveAttribute('aria-label', '第 2 列第 3 格，排序骰子 3 骰點，方向未指定，按 R 切換');

  for (const glyph of ['↑', '→', '↓', '←', '?']) {
    await pressBadge(page, 7);
    await expect(badge(page, 7)).toHaveText(glyph);
  }
  await expect(page.locator('#dice-card'), '點角標不開卡片').toBeHidden();
  await pressBadge(page, 7);
  await expect(page.locator('#board-live')).toHaveText('排序改為朝上');
  await expect(cell7).toHaveAttribute('aria-label', '第 2 列第 3 格，排序骰子 3 骰點，方向朝上，按 R 切換');

  for (const glyph of ['強', '動', '變', '?']) {
    await pressBadge(page, 5);
    await expect(badge(page, 5)).toHaveText(glyph);
  }
  await pressBadge(page, 5);
  await expect(page.locator('#board-live')).toHaveText('齒輪二階改為強化齒輪');
  await expect(page.locator('.board-cell[data-index="5"]')).toHaveAttribute('aria-label', '第 2 列第 1 格，齒輪二階骰子 2 骰點，種類：強化齒輪，按 R 切換');

  // 點格子其他地方（中心，圖示上）：照舊開卡片，角標不動。
  await cell7.click();
  await expect(page.locator('#dice-card')).toBeVisible();
  await expect(page.locator('#dice-card .dice-card-title')).toHaveText('排序骰子 · 3 骰點 · 強化 Lv.1');
  await expect(badge(page, 7)).toHaveText('↑');
});

test('B36. 從角標起手拖超過 5px 照舊是拖曳：骰子移過去、角標跟著走；放上別的骰子角標就清掉', async ({ page }) => {
  await page.goto('/board');
  await pickInto(page, 0, ALIGN, 3);
  await pickInto(page, 1, dice[0]!.id, 2);
  await drag(page, '.deck-dice[data-slot="0"]', '.board-cell[data-index="6"]');
  await drag(page, '.deck-dice[data-slot="1"]', '.board-cell[data-index="8"]');
  await pressBadge(page, 6);
  await pressBadge(page, 6);
  await expect(badge(page, 6)).toHaveText('→');

  const b = (await badge(page, 6).boundingBox())!;
  const dst = (await page.locator('.board-cell[data-index="8"]').boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(dst.x + dst.width / 2, dst.y + dst.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(badge(page, 8), '交換後角標跟著排序骰子到第 8 格').toHaveText('→');
  await expect(badge(page, 6), '火骰子換到第 6 格，沒有角標').toHaveCount(0);
  await expect(page.locator('#dice-card')).toBeHidden();

  // 從組合列放一顆火骰子蓋掉第 8 格：角標消失；再放回排序＝新的一顆，回到「?」。
  await drag(page, '.deck-dice[data-slot="1"]', '.board-cell[data-index="8"]');
  await expect(badge(page, 8)).toHaveCount(0);
  await drag(page, '.deck-dice[data-slot="0"]', '.board-cell[data-index="8"]');
  await expect(badge(page, 8)).toHaveText('?');
});

test('B37. 鍵盤：格子有焦點時 R 切換角標並播報，卡片不收；Ctrl+R 不攔；沒有角標的格子 R 什麼都不做', async ({ page }) => {
  await page.goto('/board');
  await pickInto(page, 0, ALIGN, 2);
  await pickInto(page, 1, dice[0]!.id, 1);
  await drag(page, '.deck-dice[data-slot="0"]', '.board-cell[data-index="1"]');
  await drag(page, '.deck-dice[data-slot="1"]', '.board-cell[data-index="2"]');
  // 同 B19：先 focus 空格再按方向鍵，焦點才是 :focus-visible、卡片才會跟著開。
  await page.locator('.board-cell[data-index="0"]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#dice-card .dice-card-title')).toHaveText('排序骰子 · 2 骰點 · 強化 Lv.1');

  await page.keyboard.press('r');
  await expect(badge(page, 1)).toHaveText('↑');
  await expect(page.locator('#board-live')).toHaveText('排序改為朝上');
  await expect(page.locator('#dice-card'), 'R 切換角標，卡片不收').toBeVisible();
  await expect(page.locator('.board-cell[data-index="1"]')).toBeFocused();
  await page.keyboard.press('Shift+R');
  await expect(badge(page, 1)).toHaveText('→');

  // Ctrl+R 是重新整理：不能 preventDefault、也不能切換角標。用合成事件驗（真按下去頁面就重整了）。
  const prevented = await page.locator('.board-cell[data-index="1"]').evaluate(el =>
    !el.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', ctrlKey: true, bubbles: true, cancelable: true })));
  expect(prevented, 'Ctrl+R 被攔下了').toBe(false);
  await expect(badge(page, 1)).toHaveText('→');

  // 沒有角標的格子：R 不做事也不播報。
  await page.locator('#board-live').evaluate(el => { el.textContent = ''; });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('r');
  await expect(page.locator('#board-live')).toHaveText('');
});

test('B38. 跨路徑：鍵盤拿起中按 R、挑選網格開著點角標、別格的卡片開著點角標', async ({ page }) => {
  await page.goto('/board');
  await pickInto(page, 0, ALIGN, 3);
  await pickInto(page, 1, dice[0]!.id, 1);
  await drag(page, '.deck-dice[data-slot="0"]', '.board-cell[data-index="0"]');
  await drag(page, '.deck-dice[data-slot="1"]', '.board-cell[data-index="2"]');

  // (a) held：拿起排序 → R 切換 → 移到第 2 格放下（交換）→ 角標跟著到第 2 格。
  await page.locator('.board-cell[data-index="1"]').focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  await page.keyboard.press('r');
  await expect(badge(page, 0)).toHaveText('↑');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(badge(page, 2), '拿起後切換的方向跟著換過去').toHaveText('↑');
  await expect(badge(page, 0)).toHaveCount(0);

  // (b) 挑選網格開著：點角標照樣循環，網格不收、卡片不開。
  await page.locator('.deck-dice[data-slot="2"]').click();
  await expect(page.locator('#dice-picker')).toBeVisible();
  await exposeAbovePicker(page, '.board-cell[data-index="2"] .cell-badge');
  await pressBadge(page, 2);
  await expect(badge(page, 2)).toHaveText('→');
  await expect(page.locator('#dice-picker')).toBeVisible();
  await expect(page.locator('#dice-card')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('#dice-picker')).toBeHidden();

  // (c) 別格（火，現在在第 0 格）的卡片開著：點排序的角標，卡片留著、仍描述火那一格。
  await page.locator('.board-cell[data-index="0"]').click();
  await expect(page.locator('#dice-card')).toBeVisible();
  await pressBadge(page, 2);
  await expect(badge(page, 2)).toHaveText('↓');
  await expect(page.locator('#dice-card')).toBeVisible();
  await expect(page.locator('.board-cell[data-index="0"]')).toHaveAttribute('aria-describedby', 'dice-card');
});

test('B39. 角標完整落在格子裡、不壓到骰點（桌機與 320px）；頁面不橫向捲', async ({ page, isMobile }) => {
  await page.goto('/board');
  if (isMobile) await page.setViewportSize({ width: 320, height: 640 });
  await pickInto(page, 0, ALIGN, 6);
  await drag(page, '.deck-dice[data-slot="0"]', '.board-cell[data-index="4"]');
  const cell = (await page.locator('.board-cell[data-index="4"]').boundingBox())!;
  const b = (await badge(page, 4).boundingBox())!;
  const pips = (await page.locator('.board-cell[data-index="4"] .cell-pips').boundingBox())!;
  expect(b.x, '角標超出格子左緣').toBeGreaterThanOrEqual(cell.x);
  expect(b.y, '角標超出格子上緣').toBeGreaterThanOrEqual(cell.y);
  expect(b.x + b.width, '角標超出格子右緣').toBeLessThanOrEqual(cell.x + cell.width);
  expect(b.y + b.height, '角標超出格子下緣').toBeLessThanOrEqual(cell.y + cell.height);
  const overlap = b.x < pips.x + pips.width && pips.x < b.x + b.width && b.y < pips.y + pips.height && pips.y < b.y + b.height;
  expect(overlap, '角標壓到骰點').toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), '頁面橫向捲').toBe(true);
});

test('B40. 盤面加成進卡片：光照到的火骰子攻速多一個括號、明細列出來源、來源與目標格高亮；「不含」也算（擺位是局內）', async ({ page }) => {
  await page.goto('/board');
  await pickInto(page, 0, dice[0]!.id, 7);
  await pickInto(page, 1, LIGHT, 1);
  await drag(page, '.deck-dice[data-slot="0"]', '.board-cell[data-index="6"]');
  await drag(page, '.deck-dice[data-slot="1"]', '.board-cell[data-index="7"]');
  await expect(modeBtn(page, 'none')).toHaveAttribute('aria-pressed', 'true');

  await page.locator('.board-cell[data-index="6"]').click();
  await expect(cardValue(page, '攻擊速度')).toHaveText('0.143 秒/次 (−0.008)');
  await expect(page.locator('#dice-card .dice-card-note')).toHaveText('未含骰子樹（符文／被動）加成；含盤面加成');
  await expect(page.locator('#dice-detail .detail-board-h')).toBeVisible();
  await expect(page.locator('#dice-detail .detail-board li')).toHaveText(['鄰格光 ×1：攻速 +6%']);
  await expect(page.locator('.board-cell.buff-src')).toHaveCount(1);
  await expect(page.locator('.board-cell[data-index="7"]')).toHaveClass(/\bbuff-src\b/);
  await expect(page.locator('.board-cell.buff-dst')).toHaveCount(0);

  // 開光：它照到的火骰子是目標；光自己沒有盤面加成 → 盤面區塊不顯示、註記沒有後綴。
  await page.locator('.board-cell[data-index="7"]').click();
  await expect(page.locator('.board-cell.buff-dst')).toHaveCount(1);
  await expect(page.locator('.board-cell[data-index="6"]')).toHaveClass(/\bbuff-dst\b/);
  await expect(page.locator('.board-cell.buff-src')).toHaveCount(0);
  await expect(page.locator('#dice-detail .detail-board')).toBeHidden();
  await expect(page.locator('#dice-detail .detail-board-h')).toBeHidden();
  await expect(page.locator('#dice-card .dice-card-note')).toHaveText('未含骰子樹（符文／被動）加成');

  // 卡片收起：高亮清掉。
  await page.keyboard.press('Escape');
  await expect(page.locator('#dice-card')).toBeHidden();
  await expect(page.locator('.board-cell.buff-src, .board-cell.buff-dst')).toHaveCount(0);

  // 全滿：光那一列帶上 1206（20.8%），火自己的自然系攻速 38.5% 也進來 → (−0.064)。
  await modeBtn(page, 'max').click();
  await page.locator('.board-cell[data-index="6"]').click();
  await expect(cardValue(page, '攻擊速度')).toHaveText('0.143 秒/次 (−0.064)');
  await expect(page.locator('#dice-detail .detail-board li')).toHaveText(['鄰格光 ×1：攻速 +20.8%']);
});

test('B41. 切換角標時卡片不收、數字即時變：排序朝右照到火骰子 → 150 (+30)；方向未指定時明細有提示；卡片收起後明細仍跟著變', async ({ page }) => {
  await page.goto('/board');
  await pickInto(page, 0, ALIGN, 1);
  await pickInto(page, 1, dice[0]!.id, 1);
  await drag(page, '.deck-dice[data-slot="0"]', '.board-cell[data-index="0"]');
  await drag(page, '.deck-dice[data-slot="1"]', '.board-cell[data-index="2"]');

  await page.locator('.board-cell[data-index="0"]').click();
  await expect(page.locator('#dice-detail .detail-board li')).toHaveText(['方向未指定，點左上角標切換']);

  await page.locator('.board-cell[data-index="2"]').click();
  await expect(cardValue(page, '攻擊力')).toHaveText('150');
  await pressBadge(page, 0); // ↑
  await pressBadge(page, 0); // →
  await expect(page.locator('#dice-card'), '切換角標卡片不收').toBeVisible();
  await expect(cardValue(page, '攻擊力')).toHaveText('150 (+30)');
  await expect(page.locator('#dice-detail .detail-board li')).toHaveText(['排序（第 1 列第 1 格 →）：攻擊 +20%']);
  await expect(page.locator('.board-cell[data-index="0"]')).toHaveClass(/\bbuff-src\b/);

  await pressBadge(page, 0); // ↓：射線離開火骰子
  await expect(cardValue(page, '攻擊力')).toHaveText('150');
  await expect(page.locator('#dice-detail .detail-board')).toBeHidden();
  await expect(page.locator('.board-cell.buff-src')).toHaveCount(0);

  for (let k = 0; k < 4; k++) await pressBadge(page, 0); // ← ? ↑ →
  await expect(badge(page, 0)).toHaveText('→');
  await page.keyboard.press('Escape');
  await expect(page.locator('#dice-card')).toBeHidden();
  await expect(page.locator('#dice-detail .detail-board li')).toHaveText(['排序（第 1 列第 1 格 →）：攻擊 +20%']);
  await pressBadge(page, 0); // ↓
  await expect(page.locator('#dice-detail .detail-title')).toHaveText('火骰子 · 1 骰點 · 強化 Lv.1');
  await expect(page.locator('#dice-detail .detail-board')).toBeHidden();
});

test('B42. 齒輪二階：同群組的變速齒輪加攻速——群組裡另一顆 1.3 秒/次 (−0.062)，它自己還是「?」', async ({ page }) => {
  await page.goto('/board');
  await pickInto(page, 0, GEAR2, 1);
  await drag(page, '.deck-dice[data-slot="0"]', '.board-cell[data-index="0"]');
  await drag(page, '.deck-dice[data-slot="0"]', '.board-cell[data-index="1"]');
  for (const glyph of ['強', '動', '變']) {
    await pressBadge(page, 0);
    await expect(badge(page, 0)).toHaveText(glyph);
  }
  await page.locator('.board-cell[data-index="1"]').click();
  await expect(cardValue(page, '攻擊速度')).toHaveText('1.3 秒/次 (−0.062)');
  await expect(page.locator('#dice-detail .detail-board li')).toHaveText(['齒輪二階變速 ×1：攻速 +5%', '種類未指定，點左上角標切換']);
});

test('B43. 改施加者的強化 Lv，被加成那顆的卡片即時重算（光 Lv.2 → 7%）', async ({ page }) => {
  await page.goto('/board');
  await pickInto(page, 0, dice[0]!.id, 7);
  await pickInto(page, 1, LIGHT, 1);
  await drag(page, '.deck-dice[data-slot="0"]', '.board-cell[data-index="6"]');
  await drag(page, '.deck-dice[data-slot="1"]', '.board-cell[data-index="7"]');
  await page.locator('.board-cell[data-index="6"]').click();
  await expect(cardValue(page, '攻擊速度')).toHaveText('0.143 秒/次 (−0.008)');
  await page.locator('.sp-inc[data-slot="1"]').click();
  await expect(page.locator('#dice-card')).toBeVisible();
  await expect(cardValue(page, '攻擊速度')).toHaveText('0.143 秒/次 (−0.009)');
  await expect(page.locator('#dice-detail .detail-board li')).toHaveText(['鄰格光 ×1：攻速 +7%']);
});

test('B44. 分享圖：設定過的角標畫在格子左上角，「?」不畫', async ({ page }) => {
  await page.goto('/board');
  await pickInto(page, 0, ALIGN, 3);
  await pickInto(page, 1, ALIGN, 7);

  const img = page.locator('#board-export-img');
  const r = badgeRect(0);
  const sample = () => img.evaluate((el: HTMLImageElement, box: typeof r) => {
    const c = document.createElement('canvas');
    c.width = el.naturalWidth;
    c.height = el.naturalHeight;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(el, 0, 0);
    return [...ctx.getImageData(box.x, box.y, box.w, box.h).data].join(',');
  }, r);
  let prevSrc: string | null = null;
  /** 產一張新圖，等它真的換上、載完。 */
  const exportImage = async (): Promise<void> => {
    await page.locator('#board-export').click();
    await expect.poll(() => img.getAttribute('src'), { timeout: EXPORT_TIMEOUT }).not.toBe(prevSrc);
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => (el.complete ? el.naturalWidth : 0)), { timeout: EXPORT_TIMEOUT }).toBe(1200);
    prevSrc = await img.getAttribute('src');
  };

  // 基準：7 骰點的排序四向全開、沒有角標——同一張圖示，角標那一塊只有格子底色與圖示的一角。
  await drag(page, '.deck-dice[data-slot="1"]', '.board-cell[data-index="0"]');
  await expect(badge(page, 0)).toHaveCount(0);
  await exportImage();
  const noBadge = await sample();

  // 換成 3 骰點、角標「?」：角標那一塊要跟基準一模一樣＝「?」沒有畫進分享圖。
  await drag(page, '.deck-dice[data-slot="0"]', '.board-cell[data-index="0"]');
  await expect(badge(page, 0)).toHaveText('?');
  await exportImage();
  expect(await sample(), '「?」被畫進分享圖了').toBe(noBadge);

  // 設成「→」：角標那一塊跟基準不同＝設定過的角標有畫。
  await pressBadge(page, 0);
  await pressBadge(page, 0);
  await expect(badge(page, 0)).toHaveText('→');
  await exportImage();
  const set = await sample();
  expect(set, '設定方向之後分享圖的角標位置沒有變化＝角標沒畫').not.toBe(noBadge);

  // 隱藏星數不影響角標（方向是擺位資訊）。
  await page.locator('#board-hide-pips').click();
  await exportImage();
  expect(await sample(), '隱藏星數把角標也藏掉了').toBe(set);
});
