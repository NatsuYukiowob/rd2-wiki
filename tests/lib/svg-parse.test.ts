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
});
