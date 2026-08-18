import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// 這支測試守的是「換行不變量本身」：SVG 屬性值內不得殘留字面換行（必須編成 &#10; 實體），
// <title> 元素內容則相反（維持字面換行）。純字串掃描 data/dice-tree.svg 的原始文字，
// 不解析 DOM、不啟動瀏覽器，毫秒級、零相依、不會 flake。
//
// 這支測試曾經踩過的坑：第一版直接在這裡 `chromium.launch()` 做雙 parser 比對，本機因為
// 之前跑過 E2E、`~/.cache/ms-playwright/` 剛好留有瀏覽器而測試能過，但 `.github/workflows/
// ci.yml` 的 `verify` job（`npm test` 跑在這裡）從頭到尾沒有 `npx playwright install`——
// 只有 `e2e` job 裝了瀏覽器，兩個 job 又跑在各自獨立的 runner 上。乾淨的 verify job 會直接
// 炸「Executable doesn't exist」，擋掉每一個 PR。教訓：`npm test`／`verify` job 的範圍內
// 不能引入瀏覽器相依，需要瀏覽器的測試一律歸到 tests/e2e/（由 e2e job 執行）。
//
// 「為什麼這個不變量重要」（XML 規範要求 parser 把屬性值內的字面換行正規化成空格、Chromium
// 遵守但 linkedom 不遵守，兩邊解析同一份檔案會讀出不同的 data-cost/data-description）由
// `tests/e2e/parser-parity.spec.ts` 的雙 parser 比對證明；這支測試只負責守住「不變量本身
// 有沒有被破壞」——兩者互補，前者能在每一次 PR 的 verify job 秒級跑到，不用等 e2e job
// 把瀏覽器裝完。
const svgText = readFileSync('data/dice-tree.svg', 'utf8');

describe('SVG 換行不變量（純字串掃描，不需要 DOM／瀏覽器）', () => {
  it('所有 data-* 屬性值內沒有殘留字面換行（都已編成 &#10; 實體）', () => {
    // data-* 屬性值本身不會含裸雙引號（XML 屬性值若要放 " 一定得轉義成 &quot;），
    // 所以「配對到下一個雙引號」就是這個屬性值的結尾，不需要處理跳脫或掃描狀態機。
    // 捕捉群組 1 一定會配對到（正則本身要求），`?? ''` 純粹是滿足
    // tsconfig 的 `noUncheckedIndexedAccess`，不代表真的可能是 undefined。
    const values = [...svgText.matchAll(/data-[\w-]+="([^"]*)"/g)].map(m => m[1] ?? '');
    const literalNewlines = values.reduce((acc, v) => acc + (v.match(/\n/g) ?? []).length, 0);
    expect(literalNewlines).toBe(0);
  });

  it('<title> 元素內容含字面換行的節點數 = 69（Task 1 核實的實際值，元素內容不編碼）', () => {
    const titles = [...svgText.matchAll(/<title>([\s\S]*?)<\/title>/g)].map(m => m[1] ?? '');
    expect(titles.length).toBe(239);
    const withLiteralNewline = titles.filter(t => t.includes('\n')).length;
    expect(withLiteralNewline).toBe(69);
  });
});
