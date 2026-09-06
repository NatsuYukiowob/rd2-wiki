import { describe, it, expect } from 'vitest';
import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { mountCanvasTree } from '../../../src/lib/canvas/canvas-tree';
import type { TreeData } from '../../../src/lib/types';
const data = JSON.parse(readFileSync('src/generated/tree.json', 'utf8')) as TreeData;

// linkedom 沒有 2D context、沒有版面引擎（getBoundingClientRect 全 0），所以這裡只驗
// 「掛得起來、狀態進得去、查詢介面裝得上」，實際繪圖由瀏覽器 smoke 與 E2E 驗。
// 偵錯介面裝在 globalThis（瀏覽器＝window），測試也從 globalThis 讀。
type DebugHost = { __tree?: { count(): { nodes: number; edges: number }; scale(): number; hitAt(x: number, y: number): string | null } };

describe('mountCanvasTree（linkedom：沒有 2D context，只驗掛載與狀態）', () => {
  it('掛出兩張 canvas 與 241 顆按鈕；setState 後 getState 反映；nodeScreenRect 在沒版面時回 null 而不是丟', () => {
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
    reset: () => { for (const c of [...offscreen, ...layers]) c.calls = 0; },
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

  it('平移 10% 視口寬（邊距內）：沿用舊位圖，241 顆一顆都不重畫', () => {
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
