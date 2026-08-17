import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
// 從 @playwright/test 匯入而不是裸的 playwright：package.json 宣告的是 @playwright/test，
// 它會 re-export chromium/firefox/webkit，依賴關係才跟 devDependencies 一致。
import { chromium, type Browser } from '@playwright/test';
import { loadSvg } from '../../tools/lib/dom';

// 這支測試存在的理由：linkedom 不做 XML 屬性值正規化、Chromium 會做。線上編輯器在瀏覽器
// 解析同一份 data/dice-tree.svg，兩邊讀出來的 data-* 若不一致，玩家的編輯會靜默弄丟換行。
// 這條斷言把「兩個 parser 讀出來必須逐字相同」變成 CI 擋得下來的規則。
const ATTRS = ['data-id', 'data-type', 'data-name', 'data-cost', 'data-description'] as const;
const svgText = readFileSync('data/dice-tree.svg', 'utf8');

function readWithLinkedom(): Record<string, string>[] {
  const doc = loadSvg(svgText);
  return [...doc.querySelectorAll('g.node')].map(g =>
    Object.fromEntries(ATTRS.map(a => [a, g.getAttribute(a) ?? ''])),
  );
}

describe('parser parity', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch(); }, 60_000);
  afterAll(async () => { await browser?.close(); });

  it('linkedom 與 Chromium 讀出的 239 個節點 data-* 逐字相同', async () => {
    const page = await browser.newPage();
    const fromBrowser = await page.evaluate(
      ([text, attrs]: [string, string[]]) => {
        const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
        return [...doc.querySelectorAll('g.node')].map(g =>
          Object.fromEntries(attrs.map(a => [a, g.getAttribute(a) ?? ''])),
        );
      },
      [svgText, [...ATTRS]] as [string, string[]],
    );
    await page.close();

    const fromNode = readWithLinkedom();
    expect(fromBrowser.length).toBe(239);
    expect(fromNode.length).toBe(239);
    expect(fromBrowser).toEqual(fromNode);
  }, 60_000);
});
