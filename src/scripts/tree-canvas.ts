// 掛載骰子樹畫布：讀取建置期產生的 tree.json，畫成 SVG 掛進 #canvas-host，
// 再接上平移縮放（滑鼠拖曳／滾輪、雙指觸控、鍵盤）。
// 節點互動（詳情面板、搜尋、篩選……後續任務）會接著在這支腳本上擴充。
import rawData from '../generated/tree.json';
import { renderTree } from '../lib/render.js';
import { Viewport, minReadableScale } from '../lib/viewport.js';
import { computeSelection } from '../lib/selection.js';
import { renderDetail } from '../components/NodeDetail.js';
import { matchesFilter, stateToQueryString, queryStringToState, isTypingTarget } from '../lib/filter.js';
import { visibleNodeIds, upgradeIcons } from '../lib/hires.js';
import type { Branch, NodeType, TreeData } from '../lib/types.js';

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
  const bottom = nav.getBoundingClientRect().bottom;
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
window.addEventListener('resize', updateNavHeight);

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
const isMobile = typeof matchMedia === 'function' && matchMedia('(max-width: 720px)').matches;

// 骰子圖示的顯示寬度（使用者座標，見 tree.json 節點的 size 欄位／render.ts）。分支包圍盒
// 裡最小的節點是骰子符文／被動（20～24 單位寬），但「至少要看得清一顆骰子圖示」是 task-17
// 裁決原文明確舉的例子（48 單位寬）——拿骰子的尺寸當基準，比骰子小的圖示縮放後只會更清楚
// 不會反而不夠，不需要每個節點各自算一個下限再取最大值，徒增複雜度換不到實質好處。
const DICE_ICON_WIDTH_UNITS = 48;
// 手機用手指操作、桌機用滑鼠，桌機的精準度門檻可以比手機低一些，兩者都遠高於「完全看不清」
// 的舊 bug 數字（約 9～13px），差別只是要拉到多高的下限。
const MOBILE_ICON_TARGET_PX = 32;
const DESKTOP_ICON_TARGET_PX = 24;

/**
 * `fitTo(bounds)` 之後，如果算出來的縮放比 `minReadableScale()`（見 src/lib/viewport.ts）
 * 算出的可讀性下限還小，就再疊一次縮放拉到下限；若 `fitTo` 本身給的倍率已經 ≥ 下限，就不去
 * 動它，不會把已經夠清楚的畫面反而縮小。
 *
 * task-17 裁決原文只把這件事套用在手機版：手機直向容器窄，`fitTo` 塞整個分支包圍盒進去
 * 算出來的倍率（約 2.17～2.36）換算成 CSS px 只有約 11～13px，看不清。task-18 E2E 第二輪
 * 找到同一個問題也發生在桌機：桌機橫向容器（例如 1280x610）比 viewBox（3400x2850）更扁，
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
let upgradeRaf = 0;
function maybeUpgradeIcons(): void {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(upgradeRaf);
  if (typeof requestAnimationFrame !== 'function') return;
  upgradeRaf = requestAnimationFrame(() => {
    if (vp.scale <= 1) return;
    const g = svg.querySelector<SVGGElement>('#viewport');
    const ctm = g?.getScreenCTM?.()?.inverse();
    if (!ctm) return; // 沒有版面引擎（測試環境）或畫布尚未真正掛進有版面的 DOM，無法換算
    const box = svg.getBoundingClientRect();
    const tl = new DOMPoint(box.left, box.top).matrixTransform(ctm);
    const br = new DOMPoint(box.right, box.bottom).matrixTransform(ctm);
    upgradeIcons(visibleNodeIds(data, { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y }), svg);
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
maybeUpgradeIcons();

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

function select(id: string | null): void {
  currentSelected = id;
  svg.querySelectorAll('.in-chain').forEach(el => el.classList.remove('in-chain'));
  svg.classList.toggle('has-selection', id !== null);
  panel.hidden = id === null;
  syncUrl();
  if (id === null) return;

  const node = byId.get(id);
  if (!node) return;

  const sel = computeSelection(id, data);
  for (const chainId of sel.chain) {
    svg.querySelector(`g.node[data-id="${chainId}"]`)?.classList.add('in-chain');
  }
  for (const line of svg.querySelectorAll('line.edge')) {
    const from = line.getAttribute('data-from');
    const to = line.getAttribute('data-to');
    if (from && to && sel.chain.has(from) && sel.chain.has(to)) line.classList.add('in-chain');
  }
  // 篩選功能（分支／類型／搜尋）是後續任務的事，這裡先掃一次 DOM：一旦那個任務把
  // 「被篩掉」的節點標上 .filtered-out，這裡就會自動把數字算進面板，不用回頭改這段。
  sel.hiddenByFilter = [...sel.chain].filter(
    chainId => svg.querySelector(`g.node[data-id="${chainId}"]`)?.classList.contains('filtered-out'),
  ).length;

  renderDetail(node, sel, panel);
}

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
  for (const n of data.nodes) {
    svg.querySelector(`g.node[data-id="${n.id}"]`)?.classList.toggle('filtered-out', !matchesFilter(n, filterState));
  }
  // 邊也要跟著篩選淡出（上一輪審查 Minor，task-17 補漏）：一條邊如果兩端節點都被篩掉，
  // 套用同一套 .filtered-out class 讓它一起淡出（樣式見 global.css 的
  // `#tree .edge.filtered-out` 規則）。這裡刻意用「兩端都被篩掉」而不是「任一端被篩掉」
  // ——一條邊只要還連著一個可見節點，使用者就還看得到、也還關心它的另一端在哪裡，不該
  // 跟著淡出。前置鏈上的邊即使兩端都被篩掉也不受影響：下面如果目前有選取節點會呼叫
  // select()，幫前置鏈上的邊補上 .in-chain，靠 CSS 的 !important 疊加規則蓋過這裡設的
  // opacity（見 global.css 的說明），這裡不用另外排除前置鏈上的邊。
  for (const [from, to] of data.edges) {
    const a = byId.get(from);
    const b = byId.get(to);
    const bothFiltered = !!a && !!b && !matchesFilter(a, filterState) && !matchesFilter(b, filterState);
    svg
      .querySelector(`line.edge[data-from="${from}"][data-to="${to}"]`)
      ?.classList.toggle('filtered-out', bothFiltered);
  }
  // 沒有選取節點時，select() 不會被呼叫、syncUrl() 也就不會跑，這裡補呼叫一次，
  // 確保單純調整篩選（沒選節點）也會把 ?branch=/?type=/?q= 寫回網址。
  if (currentSelected) select(currentSelected);
  else syncUrl();
}

/** 把目前的篩選狀態＋選取節點寫回網址，用 replaceState（不用 pushState，見任務指示：
 * 避免每次打字/勾選都往瀏覽器歷史多塞一筆，使用者按上一頁會被灌爆）。 */
function syncUrl(): void {
  const qs = stateToQueryString(filterState, currentSelected);
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}

const searchEl = document.getElementById('search');
if (!(searchEl instanceof HTMLInputElement)) {
  throw new Error('找不到 #search，搜尋功能無法掛載');
}
const filtersEl = document.getElementById('filters');
if (!filtersEl) {
  throw new Error('找不到 #filters，篩選功能無法掛載');
}

// --- 手機版篩選抽屜（task-17）：#filters 預設收起（見 tree.astro 的手機媒體查詢），
// 點 #filters-toggle 切換展開/收起。桌機版沒有這顆按鈕（CSS 隱藏），這裡用 optional
// chaining 讓「找不到這個按鈕」不算錯誤——它本來就只在手機版版面才存在。
document.getElementById('filters-toggle')?.addEventListener('click', () => {
  filtersEl.classList.toggle('open');
});

// --- 關鍵字 chip 可點擊搜尋（spec §6.2.3，task-17 補漏）---
// NodeDetail.ts 的 renderDetail() 每次都用 innerHTML 整段重畫面板內容，直接在渲染出來的
// <span class="kw"> 上掛監聽器，下一次重畫就會被沖掉；改用事件委派掛在 #detail 本身
// （面板容器元素不會被 innerHTML 重畫掉，只有它的子節點內容會被整段換掉），點擊事件
// 冒泡上來時用 closest('.kw') 判斷是不是點在關鍵字 chip 上，不是就直接略過。
panel.addEventListener('click', e => {
  const kwEl = (e.target as Element).closest?.('.kw');
  if (!kwEl) return;
  const keyword = (kwEl.textContent ?? '').replace(/^#/, '');
  if (!keyword) return;
  searchEl.value = keyword;
  filterState.query = keyword;
  applyFilter();
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
