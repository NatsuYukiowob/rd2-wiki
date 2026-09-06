// painter 是唯一碰 Canvas 2D 的檔；這裡用假 ctx（Proxy 記錄呼叫）測，不需要真的 <canvas>。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildScene } from '../../../src/lib/canvas/scene';
import { CanvasView } from '../../../src/lib/canvas/view';
import { DEFAULT_THEME } from '../../../src/lib/canvas/theme';
import { emptyPaintState } from '../../../src/lib/canvas/state';
import { drawStatic, drawOverlay, type Ctx2D } from '../../../src/lib/canvas/painter';
import type { AssetStore } from '../../../src/lib/canvas/assets';
import type { TreeData } from '../../../src/lib/types';

const data = JSON.parse(readFileSync('src/generated/tree.json', 'utf8')) as TreeData;
const scene = buildScene(data);
function fakeCtx() {
  const calls: { op: string; args: unknown[]; alpha: number; dash: number[]; shadowBlur: number }[] = [];
  let dash: number[] = [];
  const ctx = new Proxy({ globalAlpha: 1, shadowBlur: 0 } as Record<string, unknown>, {
    get(t, p: string) {
      if (p in t) return t[p];
      if (p === 'setLineDash') return (d: number[]) => { dash = d; };
      if (p === 'measureText') return (s: string) => ({ width: s.length * 8 });
      return (...args: unknown[]) => { calls.push({ op: p, args, alpha: t.globalAlpha as number, dash, shadowBlur: t.shadowBlur as number }); };
    },
    // 屬性設定也記一筆（只記 textBaseline）：T5 要驗的是「有沒有自己設」，
    // 那是一次賦值、不是一次呼叫，只記呼叫的話這件事在假 ctx 上完全看不見。
    set(t, p: string, v) {
      t[p] = v;
      if (p === 'textBaseline') calls.push({ op: 'set:textBaseline', args: [v], alpha: t.globalAlpha as number, dash, shadowBlur: t.shadowBlur as number });
      return true;
    },
  }) as unknown as Ctx2D;
  return { ctx, calls };
}
// as unknown as AssetStore（不是 as never）：底下兩個測試都會 `{ ...fakeAssets, sprite: null }`，
// spread 需要一個真的物件型別，never 在型別層根本不是可展開的形狀。
const fakeAssets = { sprite: { width: 1, height: 1 } as unknown as HTMLImageElement, image: () => null, loadedHires: () => null, wantHires: () => {}, version: 0 } as unknown as AssetStore;
const view = new CanvasView(scene.viewBox); view.resize(1440, 900); view.fitTo(scene.viewBox);

describe('drawStatic', () => {
  it('每顆節點一次 drawImage、每條邊一次 stroke；沒有 sprite 時一顆都不畫', () => {
    const { ctx, calls } = fakeCtx();
    drawStatic(ctx, scene, view, DEFAULT_THEME, emptyPaintState(), fakeAssets, 1, false);
    // 樞紐圖走 assets.image(scene.center.url)（Ruling B）；fakeAssets.image 永遠回傳 null
    // （模擬「這張圖還沒載好」），所以樞紐不會多一次 drawImage——這跟真的 AssetStore 首次
    // 呼叫 image() 必回 null 的行為一致（Task 4：第一次呼叫先回 null 並開始載入）。
    expect(calls.filter(c => c.op === 'drawImage')).toHaveLength(scene.nodes.length);
    expect(calls.filter(c => c.op === 'stroke').length).toBeGreaterThanOrEqual(scene.edges.length);
    const { ctx: c2, calls: k2 } = fakeCtx();
    drawStatic(c2, scene, view, DEFAULT_THEME, emptyPaintState(), { ...fakeAssets, sprite: null } as never, 1, false);
    expect(k2.filter(c => c.op === 'drawImage')).toHaveLength(0);
  });
  it('常駐標籤只有骰子與支援：fillText 次數 = 46 ＋ 樞紐標籤 1', () => {
    const { ctx, calls } = fakeCtx();
    drawStatic(ctx, scene, view, DEFAULT_THEME, emptyPaintState(), fakeAssets, 1, false);
    const always = scene.nodes.filter(n => n.labelAlways).length;
    expect(calls.filter(c => c.op === 'fillText')).toHaveLength(always + (scene.center?.label ? 1 : 0));
  });
  it('可跳過的入邊用虛線 [9,7] 畫，其餘實線', () => {
    const { ctx, calls } = fakeCtx();
    drawStatic(ctx, scene, view, DEFAULT_THEME, emptyPaintState(), fakeAssets, 1, false);
    const dashed = calls.filter(c => c.op === 'stroke' && c.dash.length === 2);
    expect(dashed).toHaveLength(scene.edges.filter(e => e.bypassable).length);
  });
  it('有選取時，鏈外節點以 alpha .25 畫', () => {
    const { ctx, calls } = fakeCtx();
    const s = { ...emptyPaintState(), selected: '1001', chain: new Set(['1001']) };
    drawStatic(ctx, scene, view, DEFAULT_THEME, s, fakeAssets, 1, false);
    const alphas = calls.filter(c => c.op === 'drawImage').map(c => c.alpha);
    expect(alphas.filter(a => a === 0.25)).toHaveLength(scene.nodes.length - 1);
  });
  it('繪製順序：clearRect 在第一筆 stroke 之前、所有邊的 stroke 在第一筆節點 drawImage 之前、常駐標籤的 fillText 在最後一筆節點 drawImage 之後', () => {
    const { ctx, calls } = fakeCtx();
    drawStatic(ctx, scene, view, DEFAULT_THEME, emptyPaintState(), fakeAssets, 1, false);
    const firstClear = calls.findIndex(c => c.op === 'clearRect');
    const firstStroke = calls.findIndex(c => c.op === 'stroke');
    expect(firstClear).toBeGreaterThanOrEqual(0);
    expect(firstClear).toBeLessThan(firstStroke);
    let lastStroke = -1, firstDrawImage = -1, lastDrawImage = -1;
    calls.forEach((c, i) => {
      if (c.op === 'stroke') lastStroke = i;
      if (c.op === 'drawImage') { if (firstDrawImage === -1) firstDrawImage = i; lastDrawImage = i; }
    });
    // fakeAssets.image() 永遠回傳 null，樞紐圖不會 drawImage（見上一條測試的註解），
    // 所以這裡看到的每一筆 drawImage 都是節點 sprite——邊全部畫在 drawEdges()，先於節點圖那個迴圈。
    expect(lastStroke).toBeLessThan(firstDrawImage);
    // 常駐標籤（骨子／支援）在自己獨立的第二個迴圈，排在節點圖迴圈之後；樞紐標籤（若有）只用
    // fillText、沒有 strokeText，且畫在邊與節點圖之前，所以只認「節點標籤集合」的文字，
    // 排除樞紐標籤混進來誤判。
    const nodeLabelTexts = new Set(scene.nodes.filter(n => n.labelAlways).map(n => n.label));
    const firstNodeLabelFillText = calls.findIndex(c => c.op === 'fillText' && nodeLabelTexts.has(c.args[0] as string));
    expect(firstNodeLabelFillText).toBeGreaterThan(-1);
    expect(firstNodeLabelFillText).toBeGreaterThan(lastDrawImage);
  });
  it('paint-order: stroke——每一筆節點標籤的 fillText，緊接在它前面的文字呼叫是同一字串的 strokeText', () => {
    const { ctx, calls } = fakeCtx();
    drawStatic(ctx, scene, view, DEFAULT_THEME, emptyPaintState(), fakeAssets, 1, false);
    const nodeLabelTexts = new Set(scene.nodes.filter(n => n.labelAlways).map(n => n.label));
    const textCalls = calls.filter(c => c.op === 'fillText' || c.op === 'strokeText');
    const nodeFillTexts = textCalls.filter(c => c.op === 'fillText' && nodeLabelTexts.has(c.args[0] as string));
    expect(nodeFillTexts.length).toBeGreaterThan(0);
    for (const f of nodeFillTexts) {
      const i = textCalls.indexOf(f);
      expect(textCalls[i - 1]?.op).toBe('strokeText');
      expect(textCalls[i - 1]?.args[0]).toBe(f.args[0]);
    }
  });
  it('/sim 等級牌：只有 owned 且 maxLevel>1 的節點才畫牌，牌上文字是「當前/上限」', () => {
    const { ctx, calls } = fakeCtx();
    const sim = {
      owned: new Set(['1201']), available: new Set<string>(), selected: null,
      linked: new Set<string>(), active: new Set<string>(), ready: new Set<string>(),
      levels: new Map([['1201', 12]]), maxLevels: new Map([['1201', 50]]),
    };
    drawStatic(ctx, scene, view, DEFAULT_THEME, { ...emptyPaintState(), sim }, fakeAssets, 1, false);
    const ownedWithMax = [...sim.owned].filter(id => (sim.maxLevels.get(id) ?? 1) > 1).length;
    expect(calls.filter(c => c.op === 'roundRect')).toHaveLength(ownedWithMax);
    expect(calls.some(c => c.op === 'fillText' && c.args[0] === '12/50')).toBe(true);
  });
  // 等級牌是靜態層唯一一個曾經寫死 globalAlpha = 1 的東西，跟互動層那三處是同一族缺陷。
  // ⚠️ 這條是**對舊版 SVG 的回歸**，不是新增的行為：舊版 `<g class="sim-badge">` 是
  // `<g class="node">` 的子節點，`.sim-dimmed { opacity: .08 }` 掛在父層、牌子一起淡。
  // canvas 沒有父子關係，不自己乘就會變成「一個滿亮的白框牌子浮在一片暗節點裡，底下什麼都沒有」。
  it('/sim 等級牌也要吃 nodeAlpha：被搜尋淡出的 owned 節點，它的牌子跟著淡', () => {
    const { ctx, calls } = fakeCtx();
    const sim = {
      owned: new Set(['1201']), available: new Set<string>(), selected: null,
      linked: new Set<string>(), active: new Set<string>(), ready: new Set<string>(),
      levels: new Map([['1201', 12]]), maxLevels: new Map([['1201', 50]]),
    };
    const s = { ...emptyPaintState(), sim, filteredOut: new Set(['1201']) };
    drawStatic(ctx, scene, view, DEFAULT_THEME, s, fakeAssets, 1, false);
    const badge = calls.filter(c => c.op === 'roundRect');
    expect(badge).toHaveLength(1);
    expect(badge[0]!.alpha).toBe(0.08);
    const badgeText = calls.filter(c => c.op === 'fillText' && c.args[0] === '12/50');
    expect(badgeText).toHaveLength(1);
    expect(badgeText[0]!.alpha).toBe(0.08);
  });
  // ── painter 只讀不載（Task 12b，Task 12 報告 §5 ①） ────────────────────────
  // `drawNodeImage()` 舊版寫的是 `assets.hires(n.icon)`，而 `hires()` 是「沒載過就開始載」的
  // 懶載入口——畫一幀＝對場景裡**每一顆**節點各要一張 2× WebP。`updateLod()` 那段「只預載
  // `visibleWorldRect()` 裡看得到的那幾十顆」因此完全被架空（Pixel 7 首屏實測 240 張／779.5KB，
  // SVG 版只有 68 張／<500KB）。修法是把「查已載好的」跟「要求載入」分成兩個方法：painter 只
  // 呼叫前者（畫一幀不該有副作用），要求載入只由 controller 的 updateLod() 依視錐發動。
  it('只讀已載好的高解析圖，不觸發載入：useHires 為 true 時走 loadedHires()，不碰 hires()／wantHires()', () => {
    const { ctx } = fakeCtx();
    const n = { loadedHires: 0, hires: 0, wantHires: 0 };
    const spyAssets = {
      ...(fakeAssets as unknown as object),
      loadedHires: () => { n.loadedHires++; return null; },
      hires: () => { n.hires++; return null; },
      wantHires: () => { n.wantHires++; },
    } as unknown as AssetStore;
    drawStatic(ctx, scene, view, DEFAULT_THEME, emptyPaintState(), spyAssets, 1, true);
    expect(n.hires, 'painter 不該碰懶載入口（那會把整棵樹 240 張 2× WebP 一次要下來）').toBe(0);
    expect(n.wantHires, '要求載入是 controller 的事（updateLod 依視錐挑）').toBe(0);
    expect(n.loadedHires).toBe(scene.nodes.length);
  });
  it('drawOverlay 的光暈同樣只讀不載', () => {
    const { ctx } = fakeCtx();
    const n = { loadedHires: 0, hires: 0 };
    const spyAssets = {
      ...(fakeAssets as unknown as object),
      loadedHires: () => { n.loadedHires++; return null; },
      hires: () => { n.hires++; return null; },
    } as unknown as AssetStore;
    drawOverlay(ctx, scene, view, DEFAULT_THEME, { ...emptyPaintState(), chain: new Set(['1201']) }, spyAssets, 1, true);
    expect(n.hires).toBe(0);
    expect(n.loadedHires).toBe(1);
  });
  it('Ruling H：陰影不吃 transform，shadows 開啟時節點的 shadowBlur 要乘上 dpr*view.pxPerUnit', () => {
    const { ctx, calls } = fakeCtx();
    const dpr = 2;
    drawStatic(ctx, scene, view, DEFAULT_THEME, { ...emptyPaintState(), shadows: true }, fakeAssets, dpr, false);
    const expected = 1.5 * dpr * view.pxPerUnit;
    const drawImageCalls = calls.filter(c => c.op === 'drawImage');
    expect(drawImageCalls.length).toBeGreaterThan(0);
    for (const c of drawImageCalls) expect(c.shadowBlur).toBeCloseTo(expected, 6);
  });
});
describe('drawOverlay', () => {
  it('沒選取沒 hover 沒 focus 時什麼都不畫（只 clearRect）', () => {
    const { ctx, calls } = fakeCtx();
    drawOverlay(ctx, scene, view, DEFAULT_THEME, emptyPaintState(), fakeAssets, 1, false);
    expect(calls.filter(c => c.op !== 'clearRect' && c.op !== 'setTransform' && c.op !== 'save' && c.op !== 'restore')).toHaveLength(0);
  });
  // ── 互動層要尊重篩選淡出 ──────────────────────────────────────────────────
  // 互動層是**疊在靜態層上面**的第二張 canvas，同一顆節點會被畫兩次。靜態層已經照
  // nodeAlpha() 把被篩掉／被搜尋淡出的節點畫成 0.08／0.1 了，互動層若用 globalAlpha = 1
  // 把它重畫一次，那顆節點在畫面上就是**滿亮**的——淡出等於沒發生。
  // /sim 的實際症狀（Task 11 review 抓到）：搜尋「火」之後，所有「可取得」與「已選取」的
  // 節點照樣亮著，只有鎖住的那些變暗，搜尋看起來只做了一半。
  it('/sim：被搜尋淡出的 available 節點，金光重畫要吃 nodeAlpha（.08），不是一律 1', () => {
    const { ctx, calls } = fakeCtx();
    const sim = {
      owned: new Set<string>(), available: new Set(['1201']), selected: null,
      linked: new Set<string>(), active: new Set<string>(), ready: new Set<string>(),
      levels: new Map<string, number>(), maxLevels: new Map<string, number>(),
    };
    const s = { ...emptyPaintState(), sim, filteredOut: new Set(['1201']) };
    drawOverlay(ctx, scene, view, DEFAULT_THEME, s, fakeAssets, 1, false);
    const glow = calls.filter(c => c.op === 'drawImage');
    expect(glow).toHaveLength(1);
    expect(glow[0]!.alpha).toBe(0.08);
  });
  it('/sim：被搜尋淡出的 selected 節點也一樣（state.ts 把 filteredOut 排在 selected 之前）', () => {
    const { ctx, calls } = fakeCtx();
    const sim = {
      owned: new Set(['1201']), available: new Set<string>(), selected: '1201',
      linked: new Set<string>(), active: new Set<string>(), ready: new Set<string>(),
      levels: new Map<string, number>(), maxLevels: new Map<string, number>(),
    };
    const s = { ...emptyPaintState(), sim, filteredOut: new Set(['1201']) };
    drawOverlay(ctx, scene, view, DEFAULT_THEME, s, fakeAssets, 1, false);
    const glow = calls.filter(c => c.op === 'drawImage');
    expect(glow).toHaveLength(1);
    expect(glow[0]!.alpha).toBe(0.08);
  });
  it('/tree：被篩掉的節點 hover 出來的標籤與焦點框也要跟著淡（.1）', () => {
    const { ctx, calls } = fakeCtx();
    const s = { ...emptyPaintState(), hover: '1201', focus: '1201', filteredOut: new Set(['1201']) };
    drawOverlay(ctx, scene, view, DEFAULT_THEME, s, fakeAssets, 1, false);
    const text = calls.filter(c => c.op === 'fillText' || c.op === 'strokeText');
    expect(text.length).toBeGreaterThan(0);
    for (const c of text) expect(c.alpha).toBe(0.1);
    // 焦點框（菱形）的那一筆 stroke
    const ring = calls.filter(c => c.op === 'stroke');
    expect(ring).toHaveLength(1);
    expect(ring[0]!.alpha).toBe(0.1);
  });
  it('/tree：前置鏈蓋過篩選淡出——鏈上的節點即使被篩掉，金光與標籤仍是滿亮的', () => {
    const { ctx, calls } = fakeCtx();
    // nodeAlpha() 的優先序：chain 先於 filteredOut（canvas.css 舊版 `.filtered-out.in-chain`）。
    // 這一條是上面三條的反例守門員：修法若寫成「只要在 filteredOut 就淡」而不是「照 nodeAlpha」，
    // 前置鏈高亮會在有篩選時整條消失，而那是 /tree 詳情卡片唯一的視覺回饋。
    const s = { ...emptyPaintState(), chain: new Set(['1201']), filteredOut: new Set(['1201']) };
    drawOverlay(ctx, scene, view, DEFAULT_THEME, s, fakeAssets, 1, false);
    const glow = calls.filter(c => c.op === 'drawImage');
    expect(glow).toHaveLength(1);
    expect(glow[0]!.alpha).toBe(1);
  });
  it('focus 在符文上：畫它的標籤與焦點框（菱形＝1 個 moveTo＋3 個 lineTo＋1 個 closePath）', () => {
    const { ctx, calls } = fakeCtx();
    drawOverlay(ctx, scene, view, DEFAULT_THEME, { ...emptyPaintState(), focus: '1201' }, fakeAssets, 1, false);
    expect(calls.filter(c => c.op === 'fillText')).toHaveLength(1);
    // '1201' 是 rune，shape === 'diamond'：focusRingPath 畫 moveTo(頂)→lineTo(右/下/左)→closePath，
    // 這個狀態下（沒有 chain／sim glow）畫布上唯一用得到這三個 op 的地方就是這個焦點框，數字要精確。
    expect(calls.filter(c => c.op === 'moveTo')).toHaveLength(1);
    expect(calls.filter(c => c.op === 'lineTo')).toHaveLength(3);
    expect(calls.filter(c => c.op === 'closePath')).toHaveLength(1);
  });
});

// ── T5（2026-09-06 最終審查）：文字繪製一律自己宣告基線 ─────────────────────────
// `drawLabel()` 就在同一支裡把 textBaseline 設成 'alphabetic'，而樞紐標籤與 /sim 等級牌
// 舊版一個字都沒設——它們只是剛好「前面沒有人改過」才對。canvas 的 textBaseline 是
// context 狀態，離屏位圖那張 ctx 是共用的，任何人在前面插一行就會讓這兩處默默移位，
// 而移位的畫面只有四張桌機快照擋得住（等級牌只出現在 /sim，那頁一張快照都沒有）。
describe('文字基線是明寫的，不是繼承來的', () => {
  const simState = () => ({
    ...emptyPaintState(),
    sim: {
      owned: new Set(['1001']), available: new Set<string>(), selected: null,
      linked: new Set<string>(), active: new Set<string>(), ready: new Set<string>(),
      levels: new Map([['1001', 3]]), maxLevels: new Map([['1001', 50]]),
    },
  });
  it('樞紐標籤在畫之前自己設過 textBaseline', () => {
    const { ctx, calls } = fakeCtx();
    drawStatic(ctx, scene, view, DEFAULT_THEME, simState(), fakeAssets, 1, false);
    // 樞紐標籤是 drawStatic 的第一筆 fillText（樞紐那段畫在最前面）。
    const first = calls.findIndex(c => c.op === 'fillText');
    expect(first).toBeGreaterThan(0);
    const before = calls.slice(0, first).filter(c => c.op === 'set:textBaseline');
    expect(before.length).toBeGreaterThan(0);
    expect(before.at(-1)!.args[0]).toBe('alphabetic');
  });
  it('/sim 等級牌在寫字之前自己設過 textBaseline', () => {
    const { ctx, calls } = fakeCtx();
    drawStatic(ctx, scene, view, DEFAULT_THEME, simState(), fakeAssets, 1, false);
    // 等級牌是 drawStatic 最後一段，牌面的 roundRect 之後才寫字。
    const after = calls.slice(calls.map(c => c.op).lastIndexOf('roundRect'));
    const baseline = after.findIndex(c => c.op === 'set:textBaseline');
    const text = after.findIndex(c => c.op === 'fillText');
    expect(baseline).toBeGreaterThanOrEqual(0);
    expect(baseline).toBeLessThan(text);
    expect(after[baseline]!.args[0]).toBe('alphabetic');
  });
});
