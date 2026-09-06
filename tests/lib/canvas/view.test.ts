import { describe, it, expect } from 'vitest';
import {
  CanvasView, shiftedView, MIN_SCALE, MAX_SCALE, minReadableScale, effectiveDevicePx,
  HIRES_UPGRADE_AT, HIRES_DOWNGRADE_AT, SHADOW_ON_AT_ICON_PX, SHADOW_OFF_AT_ICON_PX,
  DESKTOP_ICON_TARGET_PX, MOBILE_ICON_TARGET_PX,
} from '../../../src/lib/canvas/view';

const VB: [number, number, number, number] = [0, 0, 2000, 1700];

describe('CanvasView', () => {
  it('fitTo 整張 viewBox 後 scale=1，world 中心落在容器中心', () => {
    const v = new CanvasView(VB); v.resize(1000, 850);
    v.fitTo(VB, 1);
    expect(v.scale).toBe(1);
    expect(v.worldToScreen(1000, 850)).toEqual([500, 425]);
  });
  it('worldToScreen 與 screenToWorld 互為反函數（平移縮放後仍成立）', () => {
    const v = new CanvasView(VB); v.resize(1440, 900); v.fitTo(VB);
    v.pan(123, -45); v.zoomAt(1.7, 300, 200);
    const [sx, sy] = v.worldToScreen(860, 680);
    const [wx, wy] = v.screenToWorld(sx, sy);
    expect(wx).toBeCloseTo(860, 6); expect(wy).toBeCloseTo(680, 6);
  });
  it('zoomAt 以游標為錨點：錨點下的 world 座標縮放前後相同', () => {
    const v = new CanvasView(VB); v.resize(1440, 900); v.fitTo(VB);
    const before = v.screenToWorld(300, 200);
    v.zoomAt(2, 300, 200);
    const after = v.screenToWorld(300, 200);
    expect(after[0]).toBeCloseTo(before[0], 6); expect(after[1]).toBeCloseTo(before[1], 6);
  });
  it('scale 夾在 0.2～8', () => {
    const v = new CanvasView(VB); v.resize(1440, 900); v.fitTo(VB);
    v.zoomAt(100, 0, 0); expect(v.scale).toBe(MAX_SCALE);
    v.zoomAt(1e-6, 0, 0); expect(v.scale).toBe(MIN_SCALE);
  });
  it('version 每次改變 +1，resize 也算', () => {
    const v = new CanvasView(VB); const v0 = v.version;
    v.resize(800, 600); v.pan(1, 1); v.zoomAt(1.1, 0, 0);
    expect(v.version).toBe(v0 + 3);
  });
  it('minReadableScale：骰子 50 單位要達 26 CSS px 時的最小 scale', () => {
    // 1440×900 容器對 2000×1700：pxPerUnit(base)=min(0.72,0.529)=0.529 → 26/(50*0.529)=0.983
    expect(minReadableScale(1440, 900, 2000, 1700, 50, 26)).toBeCloseTo(0.983, 2);
  });
  it('cssSize：resize 後回傳目前的容器 CSS px 尺寸', () => {
    const v = new CanvasView(VB);
    v.resize(1000, 850);
    expect(v.cssSize).toEqual([1000, 850]);
  });
});

// ── 以下三組是 tests/lib/viewport.test.ts 隨 SVG 渲染器一起刪掉時搬過來的 ──────────
// 那個檔測的 `Viewport`（getScreenCTM／DOM transform）已經不存在了，但這幾條門檻常數與
// 兩個純算式在 canvas/view.ts 是**同名同公式**原封搬過來的，它們守的不變式仍然有效——
// 連同數值一起照搬，不重新推導。

describe('minReadableScale（task-17/18 裁決：最小可讀縮放下限，純函式）', () => {
  // 這三組是這一組純函式測試自己的**固定樣本**，不是站台當下的實際值（正本的 viewBox 是
  // 2000×1700、骰子圖示 50 單位寬）。minReadableScale() 是純算式，換成真實資料只會讓期望值
  // 跟著資料浮動、失去「這個算式算對了沒」的意義，所以刻意釘死在一組容易手算的數字上。
  // 要驗「站台實際用的值有沒有接對」，那是 tests/scripts/tree-canvas.test.ts 的事。
  //
  // ⚠️ 簽章吃的是**容器寬高兩個**，不是只吃寬度：SVG 時期 preserveAspectRatio 預設的
  // `xMidYMid meet`（＝canvas 版 `base` 的 `Math.min(w/vbw, h/vbh)`）是「寬高兩個縮放比取
  // 較小值」，容器與 viewBox 長寬比不同時，到底是寬還是高在限制縮放要看實際尺寸。只算寬度
  // 在手機直向容器（窄且高）剛好蒙混過關，桌機橫向容器（寬且扁，比 viewBox 更扁）就會算錯
  // ——下面「1280x610 桌機」那條就是 task-18 修正的核心案例。
  const VBW = 3400, VBH = 2850, DICE = 48;

  it('390x800 手機直向（寬度限制縮放）：最小可讀縮放約 5.8×（目標 32px）', () => {
    const s = minReadableScale(390, 800, VBW, VBH, DICE, 32);
    expect(s).toBeGreaterThan(5.5);
    expect(s).toBeLessThan(6.0);
    // 精確值另外鎖死，避免公式日後被意外改動卻沒被上面的寬鬆範圍抓到。
    expect(s).toBeCloseTo(5.811965811965812, 9);
  });
  it('768x1024 平板直向（寬度限制縮放）：約 2.95×（中間寬度的樣本點，目標 32px）', () => {
    expect(minReadableScale(768, 1024, VBW, VBH, DICE, 32)).toBeCloseTo(2.9513888888888884, 9);
  });
  it('1280x610 桌機橫向（高度限制縮放，task-18 修正的核心案例）：約 2.34×（目標 24px）', () => {
    // 用高度換算（610/2850≈0.214），不是舊 bug 版本用寬度換算（1280/3400≈0.376）——若還在用
    // 舊公式，這裡會因為每單位 px 數被高估 76% 而算出遠小於正確值的下限（約 1.33x），
    // 對應到 fitTo 給的 0.9x 桌機初始視角仍然低於下限但幅度小很多，等於沒修好。
    expect(minReadableScale(1280, 610, VBW, VBH, DICE, 24)).toBeCloseTo(2.3360655737704916, 9);
  });
  it('容器高度比 viewBox 更扁時，改由高度限制縮放，不是寬度', () => {
    // 兩個容器寬度相同（1280），只改高度：矮的（610，桌機常見比例）比高的（2850，正好跟
    // viewBox 一樣高、寬度轉為限制縮放的那個）需要更大的縮放下限——矮容器的高度限制更緊。
    expect(minReadableScale(1280, 610, VBW, VBH, DICE, 24))
      .toBeGreaterThan(minReadableScale(1280, 2850, VBW, VBH, DICE, 24));
  });
  it('容器越寬（同高度），需要的縮放下限越小（同一顆圖示在大螢幕上不用放大也看得清）', () => {
    expect(minReadableScale(390, 800, VBW, VBH, DICE, 32))
      .toBeGreaterThan(minReadableScale(1200, 800, VBW, VBH, DICE, 32));
  });
});

describe('effectiveDevicePx（高解析升級的真正判準）', () => {
  // viewBox 固定 2000×1700（見 CLAUDE.md 的不變量）。
  const px = (w: number, h: number, scale: number, dpr: number) => effectiveDevicePx(w, h, 2000, 1700, scale, dpr);

  it('1280×720 桌機 dpr1：初始視角不該升級——舊版在這裡白抓了 213 張圖', () => {
    // 畫布高 595（1280×720 扣掉 nav 與 footer），可讀性下限把 scale 拉到約 1.49。
    const v = px(1280, 595, 1.49, 1);
    expect(v).toBeCloseTo(0.52, 1);
    expect(v).toBeLessThan(HIRES_UPGRADE_AT);
  });
  it('2560×1440 dpr2：該升級——舊版在這裡一張都沒升', () => {
    expect(px(2560, 1315, 1.49, 2)).toBeGreaterThan(HIRES_UPGRADE_AT);
  });
  it('Pixel 7 手機（412×678 dpr2.625，分支視角 scale≈5.5）：該升級', () => {
    expect(px(412, 678, 5.5, 2.625)).toBeGreaterThan(HIRES_UPGRADE_AT);
  });
  it('桌機放大之後就會跨過門檻', () => {
    expect(px(1280, 595, 1.49, 1)).toBeLessThan(HIRES_UPGRADE_AT);
    expect(px(1280, 595, 4, 1)).toBeGreaterThan(HIRES_UPGRADE_AT);
  });
  it('遲滯：升級門檻高於降級門檻，避免在邊界反覆抖動', () => {
    expect(HIRES_UPGRADE_AT).toBeGreaterThan(HIRES_DOWNGRADE_AT);
  });
  it('viewBox 壞掉時回 0，不會變成 NaN 一路傳下去', () => {
    expect(effectiveDevicePx(1280, 595, 0, 1700, 2, 1)).toBe(0);
  });
});

describe('投影門檻（SHADOW_*_AT_ICON_PX）的不變式', () => {
  it('有遲滯：開啟門檻嚴格高於關閉門檻', () => {
    expect(SHADOW_ON_AT_ICON_PX).toBeGreaterThan(SHADOW_OFF_AT_ICON_PX);
  });

  /**
   * 這條是整個效能修正的地基，不是湊數的斷言。
   *
   * `/tree` 的 `applyReadabilityFloor()` 與 `/sim` 的 `fitAll()` 都保證預設視角的圖示顯示寬度
   * **至少**是這兩個目標值——也就是「整棵樹／整個分支都看得到」那個節點最多、最慢的狀態，
   * 一定落在門檻上。關閉門檻只要掉到任何一個目標值以下，那個狀態就會重新畫滿 239（或數十）
   * 個 drop-shadow，2026-08-21 真機實測的手機平移 20→40 FPS 直接還回去。
   *
   * 日後有人調 DESKTOP_ICON_TARGET_PX／MOBILE_ICON_TARGET_PX（例如骰子顯示尺寸改了要照比例
   * 重算）時，這條測試會紅，提醒他一起看投影門檻。
   */
  it('關閉門檻高於預設視角保證的圖示尺寸：預設視角一律不畫投影', () => {
    expect(SHADOW_OFF_AT_ICON_PX).toBeGreaterThan(DESKTOP_ICON_TARGET_PX);
    expect(SHADOW_OFF_AT_ICON_PX).toBeGreaterThan(MOBILE_ICON_TARGET_PX);
  });
});

// ── I3（2026-09-06 最終審查）：位移視圖只是一個唯讀的幾何替身 ─────────────────
// 舊版手工湊出 12 個成員再 `as unknown as CanvasView` 冒充類別實例，其中
// resize／pan／zoomAt／fitTo 四支**直接改到底層那個真的 view**——沒有任何呼叫端會對
// 位移視圖做這件事，而它們存在的唯一理由是「湊齊型別」。現在型別是 ViewGeometry
// （唯讀幾何），這四支不必再假裝提供，painter／cache 也拿不到改狀態的手把。
describe('shiftedView', () => {
  const base = (): CanvasView => { const v = new CanvasView(VB); v.resize(1000, 850); v.fitTo(VB, 1); return v; };
  it('world→screen 多一份邊距，screen→world 反向抵銷，cssSize 是整張元素', () => {
    const v = base();
    const s = shiftedView(v, 40, 30, 1080, 910);
    const [x0, y0] = v.worldToScreen(500, 400);
    expect(s.worldToScreen(500, 400)).toEqual([x0 + 40, y0 + 30]);
    expect(s.screenToWorld(x0 + 40, y0 + 30)).toEqual([500, 400]);
    expect(s.cssSize).toEqual([1080, 910]);
  });
  it('visibleWorldRect 回整張元素蓋到的 world 範圍（＝視口每邊外擴一份邊距）', () => {
    const v = base();
    const s = shiftedView(v, 40, 30, 1080, 910);
    const r = s.visibleWorldRect(), vr = v.visibleWorldRect();
    const k = v.pxPerUnit;
    expect(r.x).toBeCloseTo(vr.x - 40 / k, 10);
    expect(r.y).toBeCloseTo(vr.y - 30 / k, 10);
    expect(r.w).toBeCloseTo(vr.w + 80 / k, 10);
    expect(r.h).toBeCloseTo(vr.h + 60 / k, 10);
  });
  it('不再提供 resize／pan／zoomAt／fitTo：位移視圖碰不到底層 view 的狀態', () => {
    const v = base();
    const s = shiftedView(v, 40, 30, 1080, 910) as unknown as Record<string, unknown>;
    for (const m of ['resize', 'pan', 'zoomAt', 'fitTo']) expect(s[m]).toBeUndefined();
  });
});
