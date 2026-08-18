import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseTreeWith } from '../../src/lib/svg-parse';
import { parseTree } from '../../tools/lib/svg-parse';
import { loadSvg } from '../../tools/lib/dom';

// parseTreeWith 的存在理由：線上編輯器要在瀏覽器跑跟 CI 完全相同的解析邏輯。
// 這支測試證明「同一份程式碼、換一個 DOM 實作，結果一模一樣」，以及 tools/ 的薄包裝沒有改變行為。
const svgText = readFileSync('data/dice-tree.svg', 'utf8');

describe('parseTreeWith', () => {
  it('注入 linkedom 時解析出正確的節點、邊與 meta', () => {
    const r = parseTreeWith(svgText, loadSvg);
    expect(r.nodes.length).toBe(239);
    expect(r.edges.length).toBe(248);
    expect(r.meta.svgVersion).toBe('1.0.4');
  });

  it('與重構前的 tools/lib/svg-parse.ts 的 parseTree 結果完全相同', () => {
    // parseTree 現在是注入 loadSvg 的薄包裝；兩者輸出必須逐位元組相同，
    // 這是「重構不改變行為」的定義。
    expect(JSON.stringify(parseTree(svgText))).toBe(JSON.stringify(parseTreeWith(svgText, loadSvg)));
  });

  it('抽樣節點的欄位正確（含全形斜線成本與多行描述）', () => {
    const n = parseTreeWith(svgText, loadSvg).nodes.find(x => x.id === '1201')!;
    expect(n.typeZh).toBe('骰子符文');
    expect(n.costRaw).toContain('\n');       // 屬性值的 &#10; 解析後是真換行
    expect(n.shape).toBe('diamond');
  });

  it('屬性值裡的具名實體要正確解碼（linkedom 的 getAttribute 不解碼，必須走 getAttributeNode）', () => {
    // 現行資料 0 個具名實體，所以 239 節點的往返與 parity 測試都涵蓋不到這條；
    // 但編輯器一旦讓玩家打出 & 或 <，這條路徑就會被走到。
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" data-version="1" data-updated="x">`
      + `<path class="edge" marker-end="url(#arrow)" d="M 0.00 0.00 L 1.00 1.00" />`
      + `<g class="node" transform="translate(0.00,0.00)" data-id="1001" data-type="骰子" `
      + `data-name="A &amp; B" data-cost="核心 5" data-description="傷害 &lt; 100">`
      + `<title>骰子｜A &amp; B｜傷害 &lt; 100</title>`
      + `<rect x="-36" y="-28" width="72" height="56" rx="11" fill="#322b4b" stroke="#ef625e" stroke-width="2" />`
      + `<image href="icons/a5caff6da1d2.png" x="-24" y="-26" width="48" height="52" preserveAspectRatio="xMidYMid meet" />`
      + `<text class="dice-label" y="39">A &amp; B</text></g></svg>`;
    const n = parseTreeWith(svg, loadSvg).nodes[0]!;
    expect(n.name).toBe('A & B');
    expect(n.description).toBe('傷害 < 100');
    expect(n.label).toBe('A & B');
  });
});
