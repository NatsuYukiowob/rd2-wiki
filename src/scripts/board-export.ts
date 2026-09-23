// 把骰盤狀態畫成一張固定尺寸的 PNG。
//
// 為什麼不共用畫面上那份 DOM 渲染：畫面是響應式的（格子尺寸跟著視窗走），分享圖必須是
// 固定尺寸才在別人的裝置上長得一樣。兩份渲染各自很短，共用反而要引進一層抽象去吸收
// 「有沒有視窗」的差別。
import { CELLS, COLS, DECK_SIZE, badgeText, emptyBoard, emptyDeck, type Board, type Deck } from '../lib/board.js';
import {
  badgeRect, cellRect, deckLabelBaseline, deckRect, iconRect, imageSize,
  type BoardSide, type Rect,
} from '../lib/board-image.js';

export interface ExportInput {
  board: Board;
  deck: Deck;
  meta: Map<string, { name: string; icon: string }>;
  /** 「隱藏星數」開著時：分享圖的骰盤格也不畫骰面點數（Yuki 2026-08-22 拍板——使用者按了
   *  隱藏就是不想看到那些數字，分享出去自然也不該有）。**只影響骰盤格**，不影響組合列：
   *  組合列的數字是「這一槽的等級」控制項本身，不是「星數」這個可切換的顯示項，
   *  跟 #board-grid 的 .cell-pips 不是同一件事。 */
  hidePips?: boolean;
  /**
   * 合作模式：畫布變高，隊友的骰盤與隊伍列畫在自己這一盤的上面。
   *
   * 跟 `partner` 分成兩個欄位而不是「有 partner 就是合作」：模式是使用者按出來的狀態，
   * 內容是不是空的則跟它無關——隊友盤一顆都還沒擺時仍然要畫出那一盤的空格子，
   * 不然切到合作模式產出的圖會跟對戰模式一模一樣。
   */
  coop?: boolean;
  /**
   * 隊友那一盤的內容。
   *
   * ⚠️ **刻意不帶自己的 `meta`**：全頁只有一個挑選網格，`board.ts` 讀它組出來的那一份
   * 對照表同時給兩盤用（見 `SideOptions.diceMeta`）。在這裡複製第二份只會多一個
   * 「兩份指向不同圖」的漂移機會，而它們在任何情況下都不可能不一樣。
   */
  partner?: { board: Board; deck: Deck };
}

/**
 * 顏色一律從 CSS 讀，**不要在這裡抄第二份寫死值**。
 *
 * CLAUDE.md 明訂「動畫長度一律從 CSS 讀，JS 不寫第二份」，理由對顏色完全相同：註解寫
 * 「改一邊要改兩邊」正是那條規則要禁止的東西。repo 已經有兩份現成寫法可抄——
 * `src/scripts/tree-canvas.ts` 的 `cssMs()` 與 `tests/e2e/probe.ts` 的 `resolveColor()`。
 *
 * fallback 存在是因為 `getComputedStyle` 在沒有版面的環境（單元測試的 linkedom）拿不到值；
 * 那條路本來就不會產圖。
 */
function cssVar(name: string, fallback: string): string {
  if (typeof getComputedStyle !== 'function' || typeof document === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function palette() {
  return {
    bg: cssVar('--bg', '#17161a'),
    surface: cssVar('--surface-1', '#28213f'),
    chip: cssVar('--surface-2', '#342b52'),
    borderStrong: cssVar('--border-strong', '#5d5090'),
    border: cssVar('--border', '#463b6e'),
    fg: cssVar('--fg', '#f5f1ff'),
    muted: cssVar('--muted', '#b0a8c8'),
    gold: cssVar('--gold', '#ffd66f'),
  };
}

/** ⚠️ 跟 --font 同一組。canvas 的 font 屬性吃的是 CSS font shorthand，不吃 var()。 */
const FONT_STACK = "'Noto Sans TC', 'Microsoft JhengHei', sans-serif";

function roundRect(ctx: CanvasRenderingContext2D, r: Rect, radius: number): void {
  ctx.beginPath();
  // ⚠️ ctx.roundRect 是 Safari 16.4（2023-03）才有的。比它舊的 iOS 進到這裡會丟
  // TypeError，而分享圖正是這一頁唯一的產出——整張圖產不出來只為了圓角，不划算。
  if (typeof ctx.roundRect === 'function') ctx.roundRect(r.x, r.y, r.w, r.h, radius);
  else ctx.rect(r.x, r.y, r.w, r.h);
}

const imageCache = new Map<string, HTMLImageElement>();

async function loadIcon(src: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(src);
  if (cached) return cached;
  const img = new Image();
  img.src = src;
  // decode() 而不是 onload：decode 完成才保證 drawImage 畫得出東西。
  // 圖示與頁面同源，所以 canvas 不會被 taint，toBlob() 可用。
  await img.decode();
  imageCache.set(src, img);
  return img;
}

export async function renderShareImage(input: ExportInput): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  const coop = input.coop === true;
  const { w: imageW, h: imageH } = imageSize(coop);
  canvas.width = imageW;
  canvas.height = imageH;
  const ctx = canvas.getContext('2d')!;
  const COLORS = palette();

  /**
   * 要畫的盤，由上而下。合作模式多一盤隊友的——隊伍列貼在自己那一盤的外側，
   * 就是畫面上的順序（`applyCoopLayout()`），也是遊戲裡兩人對坐的樣子。
   */
  const partner = input.partner ?? { board: emptyBoard(), deck: emptyDeck() };
  const sides: { side: BoardSide; board: Board; deck: Deck; deckLabel: string }[] = coop
    ? [
      { side: 'partner', board: partner.board, deck: partner.deck, deckLabel: '隊友的隊伍' },
      { side: 'me', board: input.board, deck: input.deck, deckLabel: '我的隊伍' },
    ]
    : [{ side: 'me', board: input.board, deck: input.deck, deckLabel: '我的隊伍' }];

  // ⚠️ 等字型載完再畫，否則中文會退回系統預設字面，跟站上看到的不一樣。
  await document.fonts.ready;

  // 先把所有要用到的圖示載完，之後的繪製就全是同步的，順序才控制得住。
  const needed = new Set<string>();
  for (const p of sides.flatMap(s => [...s.board, ...s.deck])) {
    if (p) {
      const icon = input.meta.get(p.diceId)?.icon;
      if (icon) needed.add(icon);
    }
  }
  const icons = new Map<string, HTMLImageElement>();
  await Promise.all([...needed].map(async src => {
    try {
      icons.set(src, await loadIcon(src));
    } catch {
      // 單張圖示載不到就讓那一格只剩底色與點數，不要讓整張圖產不出來。
    }
  }));

  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, imageW, imageH);

  ctx.fillStyle = COLORS.fg;
  ctx.font = `600 40px ${FONT_STACK}`;
  ctx.textBaseline = 'middle';
  ctx.fillText(coop ? '我們的骰盤' : '我的骰盤', 48, 52);

  ctx.fillStyle = COLORS.muted;
  ctx.font = `24px ${FONT_STACK}`;
  ctx.textAlign = 'right';
  ctx.fillText('rd2wiki.org', imageW - 48, 52);
  ctx.textAlign = 'left';

  for (const { side, board, deck, deckLabel } of sides) {
    for (let i = 0; i < CELLS; i++) {
      const box = cellRect(i, coop, side);
      ctx.fillStyle = COLORS.surface;
      roundRect(ctx, box, 14);
      ctx.fill();
      ctx.strokeStyle = COLORS.border;
      ctx.lineWidth = 2;
      ctx.stroke();

      const p = board[i];
      if (!p) continue;
      const icon = input.meta.get(p.diceId)?.icon;
      const img = icon ? icons.get(icon) : undefined;
      if (img) {
        const ir = iconRect(box, img.naturalWidth, img.naturalHeight);
        ctx.drawImage(img, ir.x, ir.y, ir.w, ir.h);
      }
      if (!input.hidePips) {
        ctx.fillStyle = COLORS.gold;
        ctx.font = `600 26px ${FONT_STACK}`;
        ctx.textAlign = 'right';
        ctx.fillText(String(p.pips), box.x + box.w - 10, box.y + box.h - 18);
        ctx.textAlign = 'left';
      }
      // 角標：只畫設定過的（「?」不畫——沒指定就是沒有資訊）。不看 hidePips：方向是擺位資訊，不是星數。
      const badge = badgeText(p);
      if (badge && badge.glyph !== '?') {
        const r = badgeRect(i, coop, side);
        ctx.fillStyle = COLORS.chip;
        roundRect(ctx, r, 8);
        ctx.fill();
        ctx.strokeStyle = COLORS.borderStrong;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = COLORS.gold;
        ctx.font = `600 26px ${FONT_STACK}`;
        ctx.textAlign = 'center';
        ctx.fillText(badge.glyph, r.x + r.w / 2, r.y + r.h / 2);
        ctx.textAlign = 'left';
      }
    }

    ctx.fillStyle = COLORS.muted;
    ctx.font = `24px ${FONT_STACK}`;
    ctx.fillText(deckLabel, deckRect(0, coop, side).x, deckLabelBaseline(coop, side));

    for (let s = 0; s < DECK_SIZE; s++) {
      const box = deckRect(s, coop, side);
      ctx.fillStyle = COLORS.surface;
      roundRect(ctx, box, 12);
      ctx.fill();
      ctx.strokeStyle = COLORS.border;
      ctx.lineWidth = 2;
      ctx.stroke();

      const p = deck[s];
      if (!p) continue;
      const icon = input.meta.get(p.diceId)?.icon;
      const img = icon ? icons.get(icon) : undefined;
      if (img) {
        const ir = iconRect(box, img.naturalWidth, img.naturalHeight, 0.72);
        ctx.drawImage(img, ir.x, ir.y, ir.w, ir.h);
      }
      ctx.fillStyle = COLORS.gold;
      ctx.font = `600 22px ${FONT_STACK}`;
      ctx.textAlign = 'right';
      ctx.fillText(String(p.pips), box.x + box.w - 8, box.y + box.h - 14);
      ctx.textAlign = 'left';
    }
  }

  // 兩盤之間的分隔線，位置從兩盤的幾何現算（不寫死 y）——畫面上那條 .board-divider 的角色：
  // 沒有它，上下兩盤只是「六列格子」，看不出哪三列是誰的。
  if (coop) {
    const above = cellRect(CELLS - 1, true, 'partner');
    const below = cellRect(0, true, 'me');
    const y = Math.round((above.y + above.h + below.y) / 2);
    const left = cellRect(0, true, 'me');
    const right = cellRect(COLS - 1, true, 'me');
    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(left.x, y);
    ctx.lineTo(right.x + right.w, y);
    ctx.stroke();
  }

  return canvas;
}
