import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CARD_GAP, cardModel, placeCard } from '../../src/lib/board-card';
import { deriveTable } from '../../src/lib/dice-calc';
import type { DiceStatsTable } from '../../src/lib/types';

const params = deriveTable(JSON.parse(readFileSync('data/dice-stats.json', 'utf8')) as DiceStatsTable);

describe('cardModel', () => {
  it('火骰子 3 骰點 Lv.5：標題與數值列', () => {
    const m = cardModel('火骰子', 3, 5, params['D000']!);
    expect(m.title).toBe('火骰子 · 3 骰點 · 強化 Lv.5');
    const row = (label: string) => m.rows.find(r => r.label === label)?.value;
    expect(row('攻擊力')).toBe('950');
    expect(row('攻擊速度')).toBe('0.333 秒/次');
    expect(row('範圍傷害')).toBe('490%');
    expect(row('目標')).toBe('前方');
  });

  it('列的順序跟 dice-stats.json 一致（前三項是攻擊力、攻擊速度、目標）', () => {
    const labels = cardModel('火骰子', 1, 1, params['D000']!).rows.map(r => r.label);
    expect(labels.slice(0, 3)).toEqual(['攻擊力', '攻擊速度', '目標']);
  });
});

describe('placeCard', () => {
  const card = { width: 240, height: 200 };
  const desk = { width: 1280, height: 800 };

  it('空間夠時開在 prefer 那一側、水平以錨點中線置中', () => {
    const a = { left: 600, top: 300, width: 80, height: 80 };
    expect(placeCard(a, card, desk, 'below')).toEqual({ left: 520, top: 300 + 80 + CARD_GAP });
    expect(placeCard(a, card, desk, 'above')).toEqual({ left: 520, top: 300 - CARD_GAP - 200 });
  });

  it('prefer 預設是 below', () => {
    const a = { left: 600, top: 300, width: 80, height: 80 };
    expect(placeCard(a, card, desk)).toEqual(placeCard(a, card, desk, 'below'));
  });

  it('prefer 那側放不下就換另一側', () => {
    const nearBottom = { left: 600, top: 650, width: 80, height: 80 };
    expect(placeCard(nearBottom, card, desk, 'below').top).toBe(650 - CARD_GAP - 200);
    const nearTop = { left: 600, top: 20, width: 80, height: 80 };
    expect(placeCard(nearTop, card, desk, 'above').top).toBe(20 + 80 + CARD_GAP);
  });

  it('兩側都放不下就貼齊視窗底部、不出上緣', () => {
    const a = { left: 600, top: 300, width: 80, height: 80 };
    expect(placeCard(a, { width: 240, height: 700 }, desk).top).toBe(800 - 700 - CARD_GAP);
    expect(placeCard(a, { width: 240, height: 900 }, desk).top).toBe(CARD_GAP);
  });

  it('水平夾在視窗內；卡片比視窗還寬時貼左、不回負值', () => {
    const phone = { width: 320, height: 640 };
    expect(placeCard({ left: 0, top: 100, width: 50, height: 50 }, card, phone).left).toBe(CARD_GAP);
    expect(placeCard({ left: 280, top: 100, width: 40, height: 50 }, card, phone).left).toBe(320 - 240 - CARD_GAP);
    expect(placeCard({ left: 100, top: 100, width: 50, height: 50 }, { width: 400, height: 100 }, phone).left).toBe(CARD_GAP);
  });

  // topInset＝視窗上緣被 sticky 導覽列佔掉的高度。卡片 z-index 45 高過導覽列的 40，不讓的話往上開會畫在導覽列上。
  it('topInset：往上開要讓出導覽列，放不下就換到下方', () => {
    const a = { left: 600, top: 250, width: 80, height: 80 };
    // 沒有 topInset 時上方放得下（250 − 8 − 200 = 42 ≥ 8）。
    expect(placeCard(a, card, desk, 'above').top).toBe(250 - CARD_GAP - 200);
    // 導覽列佔掉上面 56px：42 < 56 + 8 → 換到下方。
    expect(placeCard(a, card, desk, 'above', 56).top).toBe(250 + 80 + CARD_GAP);
  });

  it('topInset：錨點被捲到導覽列底下、或兩側都放不下時，上緣仍夾在導覽列之下', () => {
    // 錨點下緣 50 在導覽列（56）底下：往下開的 58 仍會落進導覽列 → 夾到 56 + 8。
    expect(placeCard({ left: 600, top: 0, width: 80, height: 50 }, card, desk, 'below', 56).top).toBe(56 + CARD_GAP);
    // 兩側都放不下：原本貼齊視窗底部會算出負值再夾到 CARD_GAP，有 topInset 時改夾到 topInset + CARD_GAP。
    const a = { left: 600, top: 300, width: 80, height: 80 };
    expect(placeCard(a, { width: 240, height: 900 }, desk, 'below', 56).top).toBe(56 + CARD_GAP);
  });

  it('性質：有 topInset 時，四個角、兩種 prefer，卡片都落在導覽列之下、視窗之內', () => {
    const topInset = 56;
    for (const vp of [{ width: 320, height: 640 }, desk]) {
      const size = 50;
      const corners = [
        { left: 0, top: 0 }, { left: vp.width - size, top: 0 },
        { left: 0, top: vp.height - size }, { left: vp.width - size, top: vp.height - size },
      ];
      for (const c of corners) {
        for (const prefer of ['above', 'below'] as const) {
          const { left, top } = placeCard({ ...c, width: size, height: size }, card, vp, prefer, topInset);
          const where = `${vp.width}×${vp.height} 錨點 (${c.left},${c.top}) prefer=${prefer} topInset=${topInset}`;
          expect(left, where).toBeGreaterThanOrEqual(CARD_GAP);
          expect(top, where).toBeGreaterThanOrEqual(topInset + CARD_GAP);
          expect(left + card.width, where).toBeLessThanOrEqual(vp.width - CARD_GAP);
          expect(top + card.height, where).toBeLessThanOrEqual(vp.height - CARD_GAP);
        }
      }
    }
  });

  it('性質：320×640 與 1280×800 上，錨點在四個角、兩種 prefer，卡片都完整落在視窗內', () => {
    for (const vp of [{ width: 320, height: 640 }, desk]) {
      const size = 50;
      const corners = [
        { left: 0, top: 0 }, { left: vp.width - size, top: 0 },
        { left: 0, top: vp.height - size }, { left: vp.width - size, top: vp.height - size },
      ];
      for (const c of corners) {
        for (const prefer of ['above', 'below'] as const) {
          const { left, top } = placeCard({ ...c, width: size, height: size }, card, vp, prefer);
          const where = `${vp.width}×${vp.height} 錨點 (${c.left},${c.top}) prefer=${prefer}`;
          expect(left, where).toBeGreaterThanOrEqual(CARD_GAP);
          expect(top, where).toBeGreaterThanOrEqual(CARD_GAP);
          expect(left + card.width, where).toBeLessThanOrEqual(vp.width - CARD_GAP);
          expect(top + card.height, where).toBeLessThanOrEqual(vp.height - CARD_GAP);
        }
      }
    }
  });
});
