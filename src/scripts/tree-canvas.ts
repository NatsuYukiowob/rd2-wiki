// 掛載骰子樹畫布：讀取建置期產生的 tree.json，交給 src/lib/canvas 的 controller
// （`mountCanvasTree`）畫成兩張 <canvas> 掛進 #canvas-host。
//
// ⚠️ **平移／縮放／hover／點選命中／鍵盤焦點都不在這支檔案裡了**：它們是「任何一張骰子樹
// 畫布都要有」的行為，`/tree` 與 `/sim` 共用同一份 controller（見 canvas-tree.ts 的檔頭）。
// 這裡只留 `/tree` 專屬的東西：搜尋、篩選、網址狀態同步、詳情卡片的擺位與視圖堆疊、
// 分支跳轉。畫面狀態（選取、前置鏈、被篩掉的節點）一律用 `tree.setState()` 交出去，
// 不再自己往 DOM 掛 class——canvas 裡什麼都不是元素，沒有 classList 可掛。
import rawData from '../generated/tree.json';
// ⚠️ **這份費用表刻意不進 tree.json**（tier 是 (maxLevel, unlockCost.gold) 的純函數，見
// PassiveUpgradeCost 的說明），所以走頁面 import 直接進 /tree 的 JS bundle，不吃那 20 KB
// 的 gzip 預算。`/sim` 用的是同一份檔案、同一種載法。詳情面板有兩個地方需要它：
// 「練滿 N 級累計」（1601 太陽強化的費用在 special 裡）與前置鏈的「前置練等」那一段。
import rawTables from '../../data/passive-upgrade-cost.json';
import { mountCanvasTree, type TreeHandle } from '../lib/canvas/canvas-tree.js';
import { cssMs } from '../lib/css-ms.js';
import { DESKTOP_ICON_TARGET_PX, MOBILE_ICON_TARGET_PX, minReadableScale } from '../lib/canvas/view.js';
import { computeSelection } from '../lib/selection.js';
import { renderDetail, nodeViewHtml, termViewHtml, awakeningViewHtml } from '../components/NodeDetail.js';
import { matchesFilter, stateToQueryString, queryStringToState, isTypingTarget } from '../lib/filter.js';
import type { Branch, NodeType, PassiveUpgradeCost, TreeData, TreeNode } from '../lib/types.js';
import { updateNavHeight } from '../lib/nav-height.js';

// tree.json 是建置期由 tools/build-data.ts 產生、結構保證符合 TreeData；
// 但 TS 對 JSON 匯入的型別推論會把 tuple（如 viewBox、size）寬鬆推成 number[]，
// 與 TreeData 的字面聯集/tuple 型別對不上，因此這裡用雙重斷言而非 any。
const data = rawData as unknown as TreeData;
const tables = rawTables as unknown as PassiveUpgradeCost;
// 提前建好：原本只有詳情面板那段在用，但下面「手機版初始視角」也要靠它從「網址帶的
// ?node=」反查該節點所屬分支，純資料處理、不依賴任何 DOM，提前宣告沒有副作用。
const byId = new Map(data.nodes.map(n => [n.id, n]));

// 動畫長度：cssMs() 的實作與注意事項在 src/lib/css-ms.ts（全站共用一份）。

// 導覽列高度：實作與說明在 src/lib/nav-height.ts（全站共用，見那裡的註解）。
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

// 只剩「頁面 chrome 的量測」：畫布本身的尺寸、dpr、高解析圖示門檻與投影門檻全部由
// controller 的 ResizeObserver ＋ 每幀 updateLod() 自己處理（見 canvas-tree.ts），
// 不必也不該在這裡再接一次線。
window.addEventListener('resize', () => {
  updateNavHeight();
  updateChipsHeight();
});

const hostOrNull = document.getElementById('canvas-host');
if (!hostOrNull) {
  throw new Error('找不到 #canvas-host，骰子樹畫布無法掛載');
}
// 收窄後的別名：TS 的 control-flow 窄化不會跨函式邊界，而 applyReadabilityFloor() 等
// 函式閉包會用到它（同下面 `panel` 的理由）。
const host: HTMLElement = hostOrNull;
// controller 會在 host 底下掛兩張 canvas（靜態層／互動層）與一份無障礙節點按鈕清單，
// 並自己接上 pointer（拖曳平移、雙指縮放、滾輪、hover 命中）與鍵盤焦點。
const tree: TreeHandle = mountCanvasTree(host, data);
// `vp` 是 controller 的座標狀態機（src/lib/canvas/view.ts）。下面既有的
// `vp.pan／vp.zoomAt／vp.scale／vp.pxPerUnit` 呼叫語意跟 SVG 時期一樣，
// ⚠️ 只有一點不同：**它吃的是相對 host 的 CSS px，不是 clientX/clientY**。
const vp = tree.view;
// 使用者一碰畫布就放棄進行中的置中平移——兩股力量同時改 view 會互相拉扯。
// 掛在 pointerdown／wheel 上（不是 pointermove）：手勢一開始就該讓位，不必等真的移動。
// ⚠️ 掛在 **host** 上而不是 canvas 元素上：controller 把 pointer 監聽器掛在互動層那張
// canvas（見 canvas-tree.ts 的說明），事件會冒泡到 host，一個掛勾同時涵蓋兩張 canvas
// 與無障礙按鈕清單，也不必知道 controller 內部把 canvas 叫什麼。
host.addEventListener('pointerdown', cancelCenterPan);
host.addEventListener('wheel', cancelCenterPan, { passive: true });

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
/**
 * 目前被篩掉的節點 id。
 *
 * 這是**唯一**一份「誰被篩掉」的事實：畫布拿它算 opacity（state.ts 的 nodeAlpha／
 * edgeAlpha／centerAlpha），`selectionFor()` 拿它算 hiddenByFilter。舊版把它散在 241 個
 * `<g>` 的 classList 上、再反過來 querySelector 讀回來。
 * ⚠️ 宣告放在這裡而不是 `applyFilter()` 旁邊：`selectionFor()` 比 `applyFilter()` 早定義，
 * 留在下面會落進 `let` 的暫時死區（本檔已經為同一個理由搬過三個變數，見下面的說明）。
 */
let filteredOut = new Set<string>();

// --- 手機版視角（task-17）：預設聚焦單一分支，不像桌機版一次看全部 5 個分支 ---
// 置中平移的 rAF 控制碼，以及卡片擺在節點的哪一邊。⚠️ 宣告刻意提到這裡（離它自己的函式很
// 遠），而且**是實際踩到的**：jumpToBranch()（手機版初始視角，模組初始化階段就會跑）會呼叫
// cancelCenterPan()，宣告留在函式旁邊時 400×800 與 720×800 都直接
// `ReferenceError: Cannot access 'centerRaf' before initialization`，整個模組掛掉、詳情面板
// 永遠是 hidden。1440×900 完全正常——桌機不走 jumpToBranch()，所以只有窄畫面會炸。
let centerRaf = 0;
// 卡片放在節點上方還是下方。select() 決定（見 sideLeastCovered()），positionPanel() 與
// centerOnSelected() 共用同一個值——兩邊各算一次的話，平移目標與實際擺法會對不上。
let panelSide: 'above' | 'below' = 'above';
// panelSide 是為了哪一顆節點算的。applyFilter() 每次輸入都會呼叫 select(currentSelected)，
// 不記這個的話會跟著重算——見 select() 裡的說明。
let sidePickedFor: string | null = null;
// 置中平移期間把卡片**釘在終點位置**，不讓它跟著節點跑（見 centerOnSelected()）。
let panelPinned = false;

/** 手機版斷點。要跟 src/pages/tree.astro 的媒體查詢保持一致，兩邊改動時一起改。 */
const NARROW_QUERY = '(max-width: 720px)';
// 只用於「載入當下要不要走手機版初始視角」這種一次性決定；跟著視窗變化的判斷請當場再問一次
// matchMedia（見 positionPanel()）。
// 故意不直接寫 `matchMedia(...)`：這支腳本的測試環境（linkedom）不提供 window.matchMedia，
// 直接呼叫會是 ReferenceError；`typeof matchMedia` 對完全沒宣告過的識別字回傳 'undefined'
// 而不會拋錯（JS 對 typeof 的特例），是安全的存在性檢查寫法，也讓測試可以用
// vi.stubGlobal('matchMedia', ...) 精準模擬手機環境（見 tests/scripts/tree-canvas.test.ts）。
const isMobile = typeof matchMedia === 'function' && matchMedia(NARROW_QUERY).matches;


/**
 * `fitTo(bounds)` 之後，如果算出來的縮放比 `minReadableScale()`（見 src/lib/canvas/view.ts）
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
 * ⚠️ 換成 canvas 之後量的是 **host** 的盒子（`#canvas-host`），不是畫布元素——canvas 是
 * controller 掛在 host 底下的子元素，尺寸就是跟著 host 走的（見 canvas-tree.ts 的
 * `measure()`）。`CanvasView.scale` 的 1 倍定義是「整張 viewBox 剛好塞進容器」，
 * 跟 `minReadableScale()` 的 `pxPerUnit` 是同一個基準，所以下限的數值語意原封不動。
 */
function applyReadabilityFloor(): void {
  const targetPx = isMobile ? MOBILE_ICON_TARGET_PX : DESKTOP_ICON_TARGET_PX;
  const rect = host.getBoundingClientRect();
  const floor = minReadableScale(
    rect.width,
    rect.height,
    data.meta.viewBox[2],
    data.meta.viewBox[3],
    tree.scene.diceIconWidth,
    targetPx,
  );
  if (vp.scale >= floor) return; // fitTo 給的倍率已經夠大，下限只是下限、不該把畫面往下拉

  // ⚠️ 錨點是**相對 host 的** CSS px（`CanvasView.zoomAt()` 的座標系），不是視窗座標——
  // 拿 rect.left + width/2 進去的話，host 有 offset 時畫面會被推走。
  vp.zoomAt(floor / vp.scale, rect.width / 2, rect.height / 2);
  tree.requestRedraw();   // 直接動 vp 的地方要自己排一幀，controller 只在自己的 pointer 路徑上排
}

/**
 * 把鏡頭移到指定分支（spec §6.2.6：桌機側欄 #branch-nav／手機底部分支 chip #branch-chips
 * 共用同一個 handler，不寫兩份跳轉邏輯；頁面載入時的手機版預設視角也直接呼叫這個函式，
 * 同一套邏輯只寫一次）。`fitTo(bounds)` 之後一律套用 `applyReadabilityFloor()`（桌機／
 * 手機都會，見該函式的說明）。
 */
function jumpToBranch(branch: Branch): void {
  cancelCenterPan();
  tree.fitBounds(data.meta.bounds[branch]);
  applyReadabilityFloor();
}

if (isMobile) {
  // 網址帶了 ?node= 就對準該節點所屬的分支，否則預設 'nature'（五個分支挑一個當預設是
  // 主觀決定，跟 brief 的參考實作一致，沿用 nature）。
  const initialBranch = currentSelected ? (byId.get(currentSelected)?.branch ?? 'nature') : 'nature';
  jumpToBranch(initialBranch);
} else {
  // 桌機初始視角：整棵樹塞進容器（`fitAll(1)`＝scale 1＝CanvasView 的「全貌」定義，
  // 見 view.ts 的 base／scale），一樣要套可讀性下限——容器夠扁
  // 時，「整棵樹塞進去」跟「看得清圖示」不可能同時成立，優先保證看得清，捲動交給使用者
  // （跟手機版分支視角的取捨邏輯一致，見 applyReadabilityFloor() 的說明）。
  tree.fitAll(1);
  applyReadabilityFloor();
}

// 桌機側欄（#branch-nav）與手機底部分支列（#branch-chips）是同一組 5 個
// button[data-branch]，靠 CSS 媒體查詢互斥顯示（見 src/pages/tree.astro），這裡用同一個
// querySelectorAll 把兩邊的按鈕一次接上同一個 jumpToBranch()，不寫兩份監聽器。
for (const btn of document.querySelectorAll<HTMLButtonElement>('#branch-chips button, #branch-nav button')) {
  btn.addEventListener('click', () => jumpToBranch(btn.dataset.branch as Branch));
}

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
  // ⚠️ 縮放錨點要用**畫布中心**（相對 host 的 CSS px），不是 innerWidth/2：`CanvasView`
  // 的座標系原點在 host 左上角，餵視窗座標進去的話 host 有 offset（導覽列高度）時，
  // 每按一次 +／− 畫面就會往一邊偏一段。平移是相對量，不受這件事影響。
  const box = host.getBoundingClientRect();
  // 方向鍵走 `tree.pan()` 而不是 `vp.pan()`：那條會順手作廢靜態層位圖並排一幀，
  // 平移露出來的區域才補得到（一次 60 px 是離散操作，重畫一次不影響手感）。
  if (e.key === 'ArrowLeft') tree.pan(step, 0);
  else if (e.key === 'ArrowRight') tree.pan(-step, 0);
  else if (e.key === 'ArrowUp') tree.pan(0, step);
  else if (e.key === 'ArrowDown') tree.pan(0, -step);
  else if (e.key === '+' || e.key === '=') vp.zoomAt(1.2, box.width / 2, box.height / 2);
  else if (e.key === '-') vp.zoomAt(1 / 1.2, box.width / 2, box.height / 2);
  else moved = false;
  if (moved) {
    // ⚠️ `cancelCenterPan()` 只能放在**確定是平移／縮放按鍵**的這條路上。
    // 放在 handler 開頭（一度是那樣寫的）會咬到兩件事：
    // (a) 節點上按 Enter 開卡片時，controller 的 onSelect 先跑 openNode() → animatePan()
    //     排好 rAF，同一個事件接著冒泡到 window 就把它取消——實測節點停在 x=172 而不是
    //     畫面中央 640，Enter 這條路等於完全沒有置中（isTypingTarget 只認
    //     INPUT/TEXTAREA/SELECT，焦點在無障礙節點按鈕上不會被前面那行擋掉）。
    // (b) 點擊開節點之後 200ms 內按任何一個鍵（Tab、Esc、任一個字母）都會把平移中途掐掉，
    //     節點卡在半路。
    cancelCenterPan();
    // 直接動 vp 的地方要自己排一幀（controller 只在自己的 pointer／wheel 路徑上排）。
    tree.requestRedraw();
  }
});

// --- 點選節點：前置鏈高亮 + 詳情面板 ---
// select(null) 清空選取；select(id) 算前置鏈，把「選了誰、鏈上有誰」寫進畫布狀態
// （`tree.setState`），並把詳情面板內容交給 renderDetail 畫。
// ⚠️ 高亮不再是 DOM class：canvas 裡的節點與邊不是元素，沒有 classList。舊版的
// `.in-chain`／`.has-selection`／`.filtered-out` 三條 opacity 規則已經原值搬進
// src/lib/canvas/state.ts 的 nodeAlpha()／edgeAlpha()／edgeColor()，那裡有自己的測試。
// #detail 的初始 hidden 狀態仍是跨任務的 DOM 契約（E2E 依賴），不要改。
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
  panel.hidden = id === null;
  syncUrl();
  if (id === null) {
    // 清空選取：鏈也要一起清掉，不然畫面會留著上一顆的金光。
    tree.setState({ selected: null, chain: new Set() });
    return;
  }

  const node = byId.get(id);
  if (!node) return;

  const sel = selectionFor(id);
  // 邊的高亮不必另外算：painter 用「兩端都在 chain 裡」判斷（state.ts 的 edgeAlpha／
  // edgeColor），跟舊版逐條 line 掛 .in-chain 是同一個判準，少一份會漂移的複本。
  tree.setState({ selected: id, chain: new Set(sel.chain) });

  renderDetail(node, sel, panel, data.meta.glossary, data.meta.upgradeCostTable, tables);
  viewStack = [{ view: { kind: 'node', id }, scrollTop: 0 }];
  // ⚠️ 只有「真的換了一顆節點」才重算擺法。`applyFilter()` 每次 input 事件都會呼叫
  // `select(currentSelected)` 重畫高亮（見那裡的註解），跟著重算有兩個問題：
  // (a) 每打一個字多兩次強制版面計算 ＋ 一次前置鏈模擬，疊在本來就有的 239 節點篩選上；
  // (b) `sideLeastCovered()` 模擬的是「**置中之後**」的螢幕座標，而篩選這條路徑根本不會
  //     置中——算出來的擺法描述的是一個不存在的版面。
  // 順帶讓擺法在打字期間保持穩定，卡片不會邊打字邊上下跳。
  if (id !== sidePickedFor) {
    // 兩趟：第一趟只是為了套上 max-height，量到夾制**之後**的真實高度，那是決定「上面還是
    // 下面比較不擋」的輸入；第二趟才是最終位置。一趟做不到——擺法要用高度算，高度又要先
    // 擺過一次才量得準。globalCap 的理由見 positionPanel() 的參數說明。
    panelSide = 'above';
    positionPanel({ globalCap: true });
    panelSide = sideLeastCovered(node, sel.chain, panel.getBoundingClientRect().height);
    sidePickedFor = id;
  }
  positionPanel();
}

/**
 * 某顆節點現在在螢幕上的矩形（相對 viewport 的 CSS px，含 host 的 offset）。
 *
 * 語意跟舊版的 `svg.querySelector('g.node[data-id=…] .icon').getBoundingClientRect()`
 * 完全相同，只是改成問幾何（controller 的 `nodeScreenRect()`）而不是問 DOM——canvas 裡
 * 的節點不是元素。`right`／`bottom` 在這裡補上，下面三個消費者（sideLeastCovered／
 * centerOnSelected／positionPanel）用的還是 DOMRect 那套欄位名。
 * 量不到版面（容器尺寸 0、還沒排版）時回 null，跟舊版「找不到元素就早退」一樣。
 */
function nodeRect(id: string): { left: number; top: number; right: number; bottom: number; width: number; height: number } | null {
  const r = tree.nodeScreenRect(id);
  return r && { ...r, right: r.left + r.width, bottom: r.top + r.height };
}

/**
 * 卡片要放節點上方還是下方：**實際算一遍兩種擺法各會蓋住幾個前置節點**，取少的那個。
 *
 * 為什麼一定要能翻面：五個分支的生長方向不同。1 系往上長、2／3 系往下長、4 系往左、
 * 5 系往右——「一律放上方」只解掉往上長與左右長的那三系，2／3 系深層節點的前置鏈整條
 * 在節點**上方**，卡片放上面照樣全蓋住（2026-08-23 實測：固定放上方時 239 顆有 155 顆
 * 仍有前置鏈被蓋，其中 2108 是 14 個蓋掉 13 個；能翻面之後降到 44 顆、單顆最多 5 個）。
 *
 * 為什麼不用「前置節點在上面的多還是下面的多」這種便宜的判斷：分支是扇形展開的，很多節點
 * 的前置鏈上下都有，而**離得遠的那些根本不在卡片的水平範圍內**，算進去只會把擺法帶偏。
 * 直接模擬一次就沒有這個誤差，成本也只是幾十次乘法。
 *
 * 只比上下、不比左右：左右兩側正是 4／5 系前置鏈延伸的方向，多一個維度只會讓擺法更難
 * 預期，而上下兩種已經把最壞情況從「整條鏈」壓到「零星一兩顆」。
 *
 * 模擬的座標系是**平移置中之後的螢幕座標**（節點會落在 innerWidth/2, targetCenterY）——
 * 那才是使用者真正看到的版面。使用者座標換算成 CSS px 的比例就是 view 的 `pxPerUnit`。
 */
function sideLeastCovered(node: TreeNode, chain: Set<string>, cardH: number): 'above' | 'below' {
  const n = nodeRect(node.id);
  if (!n) return 'above';
  const cardW = panel.getBoundingClientRect().width;
  const topLimit = panelTopLimit();
  // 一個使用者座標單位攤到幾個 CSS px。舊版是「根 svg 的 CTM ✕ 畫布自己的縮放」兩層相乘，
  // canvas 版直接就是 view 的 pxPerUnit（base ✕ scale），不必再問版面引擎。
  const ppu = vp.pxPerUnit;
  const others = [...chain]
    .filter(id => id !== node.id)
    .map(id => byId.get(id))
    .filter((o): o is TreeNode => !!o);
  if (others.length === 0) return 'above';

  const cx = window.innerWidth / 2;
  const radius = n.height / 2;
  const covered = (side: 'above' | 'below'): number => {
    const cy = targetCenterY(side, cardH, n.height, topLimit);
    const cardTop = side === 'above' ? cy - radius - GAP - cardH : cy + radius + GAP;
    const cardBottom = cardTop + cardH;
    const cardLeft = cx - cardW / 2;
    const cardRight = cardLeft + cardW;
    let hit = 0;
    for (const o of others) {
      const ox = cx + (o.x - node.x) * ppu;
      const oy = cy + (o.y - node.y) * ppu;
      if (ox + radius > cardLeft && ox - radius < cardRight
        && oy + radius > cardTop && oy - radius < cardBottom) hit++;
    }
    return hit;
  };
  // 平手維持預設的上方（卡片壓在節點上方時，視線是「先看卡片再往下看樹」，比反過來自然）。
  return covered('below') < covered('above') ? 'below' : 'above';
}

/**
 * 前置鏈計算 ＋ 把「被篩選淡出的前置有幾個」算進去。
 *
 * 抽出來是因為現在有兩個地方要它：`select()`（選節點）與視圖堆疊回到根視圖時的重繪。
 * `hiddenByFilter` 只能在這裡算——`computeSelection()` 是純函式、看不到畫面狀態，
 * 而「哪些節點正被篩掉」是畫面狀態不是資料。
 */
function selectionFor(id: string) {
  const sel = computeSelection(id, data, tables);
  sel.hiddenByFilter = [...sel.chain].filter(chainId => filteredOut.has(chainId)).length;
  return sel;
}

/** 卡片與節點、卡片與視窗邊界之間的留白（CSS px）。 */
const GAP = 12;
/**
 * 卡片高度的下限（CSS px）。
 *
 * 高度上限是「卡片那一側到畫面邊緣還剩多少」，而使用者可以把節點拖到貼著畫面上緣——那時
 * 上方的空間會趨近 0，照算會把卡片壓成一條看不出是什麼的細縫。低於這個值時寧可換到另一側
 * （另一側也塞不下才容許重疊，那已經是「整個視窗都放不下」的極端）。
 */
const MIN_PANEL_H = 200;
/**
 * 置中時多留給卡片的高度（CSS px），約一行的量。
 *
 * 不留的話節點會被推到「卡片剛好放得下」的位置，之後卡片只要長高一點點就會超過那一側的
 * 空間、被 max-height 裁掉而冒出捲軸。實際會長高的情形至少有一個：選好節點後在搜尋框打字，
 * 卡片多出「含 N 個被篩選隱藏的前置」一行（實測 279.7 → 312.2）。留一行就吸收得掉。
 */
const CENTER_SLACK = 40;
/**
 * 置中平移時要在節點下方留的空間（CSS px）。
 *
 * 卡片放在節點上方，所以「卡片放得下」等於「節點必須夠低」。這個值只用來算卡片的
 * `max-height` 上限，刻意是**常數**而不是量到的節點高度：節點大小會隨縮放在 9–50 CSS px
 * 之間變動（見 src/lib/canvas/view.ts 的 SHADOW_ON_AT_ICON_PX＝50），拿它當上限的話縮放時
 * 卡片會跟著一格一格改高度。56 蓋得住最大的那一顆。
 */
const NODE_ROOM = 56;

/**
 * 現在是不是窄畫面（手機版底部抽屜）。
 *
 * 每次都重新問一次 matchMedia，不用模組頂端那個載入時算一次的 `isMobile`——視窗是會被拉的。
 */
function isNarrow(): boolean {
  return typeof matchMedia === 'function' && matchMedia(NARROW_QUERY).matches;
}

/**
 * 卡片與置中平移共用的上界：**工具列下緣**。
 *
 * #toolbar 是疊在畫布左上角的固定圖層（搜尋框＋篩選），只看 --nav-h 的話卡片會滑到它底下、
 * 把搜尋框蓋掉一半。量它的實際下緣而不是再寫一個固定偏移量——這個 repo 的版面偏移量已經
 * 寫死出過三次 bug（見 CLAUDE.md）。
 */
function panelTopLimit(): number {
  const toolbarEl = document.getElementById('toolbar');
  return toolbarEl
    ? toolbarEl.getBoundingClientRect().bottom
    : parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-h')) || 48;
}

/** 置中平移的長度。跟 FILTERS_MS／SLIDE_MS 同一個原則：**從 CSS 讀**，不在 JS 寫第二份。 */
const CENTER_MS = cssMs('--t-med', 200);

/**
 * 中止進行中的置中平移。
 *
 * 使用者一動畫布（拖曳、滾輪、雙指、鍵盤方向鍵）或程式自己搬鏡頭（搜尋跳轉、分支跳轉）時
 * 都要叫：兩股力量同時寫 transform 的話，畫面會在兩個目標之間來回被拉扯。
 */
function cancelCenterPan(): void {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(centerRaf);
  centerRaf = 0;
  // 中途被打斷（使用者自己動畫布）時一定要解除釘住並重新對齊，否則卡片會停在一個
  // 「本來預定要到、但畫布沒走完」的位置，跟節點對不上而且再也不會自己修正。
  if (panelPinned) {
    panelPinned = false;
    positionPanel();
  }
}

/**
 * 以螢幕座標的位移量做一段緩動平移（easeOutCubic）。
 *
 * 逐幀累加**差值**而不是每幀重算絕對位置：`vp.pan()` 收的就是差值，這樣寫不必知道畫布現在
 * 在哪，也不會跟同一幀裡別的平移互相覆蓋。
 * `canAnimate()` 為 false（linkedom 測試環境沒有 rAF、或使用者要求減少動態）時直接跳到位。
 */
function animatePan(dx: number, dy: number, onDone: () => void): void {
  // ⚠️ 這裡**不**呼叫 cancelCenterPan()：它會順手解除釘住並重新對齊，而呼叫端正是在
  // 「卡片剛剛釘到終點」之後才進來的，清掉等於把剛擺好的位置又推回節點現在的位置。
  // 「取消上一段動畫」由呼叫端在釘住**之前**做。
  if (!canAnimate() || typeof performance === 'undefined'
    || (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5)) {
    tree.pan(dx, dy);   // 一步到位＝平移已經結束，走會補畫靜態層的那條
    onDone();
    return;
  }
  const start = performance.now();
  let done = 0;
  const step = (now: number): void => {
    const t = Math.min(1, (now - start) / CENTER_MS);
    const eased = 1 - (1 - t) ** 3;
    // 動畫中間的每一幀只 pan＋排一幀（直接動 vp 的地方要自己排，controller 只在自己的
    // pointer／wheel 路徑上排）；最後一幀才走 `tree.pan()` 補畫靜態層，把位圖邊距重新置中。
    // 每一幀都補畫的話，這段緩動就等於重畫 241 顆節點十幾次。
    if (t < 1) { vp.pan(dx * (eased - done), dy * (eased - done)); tree.requestRedraw(); }
    else tree.pan(dx * (eased - done), dy * (eased - done));
    done = eased;
    if (t < 1) {
      centerRaf = requestAnimationFrame(step);
      return;
    }
    centerRaf = 0;
    onDone();
  };
  centerRaf = requestAnimationFrame(step);
}

/**
 * 節點平移置中之後，它的垂直中心該落在哪（螢幕 CSS px）。
 *
 * 基準是「工具列下緣 → 視窗底部」的中央；卡片那一側放不下時，把節點往卡片的**反**方向
 * 推到剛好放得下為止（需求卡驗收 3：卡片完整顯示且不蓋到節點），能不動就不動。
 * `sideLeastCovered()` 也用同一個函式模擬兩種擺法，兩邊算出來的版面才會一致。
 */
function targetCenterY(
  side: 'above' | 'below',
  cardH: number,
  nodeH: number,
  topLimit: number,
): number {
  const center = (topLimit + window.innerHeight) / 2;
  const need = GAP + cardH + CENTER_SLACK;
  const lo = topLimit + GAP + nodeH / 2 + (side === 'above' ? need : 0);
  const hi = window.innerHeight - GAP - nodeH / 2 - (side === 'below' ? need : 0);
  // 兩邊擠不下時（極矮的視窗）以「卡片完整顯示」為優先，讓節點貼到另一側的邊。
  if (hi < lo) return side === 'above' ? hi : lo;
  return Math.min(Math.max(center, lo), hi);
}

/**
 * 把目前選取的節點平移到畫面中央，讓卡片那一側空出一整塊。
 *
 * ⚠️ 刻意**不放進 `select()`**：`applyFilter()` 每次都會呼叫 `select(currentSelected)` 來重畫
 * 高亮（見那裡的註解），放進去的話使用者在搜尋框每打一個字鏡頭就飛一次。這裡只掛在真正的
 * 「開啟一個節點」動線上：畫布點擊、鍵盤 Enter、以及 `?node=` 進站。
 *
 * 垂直目標是「工具列下緣 → 視窗底部」的中央；卡片比那個位置上方的空間還高時，把節點再往下
 * 推到「卡片剛好放得下」為止（需求卡驗收 3：卡片完整顯示且不蓋到節點）。水平目標就是視窗
 * 中央——側欄只是左上角一小塊浮層，畫布本身是整個視窗寬。
 */
function centerOnSelected(): void {
  if (isNarrow() || panel.hidden || !currentSelected) return;
  // 上一段還在跑就先收乾淨（含解除釘住），再重新量、重新釘。
  cancelCenterPan();
  const n = nodeRect(currentSelected);
  if (!n) return;

  const topLimit = panelTopLimit();
  // ⚠️ 要的是卡片的**自然高度**（只受整個可視區限制），不是它現在被那一側空間裁過的高度。
  // 節點此刻還在平移前的位置，那一側可能只剩一點空間；拿被裁過的高度算目標，平移完卡片
  // 長回自然高度就又會壓到節點——正是 2026-08-23 code review 抓到的那一族問題。
  positionPanel({ globalCap: true });
  const height = panel.getBoundingClientRect().height;

  const target = {
    cx: window.innerWidth / 2,
    cy: targetCenterY(panelSide, height, n.height, topLimit),
  };
  // ⚠️ 卡片**先跳到終點**，然後整段動畫只有畫布在走。
  // 讓卡片跟著節點一起滑看起來才「對」，但實際上不行：動畫途中節點還在畫面上緣附近，
  // 卡片被 top 的夾制壓在工具列下方、跟節點重疊，等節點降下來才彈回貼齊——2026-08-23
  // 實測那段垂直間距從 −50px 一路爬到 +12px，就是 Yuki 回報的「移動的動畫會閃爍」的另一半。
  // 釘住之後卡片一次到位、只有樹在底下滑進來，是安靜的。
  positionPanel({ nodeCenter: target });
  panelPinned = true;
  animatePan(
    target.cx - (n.left + n.width / 2),
    target.cy - (n.top + n.height / 2),
    () => {
      panelPinned = false;
      positionPanel();
    },
  );
}

/** 「使用者開啟了一個節點」：選取 ＋ 把鏡頭帶過去。`id` 為 null 時就只是清掉選取。 */
function openNode(id: string | null): void {
  select(id);
  if (id !== null) centerOnSelected();
}

/**
 * 把詳情卡片挪到被選節點**正上方**（2026-08-23 Yuki 指定；在那之前是「貼在節點左右兩側，
 * 右邊放不下就翻左邊」）。
 *
 * 為什麼不再左右擺：左右兩側正是前置鏈延伸出去的方向。2 系與 4 系長在畫布左半邊，深層節點
 * 的前置鏈整條往**右**長，而卡片預設就開在右邊——實測 `?node=4112`，9 個前置鏈節點有 7 個
 * 被卡片蓋住。翻面只是把問題丟給另一邊（1 系與 3 系反過來），真正沒有鏈的方向是上下。
 * 搭配 `centerOnSelected()`（選取時把節點平移到畫面中央）之後，節點上方永遠有一整塊空地。
 *
 * 只在桌機做。手機版的 #detail 是從螢幕底部升起的抽屜（見 src/pages/tree.astro 的媒體
 * 查詢），窄螢幕上根本沒有「節點旁邊」這種空間，硬擠只會兩邊都看不清。
 *
 * 位置規則：卡片**下緣**貼節點上緣（GAP），水平**中心**對齊節點中心；兩個方向都夾回可視
 * 範圍內，水平還要避開 #branch-nav 側欄。這幾個夾制不是防禦性程式碼——樹的四個角落本來就
 * 有節點，而使用者可以把畫布拖到任何位置，不夾就會有卡片一半在畫面外的情況。
 */
/**
 * @param opts.assumeHeight 用這個高度算位置，而不是量卡片現在的高度。
 *   換頁時用：高度正在動畫中，要先把**終點**的位置寫進 `top`，讓 top 與 height 同時跑完，
 *   卡片的**下緣**才會固定不動（＝「往上收」而不是「往下掉一截再回來」）。
 * @param opts.nodeCenter 用這個螢幕座標當節點中心，而不是量節點現在在哪。
 *   置中平移開始前用：先把卡片放到**平移結束後**該在的位置，整段動畫就只有畫布在動。
 *   傳了這個參數也代表「我知道自己在做什麼」，會蓋過 panelPinned 的早退。
 * @param opts.globalCap 高度上限改用「整個可視區」算，而不是「卡片那一側剩多少空間」。
 *   `select()` 量自然高度時用：那一刻節點還在平移前的位置，用當下的側邊空間算會量到一個
 *   被壓扁的高度，而置中的目標位置正是拿那個高度算的——目標會算錯，平移完卡片再長回來就
 *   又壓到節點了。
 */
function positionPanel(opts: {
  assumeHeight?: number;
  nodeCenter?: { cx: number; cy: number };
  globalCap?: boolean;
} = {}): void {
  // 這裡刻意**不用**模組頂端那個 isMobile：它在載入時算一次就定案，而視窗是會被拉的。
  // 桌機視窗拉窄到斷點以下時，CSS 會把面板切成底部抽屜（inset: auto 0 0 0），但這裡留下的
  // 行內 left/top 優先級更高，抽屜會被釘在桌機算出來的位置上（code review 實測：400×800 下
  // 面板停在 top=162、left=12、寬 400，右邊突出畫面外）。每次都重新問一次媒體查詢才對。
  if (isNarrow()) {
    panel.style.left = '';
    panel.style.top = '';
    panel.style.right = '';
    panel.style.maxHeight = '';
    return;
  }
  if (panel.hidden || !currentSelected) return;
  // 置中平移進行中：卡片已經放在終點，不要每幀再跟著節點算一次（見 centerOnSelected()）。
  if (panelPinned && !opts.nodeCenter) return;
  const now = nodeRect(currentSelected);
  if (!now) return;

  const topLimit = panelTopLimit();

  // 左右緣要避開 #branch-nav 側欄。只避 #toolbar 是不夠的：側欄比工具列矮但更長，760px 寬時
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
  //
  // 節點的「盒子」：尺寸一律用量到的（跟著縮放走），位置可以被 nodeCenter 換成終點座標。
  const n = opts.nodeCenter
    ? {
        top: opts.nodeCenter.cy - now.height / 2,
        bottom: opts.nodeCenter.cy + now.height / 2,
        left: opts.nodeCenter.cx - now.width / 2,
        width: now.width,
        height: now.height,
      }
    : now;

  // 高度上限。基準是工具列下緣而不是 --nav-h：CSS 的 max-height 用 --nav-h 起算，但實際起點
  // 低了約 68px，兩邊基準不一致時面板下緣會超出視窗——而面板最後一段固定是 spec §2.1 強制
  // 要求的「重置需要初期化券」災情警告，捲到底也看不到（code review 實測 1000×480 下超出
  // 43.8px）。先設上限、再量高度，量到的才是夾制後的結果。
  //
  // ⚠️ 上限用的是**卡片那一側到畫面邊緣還剩多少**，不是整個視窗的高度。
  // 用整窗高度算的話，卡片只要長到超過那一側的空間，下面的夾制就會把它推到節點身上——
  // 2026-08-23 code review 實測：選好節點後在搜尋框打一個字，卡片多出「含 N 個被篩選隱藏
  // 的前置」一行（279.7 → 312.2），四顆抽樣節點有三顆被卡片完全蓋住（重疊 467.6 px²）。
  // 那條路徑不會重新置中（刻意的，見 centerOnSelected() 的註解），所以只能靠上限自己收斂。
  const roomAbove = n.top - topLimit - GAP * 2;
  const roomBelow = window.innerHeight - n.bottom - GAP * 2;
  // 偏好側連 MIN_PANEL_H 都放不下、而另一側放得下時，這一次先讓到另一側。
  // ⚠️ opts.globalCap（select() 量自然高度時用）走的是另一條路：那時節點還沒平移到定位，
  // 拿當下的空間算會量到一個被壓扁的高度，而置中的目標位置正是用那個高度算出來的。
  const side: 'above' | 'below' = !opts.globalCap
    && (panelSide === 'above' ? roomAbove : roomBelow) < MIN_PANEL_H
    && (panelSide === 'above' ? roomBelow : roomAbove) >= MIN_PANEL_H
    ? (panelSide === 'above' ? 'below' : 'above')
    : panelSide;
  // 置中之後那一側必定放得下自然高度（見 targetCenterY()），所以這個上限在正常動線上不會
  // 真的裁到卡片；它只在使用者把節點拖到畫面邊緣、或內容變高之後才生效。
  const globalCap = Math.max(0, window.innerHeight - topLimit - GAP * 3 - NODE_ROOM);
  const sideRoom = Math.max(MIN_PANEL_H, side === 'above' ? roomAbove : roomBelow);
  panel.style.maxHeight = `${opts.globalCap ? globalCap : Math.min(globalCap, sideRoom)}px`;

  const rect = panel.getBoundingClientRect();
  const height = opts.assumeHeight ?? rect.height;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));

  // 垂直：卡片下緣貼節點上緣（above），或卡片上緣貼節點下緣（below）。
  // 夾制的下界是工具列下緣、上界是「卡片整張還留在視窗內」。
  const top = clamp(
    side === 'below' ? n.bottom + GAP : n.top - GAP - height,
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

  // 水平：中心對齊節點中心。
  const left = clamp(n.left + n.width / 2 - rect.width / 2, leftLimit, rightLimit);

  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
  panel.style.right = 'auto';
}

// 畫布一動（拖曳、滾輪縮放、雙指縮放、分支跳轉、初始視角……）卡片就要跟著節點跑。與其在
// 每個事件處理器後面各補一次呼叫（漏掉任何一個就會留下一張黏在原地的卡片），統一接
// controller 的 `onViewChange`——它在**每一幀畫完之後**呼叫一次，是所有平移縮放的唯一出口。
// （SVG 時期是拿 MutationObserver 監看 #viewport 的 style 屬性達到同一件事，現在那個元素
// 不存在了；換成回呼之後也不必再擔心「監看的屬性名字改了就靜靜失效」那一族坑。）
// 仍然保留 rAF 節流：一幀最多重新定位一次，避免每次寫入後立刻 getBoundingClientRect()
// 兩次再寫回 style 的讀寫交錯版面抖動。
let positionRaf = 0;
function schedulePositionPanel(): void {
  if (typeof requestAnimationFrame !== 'function') {
    positionPanel();
    return;
  }
  // ⚠️ 「已經排了就不要再排」，**不可以**寫成 cancelAnimationFrame() ＋ 重排。
  // 兩者都是「一幀最多做一次」，但取消重排會被**每幀都寫 transform** 的來源餓死：
  // 排好的回呼還沒輪到執行就被下一次寫入取消，如此循環，卡片一次都不會重新定位。
  // 2026-08-23 實測：置中平移（每幀寫一次）期間卡片完全不動，節點滑走 468px 之後卡片
  // 在最後一幀瞬移到位——那就是 Yuki 回報的「移動的動畫會閃爍」。
  // 拖曳看不出來只是因為 pointermove 沒有真的每幀都來（實測錯位最多 12px）。
  if (positionRaf) return;
  positionRaf = requestAnimationFrame(() => {
    positionRaf = 0;
    positionPanel();
  });
}
// 包一層而不是直接把 schedulePositionPanel 當 callback：它不收參數，而回呼日後若加上參數
// 會被靜靜地當成 options 傳進去。畫布一動就是「重新對齊」，不帶任何選項。
tree.onViewChange(() => schedulePositionPanel());
window.addEventListener('resize', () => schedulePositionPanel());

// 「使用者選了一顆節點」由 controller 判定：它在 pointerdown 當下用幾何命中記下被按到的
// 是誰、pointerup 時量位移過門檻就當拖曳不當點選（那兩件事以前寫在這裡，理由見
// canvas-tree.ts 的檔頭，連 setPointerCapture 會改標 target 那個坑一起搬過去了）。
// 空白處＝`id` 為 null＝清掉選取。
// 兩個來源（畫布點擊、無障礙按鈕上按 Enter）刻意做同一件事：Enter 也要置中（E2E 的 N5）。
tree.onSelect(id => openNode(id));

// Esc 掛在 host 上而不是 window：事件要先冒泡經過 host 才會觸發這裡，所以只有「焦點在畫布
// 內（無障礙節點按鈕或畫布本身）」時才生效。搜尋框不是 host 的子節點，使用者在搜尋框按 Esc
// 時事件不會流經這裡，不會被攔截去關詳情面板，留給搜尋框自己處理「清空搜尋」。
host.addEventListener('keydown', e => {
  if (e.key === 'Escape') select(null);
});

// --- 搜尋、篩選：算出被篩掉的節點、還原網址到 UI、掛事件監聽器 ---
//
// applyFilter() 必須先把 filteredOut 更新完，最後才呼叫 select(currentSelected)
// （如果目前有選取節點的話）——這正是 spec §6.3「前置鏈高亮是獨立圖層，優先於可見度」的
// 實作順序：淡出先算好套上去，select() 再把前置鏈上的節點/邊強制拉回全不透明＋高亮色，
// 覆寫掉剛剛套用的淡出。對 brief 草稿的裁決：不在 applyFilter() 外面再呼叫一次
// select(selected)——applyFilter() 內部已經呼叫過，外面重複呼叫只是多做一次一樣的事，
// 還容易在日後改動時兩處各改一半、行為對不上，所以拿掉了。
function applyFilter(): void {
  // 判定算一次就好。以前這個函式會把 matchesFilter() 跑過節點一輪、251 條邊的兩端各一輪、
  // 再一輪算 anyFiltered，updateFilterStatus() 又跑第四輪——每一次按鍵約 1,200 次呼叫，
  // 每次都要 normalizeQuery() 再對 name／description／keywords 做 includes（code review 指出）。
  filteredOut = new Set(data.nodes.filter(n => !matchesFilter(n, filterState)).map(n => n.id));
  // 邊與中央樞紐不必在這裡各算一次：painter 用同一份 filteredOut 推導——邊是「兩端都被
  // 篩掉才淡出」（只連著一個可見節點時使用者還關心它的另一端），樞紐是「只要有任何節點
  // 被篩掉就一起淡下去」（否則它會變成全畫面唯一還亮著的東西）。判準與數值原封不動搬進
  // src/lib/canvas/state.ts 的 edgeAlpha()／centerAlpha()，由 tests/lib/canvas/state.test.ts 守。
  tree.setState({ filteredOut });
  const matchCount = data.nodes.length - filteredOut.size;

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
 * 「現在有篩選在生效」這件事要看得出來，而且要有出路。
 *
 * 這條存在的理由是可讀性，不是好看：搜尋只命中兩三個節點時，畫面上是 236 個淡掉的節點加
 * 243 條淡掉的邊，數量壓過那幾個命中的目標，看起來就像「什麼都沒發生」；而 ?q= 不會因為
 * 點空白處而清掉（那只清 ?node=），使用者會覺得畫面卡住了、也找不到回去的路。
 *
 * 2026-08-22 換了表達方式：原本是工具列上一句「符合 N 個節點」＋清除鈕，但它夾在搜尋框與
 * 篩選鈕中間，工具列寬度會跟著篩選狀態伸縮（Yuki 回報）。現在改成
 *   - 切換鈕上一顆固定尺寸的金點（`.active`）——收起面板時唯一的線索，寬度不變；
 *   - 清除鈕搬進面板裡，只在有篩選時出現。
 * 兩者都不影響工具列的尺寸。
 */
function updateFilterStatus(matchCount: number): void {
  const active = hasActiveFilter();
  const toggle = document.getElementById('filters-toggle');
  toggle?.classList.toggle('active', active);
  // 零命中要看得出來：整張畫布會淡成一片灰，沒有任何東西說「是篩選把它們藏起來的」。
  // 金點改成警示色是唯一不動到版面的表達方式（工具列的尺寸不准隨篩選狀態改變，見 O2）。
  toggle?.classList.toggle('none', active && matchCount === 0);
  document.getElementById('filter-clear')?.toggleAttribute('data-idle', !active);

  // 螢幕閱讀器的播報。畫面上不顯示（Yuki 指定），但輔助技術不該跟著什麼都收不到。
  const live = document.getElementById('filter-live');
  if (live) {
    live.textContent = !active
      ? `顯示全部 ${data.nodes.length} 個節點`
      : matchCount === 0
        ? '沒有符合的節點'
        : `符合 ${matchCount} 個節點`;
  }
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
  cancelCenterPan();
  const xs = matched.map(n => n.x);
  const ys = matched.map(n => n.y);
  const PAD = 90;
  // 下限 400：只命中一個節點時，包圍盒只有內距那麼大，fitTo 會一路放大到 8 倍上限，
  // 整個畫面只剩一顆圖示、完全失去「它在樹的哪裡」這個資訊。
  const w = Math.max(400, Math.max(...xs) - Math.min(...xs) + PAD * 2);
  const h = Math.max(400, Math.max(...ys) - Math.min(...ys) + PAD * 2);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  tree.fitBounds([cx - w / 2, cy - h / 2, w, h]);
  applyReadabilityFloor();
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

// --- 篩選面板的收合（task-17 起，2026-08-22 擴到桌機）---
// #filters 預設收起、靠 .open 展開，桌機與手機同一套。桌機以前沒有這顆切換鈕，篩選鈕永遠
// 攤在工具列上；現在兩邊都收得起來。
const filtersToggle = document.getElementById('filters-toggle');

/**
 * 現在是不是「抽屜版面」（窄螢幕）。
 *
 * 兩者的差別不只是寬度：窄螢幕上面板是蓋在畫布上的抽屜，Esc 與點外面都該關掉它；桌機上它
 * 是工具列的一部分、會一直開著——那裡如果也綁「點外面就關」，使用者每次平移畫布都會把自己
 * 的篩選面板關掉。斷點跟 tree.astro 的手機媒體查詢同一個 720px。
 */
const drawerQuery = typeof matchMedia === 'function' ? matchMedia('(max-width: 720px)') : null;
function isDrawerLayout(): boolean {
  return drawerQuery?.matches ?? false;
}

/** 開關抽屜，並把狀態同步到 aria——按鈕的 aria-label 以前永遠是「展開篩選」，也沒有 aria-expanded。 */
/** 收合過場的長度。跟 --slide-ms 同一個原則：**從 CSS 讀**，不在 JS 寫第二份。 */
const FILTERS_MS = cssMs('--t-med', 200);
let filtersAnimTimer: number | undefined;
/**
 * 面板「應該是」開還是關。
 *
 * ⚠️ 不要改回讀 `filtersEl.classList.contains('open')`：收合的過場結束前 `.open` 還掛著
 * （要等收尾的 setTimeout 才拿掉），過場中再按一次切換鈕，算出來的下一個狀態會是「再關一次」，
 * 面板就卡在關閉、aria-expanded 也停在 false（2026-08-22 E2E 的 O3 連按兩下抓到）。
 */
let filtersOpen = false;

/**
 * 開關篩選面板，並把狀態同步到 aria——按鈕的 aria-label 以前永遠是「展開篩選」，也沒有
 * aria-expanded。
 *
 * `animate` 只在**桌機**（面板橫向長在工具列上）才會真的動：那裡收合是左右伸縮，動畫看得懂。
 * 抽屜版面是上下掉出來的一整塊，橫向動畫在那裡是錯的，直接瞬間切換。
 *
 * 為什麼要用 JS 量寬度而不是純 CSS：`display: none ↔ flex` 不能過場，而 `width: auto` 也
 * 不是可內插的值。量出自然寬度、暫時鎖成 px 再動，動完把 inline width 拿掉讓它回到自然
 * 排版——最後這步不能省，否則視窗一縮，面板會卡在當初量到的寬度、不會再換行。
 */
function setFiltersOpen(open: boolean, animate = false): void {
  filtersOpen = open;
  filtersToggle?.setAttribute('aria-expanded', String(open));
  filtersToggle?.setAttribute('aria-label', open ? '收起篩選' : '展開篩選');

  window.clearTimeout(filtersAnimTimer);
  filtersEl.style.width = '';
  filtersEl.classList.remove('animating');

  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!animate || isDrawerLayout() || reduced) {
    filtersEl.classList.toggle('open', open);
    return;
  }

  if (open) {
    filtersEl.classList.add('open');
    const target = filtersEl.getBoundingClientRect().width;
    filtersEl.classList.add('animating');
    filtersEl.style.width = '0px';
    // 兩層 rAF：第一層讓 width: 0 先進到算繪，第二層改成目標值才會被當成過場的起點。
    // 少一層的話瀏覽器會把兩次寫入合併成一次，動畫整個不發生（同 dice.astro 的滑動）。
    requestAnimationFrame(() => requestAnimationFrame(() => {
      filtersEl.style.width = `${target}px`;
    }));
  } else {
    const from = filtersEl.getBoundingClientRect().width;
    filtersEl.classList.add('animating');
    filtersEl.style.width = `${from}px`;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      filtersEl.style.width = '0px';
    }));
  }

  // 用 setTimeout 而不是 transitionend：後者在元素被 display:none、動畫被中斷、或分頁切到
  // 背景時不一定會派發，收尾漏掉就會留下一個鎖死寬度的面板（同 tree-canvas 其他過場的做法）。
  filtersAnimTimer = window.setTimeout(() => {
    filtersEl.classList.remove('animating');
    filtersEl.style.width = '';
    if (!open) filtersEl.classList.remove('open');
  }, FILTERS_MS + 20);
}
// 桌機預設展開（維持這一頁一直以來的樣子），手機預設收起。之後由使用者自己按。
setFiltersOpen(!isDrawerLayout());

filtersToggle?.addEventListener('click', () => {
  setFiltersOpen(!filtersOpen, true);
});

// 跨過 720px 斷點時把面板重設回該版面的預設值。
// 少了這條：桌機開著面板把視窗縮到手機寬度，`.open` 會被手機的媒體查詢變成一個使用者從沒
// 打開過的全寬抽屜，直接吃掉畫布上緣；反過來從手機拉寬，桌機會停在收起狀態，跟文件寫的
// 「桌機預設展開」不符（2026-08-22 review 抓到，實測縮到 500px 後工具列高 196px）。
// 用 matchMedia 的 change 事件而不是 resize：它只在真的跨過斷點時派發，不必自己記上一次的狀態。
// ⚠️ 要先確認 addEventListener 真的存在：單元測試的 linkedom 環境只給了 matchMedia 一個
// 回傳 `{ matches }` 的替身，沒有事件介面，直接掛會整支腳本在載入時就丟錯。
if (typeof drawerQuery?.addEventListener === 'function') {
  drawerQuery.addEventListener('change', event => {
    setFiltersOpen(!event.matches);
  });
}

// 抽屜要有出路。舊版展開後會蓋住自己的切換鈕，而且沒有 Esc、沒有點外面關閉——唯一的辦法是
// 重新整理。版面修好之後切換鈕不再被蓋住，這兩條是額外的出口（也是一般抽屜該有的行為）。
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && isDrawerLayout() && filtersOpen) {
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
  // 只有抽屜版面才「點外面就關」。桌機的面板是工具列的一部分，平移畫布不該把它關掉。
  if (!isDrawerLayout() || !filtersOpen) return;
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
const SLIDE_MS = cssMs('--slide-ms', 280);

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

/**
 * 換頁動畫**收尾時**的焦點處理：焦點已經被移到面板外的其他元素上時，不要搶回來。
 *
 * 收尾回呼要等 `SLIDE_MS`（約 280ms）才跑，而使用者在那段時間裡是可以繼續操作的。無條件
 * `focusView(toEl)` 會把焦點從他剛剛按下的東西上偷走——實際症狀（Task 12 報告 §5 ④，E2E 的
 * Z6 偶發紅燈就是它）：點 `#關鍵字` 之後隨即點 `#filters-toggle` 打開篩選抽屜，280ms 後焦點
 * 被拉回 `#detail`，而面板的 keydown 對 Escape 是無條件 `stopPropagation()` 的，於是
 * `document` 上那條「Esc 關抽屜」永遠收不到事件，抽屜關不掉。
 *
 * 判準是「焦點還在面板裡，或根本沒落在任何元素上」——後者涵蓋原本要修的那件事：舊視圖一被
 * `hidden` 起來，剛按下的那顆按鈕就消失、焦點掉回 `<body>`（在有些環境是 null／undefined），
 * 那時仍然要把焦點移進新視圖。
 */
function focusViewAfterSlide(el: HTMLElement): void {
  const active = document.activeElement;
  if (!active || active === document.body || panel.contains(active)) focusView(el);
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
    : nodeViewHtml(node, selectionFor(view.id), data.meta.glossary, data.meta.upgradeCostTable, tables);
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
  // ⚠️ 用 getBoundingClientRect().height 不用 offsetHeight：後者**四捨五入成整數**
  // （實測 280 vs 實際 279.7）。這個值是動畫終點餵給 positionPanel() 的高度，差 0.3px 就會
  // 讓卡片在動畫最後一格越過落定位置、再被收尾的重新定位拉回來——肉眼看不到，但那是一次
  // 真正的反向，Z4 的「不反向」斷言（門檻 0.3px）會直接紅。
  // 2026-08-23 兩欄版面把自然高度從 280 改成 279.7，剛好把這個既有的取整誤差推過門檻。
  const toPanelH = panel.getBoundingClientRect().height;
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
    focusViewAfterSlide(toEl);
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
    focusViewAfterSlide(toEl);
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

// 搜尋框按 Esc＝清空搜尋，不是取消節點選取（那是取消選取／關閉面板，屬於上面掛在
// #canvas-host 的 keydown handler 的事）。兩者天然不會互相干擾：#search 不是 host 的
// 子節點，這裡的 Esc 不會冒泡到 host 去多關一次詳情面板；stopPropagation() 純粹是防呆，
// 避免日後 DOM 結構調整（例如把搜尋框移進 host 底下）導致意外冒泡出兩套 Esc 語意打架。
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
// `?node=` 進站也要置中——分享連結指名了一顆節點，它落在初始視角的哪個角落是隨機的。
// 順序在 focusMatches() **之後**：兩個參數同時出現時，指名的那顆節點比「命中的那一群」具體。
// 選取本身是上面 applyFilter() 內部的 select(currentSelected) 做掉的（見那裡的註解），
// 這裡只補鏡頭；centerOnSelected() 自己會在窄畫面／沒有選取時直接返回。
centerOnSelected();
