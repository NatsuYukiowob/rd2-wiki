// 整合測試：實際執行 src/scripts/tree-canvas.ts（不是重寫一份邏輯來斷言），驗證搜尋／
// 篩選／網址狀態同步／視圖堆疊真的接對線。本環境沒有瀏覽器，用 linkedom 模擬 document／
// window，並手刻 location／history 存根（linkedom 不提供這兩個全域物件，見下面
// makeLocationAndHistory() 的說明）。
//
// ⚠️ **2026-09-06 換成 Canvas 之後，斷言改問狀態不問 DOM。** 畫布裡的節點與邊不再是元素，
// 沒有 classList 可查（舊版是 `g.node[data-id=…].classList.contains('filtered-out')`）。
// 渲染器主動把「選了誰、鏈上有誰、誰被篩掉、縮放多少、某顆節點在螢幕上的矩形」包成
// `window.__tree`（src/lib/canvas/debug-api.ts），這裡改問它——E2E 也是問同一份介面。
// 「一條邊該不該淡出／該不該變金色」那組規則搬進 src/lib/canvas/state.ts 的 edgeAlpha()／
// edgeColor()，由 tests/lib/canvas/state.test.ts 直接對純函式驗（比從整頁腳本繞一圈準確），
// 所以這裡不再有「邊的 filtered-out」那一組測試。
//
// linkedom 沒有 canvas 2D context（`getContext` 不存在），controller 對它回 null 有守衛，
// 掛得起來但一個像素都不會畫；也沒有版面引擎，所以容器尺寸由測試自己 stub 在
// `#canvas-host` 的 getBoundingClientRect 上（controller 的 measure() 讀的就是它）。
// **stub 必須在 import 之前掛**：初始視角是在模組執行期算的，晚一步就量到 0×0。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseHTML, Event as LinkedomEvent } from 'linkedom';
import {
  CanvasView,
  DESKTOP_ICON_TARGET_PX,
  MOBILE_ICON_TARGET_PX,
  minReadableScale,
} from '../../src/lib/canvas/view';
import type { Branch, TreeData } from '../../src/lib/types';

const treeData: TreeData = JSON.parse(readFileSync('src/generated/tree.json', 'utf8'));

/** 偵錯介面裝在 globalThis（瀏覽器＝window），測試也從 globalThis 讀。 */
interface TreeState {
  selected: string | null; chain: string[]; filteredOut: string[]; focus: string | null;
}
interface DebugApi {
  count(): { nodes: number; edges: number };
  scale(): number;
  nodeScreenRect(id: string): { left: number; top: number; width: number; height: number } | null;
  state(): TreeState;
}
const debug = (): DebugApi => (globalThis as unknown as { __tree: DebugApi }).__tree;

/** 桌機容器：#canvas-host 是 flex 子元素，吃掉 nav（50.59）與 footer（73.94）之外的剩餘
 * 高度（Playwright Desktop Chrome 1280×720 實測）。**不要再自己算一個「視窗高 − 常數」**：
 * 舊註解寫的 610 是從 `calc(100vh - 110px)` 那個寫死偏移量推來的，而那個 110 本身就是錯的。
 * 它只是給 stub 用的近似容器尺寸，真正的版面正確性由 E2E 的 U 守著。 */
const DESKTOP_W = 1280;
const DESKTOP_H = Math.round(720 - 50.59 - 73.94);
/** host 在視窗裡的位置。**刻意不是 (0,0)**：`CanvasView` 的座標原點在 host 左上角，而
 * `nodeScreenRect()` 回的是視窗座標（含 host 的 offset）。兩者混用（例如把
 * `rect.top + height / 2` 當縮放錨點）在 top=0 的 stub 下完全看不出來，這裡放一個真實的
 * 導覽列高度，讓「錨點用錯座標系」這種錯真的會紅。 */
const HOST_LEFT = 0;
const HOST_TOP = 50;

/** 跟 controller 同一套：先 resize 成容器尺寸，再做事。 */
function viewOf(w: number, h: number): CanvasView {
  const v = new CanvasView(treeData.meta.viewBox);
  v.resize(w, h);
  return v;
}

/** 用真正的 `CanvasView.fitTo()` 現算「跳到某分支時，還沒套可讀性下限的原始縮放」。
 * 以前這些期望值是手算後寫死的小數，分支包圍盒一動（換版面、加一個節點）測試就會紅，
 * 而紅的原因跟它要守的行為（點按鈕有沒有真的呼叫 fitBounds）完全無關。 */
function rawFitScale(branch: Branch, w: number, h: number): number {
  const v = viewOf(w, h);
  v.fitTo(treeData.meta.bounds[branch]);
  return v.scale;
}

/** 對應 tree-canvas.ts 的 applyReadabilityFloor()：同一組容器尺寸下的可讀性下限。 */
function readabilityFloor(w: number, h: number, targetPx: number): number {
  const [, , vbw, vbh] = treeData.meta.viewBox;
  const diceWidth = treeData.nodes.find(n => n.type === 'dice')!.size[0];
  return minReadableScale(w, h, vbw, vbh, diceWidth, targetPx);
}

/** 跳到某分支、套完可讀性下限之後，view 應該長什麼樣（縮放 ＋ 位移都在裡面）。 */
function expectedBranchView(branch: Branch, w: number, h: number, targetPx: number): CanvasView {
  const v = viewOf(w, h);
  v.fitTo(treeData.meta.bounds[branch]);
  const floor = readabilityFloor(w, h, targetPx);
  // 錨點是容器中心（相對 host 的 CSS px），跟 applyReadabilityFloor() 用同一個。
  if (v.scale < floor) v.zoomAt(floor / v.scale, w / 2, h / 2);
  return v;
}

/**
 * 「某顆節點現在畫在螢幕上的哪裡」跟一個獨立算出來的 `CanvasView` 一致。
 *
 * 只驗縮放不夠：可讀性下限是用 `zoomAt(k, 錨點)` 疊上去的，錨點挑錯（例如拿 viewBox 中心
 * 或視窗座標當錨點）縮放值一樣正確，畫面卻會整個滑走。這裡不重算 zoomAt 的位移公式
 * （那等於在測試裡抄一份實作），改成拿同一套 CanvasView API 算出期望位置再比對。
 * `v` 算的是容器內座標，`nodeScreenRect()` 回的是視窗座標，差一個 host 的 offset。
 */
function expectNodeDrawnAt(id: string, v: CanvasView): void {
  const n = treeData.nodes.find(x => x.id === id)!;
  const [sx, sy] = v.worldToScreen(n.x, n.y);
  const k = v.pxPerUnit;
  const r = debug().nodeScreenRect(id)!;
  expect(r.left).toBeCloseTo(HOST_LEFT + sx - (n.size[0] * k) / 2, 6);
  expect(r.top).toBeCloseTo(HOST_TOP + sy - (n.size[1] * k) / 2, 6);
  expect(r.width).toBeCloseTo(n.size[0] * k, 6);
}

const BRANCH_VALUES = ['nature', 'engineering', 'magic', 'order', 'chaos'];
const TYPE_VALUES = ['dice', 'rune', 'passive', 'support'];

function pageHtml(): string {
  const branchInputs = BRANCH_VALUES.map(b => `<input type="checkbox" data-branch="${b}">`).join('');
  const typeInputs = TYPE_VALUES.map(t => `<input type="checkbox" data-type="${t}">`).join('');
  // #branch-nav（桌機側欄）與 #branch-chips（手機底部列）用同一組 data-branch 按鈕，
  // 跟正式頁面（src/pages/tree.astro）的結構一致——tree-canvas.ts 用同一個
  // querySelectorAll('#branch-chips button, #branch-nav button') 把兩邊接上同一個
  // handler，這裡兩邊都要有才能測到「共用同一個 handler」這件事。
  const branchButtons = BRANCH_VALUES.map(b => `<button type="button" data-branch="${b}">${b}</button>`).join('');
  return `<html><body>
    <div id="toolbar">
      <button id="filters-toggle" type="button">篩選</button>
      <input id="search" type="search">
      <div id="filters">${branchInputs}${typeInputs}</div>
    </div>
    <nav id="branch-nav">${branchButtons}</nav>
    <div id="canvas-host"></div>
    <aside id="detail" hidden></aside>
    <div id="branch-chips">${branchButtons}</div>
  </body></html>`;
}

/** location／history 的手刻存根：linkedom 的 window 不含這兩個全域物件（實測驗證過，
 * 見 task-16 報告），tree-canvas.ts 用 history.replaceState(null, '', url) 寫網址、
 * 用 location.search 讀初始網址，這裡用一個共用的 `search` 字串模擬單一事實來源。 */
function makeLocationAndHistory(initialSearch: string) {
  const box = { search: initialSearch, pathname: '/tree' };
  const location = {
    get search() {
      return box.search;
    },
    get pathname() {
      return box.pathname;
    },
  };
  // 視圖堆疊把深度存在 history.state 裡、並用 back()/go() 退回（見 tree-canvas.ts 的
  // HISTORY_DEPTH_KEY），所以存根要有一疊真的 state，不能只是幾個空函式——空函式會讓
  // 「按上一頁等於卡片返回」這件事在測試裡永遠是綠的，實際上壞掉也看不出來。
  const entries: unknown[] = [null];
  let index = 0;
  const firePopState = () => {
    (globalThis as { window?: { dispatchEvent?: (e: unknown) => void } }).window
      ?.dispatchEvent?.(new LinkedomEvent('popstate'));
  };
  const history = {
    get state() {
      return entries[index];
    },
    replaceState(state: unknown, _title: string, url: string) {
      entries[index] = state;
      const qIdx = url.indexOf('?');
      box.search = qIdx >= 0 ? url.slice(qIdx) : '';
    },
    pushState(state: unknown, _title: string, _url: string) {
      entries.length = index + 1;
      entries.push(state);
      index += 1;
    },
    go(delta: number) {
      index = Math.max(0, Math.min(entries.length - 1, index + delta));
      firePopState();
    },
    back() {
      history.go(-1);
    },
  };
  return { location, history, box };
}

async function loadTreePage(
  initialSearch: string,
  opts: { mobile?: boolean; width?: number; height?: number } = {},
) {
  const { document, window } = parseHTML(pageHtml());
  const { location, history, box } = makeLocationAndHistory(initialSearch);

  // ⚠️ 容器尺寸的 stub 必須在 import 之前掛：controller 的 measure() 在 mountCanvasTree()
  // 當下就讀一次，初始視角（fitAll／jumpToBranch ＋ 可讀性下限）也是在模組執行期算完的。
  // linkedom 沒有 ResizeObserver，事後才掛沒有任何東西會回頭重量一次。
  const width = opts.width ?? DESKTOP_W;
  const height = opts.height ?? DESKTOP_H;
  Object.assign(document.getElementById('canvas-host')!, {
    getBoundingClientRect: () => ({
      x: HOST_LEFT, y: HOST_TOP, left: HOST_LEFT, top: HOST_TOP,
      right: HOST_LEFT + width, bottom: HOST_TOP + height, width, height,
    }),
  });

  vi.stubGlobal('document', document);
  vi.stubGlobal('window', window);
  vi.stubGlobal('location', location);
  vi.stubGlobal('history', history);
  vi.stubGlobal('innerWidth', 1200);
  vi.stubGlobal('innerHeight', 800);
  // tree-canvas.ts 執行期用 `instanceof HTMLInputElement` 判斷 #search，這裡要指向
  // 跟 document 同一份 linkedom class（不能用 Node 全域裡沒有的同名類別）。
  vi.stubGlobal('HTMLInputElement', window.HTMLInputElement);
  if (opts.mobile) {
    // 模擬手機版：tree-canvas.ts 用 `typeof matchMedia === 'function' &&
    // matchMedia('(max-width: 720px)').matches` 判斷 isMobile（見那支檔案的說明），
    // 這裡直接 stub 成永遠回傳 matches:true——這支腳本只用這一個查詢字串呼叫它。
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query }) as unknown as MediaQueryList);
  }

  vi.resetModules();
  await import('../../src/scripts/tree-canvas');

  return {
    document,
    getSearchBox: () => box.search,
    searchInput: document.getElementById('search') as unknown as HTMLInputElement,
    filtersEl: document.getElementById('filters')!,
    detailEl: document.getElementById('detail')!,
    state: () => debug().state(),
    scale: () => debug().scale(),
  };
}

// linkedom 匯出的 Event 類別跟 lib.dom.d.ts 的 Event 型別結構對不齊（缺
// composed/currentTarget/isTrusted/initEvent 這些瀏覽器原生才有的欄位），但兩者在
// dispatchEvent() 實際需要的介面（type/bubbles/cancelable）上是相容的，這裡統一經過
// unknown 轉型，只在這個測試檔案的邊界做，不影響其他程式碼的型別安全。
function fireChange(el: Element): void {
  el.dispatchEvent(new LinkedomEvent('change', { bubbles: true }) as unknown as Event);
}
function fireInput(el: Element): void {
  el.dispatchEvent(new LinkedomEvent('input', { bubbles: true }) as unknown as Event);
}
function fireKeydown(el: Element, key: string): void {
  const ev = new LinkedomEvent('keydown', { bubbles: true, cancelable: true }) as unknown as Event & { key: string };
  Object.defineProperty(ev, 'key', { value: key });
  el.dispatchEvent(ev);
}
function fireClick(el: Element): void {
  el.dispatchEvent(new LinkedomEvent('click', { bubbles: true }) as unknown as Event);
}

describe('tree-canvas 整合：搜尋、篩選、網址狀態同步', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // 真實資料回歸案例（與 tests/lib/filter.test.ts 的「1002 hiddenByFilter 真實資料驗算」
  // 對同一組數字，這裡從「實際跑過的頁面腳本」再驗一次，不是重算）：
  // 1002 尖刺骰子的前置鏈＝{1001,1002,1006 為 dice；1102,1103,1109 為 passive}，
  // 只勾類型=dice 時，3 個 passive 前置應該同時出現在 filteredOut 與 chain 裡
  // （前置鏈高亮覆寫篩選，spec §6.3——真正把「鏈上的節點即使被篩掉也全不透明」畫出來的
  //  是 state.ts 的 nodeAlpha()，那條規則由 tests/lib/canvas/state.test.ts 守），
  // detail 面板要出現「含 3 個被篩選隱藏的前置」。
  it('網址帶 ?node=1002&type=dice 載入：checkbox 還原勾選、前置鏈與篩選同時成立、面板顯示 hiddenByFilter=3', async () => {
    const page = await loadTreePage('?node=1002&type=dice');

    const diceCb = page.filtersEl.querySelector<HTMLInputElement>('input[data-type="dice"]')!;
    expect(diceCb.checked).toBe(true);
    for (const t of ['rune', 'passive', 'support']) {
      expect(page.filtersEl.querySelector<HTMLInputElement>(`input[data-type="${t}"]`)!.checked).toBe(false);
    }
    for (const b of BRANCH_VALUES) {
      expect(page.filtersEl.querySelector<HTMLInputElement>(`input[data-branch="${b}"]`)!.checked).toBe(false);
    }

    expect((page.detailEl as unknown as HTMLElement).hasAttribute('hidden')).toBe(false);

    const st = page.state();
    expect(st.selected).toBe('1002');
    for (const id of ['1102', '1103', '1109']) {
      expect(st.filteredOut).toContain(id);
      expect(st.chain).toContain(id);
    }
    for (const id of ['1001', '1002', '1006']) {
      expect(st.filteredOut).not.toContain(id);
      expect(st.chain).toContain(id);
    }

    const detailText = (page.detailEl as unknown as HTMLElement).textContent ?? '';
    expect(detailText).toContain('含 3 個被篩選隱藏的前置');
  });

  it('沒有選取節點時，光是勾選分支就會把不符合的節點放進 filteredOut、並寫回網址', async () => {
    const page = await loadTreePage('');
    const natureCb = page.filtersEl.querySelector<HTMLInputElement>('input[data-branch="nature"]')!;
    natureCb.checked = true;
    fireChange(natureCb);

    // 1001 火骰子（nature）應該可見，2001 鐵甲骰子（engineering）應該被篩掉。
    const st = page.state();
    expect(st.filteredOut).not.toContain('1001');
    expect(st.filteredOut).toContain('2001');
    expect(page.getSearchBox()).toBe('?branch=nature');
  });

  it('搜尋「混沌」比對得到渾沌節點，且原樣寫回網址（正規化只在比對時做，不改使用者輸入）', async () => {
    const page = await loadTreePage('');
    page.searchInput.value = '混沌';
    fireInput(page.searchInput);

    // 不挑特定 id 斷言（真實資料裡哪個節點名稱/說明剛好含「渾沌」二字是實作細節），
    // 只斷言「至少有一個渾沌分支節點比對到、且比對邏輯有在運作」：真實資料裡已知有 8 處
    // 含「渾沌」字樣（見 tests/lib/filter.test.ts 開發時的資料探查），只要正規化生效，
    // 渾沌分支不會全滅。
    const hidden = new Set(page.state().filteredOut);
    const anyChaosNodeMatched = treeData.nodes.some(n => n.branch === 'chaos' && !hidden.has(n.id));
    expect(anyChaosNodeMatched).toBe(true);
    // 非渾沌分支節點應該被篩掉（搜尋「渾沌」不太可能比對到自然骰子的名稱/說明/關鍵字）。
    expect(hidden.has('1001')).toBe(true);
    expect(page.getSearchBox()).toBe('?q=%E6%B7%B7%E6%B2%8C'); // URLSearchParams 對「混沌」的百分號編碼
  });

  it('#search 按 Esc 清空搜尋、觸發重新篩選，不影響 #detail 的開關狀態（Esc 在搜尋框裡語意是清空搜尋，不是關面板）', async () => {
    const page = await loadTreePage('?node=1002&q=%E6%B8%BE%E6%B2%8C'); // q=渾沌，1002 不含這個字
    expect(page.searchInput.value).toBe('渾沌');
    expect((page.detailEl as unknown as HTMLElement).hasAttribute('hidden')).toBe(false);

    fireKeydown(page.searchInput, 'Escape');

    expect(page.searchInput.value).toBe('');
    // 清空搜尋後，1001 應該回到可見（不再被 q= 篩掉）。
    expect(page.state().filteredOut).not.toContain('1001');
    // 詳情面板仍然開著：Esc 在搜尋框裡沒有關閉選取。
    expect((page.detailEl as unknown as HTMLElement).hasAttribute('hidden')).toBe(false);
    expect(page.getSearchBox()).not.toContain('q=');
  });

  it('篩選條件全部清掉之後 filteredOut 是空的（畫布回到「沒有任何東西被淡出」）', async () => {
    const page = await loadTreePage('?type=dice');
    expect(page.state().filteredOut.length).toBe(treeData.nodes.length - treeData.nodes.filter(n => n.type === 'dice').length);
    const diceCb = page.filtersEl.querySelector<HTMLInputElement>('input[data-type="dice"]')!;
    diceCb.checked = false;
    fireChange(diceCb);
    expect(page.state().filteredOut).toEqual([]);
  });

  // 這個測試記錄一個環境限制，不是產品行為斷言：確認 linkedom 的 document.activeElement
  // 在呼叫 .focus() 後不會反映聚焦元素，因此「window keydown 依 activeElement 判斷要不要
  // 攔截方向鍵/+/-」這個判斷邏輯在這個測試環境下無法端對端驗證，只能單元測試
  // isTypingTarget() 本身（見 tests/lib/filter.test.ts）；真正的瀏覽器 focus 行為留給 E2E。
  it('環境限制記錄：linkedom 的 document.activeElement 不會因 .focus() 更新（故此無法端對端驗證鍵盤衝突處理）', async () => {
    const { document } = parseHTML(pageHtml());
    const input = document.getElementById('search')!;
    input.focus();
    expect(document.activeElement).toBeUndefined();
  });
});

describe('tree-canvas 整合：分支快速跳轉（task-17，spec §6.2.6）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('桌機初始視角：fitAll(1)＝全貌，低於可讀性下限時被拉到下限（task-18 修正：桌機不是永遠不套下限）', async () => {
    const page = await loadTreePage('');
    // 先把前提釘住：整棵樹的全貌（scale 1）在這個容器上比可讀性下限還小，下限應該勝出。
    // 哪天它不成立了測試會直接紅，而不是安靜地退化成驗別的事。
    const floor = readabilityFloor(DESKTOP_W, DESKTOP_H, DESKTOP_ICON_TARGET_PX);
    expect(floor).toBeGreaterThan(1);
    expect(page.scale()).toBeCloseTo(floor, 9);
  });

  it('桌機：點擊 #branch-nav 的分支按鈕，raw fitTo(bounds) 已經超過可讀性下限時維持原值', async () => {
    const page = await loadTreePage('');
    const btn = page.document.querySelector<HTMLButtonElement>('#branch-nav button[data-branch="engineering"]')!;
    fireClick(btn);
    // raw fitTo 已經超過桌機可讀性下限，下限不該把畫面往下拉，最終縮放應該就是 raw 本身。
    // 先斷言前提成立，否則這條測試會退化成驗另一件事還照樣綠。
    const raw = rawFitScale('engineering', DESKTOP_W, DESKTOP_H);
    expect(raw).toBeGreaterThan(readabilityFloor(DESKTOP_W, DESKTOP_H, DESKTOP_ICON_TARGET_PX));
    expect(page.scale()).toBeCloseTo(raw, 9);
    expectNodeDrawnAt('2001', expectedBranchView('engineering', DESKTOP_W, DESKTOP_H, DESKTOP_ICON_TARGET_PX));
  });

  it('手機底部 chip 與桌機側欄共用同一個 handler：點 #branch-chips 的按鈕效果跟點 #branch-nav 一樣', async () => {
    const page = await loadTreePage('');
    const chip = page.document.querySelector<HTMLButtonElement>('#branch-chips button[data-branch="magic"]')!;
    fireClick(chip);
    expect(page.scale()).toBeCloseTo(rawFitScale('magic', DESKTOP_W, DESKTOP_H), 9);
    expectNodeDrawnAt('3001', expectedBranchView('magic', DESKTOP_W, DESKTOP_H, DESKTOP_ICON_TARGET_PX));
  });

  it('桌機：raw fitTo(bounds) 低於可讀性下限時，也會被拉高到下限，而且錨點是容器中心', async () => {
    // 容器刻意用 1280x260（瀏覽器視窗被壓扁的桌機情境）而不是一般的 1280x595：2026-08-18
    // 換版面後 viewBox 從 3400x2850 縮成 2000x1700，一般桌機視窗下的可讀性下限已經低於
    // 任何分支的 raw fitTo——也就是新版面在那種容器下本來就夠清楚、根本不會走到 boost。
    // 要繼續守住「桌機也會套下限」這個 task-18 修正的回歸，就得挑一個下限真的會勝出的尺寸。
    const page = await loadTreePage('', { width: 1280, height: 260 });
    const raw = rawFitScale('nature', 1280, 260);
    const floor = readabilityFloor(1280, 260, DESKTOP_ICON_TARGET_PX);
    expect(raw).toBeLessThan(floor);

    const btn = page.document.querySelector<HTMLButtonElement>('#branch-nav button[data-branch="nature"]')!;
    fireClick(btn);
    expect(page.scale()).toBeCloseTo(floor, 9);
    // 縮放對了還不夠——boost 是用 `zoomAt(k, 錨點)` 疊上去的，錨點挑錯（例如拿視窗座標
    // 而不是容器內座標）縮放值一樣正確，畫面卻會整個滑走。
    expectNodeDrawnAt('1001', expectedBranchView('nature', 1280, 260, DESKTOP_ICON_TARGET_PX));
  });

  it('手機：fitTo 給的倍率低於最小可讀縮放下限時，會再拉高到下限（task-17 裁決）', async () => {
    const page = await loadTreePage('', { mobile: true, width: 390, height: 800 });
    const btn = page.document.querySelector<HTMLButtonElement>('#branch-chips button[data-branch="engineering"]')!;
    fireClick(btn);
    // 手機直向容器（390x800）算出來的可讀性下限遠大於 engineering 分支的 raw fitTo。
    const floor = readabilityFloor(390, 800, MOBILE_ICON_TARGET_PX);
    expect(rawFitScale('engineering', 390, 800)).toBeLessThan(floor);
    expect(page.scale()).toBeCloseTo(floor, 6);
  });

  it('手機：fitTo 給的倍率已經超過下限時，不會被下限往下拉，維持原本的 fitTo 結果', async () => {
    // 容器故意設得很寬（4000x2000），算出來的下限遠小於 engineering 分支的 raw fitTo，
    // 驗證「下限只往上拉、不往下拉」。
    const page = await loadTreePage('', { mobile: true, width: 4000, height: 2000 });
    const raw = rawFitScale('engineering', 4000, 2000);
    expect(raw).toBeGreaterThan(readabilityFloor(4000, 2000, MOBILE_ICON_TARGET_PX));
    const btn = page.document.querySelector<HTMLButtonElement>('#branch-chips button[data-branch="engineering"]')!;
    fireClick(btn);
    expect(page.scale()).toBeCloseTo(raw, 9);
  });

  it('手機初始視角：沒有選取節點時預設對準 nature 分支', async () => {
    const page = await loadTreePage('', { mobile: true, width: 390, height: 800 });
    expect(page.scale()).toBeCloseTo(readabilityFloor(390, 800, MOBILE_ICON_TARGET_PX), 6);
    expectNodeDrawnAt('1001', expectedBranchView('nature', 390, 800, MOBILE_ICON_TARGET_PX));
  });

  it('手機初始視角：網址帶 ?node= 時對準該節點所屬的分支，不是永遠預設 nature', async () => {
    // 2001 鐵甲骰子屬於 engineering 分支。手機容器下兩個分支的 raw fitTo 都低於可讀性下限、
    // 都會被夾到同一個 scale，所以**不能**用縮放值區分——要看鏡頭對到哪裡（節點畫在哪）。
    const page = await loadTreePage('?node=2001', { mobile: true, width: 390, height: 800 });
    expect(page.scale()).toBeCloseTo(readabilityFloor(390, 800, MOBILE_ICON_TARGET_PX), 6);
    const engineering = expectedBranchView('engineering', 390, 800, MOBILE_ICON_TARGET_PX);
    const nature = expectedBranchView('nature', 390, 800, MOBILE_ICON_TARGET_PX);
    // 前提：兩個分支的鏡頭真的落在不同位置，否則下面的斷言驗不出東西。
    expect(engineering.worldToScreen(0, 0)).not.toEqual(nature.worldToScreen(0, 0));
    expectNodeDrawnAt('2001', engineering);
  });
});

describe('tree-canvas 整合：詳情面板的視圖堆疊', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const topTitle = (page: { detailEl: Element }) =>
    page.detailEl.querySelector('.view:not([hidden]) h2')?.textContent;

  it('點關鍵字推出詞彙頁，再點巢狀關鍵字再推一層；點的當下不搜尋', async () => {
    // 1002 尖刺骰子的描述含「#尖刺」，會被渲染成 <button class="kw" data-term="尖刺">
    const page = await loadTreePage('?node=1002');
    expect(topTitle(page)).toBe('尖刺骰子');

    const kw = page.detailEl.querySelector('.kw')!;
    expect(kw.textContent).toBe('#尖刺');
    fireClick(kw);

    expect(topTitle(page)).toBe('#尖刺');
    expect(page.detailEl.querySelector('[data-detail-back]')).not.toBeNull();
    // 點關鍵字是「這個詞是什麼意思」，不是「幫我搜尋」——搜尋是詞彙頁上另一顆按鈕
    expect(page.searchInput.value).toBe('');
    expect(page.getSearchBox()).not.toContain('q=');
  });

  it('返回鍵退一層；退到根視圖就沒有返回鍵了', async () => {
    const page = await loadTreePage('?node=1002');
    fireClick(page.detailEl.querySelector('.kw')!);
    expect(topTitle(page)).toBe('#尖刺');

    fireClick(page.detailEl.querySelector('[data-detail-back]')!);
    expect(topTitle(page)).toBe('尖刺骰子');
    expect(page.detailEl.querySelector('[data-detail-back]')).toBeNull();
  });

  it('瀏覽器的上一頁等同卡片的返回鍵（A1：兩者走同一條路）', async () => {
    const page = await loadTreePage('?node=1002');
    fireClick(page.detailEl.querySelector('.kw')!);
    expect(topTitle(page)).toBe('#尖刺');

    history.back();
    expect(topTitle(page)).toBe('尖刺骰子');
  });

  it('覺醒入口推出覺醒頁；沒有覺醒的節點沒有那一列', async () => {
    const page = await loadTreePage('?node=1002');
    fireClick(page.detailEl.querySelector('[data-detail-awakening]')!);
    expect(topTitle(page)).toBe('骰子覺醒');

    const passive = await loadTreePage('?node=1101');
    expect(passive.detailEl.querySelector('[data-detail-awakening]')).toBeNull();
  });

  it('詞彙頁的「搜尋 #X」才會真的搜尋，而且會退回根視圖', async () => {
    const page = await loadTreePage('?node=1002');
    fireClick(page.detailEl.querySelector('.kw')!);
    fireClick(page.detailEl.querySelector('[data-detail-search]')!);

    expect(page.searchInput.value).toBe('尖刺');
    expect(page.getSearchBox()).toContain('q=');
    expect(topTitle(page)).toBe('尖刺骰子');
  });

  it('✕ 關掉整個面板，畫布的選取與前置鏈也一起清掉', async () => {
    const page = await loadTreePage('?node=1002');
    expect((page.detailEl as HTMLElement).hidden).toBe(false);
    fireClick(page.detailEl.querySelector('[data-detail-close]')!);
    expect((page.detailEl as HTMLElement).hidden).toBe(true);
    // 舊版是把 .in-chain 一個個從元素上拿掉；現在是把狀態清空，畫面上的金光才會跟著消失。
    expect(page.state().selected).toBeNull();
    expect(page.state().chain).toEqual([]);
  });

  it('面板重繪（例如搜尋條件改變）會把堆疊收回根視圖，不留下一張過期的詞彙頁', async () => {
    // renderDetail() 是整段重寫 innerHTML，堆疊沒有跟著重設的話，viewStack 會記著一層
    // 其實已經不在 DOM 裡的詞彙頁——之後按返回就會操作到不存在的元素。
    // （「點另一顆節點」走的是 controller 的 pointer 命中，linkedom 沒有 Pointer Capture
    //  API，那條路徑留給 E2E 驗；這裡走的是同一個 select() 重繪。）
    const page = await loadTreePage('?node=1002');
    fireClick(page.detailEl.querySelector('.kw')!);
    expect(topTitle(page)).toBe('#尖刺');
    expect(page.detailEl.querySelectorAll('.view')).toHaveLength(2);

    page.searchInput.value = '骰子';
    fireInput(page.searchInput);

    expect(topTitle(page)).toBe('尖刺骰子');
    expect(page.detailEl.querySelectorAll('.view')).toHaveLength(1);
  });

  // ── 換頁收尾不搶回已經移走的焦點（Task 12b，Task 12 報告 §5 ④） ──────────────
  // `pushView()` 在 `slide()` 的收尾回呼（約 280ms 後）無條件 `focusView(toEl)`。使用者若在
  // 那 280ms 內把焦點移到面板外（Z6 的手勢：點 `.kw` 之後立刻點 `#filters-toggle` 開抽屜），
  // 焦點會被搶回 `#detail`，而面板的 keydown 對 Escape 無條件 `stopPropagation()`——於是
  // `document` 上那條「Esc 關抽屜」收不到事件，抽屜關不掉。收尾時焦點若已經在面板外的其他
  // 可聚焦元素上，就不該搶。
  //
  // linkedom 沒有真的焦點（`.focus()` 不更新 `document.activeElement`，見上面那條環境限制
  // 測試），所以兩件事都得自己造：用 defineProperty 假造「焦點現在在誰身上」，用 prototype
  // 補丁記下誰被 `.focus()` 了。
  it('換頁收尾時焦點已經在面板外 → 不搶回面板；焦點還在面板內／body 才搶', async () => {
    const page = await loadTreePage('?node=1002');
    const toggle = page.document.getElementById('filters-toggle')!;
    let proto = Object.getPrototypeOf(toggle);
    while (proto && !Object.getOwnPropertyDescriptor(proto, 'focus')) proto = Object.getPrototypeOf(proto);
    const origFocus = proto.focus;
    const focused: Element[] = [];
    proto.focus = function (this: Element) { focused.push(this); };
    const setActive = (doc: Document, el: Element) => {
      Object.defineProperty(doc, 'activeElement', { configurable: true, get: () => el });
    };
    try {
      // (1) 焦點在抽屜切換鈕上（面板外）→ 收尾不得動焦點
      setActive(page.document as unknown as Document, toggle);
      fireClick(page.detailEl.querySelector('.kw')!);
      expect(topTitle(page)).toBe('#尖刺');   // 換頁本身照做
      // ⚠️ 斷言用「數量」不用元素本身：vitest 對 linkedom 的 Element 做深層比對／差異輸出會
      // 沿著 parentNode 無限展開，紅的時候只印得出 RangeError，看不出是哪裡壞了。
      expect(focused.filter(el => page.detailEl.contains(el)).length,
        '焦點已經在抽屜切換鈕上，換頁收尾不該把它搶回 #detail').toBe(0);

      // (2) 焦點還在面板裡 → 照舊把焦點移進新視圖。少了這個方向，把 focusView 整個拿掉也會
      // 是綠的，而那正是這段程式原本要解決的事：舊視圖一被 hidden，剛按下的那顆按鈕就消失、
      // 焦點掉回 body，Esc 收不到、Tab 從頭開始、讀屏也不知道換了一頁。
      // （真的瀏覽器裡「焦點所在元素被藏起來」會讓 activeElement 變成 body，走的是 `!active`
      //  那一支；linkedom 沒有真焦點，這裡用「焦點在面板本身」模擬 `panel.contains` 那一支。）
      const page2 = await loadTreePage('?node=1002');
      focused.length = 0;
      setActive(page2.document as unknown as Document, page2.detailEl);
      fireClick(page2.detailEl.querySelector('.kw')!);
      expect(topTitle(page2)).toBe('#尖刺');
      expect(focused.some(el => page2.detailEl.contains(el)),
        '焦點還在面板裡時，收尾仍要把它移進新視圖').toBe(true);
    } finally {
      proto.focus = origFocus;
    }
  });

  it('點詳情面板裡不是按鈕的地方不會有任何反應（委派只認那幾個 data-*）', async () => {
    const page = await loadTreePage('?node=1002');
    fireClick(page.detailEl.querySelector('.desc')!);
    expect(topTitle(page)).toBe('尖刺骰子');
    expect(page.searchInput.value).toBe('');
  });
});
