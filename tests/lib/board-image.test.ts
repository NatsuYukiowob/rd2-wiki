import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CELLS, DECK_SIZE } from '../../src/lib/board';
import { IMAGE_H, IMAGE_W, cellRect, deckRect, iconRect } from '../../src/lib/board-image';

describe('輸出尺寸', () => {
  it('固定 1200×900，跟螢幕 dpr 無關', () => {
    expect([IMAGE_W, IMAGE_H]).toEqual([1200, 900]);
  });
});

describe('cellRect', () => {
  it('15 格全部落在畫布內', () => {
    for (let i = 0; i < CELLS; i++) {
      const r = cellRect(i);
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(IMAGE_W);
      expect(r.y + r.h).toBeLessThanOrEqual(IMAGE_H);
    }
  });

  it('每一格都是正方形且尺寸相同', () => {
    const first = cellRect(0);
    expect(first.w).toBe(first.h);
    for (let i = 1; i < CELLS; i++) {
      expect(cellRect(i).w).toBe(first.w);
      expect(cellRect(i).h).toBe(first.h);
    }
  });

  it('同一列的 y 相同、x 遞增；換列時 y 增加', () => {
    expect(cellRect(0).y).toBe(cellRect(4).y);
    expect(cellRect(1).x).toBeGreaterThan(cellRect(0).x);
    expect(cellRect(5).y).toBeGreaterThan(cellRect(0).y);
  });

  it('相鄰兩格不重疊', () => {
    expect(cellRect(0).x + cellRect(0).w).toBeLessThanOrEqual(cellRect(1).x);
    expect(cellRect(0).y + cellRect(0).h).toBeLessThanOrEqual(cellRect(5).y);
  });

  it('骰盤在畫面上是置中的（左右留白相等）', () => {
    const left = cellRect(0).x;
    const right = IMAGE_W - (cellRect(4).x + cellRect(4).w);
    expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
  });

  it('越界的 index 回 0 尺寸的框，呼叫端畫出來就是什麼都沒有', () => {
    expect(cellRect(15)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    expect(cellRect(-1)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});

describe('deckRect', () => {
  it('5 槽都在骰盤下方且不超出畫布', () => {
    const boardBottom = cellRect(CELLS - 1).y + cellRect(CELLS - 1).h;
    for (let s = 0; s < DECK_SIZE; s++) {
      const r = deckRect(s);
      expect(r.y).toBeGreaterThanOrEqual(boardBottom);
      expect(r.y + r.h).toBeLessThanOrEqual(IMAGE_H);
      expect(r.x + r.w).toBeLessThanOrEqual(IMAGE_W);
    }
  });

  it('越界的槽回 0 尺寸', () => {
    expect(deckRect(DECK_SIZE)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});

describe('iconRect', () => {
  it('正方形圖示置中且依比例縮小', () => {
    // 正方形來源（imgW === imgH）：內框本身就是正方形，等比縮放後不會再裁掉任何一邊，
    // 結果跟舊版「直接拿內框當輸出尺寸」一致。
    const r = iconRect({ x: 100, y: 200, w: 80, h: 80 }, 200, 200, 0.5);
    expect(r).toEqual({ x: 120, y: 220, w: 40, h: 40 });
  });

  it('預設比例是 0.78，跟畫面上的 .board-cell img 一致', () => {
    const r = iconRect({ x: 0, y: 0, w: 100, h: 100 }, 100, 100);
    expect(r.w).toBeCloseTo(78);
  });

  // /board 的骰子來源圖尺寸與長寬比都不統一（寬 147–174、高 171–186，長寬比 0.847–0.935），
  // 這條驗的正是 M1（review 抓到的問題）：分享圖必須跟畫面上的 <img object-fit: contain>
  // 一樣是等比縮放，不能把非正方形的圖硬拉滿整個內框。
  it('非正方形圖示依長寬比等比縮放置中，短邊先頂到內框、另一邊留白', () => {
    const box = { x: 0, y: 0, w: 100, h: 100 };
    // 貪婪骰子（節點 5006 → data/board-icons/0d3632012664.png）：**149×176**，長寬比 0.84659,
    // 是這批 41 張裡最極端的一張（另一端是 1003 花骰子 174×186 = 0.93548）。
    // ⚠️ 這裡的數字要跟真實素材對得上：舊版寫的 147×173.6 不是這 41 張裡任何一張的尺寸
    //（2026-08-23 review F7-2 實測抓到，同一批 tests/e2e/board.spec.ts 的 B14 註解才是對的）。
    const r = iconRect(box, 149, 176);
    const innerW = box.w * 0.78;
    const innerH = box.h * 0.78;

    // 拉伸成正方形的舊行為會是 78×78；等比縮放之後兩邊都應該小於等於內框，且不是相等的
    // 78×78（否則就是被拉滿了，等於白改）。
    // ⚠️ 期望值用「輸出長寬比 === 來源長寬比」，不要寫成 `149 * Math.min(...)`——後者是把
    // 實作公式抄一遍，公式怎麼錯它就怎麼跟著錯（review F7-3）。
    expect(r.w / r.h).toBeCloseTo(149 / 176, 4);
    expect(r.w).toBeLessThan(innerW + 1e-6);
    expect(r.h).toBeLessThanOrEqual(innerH + 1e-6);
    expect(r.w).not.toBeCloseTo(r.h); // 不是正方形——長寬比被保留，不是被拉滿的內框
    // 高比較窄長的圖，短邊（寬）應該先讓出留白，長邊（高）吃滿內框。
    expect(r.h).toBeCloseTo(innerH, 5);

    // 在 box 內置中：左右／上下留白分別相等。
    expect(r.x - box.x).toBeCloseTo(box.x + box.w - (r.x + r.w), 5);
    expect(r.y - box.y).toBeCloseTo(box.y + box.h - (r.y + r.h), 5);
  });

  it('量不到圖片尺寸（0 或負值）時退回舊行為：整個內框當輸出尺寸，不是拒繪', () => {
    const r = iconRect({ x: 0, y: 0, w: 100, h: 100 }, 0, 0);
    expect(r).toEqual({ x: 11, y: 11, w: 78, h: 78 });
  });

  // ⚠️ `iconRect` 的預設 0.78 跟 global.css 的 `.board-cell img { width: 78% }` 是配套關係
  // （分享圖比例要跟螢幕上看到的一致），但兩邊各寫死同一個數字、沒有任何自動化在守。
  // 這條直接讀 global.css 把兩邊比對起來，手法跟 tests/styles/tokens.test.ts 一樣。
  it('預設比例與 global.css 的 .board-cell img 78% 一致，不會各自漂移', () => {
    const css = readFileSync('src/styles/global.css', 'utf8');
    const m = /\.board-cell img \{[^}]*width:\s*(\d+)%/.exec(css);
    expect(m, '在 global.css 找不到 .board-cell img 的 width 百分比').not.toBeNull();
    const cssRatio = Number(m![1]) / 100;

    const square = iconRect({ x: 0, y: 0, w: 100, h: 100 }, 100, 100);
    expect(square.w / 100).toBeCloseTo(cssRatio, 5);
  });
});

/**
 * /board 骰子圖示的顯示不變量（2026-08-23 review F6-1／F6-2 補）。
 *
 * 純骰子圖的長寬比不統一（0.847–0.935），四個顯示點的外框全是正方形，所以「不會被裁角」
 * 完全靠 `object-fit: contain` 撐著。CLAUDE.md 把它寫成不變量，但在這條測試之前**沒有任何
 * 東西在守**：改成 `cover` 的話單元測試全綠（沒有一條斷言碰過 object-fit）、E2E 的 B0d 全綠
 * （`naturalWidth` 仍 > 0）、B14 也全綠（它量的是 canvas 產出的分享圖，吃的是 `iconRect`
 * 不是 CSS）——CI 一片綠，畫面上每顆骰子的角被裁掉。
 *
 * 手法跟上面那條 78% ↔ 0.78 的綁定測試一樣：直接讀 `global.css` 把不變量釘在檔案裡。
 * ⚠️ `.drag-ghost` 也在清單裡——它是第四個顯示點（拖曳時跟在指標下方的那張圖），
 * review 之前 CLAUDE.md 的清單漏了它。
 */
describe('/board 骰子圖示的 object-fit 不變量', () => {
  const DISPLAY_POINTS = [
    ['.board-cell img', '骰盤格'],
    ['.deck-dice img', '我的隊伍那一列'],
    ['.picker-dice img', '下方的骰子選單'],
    ['.drag-ghost', '拖曳時跟在指標下方的影像'],
  ] as const;

  it.each(DISPLAY_POINTS)('%s（%s）是 object-fit: contain，不是 cover', (selector) => {
    const css = readFileSync('src/styles/global.css', 'utf8');
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`${escaped}\\s*\\{[^}]*object-fit:\\s*contain`);
    expect(
      re.test(css),
      `global.css 的 ${selector} 不是 object-fit: contain——純骰子圖的長寬比不統一（0.847–0.935），`
      + '方框裡改用 cover 會把骰子的角裁掉，而且沒有任何其他測試會說話',
    ).toBe(true);
  });
});
