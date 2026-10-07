import { describe, it, expect } from 'vitest';
import { CanvasView } from '../../src/lib/canvas/view';
import { applyCarriedView, modeSwitchHref, parseViewParam } from '../../src/lib/mode-switch';

const VB: [number, number, number, number] = [0, 0, 2000, 1700];

describe('mode-switch 視角', () => {
  it('帶過去的視角：容器尺寸不同時，畫面中心看的 world 點與倍率不變', () => {
    const from = new CanvasView(VB); from.resize(1440, 900); from.fitTo(VB);
    from.pan(-210, 95); from.zoomAt(1.8, 400, 300);
    const href = modeSwitchHref('/sim/', '5201', from);
    const p = new URLSearchParams(href.split('?')[1]);
    expect(p.get('node')).toBe('5201');

    const to = new CanvasView(VB); to.resize(1100, 760); to.fitTo(VB);
    applyCarriedView(to, parseViewParam(p.get('view'))!);
    const [fx, fy] = from.screenToWorld(720, 450);
    const [tx, ty] = to.screenToWorld(550, 380);
    expect(tx).toBeCloseTo(fx, 0); expect(ty).toBeCloseTo(fy, 0);
    expect(to.pxPerUnit).toBeCloseTo(from.pxPerUnit, 3);
  });
  it('沒有選取節點時不帶 node', () => {
    const v = new CanvasView(VB); v.resize(800, 600); v.fitTo(VB);
    expect(new URLSearchParams(modeSwitchHref('/tree/', null, v).split('?')[1]).has('node')).toBe(false);
  });
  it('壞掉的 view 參數一律當沒帶', () => {
    for (const s of [null, '', '1,2', '1,2,0', '1,2,-3', 'a,b,c', '1,2,3,4', '1,,3']) {
      expect(parseViewParam(s)).toBeNull();
    }
    expect(parseViewParam('100,-50,0.5')).toEqual({ cx: 100, cy: -50, ppu: 0.5 });
  });
});
