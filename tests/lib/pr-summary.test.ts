import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildTreeData } from '../../tools/build-data';
import { insertNode, removeEdge, removeNode, replaceNode } from '../../src/lib/svg-edit';
import { parseNodeBlock, emitNodeBlock, newNodeBlock } from '../../src/lib/svg-emit';
import { diffTrees, renderPrBody, renderPrTitle } from '../../src/lib/pr-summary';

const svgText = readFileSync('data/dice-tree.svg', 'utf8');
const opts = {
  keywords: JSON.parse(readFileSync('data/keywords.json', 'utf8')),
  unlockExceptions: JSON.parse(readFileSync('data/unlock-exceptions.json', 'utf8')),
  spriteIndex: {}, spriteSize: [1, 1] as [number, number],
};
const before = buildTreeData(svgText, opts);
const blockOf = (t: string, id: string) => t.match(new RegExp(`<g class="node"[^>]*data-id="${id}"[\\s\\S]*?</g>`))![0];

describe('pr-summary', () => {
  it('沒改動時三個清單都是空的、成本不變', () => {
    const d = diffTrees(before, before);
    expect(d).toMatchObject({ added: [], removed: [], modified: [] });
    expect(d.costAfter).toEqual(d.costBefore);
  });

  it('改一個節點的名稱只算 modified', () => {
    const n = parseNodeBlock(blockOf(svgText, '1002'));
    const after = buildTreeData(replaceNode(svgText, '1002', emitNodeBlock({ ...n, name: '尖刺骰' })), opts);
    const d = diffTrees(before, after);
    expect(d.modified).toEqual(['1002']);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
  });

  it('新增節點會反映在 added 與成本變化', () => {
    const block = emitNodeBlock(newNodeBlock({
      x: 1506.53, y: 500, id: '1099', type: 'passive', typeZh: '玩家被動',
      name: '測試被動', label: '測試', cost: '金幣 8,000',
      description: '自然骰子子彈傷害增加20%(+5%)', maxLevel: 15,
      stroke: '#ef625e', iconHash: 'a5caff6da1d2',
    }));
    const d = diffTrees(before, buildTreeData(insertNode(svgText, block), opts));
    expect(d.added).toEqual(['1099']);
    expect(d.costAfter.gold - d.costBefore.gold).toBe(8000);
  });

  it('刪除節點時 PR 內文會用 ⚠️ 警示分享網址失效', () => {
    // 1301 是葉節點（沒有後繼、不會讓「其他節點」在圖上斷線），但它自己仍有一條來自前置
    // 節點的入邊（1619.39,1271.53 → 1571.02,1319.90）。buildTreeData 對每條邊的兩端都要求
    // 對齊到現存節點中心（build-tree.ts:47 `if (!a || !b) throw`），若只刪節點、不理會這條邊，
    // 邊會變成端點對不到節點的懸空邊，buildTreeData 直接丟例外（實測: 邊端點未對齊節點中心）。
    // 跟 src/scripts/edit-canvas.ts 既有註解「刪除節點走 removeEdge（逐條）→ removeNode」、
    // 以及 svg-edit.test.ts 既有測試的做法一致：先斷開指向它的邊，再刪節點本身。
    const withoutEdge = removeEdge(svgText, [1619.39, 1271.53], [1571.02, 1319.90]);
    const after = buildTreeData(removeNode(withoutEdge, '1301'), opts);
    const d = diffTrees(before, after);
    const body = renderPrBody({ ...d, newIcons: [], newKeywords: [] }, 'https://rd2-wiki.pages.dev/edit');
    expect(d.removed).toContain('1301');
    expect(body).toContain('⚠️');
    expect(body).toContain('分享網址');
  });

  it('標題會摘要出改動規模', () => {
    const n = parseNodeBlock(blockOf(svgText, '1002'));
    const after = buildTreeData(replaceNode(svgText, '1002', emitNodeBlock({ ...n, name: '尖刺骰' })), opts);
    const s = { ...diffTrees(before, after), newIcons: [], newKeywords: [] };
    expect(renderPrTitle(s)).toBe('data: 修改 1 個節點');
  });
});
