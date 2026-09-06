// painter 是唯一碰 Canvas 2D 的檔——所有讀 ctx.xxx 屬性、呼叫 drawImage／fillText 等畫布 API
// 的程式碼都集中在這裡；別的模組（scene／state／view／assets）只算資料，不碰 Canvas 2D。
//
// 分兩層畫：drawStatic 畫「這一幀多半不變」的東西（樞紐、邊、節點圖、常駐標籤、/sim 等級牌），
// drawOverlay 畫「跟游標／鍵盤焦點有關、每次互動都可能變」的東西（鏈上光暈、hover/focus 標籤、
// 焦點框）——呼叫端可以把靜態層畫在離屏 canvas 上快取，互動層才每一幀重畫。
//
// 座標系：世界座標（world unit）＝ scene 裡的 x/y/w/h 那個單位。畫之前用
// ctx.setTransform(dpr*k, 0, 0, dpr*k, dpr*tx, dpr*ty) 把 device px 換成 world 單位，之後
// 全部用 world 單位下座標——**線寬與字級刻意不除回 k**：這是延續 SVG 版 `<text>`／
// `stroke-width` 沒有 vector-effect 時「跟著 viewport 縮放」的行為（2026-09-06 controller 裁
// 決 Ruling C），不是疏漏。
//
// ⚠️ Ruling H（2026-09-06 code review）：`shadowBlur`／`shadowOffset*` 是唯二**不吃**
// `ctx.setTransform` 的繪圖屬性（Canvas 規範定義成用「目前變換之前」的裝置像素算），所以
// `begin()` 把 `dpr*k` 算出來回傳，陰影／光暈半徑要自己乘上去才會跟著縮放與 dpr 走——
// 不乘的話 dpr 2 的手機光暈只有 SVG 版一半、畫布放大 3 倍光暈也不會變大。
import type { Scene, SceneNode } from './scene.js';
import type { ViewGeometry } from './view.js';
import type { Theme } from './theme.js';
import type { AssetStore } from './assets.js';
import { centerAlpha, edgeAlpha, edgeColor, labelVisible, nodeAlpha, type PaintState } from './state.js';

export interface Ctx2D extends Pick<CanvasRenderingContext2D,
  'save' | 'restore' | 'setTransform' | 'clearRect' | 'beginPath' | 'moveTo' | 'lineTo' | 'arc' | 'closePath' | 'rect'
  | 'stroke' | 'fill' | 'drawImage' | 'fillText' | 'strokeText' | 'setLineDash' | 'measureText'> {
  globalAlpha: number; lineWidth: number; strokeStyle: string | CanvasGradient | CanvasPattern; fillStyle: string | CanvasGradient | CanvasPattern;
  font: string; textAlign: CanvasTextAlign; textBaseline: CanvasTextBaseline; lineCap: CanvasLineCap; lineJoin: CanvasLineJoin;
  shadowBlur: number; shadowColor: string; shadowOffsetY: number;
  // 目標瀏覽器都支援，但 lib.dom.d.ts 的簽名跟這裡用到的 radii 形狀（單一數字）對不齊時容易
  // 讓 Pick 出來的型別跟呼叫端打架，所以自己宣告一份最小需要的簽名。
  roundRect(x: number, y: number, w: number, h: number, r: number): void;
}
const EDGE_W = 3.2, CHAIN_EDGE_W = 3, BADGE_W = 32, BADGE_H = 16;
/**
 * 標籤基線相對節點下緣的位移（world 單位）。**匯出是因為它有第二個消費者**：
 * `tools/build-preview-svg.ts` 的 `labelY()` 要把標籤畫在預覽 SVG 上的同一個位置，
 * 而 `render.ts` 被刪掉之後，那兩份 `15` 失去了唯一的共同祖先。
 * `tests/tools/build-preview-svg.test.ts` import 這個常數來組期望值，兩邊一漂就紅
 * （2026-09-06 最終審查 m8）。
 */
export const LABEL_DY = 15;

// 回傳 dpr*k：座標變換本身用不到這個值（setTransform 已經吃了 dpr*k），但陰影／光暈
// 半徑（Ruling H）要拿它換算，所以在這裡算一次共用，呼叫端不必自己重算 view.pxPerUnit。
function begin(ctx: Ctx2D, view: ViewGeometry, dpr: number): number {
  const k = view.pxPerUnit; const [tx, ty] = view.worldToScreen(0, 0);
  ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * tx, dpr * ty);
  return dpr * k;
}
// Ruling A：視圖的幾何面（ViewGeometry）已有 cssSize，直接用容器的 CSS px 尺寸清整塊畫布，
// 不必像 brief 草稿那樣拿 visibleWorldRect 反推——那條路徑在還沒 setTransform 前算 world 矩形
// 沒有意義，且 base 為 0（容器尚未 resize）時會除以 0。
function clear(ctx: Ctx2D, view: ViewGeometry, dpr: number): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const [w, h] = view.cssSize;
  ctx.clearRect(0, 0, w * dpr, h * dpr);
}
function drawNodeImage(ctx: Ctx2D, n: SceneNode, assets: AssetStore, useHires: boolean): void {
  // 只問「載好了嗎」，不要求載入（AssetStore.loadedHires 的說明）：畫一幀對每一顆節點各要一張
  // 2× 圖等於整棵樹一次抓完，視錐預載就沒有意義了。沒載好就用 sprite，之後圖到了 version 一變，
  // 靜態層的快取失效、這裡自然換成高解析那張。
  const hi = useHires ? assets.loadedHires(n.icon) : null;
  if (hi) { ctx.drawImage(hi, n.x - n.w / 2, n.y - n.h / 2, n.w, n.h); return; }
  const sp = assets.sprite; if (!sp || !n.cell) return;
  const [sx, sy, sw, sh] = n.cell;
  ctx.drawImage(sp, sx, sy, sw, sh, n.x - n.w / 2, n.y - n.h / 2, n.w, n.h);
}
function drawLabel(ctx: Ctx2D, n: SceneNode, theme: Theme): void {
  ctx.font = `700 ${theme.labelPx}px ${theme.font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = theme.bg; ctx.fillStyle = theme.fg;
  const y = n.y + n.h / 2 + LABEL_DY;
  ctx.strokeText(n.label, n.x, y); ctx.fillText(n.label, n.x, y); // paint-order: stroke
}
function drawEdges(ctx: Ctx2D, scene: Scene, theme: Theme, state: PaintState): void {
  ctx.lineCap = 'round';
  for (const pass of [false, true]) { // 實線一批、虛線一批，少切 lineDash
    ctx.setLineDash(pass ? [9, 7] : []);
    for (const e of scene.edges) {
      if (e.bypassable !== pass) continue;
      const gold = edgeColor(state, e) === 'gold';
      ctx.globalAlpha = edgeAlpha(state, e); ctx.strokeStyle = gold ? theme.gold : theme.edge; ctx.lineWidth = gold ? CHAIN_EDGE_W : EDGE_W;
      ctx.beginPath(); ctx.moveTo(e.x1, e.y1); ctx.lineTo(e.x2, e.y2); ctx.stroke();
    }
  }
  ctx.setLineDash([]); ctx.globalAlpha = 1;
}

export function drawStatic(ctx: Ctx2D, scene: Scene, view: ViewGeometry, theme: Theme, state: PaintState, assets: AssetStore, dpr: number, useHires: boolean): void {
  ctx.save(); clear(ctx, view, dpr); const dk = begin(ctx, view, dpr);
  if (scene.center) {
    const c = scene.center;
    ctx.strokeStyle = theme.edge; ctx.lineWidth = EDGE_W; ctx.lineCap = 'round';
    ctx.globalAlpha = centerAlpha(state, state.filteredOut.size === 0) * 0.96;
    for (const [x, y] of c.links) { ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(x, y); ctx.stroke(); }
    ctx.globalAlpha = centerAlpha(state, state.filteredOut.size === 0);
    // Ruling B：AssetStore 沒有 hires('../tree-center') 這種相對路徑用法，樞紐圖走通用的
    // image(url) 快取，url 就是 scene.center.url（tree.json 產物給的 /assets/tree-center.webp）。
    const img = assets.image(c.url);
    if (img) ctx.drawImage(img, c.x - c.w / 2, c.y - c.h / 2, c.w, c.h);
    // textBaseline 明寫（T5）：`drawLabel()` 也設 'alphabetic'，但那是在這行之後才跑的，
    // 這裡靠的是「前面沒有人改過 ctx 的預設值」——離屏位圖那張 ctx 是共用且長命的，
    // 任何人在前面插一行就會讓樞紐標籤默默移位。
    if (c.label) { ctx.font = `700 ${theme.labelPx}px ${theme.font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = theme.fg; ctx.fillText(c.label, c.x, c.y + c.labelDy); }
    ctx.globalAlpha = 1;
  }
  drawEdges(ctx, scene, theme, state);
  for (const n of scene.nodes) {
    ctx.globalAlpha = nodeAlpha(state, n.id);
    // Ruling H：陰影不吃 transform，1.5／1 這兩個 world 單位常數要自己乘 dk 換算成裝置像素。
    if (state.shadows) { ctx.shadowBlur = 1.5 * dk; ctx.shadowOffsetY = 1 * dk; ctx.shadowColor = theme.shadow; }
    drawNodeImage(ctx, n, assets, useHires);
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  }
  for (const n of scene.nodes) if (n.labelAlways) { ctx.globalAlpha = nodeAlpha(state, n.id); drawLabel(ctx, n, theme); }
  if (state.sim) {
    for (const n of scene.nodes) {
      const max = state.sim.maxLevels.get(n.id) ?? 1;
      if (!state.sim.owned.has(n.id) || max <= 1) continue;
      // ⚠️ 牌子也要吃 nodeAlpha，不能寫死 1。舊版 `<g class="sim-badge">` 是 `<g class="node">`
      // 的子節點，`.sim-dimmed { opacity: .08 }` 掛在父層、牌子自然跟著淡；canvas 沒有父子
      // 關係，不自己乘就會在搜尋時留下一個滿亮的白框牌子浮在暗節點上、底下什麼都沒有。
      ctx.globalAlpha = nodeAlpha(state, n.id); const y = n.y + n.h / 2 - 2;
      ctx.fillStyle = theme.surface1; ctx.strokeStyle = theme.borderStrong; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(n.x - BADGE_W / 2, y, BADGE_W, BADGE_H, 3); ctx.fill(); ctx.stroke();
      // 同上（T5）：牌面的數字也自己宣告基線，不吃「剛好前面那支設過」的便車。
      ctx.font = `${theme.labelPx}px ${theme.fontNum}`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = theme.fg;
      ctx.fillText(`${state.sim.levels.get(n.id) ?? 1}/${max}`, n.x, y + 12);
    }
  }
  ctx.globalAlpha = 1; ctx.restore();
}

/** 焦點框路徑，依節點形狀走：矩形（圓角 8）／菱形／圓／六邊形。inset 是外擴的 world 單位。 */
export function focusRingPath(ctx: Ctx2D, n: SceneNode, inset: number): void {
  const w = n.w + inset * 2, h = n.h + inset * 2, x = n.x - w / 2, y = n.y - h / 2;
  ctx.beginPath();
  if (n.shape === 'circle') {
    ctx.arc(n.x, n.y, w / 2, 0, Math.PI * 2);
  } else if (n.shape === 'diamond') {
    ctx.moveTo(n.x, y); ctx.lineTo(x + w, n.y); ctx.lineTo(n.x, y + h); ctx.lineTo(x, n.y); ctx.closePath();
  } else if (n.shape === 'hex') {
    ctx.moveTo(n.x, y); ctx.lineTo(x + w, y + h / 4); ctx.lineTo(x + w, y + (3 * h) / 4);
    ctx.lineTo(n.x, y + h); ctx.lineTo(x, y + (3 * h) / 4); ctx.lineTo(x, y + h / 4); ctx.closePath();
  } else {
    ctx.roundRect(x, y, w, h, 8);
  }
}

export function drawOverlay(ctx: Ctx2D, scene: Scene, view: ViewGeometry, theme: Theme, state: PaintState, assets: AssetStore, dpr: number, useHires: boolean): void {
  ctx.save(); clear(ctx, view, dpr); const dk = begin(ctx, view, dpr);
  // ⚠️ 互動層畫的每一樣東西都要用 `nodeAlpha(state, id)`，**不能寫死 1**。
  //
  // 互動層是疊在靜態層上面的第二張 canvas，這裡畫的節點在靜態層已經畫過一次了。靜態層照
  // nodeAlpha() 把被篩掉（/tree 的 .1）或被搜尋淡出（/sim 的 .08）的節點畫暗，互動層若用
  // globalAlpha = 1 把同一顆重畫上去，畫面上看到的就是**滿亮**的那一張——淡出等於沒發生。
  // 2026-09-06 Task 11 review 實測：/sim 搜尋「火」之後，所有「可取得」與「已選取」的節點
  // 照樣亮著，只有鎖住的那些變暗，搜尋看起來只做了一半。
  //
  // 用 nodeAlpha() 而不是「在 filteredOut 裡就淡」：state.ts 的優先序要原封不動沿用，
  // 其中「前置鏈蓋過篩選淡出」（舊 `.filtered-out.in-chain`）正是 /tree 詳情卡片唯一的
  // 視覺回饋，寫死成後者會讓有篩選時整條前置鏈消失。
  //
  // Ruling H：跟 drawStatic 的節點陰影一樣，glow 半徑（world 單位常數 5／6）要乘 dk 才會
  // 跟著縮放與 dpr 走——shadowBlur 不吃 transform。
  const glow = (id: string, color: string, blur: number) => {
    const n = scene.byId.get(id); if (!n) return;
    ctx.globalAlpha = nodeAlpha(state, id); ctx.shadowColor = color; ctx.shadowBlur = blur * dk;
    drawNodeImage(ctx, n, assets, useHires); ctx.shadowBlur = 0;
  };
  if (state.sim) {
    for (const id of state.sim.available) glow(id, theme.gold, 5);
    if (state.sim.selected) glow(state.sim.selected, theme.fg, 6);
  } else {
    for (const id of state.chain) glow(id, theme.gold, 6);
  }
  // hover／focus 叫出來的標籤：被篩掉的節點連標籤都要跟著淡，否則滑過一顆看不見的節點會
  // 冒出一個滿亮的名字，那是畫面上唯一提示「這裡其實有東西」的東西，跟淡出的用意相反。
  for (const n of scene.nodes) if (!n.labelAlways && labelVisible(state, n)) { ctx.globalAlpha = nodeAlpha(state, n.id); drawLabel(ctx, n, theme); }
  if (state.focus) {
    const n = scene.byId.get(state.focus);
    if (n) {
      ctx.globalAlpha = nodeAlpha(state, n.id); ctx.strokeStyle = theme.gold; ctx.lineWidth = 2; ctx.setLineDash([]);
      focusRingPath(ctx, n, 2); ctx.stroke();
    }
  }
  ctx.restore();
}
