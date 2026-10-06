import { describe, it, expect } from 'vitest';
import { parseHTML, Event as LinkedomEvent } from 'linkedom';
import { mountCanvasTree, wheelZoomFactor, isGesturePointer, escapeShift } from '../../../src/lib/canvas/canvas-tree';
import type { TreeData } from '../../../src/lib/types';
import { readTree } from '../../helpers/read-tree';
const data = readTree() as TreeData;

// linkedom 沒有 2D context、沒有版面引擎（getBoundingClientRect 全 0），所以這裡只驗
// 「掛得起來、狀態進得去、查詢介面裝得上」，實際繪圖由瀏覽器 smoke 與 E2E 驗。
// 偵錯介面裝在 globalThis（瀏覽器＝window），測試也從 globalThis 讀。
type DebugHost = { __tree?: { count(): { nodes: number; edges: number }; scale(): number; hitAt(x: number, y: number): string | null } };

describe('mountCanvasTree（linkedom：沒有 2D context，只驗掛載與狀態）', () => {
  it('掛出兩張 canvas 與 243 顆按鈕；setState 後 getState 反映；nodeScreenRect 在沒版面時回 null 而不是丟', () => {
    const { document, window } = parseHTML('<div id="host"></div>');
    globalThis.document = document as never; globalThis.window = window as never;
    const host = document.getElementById('host') as HTMLElement;
    const h = mountCanvasTree(host, data);
    expect(host.querySelectorAll('canvas')).toHaveLength(2);
    expect(host.querySelectorAll('button.tree-a11y-node')).toHaveLength(data.nodes.length);
    h.setState({ selected: '1001', chain: new Set(['1001']) });
    expect(h.getState().selected).toBe('1001');
    expect(h.nodeScreenRect('1001')).toBeNull();
    const dbg = (globalThis as DebugHost).__tree!;
    expect(dbg.count()).toEqual({ nodes: data.nodes.length, edges: data.edges.length });
    expect(dbg.scale()).toBe(h.view.scale);
    h.destroy();
    expect(host.querySelectorAll('canvas')).toHaveLength(0);
  });

  it('兩張 canvas 皆 aria-hidden；fitAll／requestRedraw／hitAt 在沒有 rAF 與版面時不丟', () => {
    const { document, window } = parseHTML('<div id="host"></div>');
    globalThis.document = document as never; globalThis.window = window as never;
    const host = document.getElementById('host') as HTMLElement;
    const h = mountCanvasTree(host, data, { hiresBase: '/assets/icons' });
    const canvases = [...host.querySelectorAll('canvas')] as HTMLCanvasElement[];
    expect(canvases.map(c => c.className)).toEqual(['tree-static', 'tree-overlay']);
    expect(canvases.every(c => c.getAttribute('aria-hidden') === 'true')).toBe(true);
    expect(() => { h.requestRedraw(); h.fitAll(); h.fitBounds([0, 0, 100, 100]); }).not.toThrow();
    expect(h.hitAt(0, 0)).toBeNull();
    h.destroy();
  });

  it('setState 是合併不是取代；onSelect／onViewChange 註冊後不丟', () => {
    const { document, window } = parseHTML('<div id="host"></div>');
    globalThis.document = document as never; globalThis.window = window as never;
    const host = document.getElementById('host') as HTMLElement;
    const h = mountCanvasTree(host, data);
    h.setState({ filteredOut: new Set(['1001']) });
    h.setState({ selected: '2001' });
    expect(h.getState().filteredOut.has('1001')).toBe(true);
    expect(h.getState().selected).toBe('2001');
    expect(h.scene.nodes).toHaveLength(data.nodes.length);
    expect(h.buttons.byId.size).toBe(data.nodes.length);
    h.onSelect(() => {}); h.onViewChange(() => {});
    h.destroy();
  });
});

// ── 以下為 code review 後補的三條 ──────────────────────────────────────────────
// linkedom 沒有 PointerEvent 建構子，用 Event 手動掛上 controller 會讀的那幾個欄位頂替。
function ptr(document: Document, type: string, x: number, y: number, pointerId = 1): Event {
  const ev = new (document.defaultView as unknown as { Event: typeof Event }).Event(type, { cancelable: true });
  for (const [k, v] of Object.entries({ clientX: x, clientY: y, pointerId, isPrimary: true })) {
    Object.defineProperty(ev, k, { value: v });
  }
  return ev;
}
// 有版面的 host：linkedom 沒有版面引擎，getBoundingClientRect 要自己 stub 才量得到尺寸。
function laidOutHost(html = '<div id="host"></div>'): { document: Document; host: HTMLElement } {
  const { document, window } = parseHTML(html);
  globalThis.document = document as never; globalThis.window = window as never;
  const host = document.getElementById('host') as HTMLElement;
  host.getBoundingClientRect = (() => ({ width: 1280, height: 900, left: 0, top: 0, right: 1280, bottom: 900, x: 0, y: 0, toJSON() {} })) as never;
  return { document: document as unknown as Document, host };
}

describe('初始鏡頭', () => {
  it('第一次量到版面後把整張 viewBox 對準容器中心（不是 world 原點附近）', () => {
    const { host } = laidOutHost();
    const h = mountCanvasTree(host, data);
    const [vx, vy, vw, vh] = h.scene.viewBox;
    const [sx, sy] = h.view.worldToScreen(vx + vw / 2, vy + vh / 2);
    expect(sx).toBeCloseTo(640, 6);
    expect(sy).toBeCloseTo(450, 6);
    h.destroy();
  });
});

describe('hover 的清除', () => {
  it('pointerleave／pointercancel 會把 hover 清掉；有觸控點在時不走 hover 分支', () => {
    const { document, host } = laidOutHost();
    const h = mountCanvasTree(host, data);
    const overlay = host.querySelector('canvas.tree-overlay') as HTMLElement;
    const r = h.nodeScreenRect('1001')!;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    overlay.dispatchEvent(ptr(document, 'pointermove', cx, cy));
    expect(h.getState().hover).toBe('1001');
    overlay.dispatchEvent(ptr(document, 'pointerleave', cx, cy));
    expect(h.getState().hover).toBeNull();

    overlay.dispatchEvent(ptr(document, 'pointermove', cx, cy));
    expect(h.getState().hover).toBe('1001');
    overlay.dispatchEvent(ptr(document, 'pointercancel', cx, cy));
    expect(h.getState().hover).toBeNull();

    // 兩指按下、鬆開一指：剩下那指的 pointermove 不該把 hover 點亮（那是縮放手勢的殘留）
    overlay.dispatchEvent(ptr(document, 'pointerdown', 0, 0, 1));
    overlay.dispatchEvent(ptr(document, 'pointerdown', 50, 50, 2));
    overlay.dispatchEvent(ptr(document, 'pointerup', 50, 50, 2));
    overlay.dispatchEvent(ptr(document, 'pointermove', cx, cy, 1));
    expect(h.getState().hover).toBeNull();
    h.destroy();
  });

  it('雙指縮放放開一指，剩下那指接著拖得動，抬起時不算點選', () => {
    const { document, host } = laidOutHost();
    const h = mountCanvasTree(host, data);
    const overlay = host.querySelector('canvas.tree-overlay') as HTMLElement;
    const selected: (string | null)[] = [];
    h.onSelect(id => selected.push(id));
    const [x0, y0] = h.view.worldToScreen(0, 0);
    overlay.dispatchEvent(ptr(document, 'pointerdown', 100, 100, 1));
    overlay.dispatchEvent(ptr(document, 'pointerdown', 300, 300, 2));
    overlay.dispatchEvent(ptr(document, 'pointerup', 300, 300, 2));
    // 瀏覽器在放開的那一指 pointerup 之後非同步補發它的 lostpointercapture：不能把剩下那指的拖曳收掉。
    overlay.dispatchEvent(ptr(document, 'lostpointercapture', 300, 300, 2));
    overlay.dispatchEvent(ptr(document, 'pointermove', 160, 140, 1));
    overlay.dispatchEvent(ptr(document, 'pointermove', 220, 180, 1));
    const [x1, y1] = h.view.worldToScreen(0, 0);
    expect([x1 - x0, y1 - y0]).toEqual([120, 80]);
    overlay.dispatchEvent(ptr(document, 'pointerup', 220, 180, 1));
    expect(selected).toEqual([]);
    h.destroy();
  });

  it('lostpointercapture 會把該 pointerId 從觸控點集合移除（之後 hover 能再點亮）', () => {
    const { document, host } = laidOutHost();
    const h = mountCanvasTree(host, data);
    const overlay = host.querySelector('canvas.tree-overlay') as HTMLElement;
    const r = h.nodeScreenRect('1001')!;
    overlay.dispatchEvent(ptr(document, 'pointerdown', 0, 0, 1));
    overlay.dispatchEvent(ptr(document, 'pointerdown', 50, 50, 2));
    overlay.dispatchEvent(ptr(document, 'lostpointercapture', 0, 0, 1));
    overlay.dispatchEvent(ptr(document, 'lostpointercapture', 50, 50, 2));
    overlay.dispatchEvent(ptr(document, 'pointermove', r.left + r.width / 2, r.top + r.height / 2, 3));
    expect(h.getState().hover).toBe('1001');
    h.destroy();
  });
});

describe('destroy 之後', () => {
  it('globalThis.__tree 不再指向死掉的實例', () => {
    const { host } = laidOutHost();
    const h = mountCanvasTree(host, data);
    expect((globalThis as DebugHost).__tree).toBeDefined();
    h.destroy();
    expect((globalThis as DebugHost).__tree).toBeUndefined();
  });
});

// ── Task 12c：平移之後靜態層要補畫 ───────────────────────────────────────────
// linkedom 沒有 2D context 也沒有 rAF，上面幾條測試因此只驗掛載。這裡把兩者都補上假的：
// 每張 canvas 給一個「只數呼叫次數」的假 ctx，rAF 換成手動 flush 的佇列，就量得到
// 「這一幀有沒有真的重畫靜態層」——離屏位圖那張 ctx 的呼叫次數 > 0 就是重畫了。
type Call = { m: string; args: number[] };
type FakeCtx = { calls: number; log: Call[] } & Record<string, unknown>;
function fakeCtx(): FakeCtx {
  const ctx = { calls: 0, log: [] } as unknown as FakeCtx;
  const rec = (m: string) => (...args: number[]): void => { ctx.calls++; ctx.log.push({ m, args }); };
  for (const m of ['save', 'restore', 'setTransform', 'clearRect', 'beginPath', 'moveTo', 'lineTo', 'arc',
    'closePath', 'rect', 'stroke', 'fill', 'drawImage', 'fillText', 'strokeText', 'setLineDash', 'roundRect']) {
    ctx[m] = rec(m);
  }
  ctx.measureText = (t: string) => ({ width: t.length * 6 });
  return ctx;
}

// host 是 1280×900、dpr 1（linkedom 沒有 devicePixelRatio）→ 邊距每邊 320×225 CSS px。
// 兩張 canvas 元素都是 1.5×1.5 視口，基準 transform 把它們推回 host 左上角。
const MX = 320, MY = 225;
const shift = (dx = 0, dy = 0): string => `translate(${dx - MX}px, ${dy - MY}px)`;

/** 有版面、有 2D context、有可手動 flush 的 rAF 的 host。 */
function paintedHost(): {
  document: Document; host: HTMLElement;
  /** 離屏位圖（＝靜態層）那張 ctx 從上次 reset 之後被呼叫的次數；> 0 代表這幾幀重畫過。 */
  offscreenCalls(): number;
  /** 掛在頁面上的兩張 canvas（靜態層＋互動層）被呼叫的次數；> 0 代表這幾幀真的重繪了貼圖。 */
  layerCalls(): number;
  /** 互動層那張 ctx 的呼叫紀錄（含引數）。 */
  overlayLog(): Call[];
  /** 靜態層那張 ctx 的呼叫紀錄（含引數）。 */
  staticLog(): Call[];
  reset(): void; flush(n?: number): void; restore(): void;
} {
  const { document, host } = laidOutHost();
  // 靜態層與互動層的 canvas 有 className，離屏位圖那張沒有——用這點分辨誰是誰。
  const offscreen: FakeCtx[] = [], layers: FakeCtx[] = [];
  const create = document.createElement.bind(document);
  (document as unknown as { createElement: (t: string) => Element }).createElement = (tag: string) => {
    const el = create(tag) as HTMLElement & { getContext?: (id: string) => unknown };
    if (tag === 'canvas') {
      el.getContext = () => { const c = fakeCtx(); (el.className ? layers : offscreen).push(c); return c; };
    }
    return el;
  };
  let queue: FrameRequestCallback[] = [];
  const prevRaf = globalThis.requestAnimationFrame, prevCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => queue.push(cb)) as never;
  globalThis.cancelAnimationFrame = (() => {}) as never;
  return {
    document, host,
    offscreenCalls: () => offscreen.reduce((n, c) => n + c.calls, 0),
    layerCalls: () => layers.reduce((n, c) => n + c.calls, 0),
    overlayLog: () => layers[1]!.log,   // 建立順序：靜態層先、互動層後
    staticLog: () => layers[0]!.log,
    reset: () => { for (const c of [...offscreen, ...layers]) { c.calls = 0; c.log.length = 0; } },
    flush(n = 1) { for (let i = 0; i < n; i++) { const q = queue; queue = []; for (const cb of q) cb(1); } },
    restore() { globalThis.requestAnimationFrame = prevRaf; globalThis.cancelAnimationFrame = prevCancel; },
  };
}

describe('平移之後的靜態層補畫', () => {
  it('平移 50% 視口寬（超出邊距）：下一幀重畫靜態層，不留空白', () => {
    const env = paintedHost();
    const h = mountCanvasTree(env.host, data);
    env.flush(3); env.reset();
    env.flush(1);
    expect(env.offscreenCalls()).toBe(0);   // 沒動：確認已經穩定，不是每幀都在重畫
    h.view.pan(-640, 0);
    h.requestRedraw(); env.flush(1);
    expect(env.offscreenCalls()).toBeGreaterThan(0);
    h.destroy(); env.restore();
  });

  it('平移 10% 視口寬（邊距內）：沿用舊位圖，243 顆一顆都不重畫', () => {
    const env = paintedHost();
    const h = mountCanvasTree(env.host, data);
    env.flush(3); env.reset();
    h.view.pan(-128, 40);
    h.requestRedraw(); env.flush(1);
    expect(env.offscreenCalls()).toBe(0);
    h.destroy(); env.restore();
  });

  it('拖曳手勢結束（pointerup）後補畫一次，即使位移還在邊距內', () => {
    const env = paintedHost();
    const h = mountCanvasTree(env.host, data);
    const overlay = env.host.querySelector('canvas.tree-overlay') as HTMLElement;
    env.flush(3); env.reset();
    overlay.dispatchEvent(ptr(env.document, 'pointerdown', 400, 400));
    overlay.dispatchEvent(ptr(env.document, 'pointermove', 460, 420));
    overlay.dispatchEvent(ptr(env.document, 'pointermove', 480, 430));
    env.flush(1);
    env.reset();                            // 拖曳中的那幾幀不算，只看放手之後
    overlay.dispatchEvent(ptr(env.document, 'pointerup', 480, 430));
    env.flush(1);
    expect(env.offscreenCalls()).toBeGreaterThan(0);
    h.destroy(); env.restore();
  });
});

describe('拖曳中不重繪、只位移貼圖', () => {
  it('拖曳進行中兩張 canvas 一個像素都不重繪，只設 CSS transform；放手後下一幀重繪並歸零', () => {
    const env = paintedHost();
    const h = mountCanvasTree(env.host, data);
    const staticEl = env.host.querySelector('canvas.tree-static') as HTMLElement;
    const overlay = env.host.querySelector('canvas.tree-overlay') as HTMLElement;
    env.flush(3); env.reset();
    overlay.dispatchEvent(ptr(env.document, 'pointerdown', 600, 400));
    overlay.dispatchEvent(ptr(env.document, 'pointermove', 540, 380));
    overlay.dispatchEvent(ptr(env.document, 'pointermove', 500, 370));
    env.flush(1);
    expect(env.layerCalls()).toBe(0);
    expect(env.offscreenCalls()).toBe(0);
    expect(staticEl.style.transform).toBe(shift(-100, -30));
    expect(overlay.style.transform).toBe(shift(-100, -30));
    overlay.dispatchEvent(ptr(env.document, 'pointerup', 500, 370));
    env.flush(1);
    expect(env.layerCalls()).toBeGreaterThan(0);
    expect(staticEl.style.transform).toBe(shift());
    expect(overlay.style.transform).toBe(shift());
    h.destroy(); env.restore();
  });

  it('拖曳中被收回指標捕捉（沒有 pointerup）：下一幀也要重繪並把 transform 歸零', () => {
    const env = paintedHost();
    const h = mountCanvasTree(env.host, data);
    const staticEl = env.host.querySelector('canvas.tree-static') as HTMLElement;
    const overlay = env.host.querySelector('canvas.tree-overlay') as HTMLElement;
    env.flush(3); env.reset();
    overlay.dispatchEvent(ptr(env.document, 'pointerdown', 600, 400));
    overlay.dispatchEvent(ptr(env.document, 'pointermove', 540, 380));
    env.flush(1);
    expect(staticEl.style.transform).toBe(shift(-60, -20));
    overlay.dispatchEvent(ptr(env.document, 'lostpointercapture', 540, 380));
    env.flush(1);
    expect(env.layerCalls()).toBeGreaterThan(0);
    expect(staticEl.style.transform).toBe(shift());
    h.destroy(); env.restore();
  });

  it('拖曳位移超出位圖邊距那一幀改成真的重繪，transform 歸零（不然會露出補不到的空白）', () => {
    const env = paintedHost();
    const h = mountCanvasTree(env.host, data);
    const staticEl = env.host.querySelector('canvas.tree-static') as HTMLElement;
    const overlay = env.host.querySelector('canvas.tree-overlay') as HTMLElement;
    env.flush(3); env.reset();
    overlay.dispatchEvent(ptr(env.document, 'pointerdown', 1200, 400));
    overlay.dispatchEvent(ptr(env.document, 'pointermove', 800, 400));   // −400 px＞1280×25%
    env.flush(1);
    expect(env.layerCalls()).toBeGreaterThan(0);
    expect(staticEl.style.transform).toBe(shift());
    expect(overlay.style.transform).toBe(shift());
    h.destroy(); env.restore();
  });
});

describe('畫布元素帶邊距（Ruling U）', () => {
  it('兩張 canvas 元素都是 1.5×1.5 視口，並用 translate(−邊距) 對回 host 左上角', () => {
    const env = paintedHost();
    const h = mountCanvasTree(env.host, data);
    env.flush(1);
    for (const cls of ['tree-static', 'tree-overlay']) {
      const el = env.host.querySelector(`canvas.${cls}`) as HTMLCanvasElement;
      expect([el.width, el.height]).toEqual([1280 + 2 * MX, 900 + 2 * MY]);
      expect([el.style.width, el.style.height]).toEqual([`${1280 + 2 * MX}px`, `${900 + 2 * MY}px`]);
      expect(el.style.transform).toBe(shift());
    }
    h.destroy(); env.restore();
  });

  it('互動層吃同一份邊距偏移：clear 清整張元素、世界原點也推了一份邊距（不然邊距那圈留殘影）', () => {
    const env = paintedHost();
    const h = mountCanvasTree(env.host, data);
    env.flush(3);
    const el = env.host.querySelector('canvas.tree-overlay') as HTMLCanvasElement;
    const log = env.overlayLog();
    const clears = log.filter(c => c.m === 'clearRect');
    expect(clears[clears.length - 1]!.args).toEqual([0, 0, el.width, el.height]);
    // drawOverlay 只設兩次變換：clear() 的單位矩陣，然後 begin() 的世界變換。
    const setT = log.filter(c => c.m === 'setTransform');
    const begin = setT[setT.length - 1]!;
    const [tx, ty] = h.view.worldToScreen(0, 0);
    expect(begin.args[4]).toBeCloseTo(tx + MX, 6);
    expect(begin.args[5]).toBeCloseTo(ty + MY, 6);
    h.destroy(); env.restore();
  });

  it('第二指落下（改成縮放手勢）也算拖曳結束：下一幀重繪、transform 回到基準', () => {
    // 審查 I1 的復現：舊版這條路只把 down 清成 null 就 return，沒有任何 rAF 被排，兩張 canvas
    // 永久卡在最後那個 transform 上，而 hitAt() 完全不知道元素被位移過 → 點到別顆節點。
    const env = paintedHost();
    const h = mountCanvasTree(env.host, data);
    const staticEl = env.host.querySelector('canvas.tree-static') as HTMLElement;
    const overlay = env.host.querySelector('canvas.tree-overlay') as HTMLElement;
    env.flush(3); env.reset();
    overlay.dispatchEvent(ptr(env.document, 'pointerdown', 600, 400, 1));
    overlay.dispatchEvent(ptr(env.document, 'pointermove', 540, 380, 1));
    env.flush(1);
    expect(staticEl.style.transform).toBe(shift(-60, -20));
    expect(env.layerCalls()).toBe(0);
    overlay.dispatchEvent(ptr(env.document, 'pointerdown', 300, 300, 2));   // 第二指落下
    env.flush(1);
    expect(env.layerCalls()).toBeGreaterThan(0);
    expect(staticEl.style.transform).toBe(shift());
    // 兩指直接放開（中間沒有 pinch 位移）之後也不該留下任何位移
    overlay.dispatchEvent(ptr(env.document, 'pointerup', 300, 300, 2));
    overlay.dispatchEvent(ptr(env.document, 'pointerup', 540, 380, 1));
    env.flush(2);
    expect(staticEl.style.transform).toBe(shift());
    h.destroy(); env.restore();
  });

  it('拖曳的門檻也要求「元素」蓋滿視口：δ≠0 之後往反方向拖同樣不露白', () => {
    // 複審 I2 的復現（PROBE P1）：只問 cache.covers() 的話，δ=−200 再往**反**方向拖 400 px
    // 會走 transform 捷徑並把元素左緣推進 host 的 x=+80（左邊 80 px 是頁面底色）。
    const env = paintedHost();
    const h = mountCanvasTree(env.host, data);
    const staticEl = env.host.querySelector('canvas.tree-static') as HTMLElement;
    const overlay = env.host.querySelector('canvas.tree-overlay') as HTMLElement;
    env.flush(3); env.reset();
    h.view.pan(-200, 0); h.requestRedraw(); env.flush(1);   // δ = −200（位圖沿用，origin 不動）
    expect(env.offscreenCalls()).toBe(0);
    env.reset();
    overlay.dispatchEvent(ptr(env.document, 'pointerdown', 600, 400));
    overlay.dispatchEvent(ptr(env.document, 'pointermove', 1000, 400));   // dx = +400 > 邊距 320
    env.flush(1);
    expect(env.layerCalls()).toBeGreaterThan(0);   // 不准走捷徑：元素蓋不滿了
    expect(staticEl.style.transform).toBe(shift());
    h.destroy(); env.restore();
  });

  it('拖曳的門檻是相對位圖 origin，不是相對上一次重繪：中途取消的置中平移之後仍不露白', () => {
    // 審查給的分岔路徑：先有一幀「ensure 回 reused、但 view 已經平移過」（animatePan 的中間幀
    // 被 cancelCenterPan() 中途取消就是這樣），paintedAt 前進而位圖 origin 沒動。若門檻拿
    // paintedAt 算，接下來拖 200 px（<25% 視口）會被當成「還在邊距內」而繼續只位移，
    // 但位圖其實已經蓋不滿視口了 → 露白。
    const env = paintedHost();
    const h = mountCanvasTree(env.host, data);
    const staticEl = env.host.querySelector('canvas.tree-static') as HTMLElement;
    const overlay = env.host.querySelector('canvas.tree-overlay') as HTMLElement;
    env.flush(3); env.reset();
    h.view.pan(-200, 0); h.requestRedraw(); env.flush(1);   // 真的重繪一幀：paintedAt 前進，origin 不動
    expect(env.offscreenCalls()).toBe(0);                   // 還在邊距內，位圖沿用
    env.reset();
    overlay.dispatchEvent(ptr(env.document, 'pointerdown', 600, 400));
    overlay.dispatchEvent(ptr(env.document, 'pointermove', 400, 400));   // 再 −200＝離 origin −400
    env.flush(1);
    expect(env.layerCalls()).toBeGreaterThan(0);             // 不准走 transform 捷徑
    expect(env.offscreenCalls()).toBeGreaterThan(0);         // 而且位圖要補畫
    expect(staticEl.style.transform).toBe(shift());
    h.destroy(); env.restore();
  });
});

// linkedom 沒有 WheelEvent，跟 ptr() 一樣用 Event 手動補上 controller 會讀的欄位。
function wheel(document: Document, deltaY: number, x: number, y: number): Event {
  const ev = new (document.defaultView as unknown as { Event: typeof Event }).Event('wheel', { cancelable: true });
  for (const [k, v] of Object.entries({ deltaY, clientX: x, clientY: y })) {
    Object.defineProperty(ev, k, { value: v });
  }
  return ev;
}

describe('縮放中用 CSS transform 拉伸（Ruling V）', () => {
  it('縮放中不重繪任何 canvas，只加上 scale()；settle 之後才重畫並回到基準', async () => {
    // ⚠️ Pixel 7 4× 節流實測：改成 CSS 之前每一格滾輪都重新提交兩張 2.25× 貼圖，縮放只有
    // 22–47 FPS；平移早就走 compositor 所以一直是 54–60。
    const env = paintedHost();
    const h = mountCanvasTree(env.host, data);
    const staticEl = env.host.querySelector('canvas.tree-static') as HTMLElement;
    const overlay = env.host.querySelector('canvas.tree-overlay') as HTMLElement;
    env.flush(3); env.reset();
    const before = h.view.scale;
    overlay.dispatchEvent(wheel(env.document, -120, 640, 450));
    overlay.dispatchEvent(wheel(env.document, -120, 640, 450));
    env.flush(2);
    expect(h.view.scale).toBeGreaterThan(before);      // 鏡頭真的動了
    expect(env.layerCalls()).toBe(0);                  // 兩張 canvas 一個像素都沒重繪
    expect(env.offscreenCalls()).toBe(0);              // 位圖也沒重畫
    expect(staticEl.style.transform).toContain('scale(');
    expect(overlay.style.transform).toBe(staticEl.style.transform);

    // settle：150 ms 之後補畫一張清晰的，transform 回到基準
    await new Promise(r => setTimeout(r, 220));
    env.flush(1);
    expect(env.layerCalls()).toBeGreaterThan(0);
    expect(env.offscreenCalls()).toBeGreaterThan(0);
    expect(staticEl.style.transform).toBe(shift());
    expect(overlay.style.transform).toBe(shift());
    h.destroy(); env.restore();
  });

  it('縮小太多、拉伸過的貼圖蓋不滿視口時，當幀改成真的重繪（不然邊緣會露白）', () => {
    const env = paintedHost();
    const h = mountCanvasTree(env.host, data);
    const staticEl = env.host.querySelector('canvas.tree-static') as HTMLElement;
    const overlay = env.host.querySelector('canvas.tree-overlay') as HTMLElement;
    env.flush(3); env.reset();
    // 邊距 25% ⇒ 元素是 1.5× 視口，縮到 1/1.5 以下就蓋不滿了（1/1.1 每格，第 5 格越界）
    for (let i = 0; i < 6; i++) overlay.dispatchEvent(wheel(env.document, 120, 640, 450));
    env.flush(1);
    expect(env.layerCalls()).toBeGreaterThan(0);
    expect(staticEl.style.transform).toBe(shift());
    h.destroy(); env.restore();
  });
});

// ── Ruling X（2026-09-06）：2× 圖示的視錐＝純視口，刻意不含位圖的邊距那一圈 ─────
// 位圖畫的是「視口每邊外擴 PAN_MARGIN」那一塊，所以邊距那一圈的節點會被畫進位圖卻停在
// 1× sprite——那是**已知且刻意**的取捨：改成含邊距的話 Pixel 7 首屏從 70 張／358 KB 漲到
// 120 張／479 KB（實測），離 500 KB 的預算只剩 20 KB，而低解析那一圈會自癒（拖進視野、
// 手勢結束補畫那一幀就升級）。這條測試把「不含邊距」釘住，免得下一個人把它當 bug 修掉。
describe('2× 圖示的預載視錐', () => {
  it('範圍＝純視口：邊距那一圈的節點不預載，位圖蓋不到的更不預載', () => {
    const env = paintedHost();
    const prevImage = globalThis.Image;
    const asked: string[] = [];
    // AssetStore 的載入只要 `typeof Image === 'function'`；把 src 的賦值記下來就知道它要了誰。
    class FakeImage {
      decoding = '';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(u: string) { asked.push(u); }
    }
    globalThis.Image = FakeImage as never;
    const h = mountCanvasTree(env.host, data, { hiresBase: '/icons' });
    env.flush(3);
    // 放大到觸發 2× 升級（每單位裝置像素 0.53×4 ≈ 2.1 > HIRES_UPGRADE_AT）。
    h.view.zoomAt(4, 640, 450);
    h.requestRedraw(); env.flush(1);

    const k = h.view.pxPerUnit;
    const vis = h.view.visibleWorldRect();
    const bmp = { x: vis.x - MX / k, y: vis.y - MY / k, w: vis.w + 2 * MX / k, h: vis.h + 2 * MY / k };
    const inside = (n: { x: number; y: number }, r: { x: number; y: number; w: number; h: number }): boolean =>
      n.x >= r.x && n.x <= r.x + r.w && n.y >= r.y && n.y <= r.y + r.h;
    const iconsAsked = new Set(asked.filter(u => u.startsWith('/icons/')));
    const url = (icon: string): string => `/icons/${icon}.webp`;

    // 視口內的每一顆都要有（這一半才是預載真的有在做事的證據）。
    const visible = h.scene.nodes.filter(n => inside(n, vis));
    expect(visible.length).toBeGreaterThan(0);
    for (const n of visible) expect(iconsAsked).toContain(url(n.icon));

    // 邊距那一圈**不預載**：扣掉「圖示剛好跟視口內某顆共用」的那些之後，一張都不該被要。
    const visibleIcons = new Set(visible.map(n => url(n.icon)));
    const ring = h.scene.nodes.filter(n => !inside(n, vis) && inside(n, bmp) && !visibleIcons.has(url(n.icon)));
    expect(ring.length).toBeGreaterThan(0);        // 先確認這個視角真的有邊距節點可驗
    for (const n of ring) expect(iconsAsked).not.toContain(url(n.icon));

    // 連位圖都蓋不到的那些當然更不該抓（擋「乾脆全抓」）。
    expect(iconsAsked.size).toBeLessThan(h.scene.nodes.length);

    globalThis.Image = prevImage;
    h.destroy(); env.restore();
  });
});

// ── 2026-09-24 review P1：畫布輸入 ────────────────────────────────────────────
// linkedom 沒有 WheelEvent／PointerEvent，照 wheel()／ptr() 的做法補上 controller 會讀的欄位。
function wheelXY(document: Document, deltaX: number, deltaY: number, x: number, y: number): Event {
  const ev = new (document.defaultView as unknown as { Event: typeof Event }).Event('wheel', { cancelable: true });
  for (const [k, v] of Object.entries({ deltaX, deltaY, deltaMode: 0, clientX: x, clientY: y })) {
    Object.defineProperty(ev, k, { value: v });
  }
  return ev;
}
function mousePtr(document: Document, type: string, x: number, y: number, button: number): Event {
  const ev = ptr(document, type, x, y);
  Object.defineProperty(ev, 'pointerType', { value: 'mouse' });
  Object.defineProperty(ev, 'button', { value: button });
  return ev;
}

describe('wheelZoomFactor：倍率照 delta 大小與方向', () => {
  const f = (deltaY: number, o: Partial<{ deltaX: number; deltaMode: number; ctrlKey: boolean }> = {}): number =>
    wheelZoomFactor({ deltaY, deltaX: 0, deltaMode: 0, ctrlKey: false, ...o }, 900);

  it('一格滑鼠滾輪（±100 px）仍是 1.1 倍——E2E 的 zoomInAt() 靠這個值', () => {
    expect(f(-100)).toBeCloseTo(1.1, 10);
    expect(f(100)).toBeCloseTo(1 / 1.1, 10);
  });

  it('水平為主（含 deltaY=0）不縮放：舊版把它一律當縮小', () => {
    expect(f(0, { deltaX: 120 })).toBe(1);
    expect(f(10, { deltaX: -40 })).toBe(1);
    expect(f(0)).toBe(1);
  });

  it('觸控板的小 delta 累積起來跟總量成正比：20 個 −3 ≈ 一格的 60%，不是 1.1²⁰', () => {
    let s = 1;
    for (let i = 0; i < 20; i++) s *= f(-3);
    expect(s).toBeCloseTo(Math.pow(1.1, 0.6), 10);
    expect(s).toBeLessThan(1.1);
  });

  it('行模式（Firefox）三行＝一格；ctrlKey（觸控板捏合）放大係數；單一事件夾在 1/1.5–1.5', () => {
    expect(f(-3, { deltaMode: 1 })).toBeCloseTo(Math.pow(1.1, 0.99), 10);
    expect(f(-5, { ctrlKey: true })).toBeCloseTo(Math.pow(1.1, 0.5), 10);
    expect(f(-2000)).toBe(1.5);
    expect(f(2000)).toBeCloseTo(1 / 1.5, 10);
  });

  it('單元測試的假事件只帶 deltaY：deltaX／deltaMode 是 undefined 時照常縮放', () => {
    expect(wheelZoomFactor({ deltaY: -100 } as never, 900)).toBeCloseTo(1.1, 10);
  });
});

describe('wheel 事件接到 controller', () => {
  it('Shift＋滾輪／觸控板左右滑（deltaX=120、deltaY=0）三次：scale 不變', () => {
    const { document, host } = laidOutHost();
    const h = mountCanvasTree(host, data);
    const overlay = host.querySelector('canvas.tree-overlay') as HTMLElement;
    const before = h.view.scale;
    for (let i = 0; i < 3; i++) overlay.dispatchEvent(wheelXY(document, 120, 0, 640, 450));
    expect(h.view.scale).toBe(before);
    h.destroy();
  });

  it('觸控板連送 20 次 deltaY=−3：放大不到一格滑鼠滾輪（舊版直接衝到 MAX_SCALE）', () => {
    const { document, host } = laidOutHost();
    const h = mountCanvasTree(host, data);
    const overlay = host.querySelector('canvas.tree-overlay') as HTMLElement;
    const before = h.view.scale;
    for (let i = 0; i < 20; i++) overlay.dispatchEvent(wheelXY(document, 0, -3, 640, 450));
    expect(h.view.scale).toBeGreaterThan(before);
    expect(h.view.scale / before).toBeLessThan(1.1);
    h.destroy();
  });
});

describe('右鍵／中鍵不算點選', () => {
  it('滑鼠右鍵、中鍵在節點上按下放開：onSelect 不被呼叫；左鍵照常', () => {
    const { document, host } = laidOutHost();
    const h = mountCanvasTree(host, data);
    const overlay = host.querySelector('canvas.tree-overlay') as HTMLElement;
    const r = h.nodeScreenRect('1001')!;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const got: (string | null)[] = [];
    h.onSelect(id => got.push(id));
    for (const b of [2, 1]) {
      overlay.dispatchEvent(mousePtr(document, 'pointerdown', cx, cy, b));
      overlay.dispatchEvent(mousePtr(document, 'pointerup', cx, cy, b));
    }
    expect(got).toEqual([]);
    overlay.dispatchEvent(mousePtr(document, 'pointerdown', cx, cy, 0));
    overlay.dispatchEvent(mousePtr(document, 'pointerup', cx, cy, 0));
    expect(got).toEqual(['1001']);
    h.destroy();
  });

  it('右鍵按下沒有 pointerup（原生選單吃掉）：之後的 pointermove 仍走 hover，不是拖曳', () => {
    const { document, host } = laidOutHost();
    const h = mountCanvasTree(host, data);
    const overlay = host.querySelector('canvas.tree-overlay') as HTMLElement;
    const r = h.nodeScreenRect('1001')!;
    overlay.dispatchEvent(mousePtr(document, 'pointerdown', 10, 10, 2));
    overlay.dispatchEvent(ptr(document, 'pointermove', r.left + r.width / 2, r.top + r.height / 2));
    expect(h.getState().hover).toBe('1001');
    h.destroy();
  });
});

describe('devicePixelRatio 改變但 host 尺寸不變', () => {
  it('matchMedia 的 change 觸發後重新量：canvas 解析度跟上新的 dpr；destroy 拆掉監聽', () => {
    const { host } = laidOutHost();
    const listeners = new Set<() => void>();
    const queries: string[] = [];
    const prevMM = globalThis.matchMedia, prevDpr = globalThis.devicePixelRatio;
    globalThis.matchMedia = ((q: string) => {
      queries.push(q);
      return {
        matches: true,
        addEventListener: (_: string, cb: () => void) => listeners.add(cb),
        removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
      };
    }) as never;
    (globalThis as { devicePixelRatio?: number }).devicePixelRatio = 1;
    try {
      const h = mountCanvasTree(host, data);
      const staticEl = host.querySelector('canvas.tree-static') as HTMLCanvasElement;
      const w1 = staticEl.width;
      expect(listeners.size).toBe(1);
      expect(queries.at(-1)).toBe('(resolution: 1dppx)');

      (globalThis as { devicePixelRatio?: number }).devicePixelRatio = 2;
      for (const cb of [...listeners]) cb();
      expect(staticEl.width).toBe(w1 * 2);
      expect(queries.at(-1)).toBe('(resolution: 2dppx)');
      expect(listeners.size).toBe(1);   // 舊的拆掉、只留新的一個，不會越掛越多

      h.destroy();
      expect(listeners.size).toBe(0);
    } finally {
      globalThis.matchMedia = prevMM;
      (globalThis as { devicePixelRatio?: number }).devicePixelRatio = prevDpr;
    }
  });

  it('查詢用原始 dpr，不是夾過 1–3 的值（dpr 4 的裝置上 3dppx 一開始就不成立）', () => {
    const { host } = laidOutHost();
    const queries: string[] = [];
    const prevMM = globalThis.matchMedia, prevDpr = globalThis.devicePixelRatio;
    globalThis.matchMedia = ((q: string) => {
      queries.push(q);
      return { matches: true, addEventListener() {}, removeEventListener() {} };
    }) as never;
    (globalThis as { devicePixelRatio?: number }).devicePixelRatio = 4;
    try {
      const h = mountCanvasTree(host, data);
      expect(queries.at(-1)).toBe('(resolution: 4dppx)');
      h.destroy();
    } finally {
      globalThis.matchMedia = prevMM;
      (globalThis as { devicePixelRatio?: number }).devicePixelRatio = prevDpr;
    }
  });
});

describe('devicePixelRatio 的備援：沒收到 matchMedia change 也要跟上', () => {
  it('下一次重畫先發現 dpr 變了 → 重新量，canvas 解析度翻倍（CDP 裝置模擬就是這種情形）', () => {
    const env = paintedHost();
    const prevDpr = globalThis.devicePixelRatio;
    (globalThis as { devicePixelRatio?: number }).devicePixelRatio = 1;
    try {
      const h = mountCanvasTree(env.host, data);
      const staticEl = env.host.querySelector('canvas.tree-static') as HTMLCanvasElement;
      env.flush(3);
      const w1 = staticEl.width;
      (globalThis as { devicePixelRatio?: number }).devicePixelRatio = 2;
      h.setState({ hover: '1001' });
      env.flush(2);
      expect(staticEl.width).toBe(w1 * 2);
      h.destroy();
    } finally {
      (globalThis as { devicePixelRatio?: number }).devicePixelRatio = prevDpr;
      env.restore();
    }
  });
});

describe('hover 只重畫互動層', () => {
  const blits = (log: Call[]): number => log.filter(c => c.m === 'drawImage' || c.m === 'clearRect').length;

  it('滑過節點進出：靜態層不 clear 也不 blit；互動層照畫', () => {
    const env = paintedHost();
    const h = mountCanvasTree(env.host, data);
    const overlay = env.host.querySelector('canvas.tree-overlay') as HTMLElement;
    env.flush(3); env.reset();
    const r = h.nodeScreenRect('1001')!;
    for (let i = 0; i < 3; i++) {
      overlay.dispatchEvent(ptr(env.document, 'pointermove', r.left + r.width / 2, r.top + r.height / 2));
      env.flush(1);
      overlay.dispatchEvent(ptr(env.document, 'pointermove', 5, 5));
      env.flush(1);
    }
    expect(blits(env.staticLog())).toBe(0);
    expect(env.overlayLog().length).toBeGreaterThan(0);
    h.destroy(); env.restore();
  });

  it('位圖重畫（選取改變）或平移（blit 位置變）那一幀照樣 blit——守衛不能擋掉真的變化', () => {
    const env = paintedHost();
    const h = mountCanvasTree(env.host, data);
    env.flush(3); env.reset();
    h.setState({ selected: '1001', chain: new Set(['1001']) });
    env.flush(1);
    expect(env.offscreenCalls()).toBeGreaterThan(0);
    expect(blits(env.staticLog())).toBe(2);
    env.reset();
    h.view.pan(-40, 0);            // 邊距內：位圖沿用，但貼的位置變了
    h.requestRedraw(); env.flush(1);
    expect(env.offscreenCalls()).toBe(0);
    expect(blits(env.staticLog())).toBe(2);
    h.destroy(); env.restore();
  });
});

// ── PR #88 /code-review 第 1 輪 ───────────────────────────────────────────────
describe('review 第 1 輪', () => {
  it('Firefox：先讀 deltaMode 才拿得到行模式——讀取順序反了就只剩 1.05 倍', () => {
    // 模擬 Firefox 的行為：deltaY 在 deltaMode 被讀過之前被讀到，就回報像素（3 行 × 19 px）並把 deltaMode 定成 0
    const ff = () => {
      let modeRead = false, pixelLocked = false;
      return {
        get deltaMode() { modeRead = true; return pixelLocked ? 0 : 1; },
        get deltaY() { if (!modeRead) pixelLocked = true; return pixelLocked ? -57 : -3; },
        get deltaX() { return 0; },
        ctrlKey: false,
      };
    };
    expect(wheelZoomFactor(ff() as never, 900)).toBeCloseTo(Math.pow(1.1, 0.99), 10);
  });

  it('isGesturePointer：滑鼠只收左鍵，觸控／筆與沒帶欄位的假事件一律收', () => {
    expect(isGesturePointer({ pointerType: 'mouse', button: 0 })).toBe(true);
    expect(isGesturePointer({ pointerType: 'mouse', button: 2 })).toBe(false);
    expect(isGesturePointer({ pointerType: 'mouse', button: 1 })).toBe(false);
    expect(isGesturePointer({ pointerType: 'pen', button: 2 })).toBe(true);
    expect(isGesturePointer({} as never)).toBe(true);
  });

  it('macOS Ctrl＋點擊（button 0 ＋ contextmenu）：不算點選，也不留下觸控點', () => {
    const { document, host } = laidOutHost();
    const h = mountCanvasTree(host, data);
    const overlay = host.querySelector('canvas.tree-overlay') as HTMLElement;
    const r = h.nodeScreenRect('1001')!;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const got: (string | null)[] = [];
    h.onSelect(id => got.push(id));
    overlay.dispatchEvent(mousePtr(document, 'pointerdown', 10, 10, 0));
    overlay.dispatchEvent(new (document.defaultView as unknown as { Event: typeof Event }).Event('contextmenu'));
    overlay.dispatchEvent(mousePtr(document, 'pointerup', 10, 10, 0));
    expect(got).toEqual([]);
    // 選單吃掉 pointerup 的情形：觸控點不能殘留，否則之後的 hover 分支永遠走不到
    overlay.dispatchEvent(mousePtr(document, 'pointerdown', 10, 10, 0));
    overlay.dispatchEvent(new (document.defaultView as unknown as { Event: typeof Event }).Event('contextmenu'));
    overlay.dispatchEvent(ptr(document, 'pointermove', cx, cy));
    expect(h.getState().hover).toBe('1001');
    h.destroy();
  });

  it('2D context 恢復之後：下一次 hover 就重貼靜態層（blit 守衛不能以為它還在）', () => {
    const env = paintedHost();
    const h = mountCanvasTree(env.host, data);
    const overlay = env.host.querySelector('canvas.tree-overlay') as HTMLElement;
    const staticEl = env.host.querySelector('canvas.tree-static') as HTMLElement;
    env.flush(3); env.reset();
    staticEl.dispatchEvent(new (env.document.defaultView as unknown as { Event: typeof Event }).Event('contextrestored'));
    const r = h.nodeScreenRect('1001')!;
    overlay.dispatchEvent(ptr(env.document, 'pointermove', r.left + r.width / 2, r.top + r.height / 2));
    env.flush(1);
    expect(env.staticLog().filter(c => c.m === 'drawImage').length).toBe(1);
    h.destroy(); env.restore();
  });

  it('ResizeObserver 連續觸發但 dpr 沒變：不重建 matchMedia 查詢', () => {
    const { host } = laidOutHost();
    let created = 0;
    let roCb: (() => void) | null = null;
    const prevMM = globalThis.matchMedia, prevRO = globalThis.ResizeObserver;
    globalThis.matchMedia = (() => { created++; return { matches: true, addEventListener() {}, removeEventListener() {} }; }) as never;
    globalThis.ResizeObserver = class { constructor(cb: () => void) { roCb = cb; } observe() {} disconnect() {} } as never;
    try {
      const h = mountCanvasTree(host, data);
      expect(created).toBe(1);
      for (let i = 0; i < 10; i++) roCb!();
      expect(created).toBe(1);
      h.destroy();
    } finally {
      globalThis.matchMedia = prevMM; globalThis.ResizeObserver = prevRO;
    }
  });
});

describe('escapeShift：鍵盤焦點把節點帶到看得見的地方', () => {
  const R = (left: number, top: number, width: number, height: number) => ({ left, top, width, height });
  it('沒有遮蔽物：已經在四邊 40px 內不動，超出就推回邊界', () => {
    expect(escapeShift(500, 500, 1280, 900, [])).toEqual([0, 0]);
    expect(escapeShift(10, 890, 1280, 900, [])).toEqual([30, -30]);
  });
  it('只避開真的蓋住它的矩形：左上角工具列不會把右上角的節點白推一段', () => {
    const toolbar = R(0, 0, 700, 60);
    expect(escapeShift(1100, 60, 1280, 900, [toolbar])).toEqual([0, 0]);
    // 在工具列底下：挑最短的出路（往下到工具列下緣＋40 = 20px，比往右 640px 近）
    expect(escapeShift(300, 80, 1280, 900, [toolbar])).toEqual([0, 20]);
  });
  it('往下推會撞進另一個遮蔽物時改走別條路；四邊都算', () => {
    const toolbar = R(0, 0, 700, 60), nav = R(0, 60, 80, 200);
    const [dx, dy] = escapeShift(60, 100, 1280, 900, [toolbar, nav]);
    const px = 60 + dx, py = 100 + dy;
    for (const r of [toolbar, nav]) {
      expect(px > r.left - 40 && px < r.left + r.width + 40 && py > r.top - 40 && py < r.top + r.height + 40).toBe(false);
    }
    expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(80);   // 往右 80 就出來了
  });
  it('放不下（整片被蓋）：退回只夾 host 四邊，不丟例外', () => {
    expect(escapeShift(500, 500, 1280, 900, [R(0, 0, 1280, 900)])).toEqual([0, 0]);
  });
});

describe('obscurers：ensureVisible 與 visibleShift 避開頁面浮層', () => {
  const focusNode = (host: HTMLElement, id: string) =>
    host.querySelector(`button[data-id="${id}"]`)!.dispatchEvent(new LinkedomEvent('focus') as unknown as Event);

  it('節點在工具列底下：聚焦後被帶出來；沒給遮蔽物就不動（已在 40px 邊界內）', () => {
    const toolbar = { left: 0, top: 0, width: 1280, height: 100 };
    for (const [obs, want] of [[[toolbar], 140], [undefined, 60]] as const) {
      const { host } = laidOutHost();
      const h = mountCanvasTree(host, data, obs ? { obscurers: () => [...obs] } : {});
      const n = h.scene.byId.get('1001')!;
      const [, sy] = h.view.worldToScreen(n.x, n.y);
      h.view.pan(0, 60 - sy);
      expect(h.visibleShift('1001')[1]).toBeCloseTo(want - 60, 6);   // 同一份計算，只是不平移
      focusNode(host, '1001');
      expect(h.view.worldToScreen(n.x, n.y)[1]).toBeCloseTo(want, 6);
      h.destroy();
    }
  });

  it('遮蔽物是視窗座標：host 有 offset 時先換算成 host 內座標', () => {
    const { host } = laidOutHost();
    host.getBoundingClientRect = (() => ({ width: 1280, height: 900, left: 0, top: 50, right: 1280, bottom: 950, x: 0, y: 50, toJSON() {} })) as never;
    const h = mountCanvasTree(host, data, { obscurers: () => [{ left: 0, top: 50, width: 1280, height: 100 }] });
    const n = h.scene.byId.get('1001')!;
    const [, sy] = h.view.worldToScreen(n.x, n.y);
    h.view.pan(0, 60 - sy);   // host 內 y=60，被 host 內 0–100 的工具列蓋住
    expect(h.visibleShift('1001')[1]).toBeCloseTo(80, 6);
    h.destroy();
  });
});
