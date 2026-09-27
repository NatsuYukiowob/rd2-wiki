import { describe, it, expect } from 'vitest';
import { costHtml, simCostHtml, currencyIcon, currencyIconDetails } from '../../src/lib/cost-html';
import { formatCost } from '../../src/lib/format';

const strip = (html: string) => html.replace(/<img[^>]*>/g, '');

describe('costHtml：帶貨幣圖的成本', () => {
  it('每一種有值的貨幣前面一張圖，文字跟 formatCost 逐字相同', () => {
    const c = { core: 30, gold: 132000, mythic: { solar: 2000 } };
    const html = costHtml(c);
    expect(strip(html)).toBe(formatCost(c));
    expect(html.match(/<img /g)).toHaveLength(3);
    expect(html).toContain('src="/currency/core.png"');
    expect(html).toContain('src="/currency/gold.png"');
    expect(html).toContain('src="/currency/solar.png"');
  });
  it('0 的貨幣連圖都不印；全 0 印「免費」', () => {
    expect(costHtml({ core: 0, gold: 2000 })).not.toContain('core.png');
    expect(costHtml({ core: 0, gold: 2000 })).not.toContain('solar.png');
    expect(costHtml({ core: 0, gold: 0 })).toBe('免費');
  });
  it('圖是裝飾：alt 為空且 aria-hidden，螢幕閱讀器只念旁邊的貨幣名', () => {
    expect(currencyIcon('gold')).toMatch(/alt=""/);
    expect(currencyIcon('gold')).toMatch(/aria-hidden="true"/);
  });
  it('共用 resolver 同時解析固定貨幣與超越核心，未登記 kind 直接拒絕', () => {
    expect(currencyIconDetails('core')).toMatchObject({ label: '核心' });
    expect(currencyIconDetails('solar')).toMatchObject({ label: '太陽核心' });
    expect(currencyIconDetails('gearSecond').html).toContain('/currency/gearSecond.png');
    expect(() => currencyIconDetails('not-registered')).toThrow('未登記的貨幣圖種類');
  });
  it('五種 rewards 資源沿用同一個 registry 與固定檔名', () => {
    const expected = {
      treeSeed: ['骰子樹種子', 'treeSeed.png'],
      coopTicket: ['合作戰入場券', 'coopTicket.png'],
      arenaTicket: ['競技場入場券', 'arenaTicket.png'],
      skinCoin: ['造型硬幣', 'skinCoin.png'],
      luckyDiceTicket: ['幸運骰子票券', 'luckyDiceTicket.png'],
    } as const;
    for (const [kind, [label, file]] of Object.entries(expected)) {
      const details = currencyIconDetails(kind);
      expect(details.label).toBe(label);
      expect(details.html).toContain('/currency/' + file);
    }
  });
});

describe('simCostHtml：/sim 三列合計', () => {
  it('核心與金幣永遠印（含 0），太陽核心有值才接；文字跟舊的純文字版逐字相同', () => {
    expect(strip(simCostHtml({ core: 0, gold: 0 }))).toBe('核心 0 ／金幣 0');
    expect(strip(simCostHtml({ core: 129, gold: 595700, mythic: { solar: 2000 } }))).toBe('核心 129 ／金幣 595,700 ／太陽核心 2,000');
    expect(simCostHtml({ core: 0, gold: 0 }).match(/<img /g)).toHaveLength(2);
  });
});
