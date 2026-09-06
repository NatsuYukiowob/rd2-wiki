import { describe, it, expect, vi } from 'vitest';
import { StaticCache, PAN_MARGIN, MAX_AREA, MAX_SIDE, marginPx } from '../../../src/lib/canvas/cache';
import { CanvasView, type ViewGeometry } from '../../../src/lib/canvas/view';
import { emptyPaintState } from '../../../src/lib/canvas/state';
import type { Ctx2D } from '../../../src/lib/canvas/painter';
const VB: [number, number, number, number] = [0, 0, 2000, 1700];
const mk = () => { const ctx = {} as Ctx2D; return { canvas: { width: 0, height: 0 } as never, ctx }; };

describe('StaticCache', () => {
  it('第一次 ensure 重畫；只平移不重畫；縮放、狀態、dpr、視口尺寸、圖集版本任一變就重畫', () => {
    const cache = new StaticCache(mk); const draw = vi.fn();
    const v = new CanvasView(VB); v.resize(1000, 800); v.fitTo(VB); const s = emptyPaintState();
    expect(cache.ensure(v, s, 1, 1000, 800, 0, draw)).toBe('redrawn');
    v.pan(30, -20);
    expect(cache.ensure(v, s, 1, 1000, 800, 0, draw)).toBe('reused');
    v.zoomAt(1.3, 10, 10);
    expect(cache.ensure(v, s, 1, 1000, 800, 0, draw)).toBe('redrawn');
    expect(cache.ensure(v, { ...s, selected: 'x', chain: new Set(['x']) }, 1, 1000, 800, 0, draw)).toBe('redrawn');
    expect(cache.ensure(v, s, 2, 1000, 800, 0, draw)).toBe('redrawn');
    expect(cache.ensure(v, s, 2, 1000, 700, 0, draw)).toBe('redrawn');
    expect(cache.ensure(v, s, 2, 1000, 700, 1, draw)).toBe('redrawn');
    expect(draw).toHaveBeenCalledTimes(6);
  });
  it('invalidate 之後下一次一定重畫', () => {
    const cache = new StaticCache(mk); const draw = vi.fn(); const v = new CanvasView(VB); v.resize(10, 10); v.fitTo(VB);
    cache.ensure(v, emptyPaintState(), 1, 10, 10, 0, draw); cache.invalidate();
    expect(cache.ensure(v, emptyPaintState(), 1, 10, 10, 0, draw)).toBe('redrawn');
  });
});

// ── Task 12c：位圖帶邊距（平移不再露出空白）────────────────────────────────────
/** 記下每次配置的位圖尺寸，並提供一個吃得下 painter 全部呼叫的假 ctx。 */
function recordingFactory(): { sizes: [number, number][]; mk: (w: number, h: number) => never } {
  const sizes: [number, number][] = [];
  const mk = (w: number, h: number) => {
    sizes.push([w, h]);
    const ctx = { setTransform() {}, clearRect() {} } as unknown as Ctx2D;
    return { canvas: { width: w, height: h } as never, ctx };
  };
  return { sizes, mk: mk as never };
}

describe('StaticCache 的平移邊距', () => {
  it('位圖每邊外擴 PAN_MARGIN：尺寸＝視口×(1+2·margin)×dpr', () => {
    const { sizes, mk: f } = recordingFactory();
    const cache = new StaticCache(f);
    const v = new CanvasView(VB); v.resize(1000, 800); v.fitTo(VB);
    cache.ensure(v, emptyPaintState(), 1, 1000, 800, 0, () => {});
    cache.ensure(v, emptyPaintState(), 2, 1000, 800, 0, () => {});
    // ⚠️ 期望值寫字面值，不寫 `1000 * (1 + 2 * PAN_MARGIN)`：那是拿同一個常數驗它自己算出來的
    // 東西，`PAN_MARGIN` 被改成 0 也照樣綠（2026-09-06 審查 M3 實測）。
    expect(sizes[0]).toEqual([1500, 1200]);      // 1000×800，dpr 1 → 每邊 +250／+200
    expect(sizes[1]).toEqual([3000, 2400]);      // 同一個視口，dpr 2 → 每個數字再乘 2
    expect(PAN_MARGIN).toBeGreaterThan(0);
  });

  it('餵給 draw 回呼的是「位圖座標系」的 view：world 原點推了一份邊距，cssSize 是整張位圖', () => {
    // ⚠️ 這條守的是整段改動最吃重的那個算術。審查 M2 實測：把 `shiftedView(view, mx/dpr, …)`
    // 改成 `shiftedView(view, 0, 0, …)`（畫的時候不補邊距、blit 仍照含邊距的 originPx 擺）之後，
    // 105 條單元測試全綠，只有 E2E 快照會紅——那條偏移不能只靠快照守。
    const { mk: f } = recordingFactory();
    const cache = new StaticCache(f);
    const v = new CanvasView(VB); v.resize(1000, 800); v.fitTo(VB);
    const seen: ViewGeometry[] = [];
    cache.ensure(v, emptyPaintState(), 2, 1000, 800, 0, (_ctx, dv) => { seen.push(dv); });
    expect(seen).toHaveLength(1);
    const dv = seen[0]!;
    const [tx, ty] = v.worldToScreen(0, 0);
    expect(dv.worldToScreen(0, 0)[0]).toBeCloseTo(tx + 250, 6);   // 1000×0.25
    expect(dv.worldToScreen(0, 0)[1]).toBeCloseTo(ty + 200, 6);   // 800×0.25
    // painter 的 clear() 讀 cssSize×dpr 清整張位圖；小於位圖的話邊距那圈會留上一幀的殘影。
    expect(dv.cssSize).toEqual([1500, 1200]);
    expect(dv.pxPerUnit).toBe(v.pxPerUnit);                        // 縮放不能被動到
    expect(dv.screenToWorld(...dv.worldToScreen(3, 7))[0]).toBeCloseTo(3, 6);
  });

  it('originPx＝world 原點在位圖裡的位置（含邊距偏移），blit 時用它把位圖擺回原位', () => {
    const { mk: f } = recordingFactory();
    const cache = new StaticCache(f);
    const v = new CanvasView(VB); v.resize(1000, 800); v.fitTo(VB);
    cache.ensure(v, emptyPaintState(), 1, 1000, 800, 0, () => {});
    const [tx, ty] = v.worldToScreen(0, 0);
    expect(cache.originPx[0]).toBeCloseTo(tx + 1000 * PAN_MARGIN, 6);
    expect(cache.originPx[1]).toBeCloseTo(ty + 800 * PAN_MARGIN, 6);
  });

  it('covers()：邊距內的平移仍蓋滿視口，超出就不蓋滿（呼叫端據此補畫）', () => {
    const { mk: f } = recordingFactory();
    const cache = new StaticCache(f);
    const v = new CanvasView(VB); v.resize(1000, 800); v.fitTo(VB);
    cache.ensure(v, emptyPaintState(), 1, 1000, 800, 0, () => {});
    expect(cache.covers(v, 1000, 800)).toBe(true);
    v.pan(100, 0);                       // 10% 視口寬，還在 25% 邊距內
    expect(cache.covers(v, 1000, 800)).toBe(true);
    v.pan(400, 0);                       // 累計 50%，超出邊距
    expect(cache.covers(v, 1000, 800)).toBe(false);
    v.pan(-500, 300);                    // 回到原點再往下 37.5% 視口高
    expect(cache.covers(v, 1000, 800)).toBe(false);
  });
});

describe('marginPx 的面積夾制', () => {
  it('位圖會超過瀏覽器面積上限時邊距逐次減半降級，而不是配一張安靜壞掉的位圖', () => {
    expect(marginPx(1600, 900, 1)).toEqual([400, 225]);        // 一般尺寸：完整的 25%
    // 2.5K×dpr2：完整邊距會是 7680×4200＝32.3M px，超過上限 → 降級但不歸零
    const [mx, my] = marginPx(2560, 1400, 2);
    const w = 5120 + 2 * mx, h = 2800 + 2 * my;
    expect(mx).toBeGreaterThan(0);
    expect(mx).toBeLessThan(2560 * PAN_MARGIN);
    expect(Math.max(w, h)).toBeLessThanOrEqual(MAX_SIDE);
    expect(w * h).toBeLessThanOrEqual(MAX_AREA);
    // 視口本身就超標（8000×6000＝48M）：邊距救不了，退到 0＝元素就是視口大小
    expect(marginPx(4000, 3000, 2)).toEqual([0, 0]);
  });
});
