// 這支測試證明「為什麼」tests/data/parser-parity.test.ts 守的換行不變量重要：linkedom
// 不做 XML 屬性值正規化、Chromium 會做。線上編輯器在瀏覽器解析同一份 data/dice-tree.svg，
// 兩邊讀出來的 data-* 若不一致，玩家的編輯會靜默弄丟換行。這條斷言把「兩個 parser 讀出來
// 必須逐字相同」變成 CI 擋得下來的規則。
//
// 這支測試刻意放在 tests/e2e/（Playwright），不是 tests/data/（vitest）：CI 的 verify job
// 沒有裝瀏覽器（見 ci.yml 開頭註解——資料驗證與單元測試刻意跟「裝瀏覽器＋建站」分開，不能
// 讓秒級的檢查被拖慢到分鐘等級），只有 e2e job 有 `npx playwright install --with-deps
// chromium`。早期版本把這支測試放進 vitest 直接 `chromium.launch()`，本機因為之前跑過 E2E
// 剛好能過，但乾淨的 verify job 沒裝瀏覽器會直接炸掉——這是那次踩的坑，見上面那支測試檔的
// 開頭註解。
//
// 不需要載入任何網頁：DOMParser 是瀏覽器內建 API，Playwright 新分頁預設的 about:blank
// 就能跑，不用 page.goto() 白等一次站台載入。
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { loadSvg } from '../../tools/lib/dom';

const ATTRS = ['data-id', 'data-type', 'data-name', 'data-cost', 'data-description'] as const;
const svgText = readFileSync('data/dice-tree.svg', 'utf8');

// 下面 linkedom（Node 端，這個函式）與 page.evaluate 裡的回呼（瀏覽器端）刻意各寫一次同樣的
// 屬性抽取邏輯，不是忘記抽共用函式：page.evaluate 的回呼會被序列化後丟進瀏覽器 context 執行，
// 跟這裡的 Node runtime 是兩個獨立的 JS 環境，import 不到彼此，硬要抽出共用函式只會變成
// 「兩份靠人工同步維持一致」卻少了 import/型別錯誤能直接讓建置失敗的保護，得不償失。
function readWithLinkedom(): Record<string, string>[] {
  const doc = loadSvg(svgText);
  return [...doc.querySelectorAll('g.node')].map(g =>
    Object.fromEntries(ATTRS.map(a => [a, g.getAttribute(a) ?? ''])),
  );
}

test('linkedom 與 Chromium 讀出的 239 個節點 data-* 逐字相同', async ({ page }) => {
  const fromBrowser = await page.evaluate(
    ([text, attrs]: [string, string[]]) => {
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
      return [...doc.querySelectorAll('g.node')].map(g =>
        Object.fromEntries(attrs.map(a => [a, g.getAttribute(a) ?? ''])),
      );
    },
    [svgText, [...ATTRS]] as [string, string[]],
  );

  const fromNode = readWithLinkedom();
  expect(fromBrowser.length).toBe(239);
  expect(fromNode.length).toBe(239);
  expect(fromBrowser).toEqual(fromNode);
});
