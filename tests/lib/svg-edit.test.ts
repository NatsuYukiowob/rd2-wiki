import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { locateNodeBlocks, replaceNode, insertNode, removeNode, insertEdge, removeEdge } from '../../src/lib/svg-edit';
import { parseNodeBlock, emitNodeBlock, emitEdgeLine, newNodeBlock, setLabelText } from '../../src/lib/svg-emit';
import { normalizeSvg } from '../../tools/normalize-svg';
import { validate } from '../../tools/validate';

const svgText = readFileSync('data/dice-tree.svg', 'utf8');
const keywords = JSON.parse(readFileSync('data/keywords.json', 'utf8')) as string[];
const vopts = { keywords, iconsDir: 'data/icons' };

describe('svg-edit', () => {
  it('定位到 239 個節點區塊，且切出來的字串就是完整的 <g>…</g>', () => {
    const map = locateNodeBlocks(svgText);
    expect(map.size).toBe(239);
    const [s, e] = map.get('1002')!;
    const block = svgText.slice(s, e);
    expect(block.startsWith('<g class="node"')).toBe(true);
    expect(block.endsWith('</g>')).toBe(true);
    expect(block).toContain('data-id="1002"');
  });

  it('不做任何編輯時輸出與原檔位元組完全相同', () => {
    let out = svgText;
    for (const id of locateNodeBlocks(svgText).keys()) {
      const [s, e] = locateNodeBlocks(out).get(id)!;
      out = replaceNode(out, id, emitNodeBlock(parseNodeBlock(out.slice(s, e))));
    }
    expect(out).toBe(svgText);
  });

  it('改一個節點的名稱時，diff 只有那一個區塊', () => {
    const [s, e] = locateNodeBlocks(svgText).get('1002')!;
    const n = parseNodeBlock(svgText.slice(s, e));
    const out = replaceNode(svgText, '1002', emitNodeBlock({ ...n, name: '尖刺骰', labelXml: setLabelText(n.labelXml, '尖刺骰') }));
    expect(out.slice(0, s)).toBe(svgText.slice(0, s));
    expect(out.slice(out.length - (svgText.length - e))).toBe(svgText.slice(e));
    expect(validate(out, vopts).errors).toEqual([]);
  });

  it('新增節點與連線後仍通過 validate，且 normalize 是定點', () => {
    const block = emitNodeBlock(newNodeBlock({
      x: 1506.53, y: 500, id: '1099', type: 'passive', typeZh: '玩家被動',
      name: '測試被動', label: '測試', cost: '金幣 8,000',
      description: '自然骰子子彈傷害增加20%(+5%)', maxLevel: 15,
      stroke: '#ef625e', iconHash: 'a5caff6da1d2',
    }));
    let out = insertNode(svgText, block);
    out = insertEdge(out, emitEdgeLine([1506.53, 626.63], [1506.53, 500]));
    expect(validate(out, vopts).errors).toEqual([]);
    expect(normalizeSvg(out)).toBe(out);
  });

  it('刪除節點與連線可還原成原檔', () => {
    const block = emitNodeBlock(newNodeBlock({
      x: 1506.53, y: 500, id: '1099', type: 'passive', typeZh: '玩家被動',
      name: '測試被動', label: '測試', cost: '金幣 8,000',
      description: '自然骰子子彈傷害增加20%(+5%)', maxLevel: 15,
      stroke: '#ef625e', iconHash: 'a5caff6da1d2',
    }));
    let out = insertEdge(insertNode(svgText, block), emitEdgeLine([1506.53, 626.63], [1506.53, 500]));
    out = removeEdge(out, [1506.53, 626.63], [1506.53, 500]);
    out = removeNode(out, '1099');
    expect(out).toBe(svgText);
  });
});
