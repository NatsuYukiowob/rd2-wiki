// 掛載骰子樹畫布：讀取建置期產生的 tree.json，畫成 SVG 掛進 #canvas-host，
// 再接上平移縮放（滑鼠拖曳／滾輪、雙指觸控、鍵盤）。
// 節點互動（詳情面板、搜尋、篩選……後續任務）會接著在這支腳本上擴充。
import rawData from '../generated/tree.json';
import { renderTree } from '../lib/render.js';
import {
  DESKTOP_ICON_TARGET_PX,
  MOBILE_ICON_TARGET_PX,
  Viewport,
  minReadableScale,
  effectiveDevicePx,
  HIRES_UPGRADE_AT,
  HIRES_DOWNGRADE_AT,
} from '../lib/viewport.js';
import { computeSelection } from '../lib/selection.js';
import { renderDetail, nodeViewHtml, termViewHtml, awakeningViewHtml } from '../components/NodeDetail.js';
import { matchesFilter, stateToQueryString, queryStringToState, isTypingTarget } from '../lib/filter.js';
import { visibleNodeIds, upgradeIcons, downgradeIcons, buildIconIndex } from '../lib/hires.js';
import type { Branch, NodeType, TreeData, TreeNode } from '../lib/types.js';

// tree.json 是建置期由 tools/build-data.ts 產生、結構保證符合 TreeData；
// 但 TS 對 JSON 匯入的型別推論會把 tuple（如 viewBox、size）寬鬆推成 number[]，
// 與 TreeData 的字面聯集/tuple 型別對不上，因此這裡用雙重斷言而非 any。
const data = rawData as unknown as TreeData;
// 提前建好：原本只有詳情面板那段在用，但下面「手機版初始視角」也要靠它從「網址帶的
// ?node=」反查該節點所屬分支，純資料處理、不依賴任何 DOM，提前宣告沒有副作用。
const byId = new Map(data.nodes.map(n => [n.id, n]));

// --- 全站導覽列的實際渲染高度，量出來寫進 CSS 自訂屬性 --nav-h ---
// 修 bug：#tree-controls（src/pages/tree.astro）與 #detail（src/styles/global.css）
// 舊版都寫死 top: 3rem，假設全站導覽列 <nav id="site-nav">（src/layouts/Base.astro）
// 恆為 48px 高，但 nav 實際渲染高度（padding 0.75rem×2 ＋ 行高 ＋ 1px 下框線）
// 實測約 50.59px，2.59px 的落差讓 #toolbar 右上角的 border-right 往上戳出 nav 下緣，
// 形成一個小突起。這是同一種「寫死偏移量」的 bug 第三次出現（前兩次見
// tree.astro 裡 #tree-controls 那條 CSS 規則的註解），這次不再換一個新的魔術數字
// （字型、行高、瀏覽器預設值一變就會再錯一次），改成實測 nav 的
// getBoundingClientRect().bottom。CSS 端讀同一個 --nav-h，3rem 只當這支腳本
// 執行前（或量測失敗時）的 fallback，兩處 CSS 因此永遠對齊同一個高度基準。
function updateNavHeight(): void {
  const nav = document.getElementById('site-nav');
  if (!nav) return;
  // ⚠️ 這裡要的是**視窗座標**：`--nav-h` 的兩個消費者（#tree-controls、#detail）都是
  // `position: fixed`，`top` 本來就是相對視窗算的。一度改成 `+ window.scrollY` 換算成文件
  // 座標是錯的——捲到 y=100 時會把兩者放到 nav 下方 100px，畫布頂端多出一條 nav 高的死區。
  //
  // 真正要防的是「頁面可捲時 nav 的視窗下緣變成負數」——那時固定層應該貼齊視窗頂端，而不是
  // 跟著 nav 跑出畫面，所以夾在 0 以上。版面改成 flex 之後畫布頁本來就不該捲得動，這條是給
  // 退化情境（例如 :has() 不支援）的保險。
  const bottom = Math.max(0, nav.getBoundingClientRect().bottom);
  // 單元測試環境（linkedom）沒有版面引擎，getBoundingClientRect() 預設全 0，
  // bottom <= 0 一定不是真實渲染結果，跳過寫入、讓 CSS 的 3rem fallback 留著
  // （tests/scripts/tree-canvas.test.ts 的頁面 fixture 也沒有 #site-nav，上面
  // 那個 `if (!nav) return` 已經先擋掉，這裡是雙重保險，避免任何環境把
  // --nav-h 寫成無意義的 0px）。
  if (bottom > 0) {
    document.documentElement.style.setProperty('--nav-h', `${bottom}px`);
  }
}
updateNavHeight();

/**
 * 手機版底部分支列的實際高度，寫進 `--chips-h` 供 footer 讓位用。
 *
 * `#branch-chips` 是 `position: fixed; bottom: 0`，頁面改成不捲動之後它會永遠疊在 footer
 * 上緣——而 footer 第二行正是「遊戲圖示與文字著作權屬 111 Percent Inc.」這句必須看得到的
 * 聲明，手機上因此完全讀不到。讓 footer 加一段等於 chip 列高度的下內距把文字頂上來；
 * `<main>` 是 `flex: 1`，footer 變高只會讓畫布跟著縮，不會把捲軸叫回來。
 *
 * 一樣是**量出來**而不是寫一個 3.5rem——這個 repo 的固定偏移量已經咬過四次（見 CLAUDE.md）。
 */
function updateChipsHeight(): void {
  const chips = document.getElementById('branch-chips');
  if (!chips) return;
  const h = chips.getBoundingClientRect().height;
  if (h > 0) document.documentElement.style.setProperty('--chips-h', `${h}px`);
}
updateChipsHeight();

window.addEventListener('resize', () => {
  updateNavHeight();
  updateChipsHeight();
  // 升級門檻的兩個輸入（畫布尺寸、devicePixelRatio）都會隨視窗變動：瀏覽器縮放到 200%
  // （dpr 1→2）、手機轉向、進入全螢幕、把視窗拖到高 DPI 螢幕，全都只發 resize。不在這裡
  // 重算的話，使用者會一直停在糊掉的 sprite（或反過來，停在已經沒必要的高解析圖），
  // 直到剛好在畫布上滾一次滾輪為止。
  maybeUpgradeIcons();
});

const host = document.getElementById('canvas-host');
if (!host) {
  throw new Error('找不到 #canvas-host，骰子樹畫布無法掛載');
}
const svg = renderTree(data, document);
host.appendChild(svg);

const viewport = svg.querySelector('#viewport');
if (!viewport) {
  throw new Error('找不到 #viewport，畫布無法平移縮放');
}
const vp = new Viewport(svg, viewport as SVGGElement);

// --- 搜尋、篩選與網址狀態（?node=/?branch=/?type=/?q=，spec §6.3）---
// 提前到這裡宣告（原本這段連同 searchEl/filtersEl 一起放在詳情面板段落之後）：下面「手機版
// 初始視角」要知道網址帶了哪個 ?node= 才能決定預設對準哪個分支，所以純資料部分
// （filterState／initialSelected／currentSelected）要在算初始視角之前就準備好。
// searchEl/filtersEl 這些真正要抓 DOM 表單元素的部分仍留在檔案後面（靠近它們自己的事件
// 監聽器，閱讀時比較好對照），不需要跟著搬。
const { state: filterState, selected: initialSelected } = queryStringToState(location.search);
// select() 每次呼叫都會把這個變數更新成當下選取的節點 id，applyFilter() 用它判斷
// 「篩選條件變了、要不要重新對目前選取的節點跑一次 select() 讓面板/高亮跟著更新」，
// syncUrl() 也用它組 ?node=。
let currentSelected: string | null = initialSelected;

// --- 手機版視角（task-17）：預設聚焦單一分支，不像桌機版一次看全部 5 個分支 ---
// isMobile 用 matchMedia 判斷，但故意不直接寫 `matchMedia(...)`：這支腳本的測試環境
// （linkedom）不提供 window.matchMedia，直接呼叫會是 ReferenceError；`typeof matchMedia`
// 對完全沒宣告過的識別字回傳 'undefined' 而不會拋錯（JS 對 typeof 的特例），是安全的
// 存在性檢查寫法，也讓測試可以用 vi.stubGlobal('matchMedia', ...) 精準模擬手機環境
// （見 tests/scripts/tree-canvas.test.ts）。720px 斷點要跟 src/pages/tree.astro 的
// CSS 媒體查詢保持一致，兩邊改動時要一起改。
// maybeUpgradeIcons() 的節流控制碼。宣告刻意提到這裡、離它的函式很遠：jumpToBranch() 會呼叫
// maybeUpgradeIcons()，而 jumpToBranch() 在模組初始化階段（手機版初始視角）就會被呼叫一次——
// 宣告若留在函式旁邊（檔案下半部），那次呼叫會落進 `let` 的暫時死區直接 ReferenceError，
// 整個模組掛掉。測試環境剛好驗不到（linkedom 沒有 cancelAnimationFrame，函式會提早 return，
// 根本讀不到這個變數），只有真瀏覽器會炸。
let upgradeRaf = 0;

/**
 * 高解析升級的批次世代號。跟 `upgradeRaf` 同一個理由提到這裡（見上面那段說明）：
 * `jumpToBranch()` 在模組初始化階段就會呼叫 `maybeUpgradeIcons()`，宣告留在函式旁邊會落進
 * 暫時死區。目前是因為工作都排在 rAF／閒置回呼裡才躲過，那是碰巧安全、不是設計。
 *
 * 每次重新評估門檻就 +1，排隊中的批次看到號碼變了就自己停下來——沒有它的話，使用者
 * 放大→鬆手（排了五批）→立刻縮小（觸發整批降級）之後，那五批仍會照原計畫把圖示一個個
 * 升回去，在一個 sprite 已經綽綽有餘的倍率上憑空多抓幾十個檔案。
 */
let upgradeGeneration = 0;

/** 手機版斷點。要跟 src/pages/tree.astro 的媒體查詢保持一致，兩邊改動時一起改。 */
const NARROW_QUERY = '(max-width: 720px)';
// 只用於「載入當下要不要走手機版初始視角」這種一次性決定；跟著視窗變化的判斷請當場再問一次
// matchMedia（見 positionPanel()）。
const isMobile = typeof matchMedia === 'function' && matchMedia(NARROW_QUERY).matches;

// 骰子圖示的顯示寬度（使用者座標，見 tree.json 節點的 size 欄位／render.ts）。分支包圍盒
// 裡最小的節點是骰子符文／被動，但「至少要看得清一顆骰子圖示」是 task-17 裁決原文明確舉的
// 例子——拿骰子的尺寸當基準，比骰子小的圖示縮放後只會更清楚不會反而不夠，不需要每個節點
// 各自算一個下限再取最大值，徒增複雜度換不到實質好處。
//
// 直接從資料取第一顆骰子的實際顯示尺寸，不抄一份數字：這個值 2026-08-18 這一天就變過兩次
// （48 → 46 → 56），寫死的話可讀性下限會照著一個已經不存在的尺寸算，畫面上看起來「差不多」，
// 而且沒有任何測試或型別會抱怨。
const DICE_ICON_WIDTH_UNITS = data.nodes.find(n => n.type === 'dice')?.size[0] ?? 50;
// 目標圖示尺寸（兩個常數與它們的由來見 src/lib/viewport.ts）。

/**
 * `fitTo(bounds)` 之後，如果算出來的縮放比 `minReadableScale()`（見 src/lib/viewport.ts）
 * 算出的可讀性下限還小，就再疊一次縮放拉到下限；若 `fitTo` 本身給的倍率已經 ≥ 下限，就不去
 * 動它，不會把已經夠清楚的畫面反而縮小。
 *
 * task-17 裁決原文只把這件事套用在手機版：手機直向容器窄，`fitTo` 塞整個分支包圍盒進去
 * 算出來的倍率（約 2.17～2.36）換算成 CSS px 只有約 11～13px，看不清。task-18 E2E 第二輪
 * 找到同一個問題也發生在桌機：桌機橫向容器（例如 1280x610）比當時的 viewBox（3400x2850，
 * 2026-08-18 換版面後是 2000x1700）更扁，
 * `fitTo` 整棵樹（bounds＝整個 viewBox）固定給 0.9x，換算出來一顆骰子圖示只有約 9 CSS
 * px——跟手機修正前一樣不可讀，只是先前只想到手機螢幕窄、沒想到桌機瓶頸在容器高度而不是
 * 寬度（`minReadableScale()` 本身的公式修正見該函式的說明）。所以這個下限現在桌機／手機、
 * 初始視角／分支跳轉都會套用，不再是手機專屬；桌機的目標圖示尺寸訂得比手機小一些
 * （`DESKTOP_ICON_TARGET_PX`），滑鼠操作比手指精準，不需要跟手機同樣大。
 *
 * `getBoundingClientRect()`／`Viewport.zoomAt()` 的錨點換算都需要真正的瀏覽器版面引擎，
 * 這個下限實際套用後的縮放結果本環境（linkedom）沒有版面資訊、驗不了；
 * `minReadableScale()` 這個算式本身已經在 tests/lib/viewport.test.ts 用純數字驗過，
 * 這裡的 DOM 接線與視覺結果留給第 18 個任務的 E2E 或真機。
 */
function applyReadabilityFloor(): void {
  const targetPx = isMobile ? MOBILE_ICON_TARGET_PX : DESKTOP_ICON_TARGET_PX;
  const rect = svg.getBoundingClientRect();
  const floor = minReadableScale(
    rect.width,
    rect.height,
    data.meta.viewBox[2],
    data.meta.viewBox[3],
    DICE_ICON_WIDTH_UNITS,
    targetPx,
  );
  if (vp.scale >= floor) return; // fitTo 給的倍率已經夠大，下限只是下限、不該把畫面往下拉

  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  vp.zoomAt(floor / vp.scale, cx, cy); // zoomAt 內部本來就會把結果夾在 0.2～8 倍，這裡不重複夾一次
}

/**
 * 把鏡頭移到指定分支（spec §6.2.6：桌機側欄 #branch-nav／手機底部分支 chip #branch-chips
 * 共用同一個 handler，不寫兩份跳轉邏輯；頁面載入時的手機版預設視角也直接呼叫這個函式，
 * 同一套邏輯只寫一次）。`fitTo(bounds)` 之後一律套用 `applyReadabilityFloor()`（桌機／
 * 手機都會，見該函式的說明）。
 */
function jumpToBranch(branch: Branch): void {
  vp.fitTo(data.meta.bounds[branch]);
  applyReadabilityFloor();
  // 同 focusMatches()：程式移動鏡頭後要自己補一次高解析升級。分支按鈕在 <svg> 之外，
  // svg 上那兩個 wheel／pointerup 監聽器接不到，不補的話跳過去看到的是糊的圖示。
  maybeUpgradeIcons();
}

if (isMobile) {
  // 網址帶了 ?node= 就對準該節點所屬的分支，否則預設 'nature'（五個分支挑一個當預設是
  // 主觀決定，跟 brief 的參考實作一致，沿用 nature）。
  const initialBranch = currentSelected ? (byId.get(currentSelected)?.branch ?? 'nature') : 'nature';
  jumpToBranch(initialBranch);
} else {
  // 桌機初始視角：整棵樹塞進 viewBox（`fitTo` 固定給 0.9x），一樣要套可讀性下限——容器夠扁
  // 時，「整棵樹塞進去」跟「看得清圖示」不可能同時成立，優先保證看得清，捲動交給使用者
  // （跟手機版分支視角的取捨邏輯一致，見 applyReadabilityFloor() 的說明）。
  vp.fitTo([0, 0, data.meta.viewBox[2], data.meta.viewBox[3]]);
  applyReadabilityFloor();
}

// 桌機側欄（#branch-nav）與手機底部分支列（#branch-chips）是同一組 5 個
// button[data-branch]，靠 CSS 媒體查詢互斥顯示（見 src/pages/tree.astro），這裡用同一個
// querySelectorAll 把兩邊的按鈕一次接上同一個 jumpToBranch()，不寫兩份監聽器。
for (const btn of document.querySelectorAll<HTMLButtonElement>('#branch-chips button, #branch-nav button')) {
  btn.addEventListener('click', () => jumpToBranch(btn.dataset.branch as Branch));
}

// --- 滑鼠拖曳平移 + 滾輪縮放 ---
// pan()/zoomAt() 吃的是螢幕座標（CSS px），內部會用 svg.getScreenCTM() 換算成
// #viewport 所在的使用者座標系，詳見 src/lib/viewport.ts 開頭的說明。
let dragging = false;
svg.addEventListener('pointerdown', e => {
  dragging = true;
  svg.setPointerCapture(e.pointerId);
});
svg.addEventListener('pointerup', e => {
  dragging = false;
  svg.releasePointerCapture(e.pointerId);
});
svg.addEventListener('pointercancel', () => {
  dragging = false;
});
svg.addEventListener('pointermove', e => {
  if (dragging) vp.pan(e.movementX, e.movementY);
});
svg.addEventListener(
  'wheel',
  e => {
    e.preventDefault();
    vp.zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX, e.clientY);
  },
  { passive: false },
);

// --- 雙指觸控縮放 ---
// 與拖曳平移共用同一批 pointer 事件：一旦偵測到第二指落下，就先停用拖曳平移，
// 改以兩指中點為錨點、依兩指距離變化量縮放，放開任一指後回到平移模式。
//
// dragging 要在「第二指落下的 pointerdown」當下就關掉，不能拖到下一個 pointermove
// 才關：上面拖曳平移的 pointerdown handler 先註冊、對每次 pointerdown 都無條件把
// dragging 設回 true，如果這裡只在 pointermove 判斷 touches.size===2 才關閉
// dragging，會有一幀空窗——兩指都落下後、雙指 handler 還沒來得及在 pointermove 裡
// 把 dragging 設 false 之前，拖曳平移的 pointermove handler（同一批事件、依註冊順序
// 先跑）仍會把這次移動當成單指拖曳多 pan() 一次，畫面出現一幀跳動。在這裡的
// pointerdown 就依當下的指數提前關閉 dragging，確保後續任何 pointermove 都不會再
// 誤觸拖曳平移。
const touches = new Map<number, { x: number; y: number }>();
let lastDist = 0;
svg.addEventListener('pointerdown', e => {
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size >= 2) dragging = false;
});
svg.addEventListener('pointerup', e => {
  touches.delete(e.pointerId);
  lastDist = 0;
});
svg.addEventListener('pointercancel', e => {
  touches.delete(e.pointerId);
  lastDist = 0;
});
svg.addEventListener('pointermove', e => {
  if (!touches.has(e.pointerId)) return;
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size !== 2) return;
  // dragging 這裡已經保證是 false（上面 pointerdown handler 在指數達到 2 時就關掉了），
  // 不用再設一次。
  const [a, b] = [...touches.values()];
  if (!a || !b) return;
  const dist = Math.hypot(a.x - b.x, a.y - b.y);
  if (lastDist > 0) vp.zoomAt(dist / lastDist, (a.x + b.x) / 2, (a.y + b.y) / 2);
  lastDist = dist;
});

// --- 高解析圖示 lazy load（縮放 > 1× 時，把可見節點的圖示從 sprite 換成個別的 2 倍
// WebP，task-17，邏輯見 src/lib/hires.ts）---
// 用 requestAnimationFrame 節流：滾輪縮放一次可能連續觸發十幾個 wheel 事件，沒必要每個
// 都重算一次可視範圍、逐一檢查 239 個節點，攢到下一個影格只算一次就好；同一批事件也在
// pointerup（拖曳放開／雙指縮放放開）時補檢查一次，涵蓋「用拖曳平移把新節點移進畫面」
// 的情境。
//
// requestAnimationFrame／cancelAnimationFrame／SVGGraphicsElement.getScreenCTM／
// DOMPoint 都是瀏覽器版面引擎才有的東西：測試環境（linkedom）裡前兩者完全不存在
// （`typeof` 對未宣告的識別字回傳 'undefined'、不拋錯，見上面 isMobile 的說明），
// getScreenCTM 則是存在但退化回傳 undefined（跟 src/lib/viewport.ts 的
// screenToUserCtm() 遇到的狀況一樣）。這裡的守衛寫法確保在沒有這些 API 的環境下不會拋
// 例外，但「縮放後圖示真的換成高解析版本」這個實際效果本環境驗不到，留給第 18 個任務的
// E2E 或真機——src/lib/hires.ts 的 upgradeIcons() 本身（拿到正確的可視節點清單之後，
// DOM 要怎麼改）已經在 tests/lib/hires.test.ts 用真實 SVG DOM 驗過。
// 節點是建置期一次畫好、之後不再增刪的，圖示元素索引建一次就永遠有效——不必每次縮放都
// 對每個可見節點各跑一次 querySelector。
const iconIndex = buildIconIndex(svg);

/**
 * 目前一個使用者座標單位攤到幾個**裝置**像素，連同量到的畫布盒子一起回傳。
 *
 * 判準本身見 `effectiveDevicePx()`（舊版只看 `vp.scale`，兩個方向都判斷錯）。盒子一起回傳是
 * 因為下面換算可視範圍還要用同一個矩形——`getBoundingClientRect()` 是強制版面計算，在每一幀
 * 都會跑的縮放路徑上讀兩次沒有意義。
 */
function currentDevicePx(): { devicePx: number; box: DOMRect } {
  const box = svg.getBoundingClientRect();
  const dpr = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return {
    devicePx: effectiveDevicePx(box.width, box.height, data.meta.viewBox[2], data.meta.viewBox[3], vp.scale, dpr),
    box,
  };
}

/** 每批處理幾個節點。24 是一個手機首屏大致的可見節點量級，夠小到不會卡住一幀。 */
const UPGRADE_BATCH = 24;

/**
 * 排一段閒置工作。
 *
 * Safari 沒有 `requestIdleCallback`（照本檔慣例做存在性檢查）。fallback 刻意是 32ms 而不是 0：
 * `setTimeout(fn, 0)` 只是「下一個 macrotask」，一串批次會在載入後幾毫秒內接力跑完——那正是
 * 這個延後想避開的首屏爭用，而 Safari 又正是 fallback 唯一的服務對象。32ms 約兩幀，讓渲染插得進去。
 */
function whenIdle(fn: () => void): void {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(() => fn(), { timeout: 1000 });
  else if (typeof setTimeout === 'function') setTimeout(fn, 32);
}

function upgradeInBatches(ids: string[], generation: number, start = 0): void {
  // 排隊中的批次要自己確認「當初排隊的理由現在還成立嗎」：使用者可能已經縮小、平移，
  // 甚至整批降級過了。號碼對不上就直接停，不要把畫面推回一個已經被推翻的狀態。
  if (generation !== upgradeGeneration) return;
  upgradeIcons(ids.slice(start, start + UPGRADE_BATCH), svg, undefined, iconIndex);
  if (start + UPGRADE_BATCH < ids.length) {
    whenIdle(() => upgradeInBatches(ids, generation, start + UPGRADE_BATCH));
  }
}

function maybeUpgradeIcons(): void {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(upgradeRaf);
  if (typeof requestAnimationFrame !== 'function') return;
  upgradeRaf = requestAnimationFrame(() => {
    // 重新評估＝先讓所有排隊中的批次失效（見 upgradeGeneration 的說明）。
    const generation = ++upgradeGeneration;
    const { devicePx, box } = currentDevicePx();
    // devicePx 為 0 代表**量不到**（畫布還沒排版、祖先暫時 display:none、容器尺寸為 0），
    // 不是「小到不需要高解析」。少了這道，那個瞬間會走進下面的降級分支，把 239 個圖示全部
    // 打回 sprite，而且要等到下一次滾輪／放開拖曳才補得回來。
    if (devicePx <= 0) return;
    // 遲滯：縮小到明顯不需要 2× 素材時把已升級的換回 sprite（連同 <defs> 裡的 pattern 一起
    // 移除，那才是真的把記憶體還回去——實測整棵樹全升級後多出約 4.6MB），但門檻比升級低一截，
    // 免得在邊界反覆縮放時來回抖動。
    if (devicePx < HIRES_DOWNGRADE_AT) {
      downgradeIcons(iconIndex.values(), svg);
      return;
    }
    if (devicePx <= HIRES_UPGRADE_AT) return;
    const g = svg.querySelector<SVGGElement>('#viewport');
    const ctm = g?.getScreenCTM?.()?.inverse();
    if (!ctm) return; // 沒有版面引擎（測試環境）或畫布尚未真正掛進有版面的 DOM，無法換算
    const tl = new DOMPoint(box.left, box.top).matrixTransform(ctm);
    const br = new DOMPoint(box.right, box.bottom).matrixTransform(ctm);
    // 分批：一次可見節點可能有近百個，全部一口氣建 pattern＋發請求會在同一幀裡卡住主執行緒。
    // 每個閒置時段做一批，其餘排到下一次——畫面上是圖示陸續變清晰，不是整個卡一下。
    upgradeInBatches(visibleNodeIds(data, { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y }), generation);
  });
}
svg.addEventListener('wheel', maybeUpgradeIcons);
svg.addEventListener('pointerup', maybeUpgradeIcons);

// 初始視角（上面的 jumpToBranch()／桌機整棵樹 fitTo + applyReadabilityFloor()）算出來的
// 縮放常常超過 1x 高解析門檻——手機版走 minReadableScale 下限（task-18 E2E 實測 Pixel 7
// 上約 5.5 倍）；桌機版原本只有 0.9x 不會超過，但 task-18 第二輪修正把可讀性下限也套用到
// 桌機的初始視角之後（見 applyReadabilityFloor()），桌機初始視角也常常超過 1x（實測約
// 2.34 倍）。maybeUpgradeIcons() 只掛在 wheel／pointerup 這兩個互動事件上，使用者一打開
// 頁面、還沒操作過的當下不會被觸發——結果是不管桌機還是手機，使用者看到的第一畫面，圖示
// 都仍然是從 sprite 格子硬拉伸的低解析度版本（會糊），要等使用者真的滾一下滾輪或放開一次
// 拖曳才會補上高解析圖（task-18 code review 找到的真實 bug，這裡修正）。所以這裡不分裝置、
// 兩種初始視角算完後都呼叫一次——`vp.scale <= 1` 的情況（例如桌機容器夠大、可讀性下限本身
// 就 <1 的極端狀況）本來就會被 maybeUpgradeIcons() 內部擋掉，不用在外面再判斷一次
// isMobile，改成無條件呼叫更準確反映「哪個裝置的初始縮放實際上超過門檻」這件事跟裝置種類
// 沒有必然關係，是純粹看縮放數字。
// 首屏這一次改成閒置時才做：它有可能一口氣建立上百個 pattern、發出上百個圖片請求，擠在
// 首次繪製的同一批工作裡只會拖慢「使用者看到第一畫面」的時間，而高解析與否是漸進增強。
// Safari 沒有 requestIdleCallback（照本檔慣例做存在性檢查後退回 setTimeout）。
//
// ⚠️ 門檻修正之後，1280×720 dpr1 的桌機首屏**不會**再升級（實測每單位只有 0.52 裝置像素，
// sprite 綽綽有餘）——這正是修正的重點，不是退步。高 DPI 螢幕與手機才會在這裡真的升級。
whenIdle(maybeUpgradeIcons);

// --- 鍵盤：方向鍵平移、+/- 縮放 ---
// 這個 handler 掛在 window 上、原本不判斷 focus（「不管焦點在哪都該生效」）；但下面
// 新增了 #search 搜尋框之後，使用者在搜尋框打字按方向鍵是要移動文字游標，不是要平移
// 畫布——所以現在多一個例外：焦點落在會接收文字/選項輸入的表單元件（搜尋框、篩選
// 核取方塊）上時，直接放行，不攔截也不觸發畫布操作。判斷邏輯抽成 src/lib/filter.ts
// 的 isTypingTarget()，是純函式（只吃 tagName 字串），才能在沒有瀏覽器的環境下單元測試；
// 這裡的 window keydown 事件本身能不能正確反映搜尋框 focus 狀態，只有真的瀏覽器才驗
// 得了，留給第 18 個任務的 E2E。
window.addEventListener('keydown', e => {
  if (isTypingTarget(document.activeElement?.tagName)) return;
  const step = 60;
  let moved = true;
  if (e.key === 'ArrowLeft') vp.pan(step, 0);
  else if (e.key === 'ArrowRight') vp.pan(-step, 0);
  else if (e.key === 'ArrowUp') vp.pan(0, step);
  else if (e.key === 'ArrowDown') vp.pan(0, -step);
  else if (e.key === '+' || e.key === '=') vp.zoomAt(1.2, innerWidth / 2, innerHeight / 2);
  else if (e.key === '-') vp.zoomAt(1 / 1.2, innerWidth / 2, innerHeight / 2);
  else moved = false;
  // 滑鼠滾輪縮放／拖曳放開都會觸發 maybeUpgradeIcons()（見上面），鍵盤的 +/-／方向鍵原本
  // 沒有接這條線——純鍵盤操作把畫面縮放/平移進新的可視範圍，圖示不會自動升級成高解析版本，
  // 要等使用者之後剛好又滾一下滑鼠才會補上（code review 找到的真實落差，這裡補齊，讓
  // 「哪些操作會改到可視範圍」跟「該不該檢查要不要升級圖示」這兩件事保持一致，不看操作是
  // 用滑鼠還是鍵盤）。
  if (moved) maybeUpgradeIcons();
});

// --- 點選節點：前置鏈高亮 + 詳情面板 ---
// select(null) 清空選取；select(id) 算前置鏈、幫節點與邊加上 .in-chain、
// 切換畫布根元素（svg#tree）的 .has-selection、並把詳情面板內容交給 renderDetail 畫。
// #detail 的初始 hidden 狀態、.in-chain／.has-selection 這幾個 class 名稱都是
// 跨任務的 DOM 契約（後面的搜尋、篩選、E2E 測試都依賴），不要改名。
const detailEl = document.getElementById('detail');
if (!detailEl) {
  throw new Error('找不到 #detail，詳情面板無法掛載');
}
// TS 的 control-flow 窄化不會跨函式邊界持續生效到下面的 select()（一個獨立的函式宣告）
// 裡，所以另外宣告一個型別明確標成 HTMLElement（非 null）的 binding 給 select() 閉包用。
const panel: HTMLElement = detailEl;

/**
 * 詳情面板的視圖堆疊，以及進行中換頁動畫的收尾。
 *
 * 宣告刻意放在 `select()` 之前——`let` 有 TDZ，而模組初始化時 `applyFilter()` 就會呼叫到
 * `select()`（它會 `abortSlide()` ＋ 重設堆疊）。宣告留在下面那一段的話會在載入當下就炸。
 *
 * 動畫還在跑的時候又要換頁（連按返回、系統上一頁一次退兩層），一定要先把前一段處理掉再
 * 開始下一段——否則兩段動畫會搶同一批元素的 inline style。
 */
let viewStack: StackEntry[] = [];
let slideTimer: ReturnType<typeof setTimeout> | null = null;
let slideFinish: (() => void) | null = null;

/**
 * 把堆疊收回根視圖，並退掉對應的歷史紀錄。實際的 DOM 由呼叫端的 renderDetail() 重畫。
 *
 * 少了退歷史這一步，使用者在詞彙頁改一下篩選（面板會重畫回節點頁）之後按上一頁，
 * 瀏覽器確實退了一步、但那一步對應的視圖已經不存在，畫面上什麼都不會發生。
 * depth 退成 0 之後這裡就是 no-op，不會每打一個字就動一次歷史。
 */
function resetViewStack(): void {
  // 整個 `.stack` 馬上就會被 renderDetail() 換掉，所以是「中止」不是「收尾」：
  // 跑收尾等於對一批即將被丟棄的元素做清理，還會多觸發一次 focus 與重新定位。
  // 但 `#detail` 本身活著，`panel-sliding` 一定要拿掉——留著的話接下來那 280ms 內，
  // 卡片跟著畫布平移的每一幀重寫 top 都會變成有 transition 的拖尾（實測會殘留）。
  abortSlide();
  const depth = viewStack.length - 1;
  viewStack = viewStack.slice(0, 1);
  if (depth <= 0) return;
  // ⚠️ 退歷史之後**一定要再寫一次網址**。`history.go()` 是非同步的，而每一筆紀錄都記著
  // 它被推入時的網址；`select()` 在這之後同步跑的 `syncUrl()` 寫的是「現在這一筆」，
  // 等傳送落地就被還原成推入前的樣子。實測：在詞彙頁點另一顆節點，面板換成新節點、
  // 網址卻還停在舊的 `?node=`，重整就回到錯的節點。
  // （這正是 afterHistoryUnwind() 存在的理由，只是 select() 這條路徑一開始沒走它。）
  afterHistoryUnwind(syncUrl, depth);
}

function select(id: string | null): void {
  resetViewStack();
  currentSelected = id;
  svg.querySelectorAll('.in-chain').forEach(el => el.classList.remove('in-chain'));
  svg.classList.toggle('has-selection', id !== null);
  panel.hidden = id === null;
  syncUrl();
  if (id === null) return;

  const node = byId.get(id);
  if (!node) return;

  const sel = selectionFor(id);
  for (const chainId of sel.chain) {
    svg.querySelector(`g.node[data-id="${chainId}"]`)?.classList.add('in-chain');
  }
  for (const line of svg.querySelectorAll('line.edge')) {
    const from = line.getAttribute('data-from');
    const to = line.getAttribute('data-to');
    if (from && to && sel.chain.has(from) && sel.chain.has(to)) line.classList.add('in-chain');
  }

  renderDetail(node, sel, panel, data.meta.glossary, data.meta.upgradeCostTable);
  viewStack = [{ view: { kind: 'node', id }, scrollTop: 0 }];
  positionPanel();
}

/**
 * 前置鏈計算 ＋ 把「被篩選淡出的前置有幾個」算進去。
 *
 * 抽出來是因為現在有兩個地方要它：`select()`（選節點）與視圖堆疊回到根視圖時的重繪。
 * `hiddenByFilter` 只能在這裡算——`computeSelection()` 是純函式、看不到 DOM 上的
 * `.filtered-out`，那是畫面狀態不是資料。
 */
function selectionFor(id: string) {
  const sel = computeSelection(id, data);
  sel.hiddenByFilter = [...sel.chain].filter(
    chainId => svg.querySelector(`g.node[data-id="${chainId}"]`)?.classList.contains('filtered-out'),
  ).length;
  return sel;
}

/**
 * 把詳情卡片挪到被選節點旁邊（spec 外，2026-08-18 人工檢視回報：卡在右上角時，眼睛要在
 * 「點下去的節點」和「螢幕另一角」之間來回跑）。
 *
 * 只在桌機做。手機版的 #detail 是從螢幕底部升起的抽屜（見 src/pages/tree.astro 的媒體
 * 查詢），窄螢幕上根本沒有「節點旁邊」這種空間，硬擠只會兩邊都看不清。
 *
 * 位置規則：預設放在節點右邊；右邊放不下就翻到左邊；再放不下就夾回可視範圍內。垂直方向
 * 對齊節點中心，同樣夾在工具列下緣與視窗底部之間。這幾個夾制不是防禦性程式碼——樹的四個
 * 角落本來就有節點，不夾就會有卡片一半在畫面外的情況。
 */
/**
 * @param opts.assumeHeight 用這個高度算位置，而不是量卡片現在的高度。
 *   換頁時用：高度正在動畫中，要先把**終點**的位置寫進 `top`，讓 top 與 height 同時跑完，
 *   卡片的垂直中心才會固定不動（＝「上下往中間收」而不是「往上收」）。
 */
function positionPanel(opts: { assumeHeight?: number } = {}): void {
  // 這裡刻意**不用**模組頂端那個 isMobile：它在載入時算一次就定案，而視窗是會被拉的。
  // 桌機視窗拉窄到斷點以下時，CSS 會把面板切成底部抽屜（inset: auto 0 0 0），但這裡留下的
  // 行內 left/top 優先級更高，抽屜會被釘在桌機算出來的位置上（code review 實測：400×800 下
  // 面板停在 top=162、left=12、寬 400，右邊突出畫面外）。每次都重新問一次媒體查詢才對。
  const narrow = typeof matchMedia === 'function' && matchMedia(NARROW_QUERY).matches;
  if (narrow) {
    panel.style.left = '';
    panel.style.top = '';
    panel.style.right = '';
    panel.style.maxHeight = '';
    return;
  }
  if (panel.hidden || !currentSelected) return;
  const nodeEl = svg.querySelector(`g.node[data-id="${currentSelected}"] .icon`);
  if (!nodeEl) return;

  const GAP = 12;
  // 上緣夾在**工具列**下方：#toolbar 是疊在畫布左上角的固定圖層（搜尋框＋篩選），只看
  // --nav-h 的話卡片會滑到它底下、把搜尋框蓋掉一半。量它的實際下緣而不是再寫一個固定
  // 偏移量——這個 repo 的版面偏移量已經寫死出過三次 bug（見 CLAUDE.md）。
  const toolbarEl = document.getElementById('toolbar');
  const topLimit = toolbarEl
    ? toolbarEl.getBoundingClientRect().bottom
    : parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-h')) || 48;

  // 左緣還要避開 #branch-nav 側欄。只避 #toolbar 是不夠的：側欄比工具列矮但更長，760px 寬時
  // 卡片會被夾到 left=12，正好壓在側欄按鈕上並攔截點擊（實測 760×800：#detail 12–364 /
  // 158.91–549.28，#branch-nav 0–79.19 / 146.91–356.75，兩個矩形相交）。
  //
  // ⚠️ 量的是 #branch-nav 不是它的父層 #tree-controls：後者是 flex column，盒子會撐到最寬
  // 子元素（#toolbar）的寬度，右邊一大片是 pointer-events:none 的透明空白（見 tree.astro
  // 那條規則的註解）。拿它當障礙物會把卡片推到畫面外（實測 1280 寬下 left 被推到 1001，
  // 卡片右緣 1353 超出視窗）。
  const obstacle = document.getElementById('branch-nav')?.getBoundingClientRect() ?? null;

  // 高度上限也要從同一個基準算。CSS 的 max-height 是用 --nav-h 起算的，但實際起點是工具列
  // 下緣（低了約 68px），兩邊基準不一致時面板下緣會超出視窗——而面板最後一段固定是 spec
  // §2.1 強制要求的「重置需要初期化券」災情警告，捲到底也看不到（code review 實測 1000×480
  // 下超出 43.8px）。先設上限、再量高度，量到的才是夾制後的結果。
  panel.style.maxHeight = `${Math.max(0, window.innerHeight - topLimit - GAP * 2)}px`;

  const n = nodeEl.getBoundingClientRect();
  const rect = panel.getBoundingClientRect();
  const height = opts.assumeHeight ?? rect.height;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));

  const top = clamp(
    n.top + n.height / 2 - height / 2,
    topLimit + GAP,
    Math.max(topLimit + GAP, window.innerHeight - height - GAP),
  );

  // 只有當卡片的垂直範圍真的跟側欄重疊時才把左緣往右推——卡片落在側欄下方時沒必要浪費那段寬度。
  // 側欄在手機版是 display:none（width 0），那時也不必推。
  const overlapsSidebar = !!obstacle && obstacle.width > 0
    && top < obstacle.bottom && top + height > obstacle.top;
  const rightLimit = Math.max(GAP, window.innerWidth - rect.width - GAP);
  // 下限取 min(避障後的左界, 右界)：視窗窄到「避開側欄就一定超出畫面」時，寧可重疊也不要
  // 把卡片推出視窗——看不到比被壓住更糟。
  const leftLimit = Math.min(overlapsSidebar ? Math.max(GAP, obstacle!.right + GAP) : GAP, rightLimit);

  let left = n.right + GAP;
  if (left + rect.width > window.innerWidth - GAP) left = n.left - GAP - rect.width;
  left = clamp(left, leftLimit, rightLimit);

  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
  panel.style.right = 'auto';
}

// 畫布一動（拖曳、滾輪縮放、雙指縮放、分支跳轉、初始視角……）卡片就要跟著節點跑。與其在
// 每個事件處理器後面各補一次呼叫（漏掉任何一個就會留下一張黏在原地的卡片），這裡監看
// #viewport 的 style 屬性——Viewport 的每一次變動最後都落在那裡，一個掛勾全包。
// ⚠️ 監看的是 `style` 不是 `transform`：Viewport 改用 CSS transform 之後（見
// src/lib/viewport.ts 的 apply()，那是為了讓畫布升成合成層的效能修正），`transform`
// attribute 永遠不會再變動，掛在它上面的 observer 一次都不會觸發——症狀是卡片黏在原地，
// 而且沒有任何錯誤訊息。`style.transform = ...` 會改寫 style attribute，所以改看它。
// #viewport 身上不會有別的 inline 樣式（will-change 寫在 tree.astro 的 CSS 裡），
// 這個 filter 不會因此變得比原本寬鬆。
// `typeof` 存在性檢查跟本檔上面 matchMedia 那裡同一個理由：單元測試環境（linkedom）沒有
// MutationObserver，直接 new 會是 ReferenceError、整個模組掛掉。卡片跟隨畫布這件事需要真的
// 版面資訊，本來就只能靠 E2E 驗（tests/e2e/tree.spec.ts 的 N）。
// 用 requestAnimationFrame 節流（跟 maybeUpgradeIcons() 同一套路）：拖曳時每一幀都會寫一次
// transform，不節流的話每次寫入後都立刻 getBoundingClientRect() 兩次再寫回 style，是典型的
// 讀寫交錯版面抖動。
let positionRaf = 0;
function schedulePositionPanel(): void {
  if (typeof requestAnimationFrame !== 'function') {
    positionPanel();
    return;
  }
  cancelAnimationFrame(positionRaf);
  positionRaf = requestAnimationFrame(() => positionPanel());
}
if (typeof MutationObserver === 'function') {
  // 包一層而不是直接把 schedulePositionPanel 當 callback：它現在收一個 options 物件，
  // 而 MutationObserver 傳進來的第一個參數是 MutationRecord[]——會被當成 `{keepTop: undefined}`
  // 之外的東西，型別也對不上。畫布一動就是「重新對齊」，不帶 keepTop。
  new MutationObserver(() => schedulePositionPanel()).observe(viewport, {
    attributes: true,
    attributeFilter: ['style'],
  });
}
window.addEventListener('resize', () => schedulePositionPanel());

// 選取判定用 pointerdown/pointerup 自己量位移，不用 click（審查回饋，2026-08-17 第 1
// 輪修正）：
// 1. click 沒有位移門檻。拖曳畫布放開時，瀏覽器仍會補一個 click，會誤觸
//    select(null)（清掉選取）或選到手指移到的別的節點。這裡改成量
//    pointerdown → pointerup 的螢幕座標位移，超過門檻視為拖曳，不當點選。
// 2. 上面「滑鼠拖曳平移」一開始就對每個 pointerdown 呼叫 svg.setPointerCapture()；
//    依規格，capture 生效後同一手指「後續」的 pointer 事件 target 一律改標成
//    capture 的元素（這裡是 svg 自己），click 是否也被同樣改標則各瀏覽器行為不一。
//    若真的被改標，e.target.closest('g.node') 會永遠是 null，節點完全點不到。
//    這裡改成在 pointerdown「當下」（setPointerCapture 生效前，target 還沒被
//    改標）就記下被按到的節點，pointerup 只用來量位移、判定放開，不依賴它自己的
//    target，繞開這個風險——但瀏覽器實際行為本環境沒有瀏覽器驗不了，留給第 18
//    個任務的 E2E 補。
const DRAG_THRESHOLD_PX = 5; // 螢幕座標（CSS px），UI 手感判定，不是使用者座標
let downTarget: Element | null = null;
let downPos = { x: 0, y: 0 };
svg.addEventListener('pointerdown', e => {
  downTarget = (e.target as Element).closest('g.node');
  downPos = { x: e.clientX, y: e.clientY };
});
svg.addEventListener('pointerup', e => {
  // 放開時還有其他手指按著（雙指縮放中途放開一指），不算一次點選；
  // 這裡讀到的 touches 已經先被上面雙指觸控段落的 pointerup handler 刪掉這一指
  // （同一元素上的 listener 依註冊順序執行，這段排在後面）。
  if (touches.size > 0) return;
  const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
  if (moved > DRAG_THRESHOLD_PX) return;
  select(downTarget ? downTarget.getAttribute('data-id') : null);
});

// Enter／Esc 掛在 svg 上而不是 window：keydown 事件要先冒泡經過 svg 才會觸發這裡，
// 所以只有「焦點在畫布內（節點或 svg 本身）」時才會生效。之後的搜尋框（下一個任務）
// 不是 svg 的子節點，使用者在搜尋框按 Esc 時事件不會流經這裡，不會被這段攔截去關
// 詳情面板，可以留給搜尋框自己處理「清空搜尋」。
svg.addEventListener('keydown', e => {
  const g = (e.target as Element).closest?.('g.node');
  if (e.key === 'Enter' && g) select(g.getAttribute('data-id'));
  if (e.key === 'Escape') select(null);
});

// --- 搜尋、篩選：套用 .filtered-out、還原網址到 UI、掛事件監聽器 ---
//
// applyFilter() 必須先把所有節點的 .filtered-out 更新完，最後才呼叫 select(currentSelected)
// （如果目前有選取節點的話）——這正是 spec §6.3「前置鏈高亮是獨立圖層，優先於可見度」的
// 實作順序：淡出先算好套上去，select() 再把前置鏈上的節點/邊強制拉回全不透明＋高亮色，
// 覆寫掉剛剛套用的淡出。對 brief 草稿的裁決：不在 applyFilter() 外面再呼叫一次
// select(selected)——applyFilter() 內部已經呼叫過，外面重複呼叫只是多做一次一樣的事，
// 還容易在日後改動時兩處各改一半、行為對不上，所以拿掉了。
function applyFilter(): void {
  // 判定算一次就好。以前這個函式會把 matchesFilter() 跑過節點一輪、248 條邊的兩端各一輪、
  // 再一輪算 anyFiltered，updateFilterStatus() 又跑第四輪——每一次按鍵約 1,200 次呼叫，
  // 每次都要 normalizeQuery() 再對 name／description／keywords 做 includes（code review 指出）。
  const matched = new Map(data.nodes.map(n => [n.id, matchesFilter(n, filterState)]));
  const isMatch = (id: string) => matched.get(id) ?? false;

  for (const n of data.nodes) {
    svg.querySelector(`g.node[data-id="${n.id}"]`)?.classList.toggle('filtered-out', !isMatch(n.id));
  }
  // 邊也要跟著篩選淡出（上一輪審查 Minor，task-17 補漏）：一條邊如果兩端節點都被篩掉，
  // 套用同一套 .filtered-out class 讓它一起淡出（樣式見 global.css 的
  // `#tree .edge.filtered-out` 規則）。這裡刻意用「兩端都被篩掉」而不是「任一端被篩掉」
  // ——一條邊只要還連著一個可見節點，使用者就還看得到、也還關心它的另一端在哪裡，不該
  // 跟著淡出。前置鏈上的邊即使兩端都被篩掉也不受影響：下面如果目前有選取節點會呼叫
  // select()，幫前置鏈上的邊補上 .in-chain，靠 CSS 的 !important 疊加規則蓋過這裡設的
  // opacity（見 global.css 的說明），這裡不用另外排除前置鏈上的邊。
  for (const [from, to] of data.edges) {
    const bothFiltered = !isMatch(from) && !isMatch(to);
    svg
      .querySelector(`line.edge[data-from="${from}"][data-to="${to}"]`)
      ?.classList.toggle('filtered-out', bothFiltered);
  }
  // 中央樞紐不是節點、拿不到上面那個逐節點掛的 .filtered-out，但畫面上它跟節點一樣佔位置：
  // 只要有任何節點被篩掉（＝使用者正在縮小注意範圍），樞紐就該一起淡下去，否則它會變成
  // 全畫面唯一還亮著的東西（樣式見 global.css 的 `#tree .tree-center.filtered-out`）。
  const matchCount = [...matched.values()].filter(Boolean).length;
  svg.querySelector('g.tree-center')?.classList.toggle('filtered-out', matchCount < data.nodes.length);

  updateFilterStatus(matchCount);

  // 沒有選取節點時，select() 不會被呼叫、syncUrl() 也就不會跑，這裡補呼叫一次，
  // 確保單純調整篩選（沒選節點）也會把 ?branch=/?type=/?q= 寫回網址。
  if (currentSelected) select(currentSelected);
  else syncUrl();
}

/** 目前符合篩選條件的節點。 */
function matchedNodes(): TreeNode[] {
  return data.nodes.filter(n => matchesFilter(n, filterState));
}

/** 現在有沒有任何篩選條件（搜尋字串或分支／類型勾選）。 */
function hasActiveFilter(): boolean {
  return filterState.query.trim() !== '' || filterState.branches.size > 0 || filterState.types.size > 0;
}

/**
 * 更新工具列的篩選狀態列。
 *
 * 這條存在的理由是可讀性，不是好看：搜尋只命中兩三個節點時，畫面上是 236 個淡掉的節點加
 * 243 條淡掉的邊，數量壓過那幾個命中的目標，看起來就像「什麼都沒發生」；而 ?q= 不會因為
 * 點空白處而清掉（那只清 ?node=），使用者會覺得畫面卡住了、也找不到回去的路。
 */
function updateFilterStatus(matchCount: number): void {
  const status = document.getElementById('filter-status');
  const count = document.getElementById('filter-count');
  if (!status || !count) return;
  if (!hasActiveFilter()) {
    status.hidden = true;
    return;
  }
  status.hidden = false;
  count.textContent = matchCount === 0 ? '沒有符合的節點' : `符合 ${matchCount} 個節點`;
  count.classList.toggle('none', matchCount === 0);
}

/**
 * 把鏡頭帶到目前符合篩選的節點上。
 *
 * 只在「使用者明確要求看結果」時呼叫（點關鍵字、在搜尋框按 Enter），不掛在每次輸入上——
 * 邊打字邊跳鏡頭會讓人抓不到畫面。
 */
function focusMatches(): void {
  const matched = matchedNodes();
  if (matched.length === 0) return;
  const xs = matched.map(n => n.x);
  const ys = matched.map(n => n.y);
  const PAD = 90;
  // 下限 400：只命中一個節點時，包圍盒只有內距那麼大，fitTo 會一路放大到 8 倍上限，
  // 整個畫面只剩一顆圖示、完全失去「它在樹的哪裡」這個資訊。
  const w = Math.max(400, Math.max(...xs) - Math.min(...xs) + PAD * 2);
  const h = Math.max(400, Math.max(...ys) - Math.min(...ys) + PAD * 2);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  vp.fitTo([cx - w / 2, cy - h / 2, w, h]);
  applyReadabilityFloor();
  // 鏡頭一動就會有新的節點進到畫面裡，它們還掛著 sprite 的低解析 pattern（放大後會糊）。
  // maybeUpgradeIcons() 平常只掛在 wheel／pointerup 上，程式自己移動鏡頭時不會被觸發——
  // 這正是 task-18 code review 抓過一次的同一個 bug，這條路徑（搜尋跳轉）當時還不存在。
  maybeUpgradeIcons();
}

/** 把目前的篩選狀態＋選取節點寫回網址，用 replaceState（不用 pushState，見任務指示：
 * 避免每次打字/勾選都往瀏覽器歷史多塞一筆，使用者按上一頁會被灌爆）。 */
function syncUrl(): void {
  const qs = stateToQueryString(filterState, currentSelected);
  // 帶著現有的 state 一起 replace：視圖堆疊的深度存在 history.state 裡（見 HISTORY_DEPTH_KEY），
  // 這裡傳 null 的話，使用者在關鍵字頁打一個字（會觸發 syncUrl）就把深度洗掉，之後按上一頁
  // 會一次退到根視圖而不是退一層。
  history.replaceState(typeof history.state === 'undefined' ? null : history.state, '', qs ? `?${qs}` : location.pathname);
}

const searchEl = document.getElementById('search');
if (!(searchEl instanceof HTMLInputElement)) {
  throw new Error('找不到 #search，搜尋功能無法掛載');
}
const filtersElOrNull = document.getElementById('filters');
if (!filtersElOrNull) {
  throw new Error('找不到 #filters，篩選功能無法掛載');
}
// 收窄後的別名：TypeScript 的 narrowing 不會跟著進到下面那些回呼／函式裡。
const filtersEl: HTMLElement = filtersElOrNull;

// --- 手機版篩選抽屜（task-17）：#filters 預設收起（見 tree.astro 的手機媒體查詢），
// 點 #filters-toggle 切換展開/收起。桌機版沒有這顆按鈕（CSS 隱藏），這裡用 optional
// chaining 讓「找不到這個按鈕」不算錯誤——它本來就只在手機版版面才存在。
const filtersToggle = document.getElementById('filters-toggle');

/** 開關抽屜，並把狀態同步到 aria——按鈕的 aria-label 以前永遠是「展開篩選」，也沒有 aria-expanded。 */
function setFiltersOpen(open: boolean): void {
  filtersEl.classList.toggle('open', open);
  filtersToggle?.setAttribute('aria-expanded', String(open));
  filtersToggle?.setAttribute('aria-label', open ? '收起篩選' : '展開篩選');
}
setFiltersOpen(false);

filtersToggle?.addEventListener('click', () => {
  setFiltersOpen(!filtersEl.classList.contains('open'));
});

// 抽屜要有出路。舊版展開後會蓋住自己的切換鈕，而且沒有 Esc、沒有點外面關閉——唯一的辦法是
// 重新整理。版面修好之後切換鈕不再被蓋住，這兩條是額外的出口（也是一般抽屜該有的行為）。
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && filtersEl.classList.contains('open')) {
    setFiltersOpen(false);
    filtersToggle?.focus();
    // 這一下 Esc 已經用掉了。不擋的話，下面那個「詳情面板退一層」的後備監聽器也會收到
    // 同一個事件（兩個都掛在 document 上，`open` 這時已經被移除、用 class 判斷來不及），
    // 使用者按一次 Esc 會同時關掉抽屜**並且**退出詞彙頁（實測 500×800 下必現）。
    // 用 stopImmediatePropagation 而不是 stopPropagation：同一個節點上後續的監聽器也要擋。
    e.stopImmediatePropagation();
  }
});
document.addEventListener('pointerdown', e => {
  if (!filtersEl.classList.contains('open')) return;
  const t = e.target as Node | null;
  if (t && (filtersEl.contains(t) || filtersToggle?.contains(t))) return;
  setFiltersOpen(false);
});

// --- 詳情面板的視圖堆疊（2026-08-20）---
//
// 面板不再是一張把所有東西攤平的卡片：點 `#關鍵字` 或「骰子覺醒」那一列，會在**同一張
// 卡片裡**推出下一頁（左滑），左上角出現返回鍵。之所以不用浮動彈出層：彈出層要自己算
// 位置、還要防超出畫面，而手機版的面板本來就是貼著螢幕底的抽屜，「貼著某個字彈出去」
// 幾乎沒有可用空間。同一張卡片換頁則位置完全不變，巢狀關鍵字也順著同一個機制解決。
//
// 事件全部用委派掛在 #detail 上：renderDetail() 每次都整段重寫 innerHTML，掛在按鈕上的
// 監聽器下一次重畫就沒了；#detail 這個容器元素本身不會被換掉。
type DetailView =
  | { kind: 'node'; id: string }
  | { kind: 'term'; term: string }
  | { kind: 'awakening'; id: string };

interface StackEntry {
  view: DetailView;
  /** 離開這一層時面板捲到哪裡；返回時要捲回去，不是跳回頂端。 */
  scrollTop: number;
}

/** 堆疊深度存在 history.state 的這個鍵下，讓系統／瀏覽器的上一頁等同卡片的返回鍵。 */
const HISTORY_DEPTH_KEY = 'rd2DetailDepth';

/**
 * 換頁動畫長度。**從 CSS 的 `--slide-ms` 讀**，不在這裡寫死第二份：JS 只負責在動畫結束後
 * 把 inline style 清乾淨，兩邊數字一旦漂開，收尾會在動畫還沒跑完就發生，看起來像被切斷。
 * 取不到值（單元測試的 linkedom 沒有 getComputedStyle）時走 fallback，那條路本來就不做動畫。
 */
const SLIDE_MS = (() => {
  if (typeof getComputedStyle !== 'function' || typeof document === 'undefined') return 280;
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--slide-ms').trim();
  const ms = raw.endsWith('ms') ? parseFloat(raw) : raw.endsWith('s') ? parseFloat(raw) * 1000 : NaN;
  return Number.isFinite(ms) && ms > 0 ? ms : 280;
})();

const canUseHistory = typeof history !== 'undefined' && typeof history.pushState === 'function';
/**
 * 動畫只在真的有瀏覽器、而且使用者沒有要求減少動態時才做。
 * 單元測試跑在 linkedom 下（沒有 requestAnimationFrame），會走瞬間切換那條路——
 * 那正好也是 `prefers-reduced-motion: reduce` 要的行為，兩邊共用同一段程式。
 */
function canAnimate(): boolean {
  return typeof requestAnimationFrame === 'function'
    && !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/**
 * 換頁之後把焦點移進新視圖。
 *
 * 不是可有可無的無障礙裝飾：剛按下的那顆按鈕會隨著舊視圖一起 `display: none`，焦點於是
 * 掉回 `<body>`——Esc 收不到、Tab 從頭開始、螢幕閱讀器也不知道畫面換了一頁。
 */
function focusView(el: HTMLElement): void {
  if (typeof el.focus === 'function') el.focus({ preventScroll: true });
}

function stackEl(): HTMLElement | null {
  return panel.querySelector('.stack');
}
/**
 * 目前最上層的視圖元素。
 *
 * 用 `viewStack` 的長度去索引，**不是**「最後一個沒有 hidden 的」：換頁動畫進行中兩張視圖
 * 都還沒被收起來，用可見性去猜會在動畫中途拿到上一張，連續兩次返回（例如系統上一頁一次
 * 退兩層）就會對同一對元素跑兩遍動畫，最後留下一個空面板。
 */
function topViewEl(): HTMLElement | null {
  const views = panel.querySelectorAll<HTMLElement>('.view');
  return views[viewStack.length - 1] ?? null;
}

function viewHtml(view: DetailView): string {
  if (view.kind === 'term') return termViewHtml(view.term, data.meta.glossary);
  const node = byId.get(view.id);
  if (!node) return '';
  return view.kind === 'awakening'
    ? awakeningViewHtml(node, data.meta.glossary)
    : nodeViewHtml(node, selectionFor(view.id), data.meta.glossary, data.meta.upgradeCostTable);
}

/**
 * 兩張視圖之間的左右滑動。
 *
 * 高度也要一起動：關鍵字那一頁通常比節點頁短很多，只滑不動高度的話，卡片會在動畫結束的
 * 那一瞬間「啪」地縮一大截。滑動期間兩張都是絕對定位（`.sliding`），`.stack` 帶著明確
 * 高度與 `overflow: hidden` 把滑出畫面的那張裁掉；結束後高度還原成 auto、留下的那張回到
 * 正常流程——平常沒有動畫時 `.stack` 就是一個普通的區塊，不影響 positionPanel() 量高度。
 */
/** 中止進行中的換頁動畫：不跑收尾（元素即將被整批替換），只把掛在 `#detail` 上的狀態清掉。 */
function abortSlide(): void {
  if (slideTimer !== null) {
    clearTimeout(slideTimer);
    slideTimer = null;
  }
  slideFinish = null;
  panel.classList.remove('panel-sliding');
}

function finishSlideNow(): void {
  if (slideTimer !== null) {
    clearTimeout(slideTimer);
    slideTimer = null;
  }
  const f = slideFinish;
  slideFinish = null;
  f?.();
}

function slide(fromEl: HTMLElement, toEl: HTMLElement, dir: 'forward' | 'back', done: () => void): void {
  const stack = stackEl();
  if (!stack || !canAnimate()) {
    done();
    return;
  }
  // ⚠️ 量起始高度之前，新視圖必須先脫離正常流程。兩張都在流程裡時 `.stack` 是兩張加起來，
  // 動畫就會從那個高度開始收——卡片先暴衝到 565px 再一路縮回 198px（實測值）。
  // 這裡是唯一負責掛 `.sliding` 的地方，呼叫端不必自己先掛（E2E 的 Z4 守著這條）。
  toEl.classList.add('sliding');
  const fromH = stack.offsetHeight;

  // 終點要量兩個高度，而且**單位不同、不能混用**：
  //   toH        ＝ `.stack` 的高度，動畫是在它身上跑的。
  //   toPanelH   ＝ 整張卡片的高度（多了 padding 與框線，而且已經被 max-height 夾過），
  //                positionPanel() 要的是這一個。
  // 把 toH 直接餵給 positionPanel 會差一個 padding（實測 164 vs 197.7），
  // top 就跟著偏一半、卡片在動畫途中往下漂 16.9px——看起來就是「縮的時候歪掉」。
  fromEl.classList.add('sliding');
  toEl.classList.remove('sliding');
  const toH = stack.offsetHeight || fromH;
  const toPanelH = panel.offsetHeight;
  toEl.classList.add('sliding');

  const enter = dir === 'forward' ? 100 : -100;
  const exit = dir === 'forward' ? -30 : 30;

  stack.classList.add('animating');
  // top 的 transition 只在換頁期間存在（拖曳畫布時卡片是每幀重寫 top，有 transition 會拖尾）
  panel.classList.add('panel-sliding');
  stack.style.height = `${fromH}px`;
  toEl.style.transform = `translateX(${enter}%)`;
  toEl.style.opacity = '0';

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      stack.style.height = `${toH}px`;
      // 用**終點高度**重算位置：top 與 height 同時跑完，卡片的垂直中心才固定不動。
      // 少了這一行，卡片只會從下緣往上收；而在動畫結束後才重新對齊，就是原本那個「跳一下」。
      positionPanel({ assumeHeight: toPanelH });
      for (const el of [fromEl, toEl]) el.classList.add('slide-anim');
      fromEl.style.transform = `translateX(${exit}%)`;
      fromEl.style.opacity = '0';
      toEl.style.transform = 'translateX(0)';
      toEl.style.opacity = '1';
    });
  });

  // 用 setTimeout 而不是 transitionend：transitionend 在元素被 display:none、動畫被中斷、
  // 或分頁切到背景時都可能不觸發，而這個 callback 負責把 .sliding／inline style 清乾淨——
  // 沒收尾的話卡片會永遠停在絕對定位＋固定高度的中間狀態。
  slideFinish = () => {
    stack.classList.remove('animating');
    panel.classList.remove('panel-sliding');
    stack.style.height = '';
    for (const el of [fromEl, toEl]) {
      el.classList.remove('sliding', 'slide-anim');
      el.style.transform = '';
      el.style.opacity = '';
    }
    done();
  };
  slideTimer = setTimeout(finishSlideNow, SLIDE_MS + 20);
}

function pushView(view: DetailView): void {
  // 先把上一段動畫收乾淨——而且要在「決定哪張是 from、哪張是 to」之前。收尾動作會把上一段的
  // fromEl 設成 hidden，晚一步跑就會把這一段剛要顯示的那張反手藏起來，畫面留下一個空面板
  // （實測：連續兩次換頁時必現）。
  finishSlideNow();
  const stack = stackEl();
  const fromEl = topViewEl();
  if (!stack || !fromEl) return;
  const html = viewHtml(view);
  if (!html) return;

  viewStack[viewStack.length - 1]!.scrollTop = panel.scrollTop;
  stack.insertAdjacentHTML('beforeend', html);
  const toEl = stack.lastElementChild as HTMLElement;
  viewStack.push({ view, scrollTop: 0 });
  if (canUseHistory) history.pushState({ [HISTORY_DEPTH_KEY]: viewStack.length - 1 }, '', location.href);

  slide(fromEl, toEl, 'forward', () => {
    fromEl.hidden = true;
    panel.scrollTop = 0;
    focusView(toEl);
    // keepTop：換頁不是「換一張卡片」，是同一張卡片換內容——它不該因為變矮就重新對齊節點
    // 中心而跳一下（實測推入詞彙頁時位移 6.3px，高度落差更大時更明顯）。
    schedulePositionPanel();
  });
}

/** 真正把最上層那張拿掉。返回鍵與系統上一頁都收斂到這裡（前者透過 history.back()）。 */
function popView(): void {
  finishSlideNow();   // 同 pushView：收尾必須在取 fromEl／toEl 之前
  if (viewStack.length <= 1) return;
  const stack = stackEl();
  const fromEl = topViewEl();
  if (!stack || !fromEl) return;
  const toEl = fromEl.previousElementSibling as HTMLElement | null;
  if (!toEl) return;

  viewStack.pop();
  toEl.hidden = false;
  slide(fromEl, toEl, 'back', () => {
    fromEl.remove();
    panel.scrollTop = viewStack[viewStack.length - 1]?.scrollTop ?? 0;
    focusView(toEl);
    schedulePositionPanel();
  });
}

/** 把堆疊收到指定深度（0 ＝ 只剩根視圖）。深度比現在還深時什麼都不做——回不去的頁面不重建。 */
function syncStackDepth(depth: number): void {
  while (viewStack.length - 1 > depth) popView();
}

function goBack(): void {
  if (viewStack.length <= 1) return;
  // 交給 history：返回鍵與系統上一頁走同一條路，堆疊與瀏覽器歷史不會各走各的。
  if (canUseHistory && typeof history.back === 'function') history.back();
  else popView();
}

/**
 * 把推進去的歷史紀錄退回來，**退完之後**才做接下來的事。
 *
 * ⚠️ 順序不能反過來：`history.go()` 是非同步的，而每一筆歷史紀錄都記著它被推入時的網址。
 * 先改網址（例如按「搜尋 #破滅」會寫 `?q=破滅`）再退，退回去的那一筆會把網址還原成推入前
 * 的樣子，搜尋條件就這樣被安靜地吃掉——實測就是這樣紅的。
 *
 * 沒有歷史紀錄可退（或環境沒有 history）時直接執行，行為一致。
 */
function afterHistoryUnwind(run: () => void, depthOverride?: number): void {
  const depth = depthOverride ?? viewStack.length - 1;
  if (depth <= 0 || typeof history === 'undefined' || typeof history.go !== 'function' || typeof window === 'undefined') {
    run();
    return;
  }
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    window.removeEventListener('popstate', finish);
    run();
  };
  window.addEventListener('popstate', finish);
  // 保險絲：popstate 沒有規格保證一定會來（例如紀錄被別的東西動過）。少了這一段，
  // 「關閉」或「搜尋」會整個不執行——比多退一步歷史還糟。
  setTimeout(finish, 300);
  history.go(-depth);
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    const raw = (history.state as Record<string, unknown> | null)?.[HISTORY_DEPTH_KEY];
    syncStackDepth(typeof raw === 'number' ? raw : 0);
  });
}

panel.addEventListener('click', e => {
  const target = e.target as Element;
  const back = target.closest?.('[data-detail-back]');
  if (back) { goBack(); return; }
  const close = target.closest?.('[data-detail-close]');
  if (close) { afterHistoryUnwind(() => select(null)); return; }
  const awakening = target.closest?.('[data-detail-awakening]');
  if (awakening && currentSelected) { pushView({ kind: 'awakening', id: currentSelected }); return; }
  const searchBtn = target.closest?.('[data-detail-search]');
  if (searchBtn) {
    const term = searchBtn.getAttribute('data-detail-search') ?? '';
    if (!term) return;
    afterHistoryUnwind(() => {
      searchEl.value = term;
      filterState.query = term;
      applyFilter();
      // 「給我看有這個效果的節點」——不把鏡頭帶過去的話，命中的節點可能在畫面外，
      // 使用者看到的只是原地的一片灰（image9 回報的「沒有東西跑出來」）。
      focusMatches();
    });
    return;
  }
  const kwEl = target.closest?.('.kw');
  if (kwEl) {
    const term = kwEl.getAttribute('data-term') ?? '';
    if (term) pushView({ kind: 'term', term });
  }
});

// Esc：有堆疊時退一層，回到根視圖才關面板（跟左上角的 ← 一致）。掛在 panel 上而不是
// window：焦點在畫布或搜尋框時的 Esc 各有各的處理（見那兩處），不該被這裡攔走。
panel.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  e.stopPropagation();
  if (viewStack.length > 1) goBack();
  else select(null);
});

// 焦點不在卡片上時的後備（例如使用者用滑鼠點完就把游標移開、或焦點被別處搶走）：
// 只在「面板開著而且有堆疊」時才攔 Esc，其餘情況留給畫布與搜尋框各自的處理。
// 上面那個 handler 會 stopPropagation，所以焦點在卡片內時這裡不會重複收到。
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || panel.hidden || viewStack.length <= 1) return;
  goBack();
});

// 還原網址帶入的搜尋字串／勾選狀態，讓畫面初始值跟網址一致（對應 brief Step 6 的手動
// 驗收項目：開 /tree?node=1002&branch=nature&q=冰凍，節點被選取、篩選框已勾選、搜尋框
// 有值——這幾行負責「篩選框已勾選、搜尋框有值」，節點被選取則是靠上面 currentSelected
// 初始值＋下面 applyFilter() 觸發的 select()）。
searchEl.value = filterState.query;
for (const cb of filtersEl.querySelectorAll<HTMLInputElement>('input[data-branch]')) {
  cb.checked = filterState.branches.has(cb.dataset.branch as Branch);
}
for (const cb of filtersEl.querySelectorAll<HTMLInputElement>('input[data-type]')) {
  cb.checked = filterState.types.has(cb.dataset.type as NodeType);
}

searchEl.addEventListener('input', () => {
  filterState.query = searchEl.value;
  applyFilter();
});

// Enter＝「帶我去看」。輸入中途不動鏡頭（每打一個字就跳一次會讓人抓不到畫面），
// 按下 Enter 才是明確要求。
searchEl.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  // 空字串時 matchedNodes() 會回傳全部 239 個節點，focusMatches() 於是把鏡頭重設成「整棵樹」
  // ——使用者剛剛的平移縮放被無聲丟掉，而畫面上沒有任何東西解釋為什麼跳走（code review 實測）。
  // 模組底部那次呼叫本來就有這個判斷，這裡當時漏了。
  if (filterState.query.trim() === '') return;
  focusMatches();
});

document.getElementById('filter-clear')?.addEventListener('click', () => {
  filterState.query = '';
  filterState.branches.clear();
  filterState.types.clear();
  searchEl.value = '';
  for (const cb of filtersEl.querySelectorAll<HTMLInputElement>('input[data-branch], input[data-type]')) {
    cb.checked = false;
  }
  applyFilter();
});

// 搜尋框按 Esc＝清空搜尋，不是取消節點選取（那是取消選取／關閉面板，屬於上面 svg 的
// keydown handler 的事）。兩者天然不會互相干擾：#search 不是 svg 的子節點，這裡的
// Esc 不會冒泡到 svg 去多關一次詳情面板；stopPropagation() 純粹是防呆，避免日後
// DOM 結構調整（例如把搜尋框移進 svg 底下）導致意外冒泡出兩套 Esc 語意打架。
searchEl.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  e.stopPropagation();
  searchEl.value = '';
  filterState.query = '';
  applyFilter();
});

for (const cb of filtersEl.querySelectorAll<HTMLInputElement>('input[data-branch]')) {
  cb.addEventListener('change', () => {
    const val = cb.dataset.branch as Branch;
    if (cb.checked) filterState.branches.add(val);
    else filterState.branches.delete(val);
    applyFilter();
  });
}
for (const cb of filtersEl.querySelectorAll<HTMLInputElement>('input[data-type]')) {
  cb.addEventListener('change', () => {
    const val = cb.dataset.type as NodeType;
    if (cb.checked) filterState.types.add(val);
    else filterState.types.delete(val);
    applyFilter();
  });
}

applyFilter();
// 網址帶了搜尋字串就把鏡頭帶到命中的節點上。分享連結（或按下重新整理）本來就是在說
// 「看這些」，落在原本的初始視角只會看到一片灰，跟點關鍵字時的死路一模一樣。
if (filterState.query.trim() !== '') focusMatches();
