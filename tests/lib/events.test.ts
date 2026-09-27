import { describe, expect, it } from 'vitest';
import { EVENT_ICON_KINDS, eventCellHtml, eventIcon } from '../../src/lib/events.js';
import { MYTHIC_CORES } from '../../src/lib/currency.js';
import events from '../../data/events.json';

describe('活動資料的貨幣圖', () => {
  it('中秋商店的種子與造型硬幣重用共用 registry，文字與交易條件不變', () => {
    const event = events.find(e => e.id === 'chuseok-2026')!;
    for (const [kind, text, price, limit] of [
      ['treeSeed', '骰子樹種子 1', '100', '2 次'],
      ['skinCoin', '造型硬幣 5', '10', '無限制'],
    ]) {
      const row = event.sections.flatMap(s => s.rows).find(r =>
        typeof r[0] === 'object' && r[0].text === text)!;
      expect(row).toEqual([{ icon: kind, text }, { icon: 'chuseokcoin', text: price }, limit]);
      expect(eventCellHtml(row[0]!)).toBe(`${eventIcon(kind!)}${text}`);
    }
  });
  it('固定登記的貨幣與每一種超越核心都在合法清單裡', () => {
    // 清單只有一份（`CURRENCY_ICON_KINDS` ＋ `MYTHIC_CORES`）——這條守的是「有人又複製了
    // 第二份」：新登記一種超越核心卻沒進這裡的話，資料檔用它就會驗證失敗而畫面沒問題。
    expect(EVENT_ICON_KINDS).toContain('gold');
    expect(EVENT_ICON_KINDS).toContain('chuseokcoin');
    for (const def of MYTHIC_CORES) expect(EVENT_ICON_KINDS).toContain(def.kind);
  });

  it('每一種合法的 kind 都產得出圖，路徑都在 /currency/ 底下', () => {
    for (const kind of EVENT_ICON_KINDS) {
      expect(eventIcon(kind)).toMatch(/^<img class="currency-icon" src="\/currency\/[\w-]+\.png"/);
    }
  });

  it('未登記的 kind 直接丟，不會安靜地產出一張破圖', () => {
    expect(() => eventIcon('mooncake')).toThrow(/未登記的貨幣圖種類/);
  });

  it('純文字的格子只做 escape，不會被當成 HTML', () => {
    expect(eventCellHtml('造型硬幣 10')).toBe('造型硬幣 10');
    expect(eventCellHtml('<b>x</b>')).toBe('&lt;b&gt;x&lt;/b&gt;');
  });

  it('帶圖的格子是「圖 ＋ 文字」，文字同樣 escape', () => {
    const html = eventCellHtml({ icon: 'gold', text: '金幣 500' });
    expect(html).toBe(`${eventIcon('gold')}金幣 500`);
    expect(eventCellHtml({ icon: 'gold', text: '<i>' })).toBe(`${eventIcon('gold')}&lt;i&gt;`);
  });
});
