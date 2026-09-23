// `/sim` 匯出圖片：精簡版（已取得節點的圖示牆）與完整版（整棵骰子樹）。
//
// 版面與「要畫什麼」全部在 src/lib/sim-image.ts（純函式、有測試）；這裡只負責把它畫出來。
// 完整版直接呼叫畫面同一支 `drawStatic()`，精簡版的單顆圖示走 `drawNodeImage()`——
// 圖示長相只有 painter 一份實作。
import { AssetStore } from '../lib/canvas/assets.js';
import { drawNodeImage, drawStatic } from '../lib/canvas/painter.js';
import type { Scene } from '../lib/canvas/scene.js';
import type { SimPaint } from '../lib/canvas/state.js';
import { readTheme, type Theme } from '../lib/canvas/theme.js';
import {
  COMPACT, FULL, IMAGE_TITLE, compactLayout, exportPaintState, fitText, fixedView, fullImageSize,
  type CompactSection,
} from '../lib/sim-image.js';

/** 跟 `mountCanvasTree()` 的預設 `hiresBase` 同一個路徑。 */
const HIRES_BASE = '/assets/icons';
const LOAD_TIMEOUT_MS = 15_000;

/**
 * 另開一個 AssetStore 把要用的圖全部要下來並等到結束。畫面那個只預載視錐內的，
 * 匯出只畫一次，沒等到的圖會永遠缺在 PNG 上。
 * sprite 沒到＝一張圖示都畫不出來 → 丟例外；個別 2× 圖失敗 → drawNodeImage 自己退回 sprite。
 */
async function loadAssets(scene: Scene, icons: Iterable<string>): Promise<AssetStore> {
  const assets = new AssetStore(scene.sprite.url, HIRES_BASE, () => {});
  assets.wantHires(icons);
  if (scene.center) assets.image(scene.center.url);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('圖示載入逾時')), LOAD_TIMEOUT_MS);
  });
  try {
    await Promise.race([assets.settled(), timeout]);
  } finally {
    clearTimeout(timer);
  }
  if (!assets.sprite) throw new Error('sprite 載入失敗');
  // 字型沒到的話 fillText 會用備援字型，而且不會重畫。
  await document.fonts.ready;
  return assets;
}

function newCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d 不可用');
  return [canvas, ctx];
}

/** 兩版共用的標題列；k 是整體放大倍率（精簡 1、完整 FULL.scale）。 */
function drawHeader(ctx: CanvasRenderingContext2D, theme: Theme, width: number, k: number, totalLine: string): void {
  const x = COMPACT.pad * k;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = theme.gold;
  ctx.font = `700 ${36 * k}px ${theme.font}`;
  ctx.fillText(IMAGE_TITLE, x, 64 * k);
  ctx.fillStyle = theme.fg;
  ctx.font = `500 ${26 * k}px ${theme.fontNum}`;
  ctx.fillText(fitText(totalLine, width - x * 2, s => ctx.measureText(s).width), x, 112 * k);
}

export async function renderCompactImage(scene: Scene, sections: CompactSection[], totalLine: string): Promise<HTMLCanvasElement> {
  const layout = compactLayout(sections);
  const icons = sections.flatMap(s => s.entries.map(e => scene.byId.get(e.id)?.icon))
    .filter((x): x is string => typeof x === 'string');
  const assets = await loadAssets(scene, icons);
  const theme = readTheme(document.documentElement);
  const [canvas, ctx] = newCanvas(COMPACT.width, layout.height);
  const { pad, headerH, cellPad, radius, icon } = COMPACT;

  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawHeader(ctx, theme, COMPACT.width, 1, totalLine);

  if (layout.sections.length === 0) {
    ctx.fillStyle = theme.fg;
    ctx.font = `500 22px ${theme.font}`;
    ctx.fillText('尚未取得任何節點', pad, headerH + 44);
  }
  for (const s of layout.sections) {
    ctx.fillStyle = theme.gold;
    ctx.font = `700 26px ${theme.font}`;
    ctx.textAlign = 'left';
    ctx.fillText(s.title, pad, s.y + 36);
    for (const c of s.cells) {
      ctx.fillStyle = theme.surface1;
      ctx.beginPath();
      ctx.roundRect(c.x, c.y, c.w, c.h, radius);
      ctx.fill();
      const n = scene.byId.get(c.entry.id);
      if (n) {
        // 等比縮進 icon×icon 的方框（節點圖不是正方形：骰子 50×53、支援 51×47）。
        const r = icon / Math.max(n.w, n.h);
        drawNodeImage(ctx, { ...n, x: c.x + cellPad + icon / 2, y: c.y + c.h / 2, w: n.w * r, h: n.h * r }, assets, true);
      }
      const tx = c.x + cellPad + icon + cellPad;
      const maxW = c.x + c.w - cellPad - tx;
      ctx.fillStyle = theme.fg;
      ctx.font = `700 ${COMPACT.namePx}px ${theme.font}`;
      ctx.fillText(fitText(c.entry.name, maxW, t => ctx.measureText(t).width), tx, c.entry.level ? c.y + 42 : c.y + c.h / 2 + 8);
      if (c.entry.level) {
        ctx.fillStyle = theme.gold;
        ctx.font = `500 20px ${theme.fontNum}`;
        ctx.fillText(c.entry.level, tx, c.y + 72);
      }
    }
  }
  return canvas;
}

export async function renderFullImage(scene: Scene, sim: SimPaint, totalLine: string): Promise<HTMLCanvasElement> {
  const assets = await loadAssets(scene, scene.nodes.map(n => n.icon));
  const theme = readTheme(document.documentElement);
  const k = FULL.scale;
  const [w, h] = fullImageSize(scene.viewBox);
  const [canvas, ctx] = newCanvas(w, h);
  const view = fixedView(scene.viewBox, k, FULL.headerH * k, [w, h]);
  // drawStatic 會先 clear 整張（cssSize＝整張圖），所以底色用 destination-over 墊在後面、
  // 標題列最後才畫。dpr 傳 1：k 已經是最終的 px/unit。
  drawStatic(ctx, scene, view, theme, exportPaintState(sim), assets, 1, true);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
  drawHeader(ctx, theme, w, k, totalLine);
  return canvas;
}
