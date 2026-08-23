// 骰子樹模擬器的端對端驗證。
//
// 這一頁跟 /dice 不同，內容不是給搜尋引擎索引的——價值全在「算得對不對」與「點得到」。
// 算術本身已經被 tests/lib/sim.test.ts 蓋掉了（純函式），所以這裡的重心是三件單元測試
// 碰不到的事：**點得到嗎**（setPointerCapture 會把 click 的 target 改標，第一版就是這樣
// 讓整頁點下去沒反應）、**畫面有沒有跟著狀態走**、**重整之後還在不在**。
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const tree = JSON.parse(
  readFileSync(new URL('../../src/generated/tree.json', import.meta.url), 'utf8'),
) as {
  nodes: { id: string; name: string; type: string; maxLevel: number; unlockVia: string; unlockCost: { core: number; gold: number }; unlockPaid?: true }[];
};

const NODE_COUNT = tree.nodes.length;
const FREE_IDS = tree.nodes.filter(n => n.unlockVia === 'default').map(n => n.id);
const OPTIONAL_IDS = tree.nodes
  .filter(n => n.unlockVia !== 'cost' && n.unlockVia !== 'default' && !n.unlockPaid)
  .map(n => n.id);

/**
 * 測試用的三顆節點，全部**初始狀態就可以直接解鎖**（前置只有起始骰子）——挑不對的話
 * 每條測試都得先「一鍵點亮」，測到的就不是自己要測的那件事了。
 *
 * - `READY`：1201 子彈傷害%增加（rune，金幣 2,000，前置 1001）
 * - `TIER_F`：1109 所有骰子傷害（passive，tier F ＝ maxLevel 100／解鎖 3,000，前置 1001）
 * - `WITH_KIDS`：2003 齒輪骰子（dice，核心 5，前置 2001；下游有 2002／2109／2203）
 */
const READY = '1201';
const TIER_F = '1109';
const WITH_KIDS = '2003';

async function openSim(page: Page): Promise<void> {
  await page.goto('/sim');
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('#tree g.node')).toHaveCount(NODE_COUNT);
}

/**
 * 畫布上可以安全點擊的矩形。
 *
 * ⚠️ **兩個方向都要算**：工具列與（手機版的）底部抽屜擋的是上下，而桌機的側欄擋的是右邊
 * ——第一版只算了上下，5201 剛好落在側欄底下，Playwright 點到的是 `<aside>`，症狀是
 * 「側欄一直停在空狀態」，看起來完全像程式沒接上點選。
 */
async function safeBox(page: Page): Promise<{ left: number; top: number; right: number; bottom: number }> {
  const top = await page.locator('#sim-toolbar').evaluate(e => e.getBoundingClientRect().bottom);
  const panel = await page.locator('#sim-panel').evaluate(e => e.getBoundingClientRect());
  const { width: vw, height: vh } = page.viewportSize()!;
  const isDrawer = panel.left <= 1;   // 手機版抽屜是全寬貼底的
  return { left: 0, top, right: isDrawer ? vw : panel.left, bottom: isDrawer ? panel.top : vh };
}

/**
 * 點一顆節點。節點若落在工具列或抽屜底下，先把畫布拖到讓它進安全區——**用真的滑鼠事件**，
 * 因為這一頁的點選判定綁在 pointerdown／pointerup 上（見 sim.ts 的說明），
 * `dispatchEvent` 合成的 PointerEvent 會讓 `setPointerCapture()` 丟 NotFoundError。
 */
async function tapNode(page: Page, id: string): Promise<void> {
  // ⚠️ 定位到 `.icon` 而不是整個 `<g>`：節點群組的 bounding box 是「圖示 ∪ 標籤」的聯集，
  // 標籤比圖示寬得多，聯集框的中心常常落在**隔壁那顆節點**上（實測點 1201 打到 1001）。
  // 症狀是「點了但那顆沒反應」，看起來完全像點擊沒接上。
  const el = page.locator(`#tree g.node[data-id="${id}"] .icon`);
  const safe = await safeBox(page);
  const cx = (safe.left + safe.right) / 2;
  const cy = (safe.top + safe.bottom) / 2;
  let box = (await el.boundingBox())!;
  const outside = (b: typeof box): boolean =>
    b.x < safe.left || b.x + b.width > safe.right || b.y < safe.top || b.y + b.height > safe.bottom;
  if (outside(box)) {
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + (cx - (box.x + box.width / 2)), cy + (cy - (box.y + box.height / 2)), { steps: 8 });
    await page.mouse.up();
    box = (await el.boundingBox())!;
  }
  // 搬完還在安全區外就是這條測試自己有問題，直接失敗比點到別的東西好。
  expect(outside(box), `節點 ${id} 搬不進可點擊範圍`).toBe(false);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
}

const totals = (page: Page) => ({
  total: page.locator('#sim-total'),
  unlock: page.locator('#sim-total-unlock'),
  upgrade: page.locator('#sim-total-upgrade'),
  owned: page.locator('#sim-owned-count'),
});

test('S0. 骨架：初始只有起始骰子、資源 0，工具列每一項都在', async ({ page }) => {
  await openSim(page);
  const t = totals(page);
  await expect(t.owned).toHaveText(`${FREE_IDS.length} / ${NODE_COUNT}`);
  await expect(t.total).toHaveText('核心 0 ／金幣 0');

  // 起始骰子是已取得、其餘一律不是——`sim-owned` 是畫布上唯一區分兩者的東西。
  await expect(page.locator('#tree g.node.sim-owned')).toHaveCount(FREE_IDS.length);

  // 工具列每一項都要在，而且**摸得到**（不是被裁在視窗外）。手機版第一版把它做成一條
  // 橫捲的列，「重置」之後的按鈕整批看不到，而畫面上沒有任何東西說可以往右滑。
  for (const id of ['sim-initial-toggle', 'sim-limit-toggle', 'sim-undo', 'sim-redo', 'sim-abilities', 'sim-export', 'sim-reset']) {
    await expect(page.locator(`#${id}`)).toBeVisible();
    const inView = await page.locator(`#${id}`).evaluate(el => {
      const r = el.getBoundingClientRect();
      return r.right <= innerWidth + 0.5 && r.left >= -0.5 && r.bottom <= innerHeight + 0.5;
    });
    expect(inView, `${id} 落在視窗外`).toBe(true);
  }

  // 可選初始骰子的勾選框從資料推導，不是硬編碼清單。
  await expect(page.locator('[data-initial]')).toHaveCount(OPTIONAL_IDS.length);
});

test('S0b. 導覽列有「模擬器」入口且在本頁標成目前分頁', async ({ page }) => {
  await page.goto('/sim');
  const link = page.locator('#site-nav a[href="/sim"]');
  await expect(link).toHaveText('骰子樹-模擬器(beta)');
  await expect(link).toHaveAttribute('aria-current', 'page');
});

test('S1. 點一顆前置齊了的節點就取得，成本加進總資源', async ({ page }) => {
  await openSim(page);
  // 火骰子（起始）的後續之一：前置只有起始骰子，一點就取得。
  const target = tree.nodes.find(n => n.id === READY)!;
  await tapNode(page, target.id);
  await expect(page.locator(`#tree g.node[data-id="${target.id}"]`)).toHaveClass(/sim-owned/);
  await expect(totals(page).owned).toHaveText(`${FREE_IDS.length + 1} / ${NODE_COUNT}`);
  await expect(totals(page).unlock).toContainText(String(target.unlockCost.core));
});

test('S2. 取消一顆會連帶取消依賴它的節點，成本一起扣回去', async ({ page }) => {
  await openSim(page);
  await tapNode(page, WITH_KIDS);
  const after1 = await totals(page).total.textContent();
  // 2003 的下游（2203 齒輪子彈傷害增加）：2003 到手之後它的前置就齊了，點一下直接取得。
  await tapNode(page, '2203');
  await expect(page.locator('#tree g.node[data-id="2203"]')).toHaveClass(/sim-owned/);
  await expect(totals(page).total).not.toHaveText(after1!);
  const deep = await totals(page).owned.textContent();

  await tapNode(page, WITH_KIDS);
  await page.locator('#sim-detail [data-remove]').click();
  await expect(page.locator(`#tree g.node[data-id="${WITH_KIDS}"]`)).not.toHaveClass(/sim-owned/);
  // 連帶取消：已取得數必須少掉不只 2003 自己那一顆
  const now = Number((await totals(page).owned.textContent())!.split('/')[0]!.trim());
  expect(now).toBeLessThan(Number(deep!.split('/')[0]!.trim()) - 1);
});

test('S3. 等級照 tier 累加，核心只在區間第一級收一次', async ({ page }) => {
  await openSim(page);
  await tapNode(page, TIER_F);
  await expect(page.locator('#sim-level-range')).toHaveCount(1);

  // tier F：Lv.2-5 每級 1,000；Lv.6 是 2,000 ＋ 1 核心。
  // 練到 Lv.5 ＝ 4,000 金幣、0 核心；Lv.6 ＝ 6,000 金幣、1 核心（核心只在區間第一級收）。
  await page.locator('#sim-level-range').fill('5');
  await page.locator('#sim-level-range').dispatchEvent('input');
  await expect(totals(page).upgrade).toHaveText('核心 0 ／金幣 4,000');
  await page.locator('#sim-level-range').fill('6');
  await page.locator('#sim-level-range').dispatchEvent('input');
  await expect(totals(page).upgrade).toHaveText('核心 1 ／金幣 6,000');

  // 等級牌跟著走。⚠️ 它的顯示是 CSS 依 `.sim-owned` 決定的——**SVG 元素不吃 HTML 的
  // `hidden` 屬性**，第一版用 toggleAttribute('hidden') 讓 239 個牌子全部留在畫面上，
  // 所有測試照樣綠，是截圖才看出來的。
  await expect(page.locator(`#tree g.node[data-id="${TIER_F}"] .sim-badge text`)).toHaveText('6/100');
  const visibleBadges = await page.locator('#tree g.node .sim-badge').evaluateAll(
    els => els.filter(e => getComputedStyle(e).display !== 'none').length);
  const ownedUpgradable = await page.locator('#tree g.node.sim-owned .sim-badge').count();
  expect(visibleBadges).toBe(ownedUpgradable);
});

test('S4. 一鍵點亮：鏈上有沒勾的初始骰子時一顆都不解，並指名要勾哪一顆', async ({ page }) => {
  await openSim(page);
  // 5201 的前置鏈同時經過 5006 與 5008（兩顆都是「可直接領、無視骰子樹前置」的骰子）。
  await tapNode(page, '5201');
  const before = await totals(page).owned.textContent();
  await page.locator('#sim-detail [data-path]').click();
  await expect(page.locator('#sim-toast')).toContainText('請先在「初始骰子」勾選');
  await expect(totals(page).owned).toHaveText(before!);   // 不做半套
});

test('S5. 勾選初始骰子不花錢；勾掉會連帶取消依賴它的節點', async ({ page }) => {
  await openSim(page);
  const id = OPTIONAL_IDS[0]!;
  await page.locator('#sim-initial-toggle').click();
  await page.locator(`[data-initial="${id}"]`).check();
  await expect(totals(page).owned).toHaveText(`${FREE_IDS.length + 1} / ${NODE_COUNT}`);
  await expect(totals(page).total).toHaveText('核心 0 ／金幣 0');
  await expect(page.locator('#sim-initial-count')).toHaveText('1');

  await page.locator(`[data-initial="${id}"]`).uncheck();
  await expect(totals(page).owned).toHaveText(`${FREE_IDS.length} / ${NODE_COUNT}`);
});

test('S6. 資源上限：會超出的操作被擋下來，總資源不變', async ({ page }) => {
  await openSim(page);
  await page.locator('#sim-limit-toggle').click();
  await page.locator('#sim-limit-core').fill('1');
  await page.locator('#sim-limit-toggle').click();   // 收起選單，免得蓋住畫布

  const before = await totals(page).total.textContent();
  await tapNode(page, WITH_KIDS);   // 齒輪骰子要 5 核心，遠超過設定的 1
  await expect(page.locator('#sim-toast')).toContainText('超出資源上限');
  await expect(totals(page).total).toHaveText(before!);
  await expect(page.locator(`#tree g.node[data-id="${WITH_KIDS}"]`)).not.toHaveClass(/sim-owned/);
});

test('S7. undo／redo 回到操作前的完整狀態', async ({ page }) => {
  await openSim(page);
  await expect(page.locator('#sim-undo')).toBeDisabled();
  await tapNode(page, READY);
  const after = await totals(page).total.textContent();
  await expect(page.locator('#sim-undo')).toBeEnabled();

  await page.locator('#sim-undo').click();
  await expect(totals(page).total).toHaveText('核心 0 ／金幣 0');
  await expect(page.locator(`#tree g.node[data-id="${READY}"]`)).not.toHaveClass(/sim-owned/);

  await page.locator('#sim-redo').click();
  await expect(totals(page).total).toHaveText(after!);
});

test('S8. 重新整理之後接續上次的規劃', async ({ page }) => {
  await openSim(page);
  await tapNode(page, READY);
  await page.locator('#sim-initial-toggle').click();
  await page.locator(`[data-initial="${OPTIONAL_IDS[0]}"]`).check();
  const before = { total: await totals(page).total.textContent(), owned: await totals(page).owned.textContent() };

  await page.reload({ waitUntil: 'networkidle' });
  await expect(totals(page).total).toHaveText(before.total!);
  await expect(totals(page).owned).toHaveText(before.owned!);
  await expect(page.locator(`[data-initial="${OPTIONAL_IDS[0]}"]`)).toBeChecked();
});

test('S9. 重置回到初始狀態並清掉存檔', async ({ page }) => {
  await openSim(page);
  await tapNode(page, READY);
  await page.locator('#sim-reset').click();
  await expect(totals(page).owned).toHaveText(`${FREE_IDS.length} / ${NODE_COUNT}`);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(totals(page).owned).toHaveText(`${FREE_IDS.length} / ${NODE_COUNT}`);
});

test('S10. 能力彙總把同名效果合起來，Esc 關得掉', async ({ page }) => {
  await openSim(page);
  await tapNode(page, TIER_F);
  await page.locator('#sim-abilities').click();
  await expect(page.locator('#sim-ability-modal')).toBeVisible();
  // 1109 是「所有骰子傷害」——五個系都有同名節點，所以歸在「全部骰子」而不是「自然」。
  await expect(page.locator('.sim-ability-group h3').first()).toHaveText('全部骰子');
  await expect(page.locator('.sim-ability-row').first()).toContainText('所有骰子傷害');
  await page.keyboard.press('Escape');
  await expect(page.locator('#sim-ability-modal')).toBeHidden();
});

test('S11. 拖曳畫布不算點選', async ({ page }) => {
  await openSim(page);
  const el = page.locator(`#tree g.node[data-id="${READY}"] .icon`);
  const box = (await el.boundingBox())!;
  const safe = await safeBox(page);
  // 只在節點本來就落在安全區時才驗——否則這條測的是 tapNode 的搬運而不是拖曳判定。
  test.skip(box.x < safe.left || box.x + box.width > safe.right || box.y < safe.top || box.y + box.height > safe.bottom,
    '節點不在可點擊範圍內');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 20, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator(`#tree g.node[data-id="${READY}"]`)).not.toHaveClass(/sim-owned/);
  await expect(totals(page).total).toHaveText('核心 0 ／金幣 0');
});

/**
 * 這一條是 2026-08-23 那個真 bug 的守門：`/sim` 一開始沒有 `.node .label` 的樣式（那段
 * 還留在 tree.astro），標籤用瀏覽器預設的 16px、全部顯示、而且照收指標事件，於是**別的
 * 節點的標籤**蓋在某些節點的圖示上，點下去打到的是那個標籤所屬的節點。症狀是「點某幾顆
 * 完全沒反應」，看起來完全像程式沒接上點選。
 *
 * ⚠️ 為什麼不是靠 S1：S1 只點一顆，而那一顆恰好沒被蓋到就永遠是綠的——把 `pointer-events`
 * 與「符文標籤預設隱藏」兩條防線同時拿掉，S1 照樣過。**逐顆掃**才守得住。
 */
test('S13. 每顆節點的圖示中心點得到的是它自己，不是別人的標籤', async ({ page }) => {
  await openSim(page);
  const wrong = await page.evaluate(() => {
    const bad: string[] = [];
    for (const g of document.querySelectorAll<SVGGElement>('#tree g.node')) {
      const id = g.getAttribute('data-id')!;
      const icon = g.querySelector('.icon')!;
      const r = icon.getBoundingClientRect();
      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      // 只驗看得見的那一段畫布（工具列與側欄底下的節點本來就點不到，那是版面不是這條的事）
      if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) continue;
      const hit = document.elementFromPoint(cx, cy);
      if (!hit) continue;
      const owner = hit.closest('g.node')?.getAttribute('data-id');
      // 打到工具列／側欄／樞紐都不算這條的問題，只抓「打到另一顆節點」
      if (owner !== undefined && owner !== null && owner !== id) bad.push(`${id} → ${owner}`);
    }
    return bad;
  });
  expect(wrong, `這些節點的圖示中心被別的節點蓋住：${wrong.join('、')}`).toEqual([]);
});

// EARS 10 的驗收：報告的**內容**已經被 tests/lib/sim-io.test.ts 蓋掉（純函式），
// 這裡驗的是「真的進了剪貼簿」——那條路徑（權限、navigator.clipboard、退回 textarea）
// 只有真瀏覽器跑得到。
test('S14. 匯出把規劃寫進剪貼簿', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openSim(page);
  await tapNode(page, READY);
  await page.locator('#sim-export').click();
  await expect(page.locator('#sim-toast')).toContainText('已複製到剪貼簿');
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain('Random Dice 2 骰子樹模擬結果');
  expect(text).toMatch(/總資源：核心 [\d,]+ ／金幣 [\d,]+/);
  expect(text).toContain(READY);
});


/**
 * 以下六條全部來自 2026-08-23 的 `/code-review high` 與 Yuki 的實機回報——**每一條都是
 * S0–S14 全綠時仍然存在的缺陷**，各自守一個當時沒有測試看得見的地方。
 */

test('S15. 鍵盤焦點在「可取得」「已選取」的節點上也看得見', async ({ page }) => {
  await openSim(page);
  // 狀態色是掛在 .icon 的 filter 上，具體度 (1,4,0) 會壓過 global.css 的
  // `.node:focus .icon { filter: url(#focus-ring) }` (0,3,0)，而 `.node:focus` 已經
  // outline:none——沒有補丁規則的話，Tab 到這兩種節點時畫面完全沒有變化。
  for (const id of [READY, WITH_KIDS, '5201']) {
    const r = await page.evaluate(nodeId => {
      const g = document.querySelector<SVGGElement>(`#tree g.node[data-id="${nodeId}"]`)!;
      const icon = g.querySelector('.icon')!;
      const before = getComputedStyle(icon).filter;
      g.focus();
      const after = getComputedStyle(icon).filter;
      g.blur();
      return { cls: g.getAttribute('class'), before, after };
    }, id);
    expect(r.after, `${id}（${r.cls}）focus 時沒有套上 #focus-ring`).toContain('focus-ring');
    expect(r.after, `${id}（${r.cls}）focus 前後畫面沒有任何變化`).not.toBe(r.before);
  }
});

test('S16. 資源上限只擋會變貴的方向，降成本的操作永遠放行', async ({ page }) => {
  await openSim(page);
  await tapNode(page, READY);
  await tapNode(page, '1205');   // 另一顆初始就可解鎖的 50 級符文
  const before = (await totals(page).total.textContent())!;

  // 填一個「現在已經超過」的上限——玩家的實際用法就是先規劃、事後才填。
  await page.locator('#sim-limit-toggle').click();
  await page.locator('#sim-limit-gold').fill('1000');
  await page.locator('#sim-limit-toggle').click();
  await expect(page.locator('#sim-limit-warn')).toBeVisible();

  await tapNode(page, READY);
  await page.locator('#sim-detail [data-remove]').click();
  await expect(totals(page).total).not.toHaveText(before);   // 真的降下來了
  await expect(page.locator('#sim-toast')).toHaveText('');    // 沒有被擋
});

test('S17. 等級滑桿一次拖得完，而且整段拖曳只算一步復原', async ({ page, isMobile }) => {
  // ⚠️ 只在桌機跑：`page.mouse` 驅動不了行動模擬下的原生 `<input type="range">`（實測拖完
  // 停在 Lv.1）——那是 Playwright 對觸控裝置的限制，不是產品的問題。**手機上的觸控拖曳
  // 只能真機驗**。根因（元素被 innerHTML 換掉）由下面的 S17b 在兩個 project 都守。
  test.skip(isMobile, 'page.mouse 驅動不了行動模擬下的原生 range，手機要真機驗');
  await openSim(page);
  await tapNode(page, TIER_F);   // maxLevel 100

  // ⚠️ 一定要用**真的滑鼠拖曳**。`fill()` ＋ `dispatchEvent('input')` 只送一次事件，
  // 完全繞過「拖曳中途元素被 innerHTML 換掉」這個缺陷——S3 就是這樣一直綠著的。
  const r = (await page.locator('#sim-level-range').boundingBox())!;
  await page.mouse.move(r.x + 4, r.y + r.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(r.x + (r.width * i) / 10, r.y + r.height / 2);
  }
  await page.mouse.up();
  await expect(page.locator('.sim-level-value')).toHaveText('Lv.100 / 100');

  // 每動一級推一步的話，這裡要按 99 次才回得去。
  await page.locator('#sim-undo').click();
  await expect(page.locator('.sim-level-value')).toHaveText('Lv.1 / 100');
});

test('S17b. 連續調整等級不會把滑桿元素換掉（拖曳斷掉的根因）', async ({ page }) => {
  await openSim(page);
  await tapNode(page, TIER_F);
  const r = await page.evaluate(() => {
    const el = document.getElementById('sim-level-range') as HTMLInputElement;
    for (const v of ['10', '30', '60']) {
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    // 同一個 DOM 元素還在不在，就是「拖曳會不會斷」的分界：innerHTML 一重寫，
    // 玩家正按著的那個元素就被移出 DOM，指標捕捉隨之失效。
    return {
      sameElement: document.getElementById('sim-level-range') === el,
      value: el.value,
      readout: document.querySelector('.sim-level-value')?.textContent,
    };
  });
  expect(r.sameElement, '滑桿元素在連續 input 之後被換掉了').toBe(true);
  expect(r.value).toBe('60');
  expect(r.readout).toBe('Lv.60 / 100');
});

test('S20. 操作被擋下來時，面板與高亮仍然跟著切到新選的節點', async ({ page }) => {
  await openSim(page);
  // 把上限填成 0/0，讓接下來每一次「取得」都必定失敗。
  await page.locator('#sim-limit-toggle').click();
  await page.locator('#sim-limit-core').fill('0');
  await page.locator('#sim-limit-gold').fill('0');
  await page.locator('#sim-limit-toggle').click();

  await tapNode(page, FREE_IDS[0]!);
  await expect(page.locator('#sim-detail h3')).toHaveText(tree.nodes.find(n => n.id === FREE_IDS[0])!.name);

  // `selected` 已經換人，但取得失敗——不重畫的話面板與 .sim-selected 會停在上一顆，
  // 而面板上那些按鈕讀的是 selected，按下去作用在畫面上看不到的節點。
  await tapNode(page, READY);
  await expect(page.locator('#sim-toast')).toContainText('超出資源上限');
  await expect(page.locator('#sim-detail h3')).toHaveText(tree.nodes.find(n => n.id === READY)!.name);
  await expect(page.locator('#tree g.node.sim-selected')).toHaveAttribute('data-id', READY);
});

test('S18. 邊有三階：沒到手＝暗、兩端都在手上＝正常亮、真的走過＝金色', async ({ page }) => {
  await openSim(page);
  // 1001 火骰子連著 1005 風與 1007 冰，三顆都是遊戲一開始就送的。這條路是通的（該正常亮），
  // 但玩家沒有走過它（不該金色）——Yuki 先後回報了這條界線的兩邊，所以三階都要驗。
  await expect(page.locator('#tree line.edge.sim-active')).toHaveCount(0);
  await expect(page.locator('#tree line.edge.sim-linked')).toHaveCount(2);

  const opacity = async (cls: string) =>
    page.locator(`#tree line.edge${cls}`).first().evaluate(el => Number(getComputedStyle(el).opacity));
  const linked = await opacity('.sim-linked');
  const idle = await opacity(':not(.sim-linked):not(.sim-ready)');
  expect(linked, '兩端都在手上的邊沒有回到正常亮度').toBe(1);
  expect(idle, '還沒到手的邊應該是暗的').toBeLessThan(0.5);

  await tapNode(page, READY);
  await expect(page.locator('#tree line.edge.sim-active')).toHaveCount(1);   // 解一顆才出現一條金線
  // 金色那條的 opacity 由 .sim-linked 給——`.sim-active` 只設 stroke，兩條規則互不搶屬性。
  const gold = page.locator('#tree line.edge.sim-active');
  await expect(gold).toHaveClass(/sim-linked/);
  expect(await gold.evaluate(el => Number(getComputedStyle(el).opacity))).toBe(1);
});

test('S19. toast 是常駐的 live region，不靠 hidden 收放', async ({ page }) => {
  await openSim(page);
  const el = page.locator('#sim-toast');
  await expect(el).toHaveAttribute('role', 'status');
  // `hidden`／`display:none`／`visibility:hidden` 三種收法都會讓它從無障礙樹消失，
  // 而它是這一頁唯一的失敗回饋管道（超出上限、初始骰子沒勾）。
  const style = await el.evaluate(e => {
    const cs = getComputedStyle(e);
    return { hidden: e.hasAttribute('hidden'), display: cs.display, visibility: cs.visibility };
  });
  expect(style).toEqual({ hidden: false, display: 'block', visibility: 'visible' });

  await tapNode(page, '5201');
  await page.locator('#sim-detail [data-path]').click();
  await expect(el).toContainText('請先在「初始骰子」勾選');
});

test('S12. 手機版：抽屜不蓋住著作權聲明，而且整頁不捲動', async ({ page, isMobile }) => {
  test.skip(!isMobile, '桌機的側欄貼在右側，不會蓋到 footer');
  await openSim(page);
  const geo = await page.evaluate(() => {
    const foot = document.querySelector('footer')!.getBoundingClientRect();
    const panel = document.getElementById('sim-panel')!.getBoundingClientRect();
    return { footTop: foot.top, panelTop: panel.top, scrollable: document.documentElement.scrollHeight > innerHeight + 1 };
  });
  expect(geo.footTop).toBeLessThan(geo.panelTop);   // footer 有一截露在抽屜上方
  expect(geo.scrollable).toBe(false);
  await expect(page.locator('footer')).toContainText('111 Percent Inc.');
});
