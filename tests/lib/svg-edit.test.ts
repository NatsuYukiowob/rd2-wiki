import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { locateNodeBlocks, replaceNode, insertNode, removeNode, insertEdge, removeEdge } from '../../src/lib/svg-edit';
import { parseNodeBlock, emitNodeBlock, emitEdgeLine, newNodeBlock, setLabelText } from '../../src/lib/svg-emit';
import { prefixesFor, allocateId } from '../../src/lib/id-alloc';
import { strokeOfElement } from '../../src/lib/taxonomy';
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

  it('用 prefixesFor/allocateId 配號、strokeOfElement 上色的新節點，五種類型都通過 validate', () => {
    const ids = [...svgText.matchAll(/data-id="(\d{4})"/g)].map(m => m[1]!);
    const cases = [
      { type: 'dice' as const, typeZh: '骰子', branch: 'nature' as const, element: 'nature' as const, cost: '核心 5', y: 400 },
      { type: 'rune' as const, typeZh: '骰子符文', branch: 'magic' as const, element: 'magic' as const, cost: '金幣 2,000\n最高 50 級', y: 420 },
      { type: 'passive' as const, typeZh: '玩家被動', branch: 'chaos' as const, element: 'chaos' as const, cost: '金幣 8,000', y: 440 },
      { type: 'support' as const, typeZh: '支援', branch: 'order' as const, element: 'support' as const, cost: '核心 12', y: 460 },
    ];
    let out = svgText;
    const used = new Set(ids);
    for (const c of cases) {
      const id = allocateId(used, prefixesFor(c.branch, c.type)[0]!);
      used.add(id);
      const block = emitNodeBlock(newNodeBlock({
        x: 1506.53, y: c.y, id, type: c.type, typeZh: c.typeZh,
        name: `測試${c.typeZh}`, label: '測試', cost: c.cost,
        description: '測試效果增加20%(+4%)', maxLevel: 50,
        stroke: strokeOfElement(c.element), iconHash: 'a5caff6da1d2',
      }));
      out = insertEdge(insertNode(out, block), emitEdgeLine([1506.53, 626.63], [1506.53, c.y]));
    }
    expect(validate(out, vopts).errors).toEqual([]);
    expect(normalizeSvg(out)).toBe(out);
  });
});
