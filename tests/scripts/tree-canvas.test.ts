// 整合測試：實際執行 src/scripts/tree-canvas.ts（不是重寫一份邏輯來斷言），驗證搜尋／
// 篩選／網址狀態同步真的接對線。本環境沒有瀏覽器，用 linkedom 模擬 document／window，
// 並手刻 location／history 存根（linkedom 不提供這兩個全域物件，見下面 makeLocation()
// 的說明）。activeElement／focus 的模擬經實測 linkedom 不支援（見檔案最後一段測試），
// 所以「搜尋框 focus 時方向鍵/+/- 不應平移畫布」這件事，這裡只能驗證判斷邏輯本身
// （isTypingTarget，已在 tests/lib/filter.test.ts 涵蓋），實際瀏覽器下的 focus 判斷
// 留給第 18 個任務的 E2E。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseHTML, Event as LinkedomEvent } from 'linkedom';
import {
  DESKTOP_ICON_TARGET_PX,
  MOBILE_ICON_TARGET_PX,
  Viewport,
  minReadableScale,
} from '../../src/lib/viewport';
import type { Branch, TreeData } from '../../src/lib/types';

const treeData: TreeData = JSON.parse(readFileSync('src/generated/tree.json', 'utf8'));

/**
 * 用真正的 `Viewport.fitTo()` 現算「跳到某分支時，還沒套可讀性下限的原始縮放」。
 *
 * 以前這些期望值是手算後寫死的小數（例如 2.358946061525727），只要分支包圍盒一動——
 * 換版面、加一個節點都會動——測試就會紅，而紅的原因跟它要守的行為（點按鈕有沒有真的
 * 呼叫 fitTo）完全無關。改成拿同一個 Viewport 現算：驗的仍然是「接線對不對」，
 * 資料變動時兩邊一起變。
 */
function rawFitScale(branch: Branch): number {
  const [, , vbw, vbh] = treeData.meta.viewBox;
  const svgStub = {
    getAttribute: (n: string) => (n === 'viewBox' ? `0 0 ${vbw} ${vbh}` : null),
  } as unknown as SVGSVGElement;
  const vp = new Viewport(svgStub, { setAttribute: () => {} } as unknown as SVGGElement);
  vp.fitTo(treeData.meta.bounds[branch]);
  return vp.scale;
}

/** 對應 tree-canvas.ts 的 applyReadabilityFloor()：同一組容器尺寸下的可讀性下限。 */
function readabilityFloor(containerW: number, containerH: number, targetPx: number): number {
  const [, , vbw, vbh] = treeData.meta.viewBox;
  const diceWidth = treeData.nodes.find(n => n.type === 'dice')!.size[0];
  return minReadableScale(containerW, containerH, vbw, vbh, diceWidth, targetPx);
}

/** 跳到某分支、還沒套下限時的 transform（translate 分量）。 */
function rawFitTranslate(branch: Branch): [number, number] {
  const [, , vbw, vbh] = treeData.meta.viewBox;
  const svgStub = {
    getAttribute: (n: string) => (n === 'viewBox' ? `0 0 ${vbw} ${vbh}` : null),
  } as unknown as SVGSVGElement;
  const vp = new Viewport(svgStub, { setAttribute: () => {} } as unknown as SVGGElement);
  vp.fitTo(treeData.meta.bounds[branch]);
  const m = /translate\(([-\d.e]+),([-\d.e]+)\)/.exec(vp.transform)!;
  return [Number(m[1]), Number(m[2])];
}

function parseTranslate(transform: string): [number, number] {
  const m = /translate\(([-\d.e]+),([-\d.e]+)\)/.exec(transform);
  if (!m) throw new Error(`transform 格式不符預期，取不出 translate：${transform}`);
  return [Number(m[1]), Number(m[2])];
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
  const history = {
    replaceState(_state: unknown, _title: string, url: string) {
      const qIdx = url.indexOf('?');
      box.search = qIdx >= 0 ? url.slice(qIdx) : '';
    },
  };
  return { location, history, box };
}

async function loadTreePage(initialSearch: string, opts: { mobile?: boolean } = {}) {
  const { document, window } = parseHTML(pageHtml());
  const { location, history, box } = makeLocationAndHistory(initialSearch);

  vi.stubGlobal('document', document);
  vi.stubGlobal('window', window);
  vi.stubGlobal('location', location);
  vi.stubGlobal('history', history);
  vi.stubGlobal('innerWidth', 1200);
  vi.stubGlobal('innerHeight', 800);
  // tree-canvas.ts 執行期用 `instanceof HTMLInputElement` 判斷 #search，這裡要指向
  // 跟 document 同一份 linkedom class（不能用 Node 全域裡沒有的同名類別）。
  // SVGGElement 只出現在型別標註（`viewport as SVGGElement`），編譯期抹除、執行期不檢查
  // instanceof，不需要 stub。
  vi.stubGlobal('HTMLInputElement', window.HTMLInputElement);
  if (opts.mobile) {
    // 模擬手機版：tree-canvas.ts 用 `typeof matchMedia === 'function' &&
    // matchMedia('(max-width: 720px)').matches` 判斷 isMobile（見那支檔案的說明），
    // 這裡直接 stub 成永遠回傳 matches:true——這支腳本只會用這一個查詢字串呼叫它，
    // 不需要真的實作媒體查詢比對邏輯。
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query }) as unknown as MediaQueryList);
  }

  vi.resetModules();
  await import('../../src/scripts/tree-canvas');

  const svg = document.getElementById('tree')!;
  return {
    document,
    getSearchBox: () => box.search,
    searchInput: document.getElementById('search') as unknown as HTMLInputElement,
    filtersEl: document.getElementById('filters')!,
    detailEl: document.getElementById('detail')!,
    svg,
    // #viewport 的 transform 屬性是 Viewport 內部狀態唯一外顯的地方（Viewport 本身沒有
    // 匯出、也沒有 export 一個 handle 出來讓測試直接讀），跟 tests/lib/viewport.test.ts
    // 讀 `.transform` 字串斷言是同一套做法。
    viewportEl: svg.querySelector('#viewport')!,
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

/** 從 `translate(x,y) scale(s)` 格式的 transform 字串取出縮放分量，跟
 * tests/lib/viewport.test.ts 的 contentUnderAnchor() 用同一套正規表達式解法。 */
function parseScale(transform: string): number {
  const m = /scale\(([\d.]+)\)/.exec(transform);
  if (!m) throw new Error(`transform 格式不符預期，取不出 scale：${transform}`);
  return Number(m[1]);
}

describe('tree-canvas 整合：搜尋、篩選、網址狀態同步', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // 真實資料回歸案例（與 tests/lib/filter.test.ts 的「1002 hiddenByFilter 真實資料驗算」
  // 對同一組數字，這裡從「實際跑過的頁面腳本」再驗一次，不是重算）：
  // 1002 尖刺骰子的前置鏈＝{1001,1002,1006 為 dice；1102,1103,1109 為 passive}，
  // 只勾類型=dice 時，3 個 passive 前置應該同時是 .filtered-out 與 .in-chain
  // （前置鏈高亮覆寫篩選，spec §6.3），detail 面板要出現「含 3 個被篩選隱藏的前置」。
  it('網址帶 ?node=1002&type=dice 載入：checkbox 還原勾選、前置鏈高亮蓋過篩選淡出、面板顯示 hiddenByFilter=3', async () => {
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

    for (const id of ['1102', '1103', '1109']) {
      const g = page.svg.querySelector(`g.node[data-id="${id}"]`)!;
      expect(g.classList.contains('filtered-out')).toBe(true);
      expect(g.classList.contains('in-chain')).toBe(true);
    }
    for (const id of ['1001', '1002', '1006']) {
      const g = page.svg.querySelector(`g.node[data-id="${id}"]`)!;
      expect(g.classList.contains('filtered-out')).toBe(false);
      expect(g.classList.contains('in-chain')).toBe(true);
    }

    const detailText = (page.detailEl as unknown as HTMLElement).textContent ?? '';
    expect(detailText).toContain('含 3 個被篩選隱藏的前置');
  });

  it('沒有選取節點時，光是勾選分支就會把不符合的節點標上 filtered-out、並寫回網址', async () => {
    const page = await loadTreePage('');
    const natureCb = page.filtersEl.querySelector<HTMLInputElement>('input[data-branch="nature"]')!;
    natureCb.checked = true;
    fireChange(natureCb);

    // 1001 火骰子（nature）应該可見，2001 鐵甲骰子（engineering）應該被篩掉。
    expect(page.svg.querySelector('g.node[data-id="1001"]')!.classList.contains('filtered-out')).toBe(false);
    expect(page.svg.querySelector('g.node[data-id="2001"]')!.classList.contains('filtered-out')).toBe(true);
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
    const anyChaosNodeMatched = [...page.svg.querySelectorAll('g.node[data-branch="chaos"]')].some(
      g => !g.classList.contains('filtered-out'),
    );
    expect(anyChaosNodeMatched).toBe(true);
    // 非渾沌分支節點應該被篩掉（搜尋「渾沌」不太可能比對到自然骰子的名稱/說明/關鍵字）。
    expect(page.svg.querySelector('g.node[data-id="1001"]')!.classList.contains('filtered-out')).toBe(true);
    expect(page.getSearchBox()).toBe('?q=%E6%B7%B7%E6%B2%8C'); // URLSearchParams 對「混沌」的百分號編碼
  });

  it('#search 按 Esc 清空搜尋、觸發重新篩選，不影響 #detail 的開關狀態（Esc 在搜尋框裡語意是清空搜尋，不是關面板）', async () => {
    const page = await loadTreePage('?node=1002&q=%E6%B8%BE%E6%B2%8C'); // q=渾沌，1002 不含這個字，理論上会被篩掉但前置鏈高亮仍覆寫
    expect(page.searchInput.value).toBe('渾沌');
    expect((page.detailEl as unknown as HTMLElement).hasAttribute('hidden')).toBe(false);

    fireKeydown(page.searchInput, 'Escape');

    expect(page.searchInput.value).toBe('');
    // 清空搜尋後，1001 應該回到可見（不再被 q= 篩掉）。
    expect(page.svg.querySelector('g.node[data-id="1001"]')!.classList.contains('filtered-out')).toBe(false);
    // 詳情面板仍然開著：Esc 在搜尋框裡沒有關閉選取。
    expect((page.detailEl as unknown as HTMLElement).hasAttribute('hidden')).toBe(false);
    expect(page.getSearchBox()).not.toContain('q=');
  });

  // 這個測試記錄一個環境限制，不是產品行為斷言：確認 linkedom 的 document.activeElement
  // 在呼叫 .focus() 後不會反映聚焦元素，因此「window keydown 依 activeElement 判斷要不要
  // 攔截方向鍵/+/-」這個判斷邏輯在這個測試環境下無法端對端驗證，只能單元測試
  // isTypingTarget() 本身（見 tests/lib/filter.test.ts）；真正的瀏覽器 focus 行為留給
  // 第 18 個任務的 E2E。
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

  // task-18 第二輪修正：可讀性下限不再是手機專屬，桌機也會套用（見
  // src/scripts/tree-canvas.ts 的 applyReadabilityFloor() 說明）。桌機測試因此也要掛一個
  // 真實桌機容器尺寸的 getBoundingClientRect stub（1280x610，跟真實 Desktop Chrome 預設
  // 視窗實測值一致——1280 寬減不出來，610 是視窗高度 720 扣掉 #canvas-host 的
  // `calc(100vh - 110px)` 那個 110），不然 linkedom 預設的全 0 版面資訊會讓下限退化成
  // Infinity、被 Viewport 的硬上限夾到 8（跟下面手機測試「環境限制記錄」那條是同一類
  // 退化路徑，但這裡的重點是驗證桌機的正常路徑，不是記錄環境限制，所以要掛 stub 避開它）。
  function stubDesktopRect(page: { svg: HTMLElement }): void {
    Object.assign(page.svg, {
      getBoundingClientRect: () => ({ x: 0, y: 0, left: 0, top: 0, right: 1280, bottom: 610, width: 1280, height: 610 }),
    });
  }

  it('桌機初始視角：套用可讀性下限的路徑真的有被觸發，不拋例外（環境限制記錄，見下方說明）', async () => {
    const page = await loadTreePage('');
    // 跟下面「手機初始視角：沒有選取節點時預設對準 nature 分支」是同一類環境限制：頁面
    // 載入當下（import 執行期間）就會呼叫 applyReadabilityFloor()，這時還沒有機會替
    // page.svg 掛上 stub（page.svg 本身要等 import 完成、renderTree() 建好 DOM 之後才存在，
    // 不可能在那之前就替它掛 getBoundingClientRect），走的是 linkedom 預設的全 0 版面
    // 資訊；minReadableScale() 除以 0 寬高得到 Infinity，下限必然大於任何 fitTo 算出來的
    // 倍率，於是被 Viewport 的硬上限夾到 8。這裡不是在斷言「正式瀏覽器環境下初始縮放值會是
    // 8」（真實環境容器尺寸不會是 0，見下面「桌機：點擊 #branch-nav」那幾條用真實桌機尺寸
    // stub 驗到的數字），只是確認桌機初始視角也真的會跑進 applyReadabilityFloor() 這條路徑
    // 且不拋例外——task-18 修正前，桌機的 `else` 分支完全不呼叫這個函式，這裡至少能抓到
    // 「忘記接線、桌機初始視角完全沒套下限」這種回歸。
    expect(parseScale(page.viewportEl.getAttribute('transform') ?? '')).toBe(8);
  });

  it('桌機：點擊 #branch-nav 的分支按鈕，raw fitTo(bounds) 已經超過可讀性下限時維持原值', async () => {
    const page = await loadTreePage('');
    stubDesktopRect(page); // 先掛真實桌機容器尺寸的 stub，再觸發點擊——點擊當下才會重新讀 rect
    const btn = page.document.querySelector<HTMLButtonElement>('#branch-nav button[data-branch="engineering"]')!;
    fireClick(btn);
    // raw fitTo 已經超過桌機可讀性下限（1280x610 容器、目標 24px），下限不該把畫面往下拉，
    // 最終縮放應該就是 raw 本身。先斷言前提成立，否則這條測試會退化成驗另一件事還照樣綠。
    const raw = rawFitScale('engineering');
    expect(raw).toBeGreaterThan(readabilityFloor(1280, 610, DESKTOP_ICON_TARGET_PX));
    expect(parseScale(page.viewportEl.getAttribute('transform') ?? '')).toBeCloseTo(raw, 9);
  });

  it('手機底部 chip 與桌機側欄共用同一個 handler：點 #branch-chips 的按鈕效果跟點 #branch-nav 一樣', async () => {
    const page = await loadTreePage('');
    stubDesktopRect(page);
    const chip = page.document.querySelector<HTMLButtonElement>('#branch-chips button[data-branch="magic"]')!;
    fireClick(chip);
    expect(parseScale(page.viewportEl.getAttribute('transform') ?? '')).toBeCloseTo(rawFitScale('magic'), 9);
  });

  it('桌機：raw fitTo(bounds) 低於可讀性下限時，也會被拉高到下限（task-18 修正的核心案例——桌機不再是永遠不套下限）', async () => {
    const page = await loadTreePage('');
    stubDesktopRect(page);
    // 容器刻意用 1280x260（瀏覽器視窗被壓扁的桌機情境）而不是上面那組 1280x610：2026-08-18
    // 換版面後 viewBox 從 3400x2850 縮成 2000x1700，同樣的容器換算出來的每單位 CSS px 變多、
    // 可讀性下限跟著降到 1.45，已經低於任何分支的 raw fitTo（1.96～2.13）——也就是新版面在
    // 一般桌機視窗下本來就夠清楚、根本不會走到 boost 這條路。要繼續守住「桌機也會套下限」
    // 這個 task-18 修正的回歸，就得挑一個下限真的會勝出的容器尺寸。下面那條 toBeLessThan
    // 就是在把這個前提釘住：哪天它不成立了，測試會直接紅，而不是安靜地退化成驗別的事。
    Object.assign(page.svg, {
      getBoundingClientRect: () => ({ x: 0, y: 0, left: 0, top: 0, right: 1280, bottom: 260, width: 1280, height: 260 }),
    });
    // 最終縮放要正好落在下限上。這裡只斷言縮放值，不重算 zoomAt 的置中位移——那等於在測試裡
    // 抄一份 viewport.ts 的實作，抄錯了測試反而會跟著錯下去。
    const raw = rawFitScale('nature');
    const floor = readabilityFloor(1280, 260, DESKTOP_ICON_TARGET_PX);
    expect(raw).toBeLessThan(floor);
    const btn = page.document.querySelector<HTMLButtonElement>('#branch-nav button[data-branch="nature"]')!;
    fireClick(btn);
    const after = page.viewportEl.getAttribute('transform') ?? '';
    expect(parseScale(after)).toBeCloseTo(floor, 9);

    // 縮放對了還不夠——boost 是用 `zoomAt(k, 容器中心)` 疊上去的，錨點挑錯（例如拿 viewBox
    // 中心當錨點）縮放值一樣正確，畫面卻會整個滑走。這裡驗的是 zoomAt 的定義本身：
    // 錨點底下的那個內容座標，縮放前後必須是同一點。不重算 zoomAt 的位移公式（那等於在測試
    // 裡抄一份實作），只用「(錨點 - 位移) / 縮放」這個座標換算來檢查不變性。
    // 容器 stub 的 left/top 都是 0，所以容器中心的螢幕座標就是 (1280/2, 400/2)；本環境
    // getScreenCTM() 不存在，Viewport 退化成 1:1，螢幕座標即使用者座標。
    const [ax, ay] = [1280 / 2, 260 / 2];
    const [rx, ry] = rawFitTranslate('nature');
    const [bx, by] = parseTranslate(after);
    expect((ax - bx) / parseScale(after)).toBeCloseTo((ax - rx) / raw, 6);
    expect((ay - by) / parseScale(after)).toBeCloseTo((ay - ry) / raw, 6);
  });

  it('手機：fitTo 給的倍率低於最小可讀縮放下限時，會再拉高到下限（task-17 裁決）', async () => {
    const page = await loadTreePage('', { mobile: true });
    // 手動掛一個回傳真實手機寬度的 getBoundingClientRect——linkedom 沒有版面引擎，預設會
    // 回傳全 0（見 src/lib/viewport.ts 對 getScreenCTM 的說明，這裡是同一類環境限制），
    // 跟 tests/lib/viewport.test.ts 手動掛假 CTM 的做法同一套路。
    Object.assign(page.svg, {
      getBoundingClientRect: () => ({ x: 0, y: 0, left: 0, top: 0, right: 390, bottom: 800, width: 390, height: 800 }),
    });
    const btn = page.document.querySelector<HTMLButtonElement>('#branch-chips button[data-branch="engineering"]')!;
    fireClick(btn);
    // 手機直向容器（390x800）算出來的可讀性下限遠大於 engineering 分支的 raw fitTo，
    // 下限應該勝出。容差放寬到 1e-6：這條路徑會先算 fitTo 的 scale 再乘上 (floor/scale)
    // 換算成 zoomAt 的縮放係數，比 minReadableScale() 本身多一次浮點乘除，可能有比純函式
    // 測試更大一點的浮點誤差。
    const floor = readabilityFloor(390, 800, MOBILE_ICON_TARGET_PX);
    expect(rawFitScale('engineering')).toBeLessThan(floor);
    expect(parseScale(page.viewportEl.getAttribute('transform') ?? '')).toBeCloseTo(floor, 6);
  });

  it('手機：fitTo 給的倍率已經超過下限時，不會被下限往下拉，維持原本的 fitTo 結果', async () => {
    const page = await loadTreePage('', { mobile: true });
    // 容器故意設得很寬（4000x2000），算出來的下限遠小於 engineering 分支的 raw fitTo，
    // 驗證「下限只往上拉、不往下拉」。
    Object.assign(page.svg, {
      getBoundingClientRect: () => ({ x: 0, y: 0, left: 0, top: 0, right: 4000, bottom: 2000, width: 4000, height: 2000 }),
    });
    const raw = rawFitScale('engineering');
    expect(raw).toBeGreaterThan(readabilityFloor(4000, 2000, MOBILE_ICON_TARGET_PX));
    const btn = page.document.querySelector<HTMLButtonElement>('#branch-chips button[data-branch="engineering"]')!;
    fireClick(btn);
    expect(parseScale(page.viewportEl.getAttribute('transform') ?? '')).toBeCloseTo(raw, 9);
  });

  it('手機初始視角：沒有選取節點時預設對準 nature 分支（環境限制記錄，見下方說明）', async () => {
    const page = await loadTreePage('', { mobile: true });
    // 頁面載入當下（尚未點擊任何按鈕）就會呼叫 jumpToBranch('nature')，這時 svg 還沒被
    // 測試手動掛過 getBoundingClientRect stub，走的是 linkedom 預設的全 0 版面資訊；
    // minReadableScale() 除以 0 寬度得到 Infinity，下限必然大於任何 fitTo 算出來的倍率，
    // 於是被 Viewport 的硬上限夾到 8。這不是在斷言「正式瀏覽器環境下的實際縮放值會是
    // 8」（真實環境容器寬度不會是 0），只是確認「手機初始視角有選對分支、且 boost 路徑
    // 真的被觸發、不會拋例外」，跟 task-17 報告裡標注的「本環境驗不到真實數值」一致。
    expect(parseScale(page.viewportEl.getAttribute('transform') ?? '')).toBe(8);
  });

  it('手機初始視角：網址帶 ?node= 時對準該節點所屬的分支，不是永遠預設 nature', async () => {
    // 2001 鐵甲骰子屬於 engineering 分支；桌機版的 fitTo(bounds.engineering) 精確值已在
    // 上面驗過（2.358946061525727），這裡沒有 getBoundingClientRect stub、容器寬度是 0，
    // 下限一樣會是 Infinity、一樣夾到 8——這條測試只驗證「真的用 2001 的分支
    // （engineering）呼叫 jumpToBranch，不是仍然對準預設的 nature」，不是驗最終縮放值，
    // 所以改成跟 nature 分支的初始視角（下面另一條測試）比對是否走了不同的分支。
    const page = await loadTreePage('?node=2001', { mobile: true });
    expect(parseScale(page.viewportEl.getAttribute('transform') ?? '')).toBe(8); // 兩分支都會被夾到 8，無法用 scale 區分
    // 改用 translate 分量區分（fitTo 的置中位移隨分支不同而不同，即使最後都被 zoomAt 夾到
    // scale=8，"中心點"對到哪個分支的 bounds 還是能從 translate 反推出差異）：
    const natureCasePage = await loadTreePage('', { mobile: true });
    expect(page.viewportEl.getAttribute('transform')).not.toBe(natureCasePage.viewportEl.getAttribute('transform'));
  });
});

describe('tree-canvas 整合：關鍵字 chip（spec §6.2.3；點擊搜尋目前由 FEATURES.keywordSearch 停用）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('關鍵字 chip 目前不觸發搜尋（FEATURES.keywordSearch 暫時關閉），也不會裝成可以點', async () => {
    // 1002 尖刺骰子的描述含「#尖刺」，keywords=['尖刺']，NodeDetail.ts 會把它渲染成
    // <span class="kw">#尖刺</span>（見 src/components/NodeDetail.ts 的 renderDescription）。
    // 關鍵字本身照樣要標示出來——停用的是「點下去會搜尋」，不是「這個詞有特殊意義」的提示。
    const page = await loadTreePage('?node=1002');
    const kw = page.detailEl.querySelector('.kw');
    expect(kw).not.toBeNull();
    expect(kw!.textContent).toBe('#尖刺');

    fireClick(kw!);

    expect(page.searchInput.value).toBe('');
    expect(page.getSearchBox()).not.toContain('q=');
    // 樣式與接線共用同一個開關：功能關著就不該掛上 .kw-clickable，否則游標與 hover 底線
    // 會騙使用者去點一個沒有反應的東西（樣式見 src/styles/global.css）。
    expect(page.detailEl.classList.contains('kw-clickable')).toBe(false);
    // FEATURES.keywordSearch 開回來時這條會紅——那是刻意的，紅的時候把上面三條斷言換回
    // 「搜尋框被設成該關鍵字、網址帶 q=、面板掛上 .kw-clickable」即可。
  });

  it('點擊詳情面板裡非關鍵字的地方，不觸發搜尋（事件委派只認 .kw，不是整個面板都可點）', async () => {
    const page = await loadTreePage('?node=1002');
    const heading = page.detailEl.querySelector('h2')!;
    fireClick(heading);
    expect(page.searchInput.value).toBe('');
    expect(page.getSearchBox()).not.toContain('q=');
  });
});

describe('tree-canvas 整合：邊也要跟著篩選淡出（task-17 補漏，上一輪審查 Minor）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('一條邊若兩端節點都被篩掉才淡出；只有一端被篩掉則不淡出（邊還連著一個看得見的節點）', async () => {
    const page = await loadTreePage('');
    const diceCb = page.filtersEl.querySelector<HTMLInputElement>('input[data-type="dice"]')!;
    diceCb.checked = true;
    fireChange(diceCb);

    // 1201->1301 兩端都是骰子符文（type=rune），在 type=dice 篩選下兩端都被判定不符合。
    const bothFiltered = page.svg.querySelector('line.edge[data-from="1201"][data-to="1301"]')!;
    expect(bothFiltered.classList.contains('filtered-out')).toBe(true);

    // 1001->1109：1001 是骰子（可見）、1109 是玩家被動（被篩掉），只有一端被篩掉。
    const oneFiltered = page.svg.querySelector('line.edge[data-from="1001"][data-to="1109"]')!;
    expect(oneFiltered.classList.contains('filtered-out')).toBe(false);
  });

  it('前置鏈上的邊即使兩端都被篩掉，仍然同時帶有 .filtered-out 與 .in-chain（靠 global.css 的 !important 疊加規則蓋過淡出，不是這裡的邏輯排除它）', async () => {
    // 1301 的前置鏈是 {1301,1201,1001}（rune、rune、dice），邊 1201->1301 兩端都是符文，
    // type=dice 篩選下兩端都會被判定不符合、但兩者都在前置鏈上。
    const page = await loadTreePage('?node=1301&type=dice');
    const chainEdge = page.svg.querySelector('line.edge[data-from="1201"][data-to="1301"]')!;
    expect(chainEdge.classList.contains('filtered-out')).toBe(true);
    expect(chainEdge.classList.contains('in-chain')).toBe(true);
  });
});
