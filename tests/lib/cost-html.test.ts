import { describe, it, expect } from 'vitest';
import { costHtml, simCostHtml, currencyIcon } from '../../src/lib/cost-html';
import { formatCost } from '../../src/lib/format';

const strip = (html: string) => html.replace(/<img[^>]*>/g, '');

describe('costHtml：帶貨幣圖的成本', () => {
  it('每一種有值的貨幣前面一張圖，文字跟 formatCost 逐字相同', () => {
    const c = { core: 30, gold: 132000, solar: 2000 };
    const html = costHtml(c);
    expect(strip(html)).toBe(formatCost(c));
    expect(html.match(/<img /g)).toHaveLength(3);
    expect(html).toContain('src="/currency/core.png"');
    expect(html).toContain('src="/currency/gold.png"');
    expect(html).toContain('src="/currency/solar.png"');
  });
  it('0 的貨幣連圖都不印；全 0 印「免費」', () => {
    expect(costHtml({ core: 0, gold: 2000, solar: 0 })).not.toContain('core.png');
    expect(costHtml({ core: 0, gold: 2000, solar: 0 })).not.toContain('solar.png');
    expect(costHtml({ core: 0, gold: 0, solar: 0 })).toBe('免費');
  });
  it('圖是裝飾：alt 為空且 aria-hidden，螢幕閱讀器只念旁邊的貨幣名', () => {
    expect(currencyIcon('gold')).toMatch(/alt=""/);
    expect(currencyIcon('gold')).toMatch(/aria-hidden="true"/);
  });
});

describe('simCostHtml：/sim 三列合計', () => {
  it('核心與金幣永遠印（含 0），太陽核心有值才接；文字跟舊的純文字版逐字相同', () => {
    expect(strip(simCostHtml({ core: 0, gold: 0, solar: 0 }))).toBe('核心 0 ／金幣 0');
    expect(strip(simCostHtml({ core: 129, gold: 595700, solar: 2000 }))).toBe('核心 129 ／金幣 595,700 ／太陽核心 2,000');
    expect(simCostHtml({ core: 0, gold: 0, solar: 0 }).match(/<img /g)).toHaveLength(2);
  });
});
