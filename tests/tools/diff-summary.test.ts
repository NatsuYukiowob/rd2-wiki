import { describe, it, expect } from 'vitest';
import type { TreeData, TreeNode, Edge } from '../../src/lib/types';
import { buildDiffSummary, escapeMarkdown, SUMMARY_MARKER, NO_CHANGE_MARKER } from '../../tools/diff-summary';

/** 最小可用的 TreeNode 替身，個別測試只覆寫需要的欄位。 */
const n = (p: Partial<TreeNode>): TreeNode =>
  ({
    id: '1001', branch: 'nature', element: 'nature', type: 'dice', name: '火骰子', label: '火',
    shape: 'rect', size: [48, 52], x: 0, y: 0,
    unlockCost: { core: 10, gold: 1000 }, unlockVia: 'cost', maxLevel: 1,
    prereqMode: null, upgradeCost: null, description: '造成傷害', keywords: [],
    growth: null, dataIssue: null, icon: 'aaaaaaaaaaaa',
    ...p,
  }) as TreeNode;

const meta = (totalUnlockCost: { core: number; gold: number }) =>
  ({
    svgVersion: '1', gameBundle: 'x', updated: '2026-01-01',
    viewBox: [0, 0, 100, 100],
    roots: ['1001'],
    bounds: {},
    totalUnlockCost,
    sprite: { url: '/assets/sprite.webp', size: [768, 458], index: {} },
  }) as TreeData['meta'];

const tree = (nodes: TreeNode[], edges: Edge[] = [], totalUnlockCost = { core: 0, gold: 0 }): TreeData => ({
  meta: meta(totalUnlockCost),
  nodes,
  edges,
});

describe('buildDiffSummary（規則 11：id 變動警告）', () => {
  it('新增節點：計入「新增」計數，不觸發 id 消失警告', () => {
    const base = tree([n({ id: '1001' })], [], { core: 10, gold: 1000 });
    const head = tree([n({ id: '1001' }), n({ id: '1002', name: '風骰子' })], [], { core: 25, gold: 2000 });

    const summary = buildDiffSummary(base, head);

    expect(summary).toContain('節點：1 → 2');
    expect(summary).toContain('新增 1｜刪除 0｜修改 0');
    expect(summary).not.toContain('id 消失');
  });

  it('刪除節點：id 消失要有顯眼警告，且點出分享網址會失效', () => {
    const base = tree([n({ id: '1001' }), n({ id: '1002', name: '風骰子' })], [], { core: 20, gold: 2000 });
    const head = tree([n({ id: '1001' })], [], { core: 10, gold: 1000 });

    const summary = buildDiffSummary(base, head);

    expect(summary).toContain('節點：2 → 1');
    expect(summary).toContain('新增 0｜刪除 1｜修改 0');
    expect(summary).toContain('⚠️ **有節點 id 消失**：1002');
    expect(summary).toContain('分享網址會失效');
  });

  it('修改成本：同 id 但 unlockCost 不同要計入「修改」並列進清單', () => {
    const base = tree([n({ id: '1001', unlockCost: { core: 10, gold: 1000 } })], [], { core: 10, gold: 1000 });
    const head = tree([n({ id: '1001', unlockCost: { core: 20, gold: 2000 } })], [], { core: 20, gold: 2000 });

    const summary = buildDiffSummary(base, head);

    expect(summary).toContain('新增 0｜刪除 0｜修改 1');
    expect(summary).toContain('全樹解鎖成本：核心 10 → 20，金幣 1,000 → 2,000');
    expect(summary).toContain('<details><summary>修改的節點</summary>');
    expect(summary).toContain('- 1001 火骰子');
  });

  it('完全無變動時不附加警告或修改清單區塊', () => {
    const base = tree([n({ id: '1001' })], [], { core: 10, gold: 1000 });
    const head = tree([n({ id: '1001' })], [], { core: 10, gold: 1000 });

    const summary = buildDiffSummary(base, head);

    expect(summary).not.toContain('⚠️');
    expect(summary).not.toContain('<details>');
  });
});

/**
 * 這則留言是由擁有 `pull-requests: write` 的 workflow 貼出去的，而內容裡的節點名稱與 id
 * 來自 `data/dice-tree.svg`——送 PR 的人改得動。不逃逸就等於讓 fork 決定留言裡渲染什麼。
 */
describe('escapeMarkdown（PR 留言的注入防護）', () => {
  it('HTML 標籤被轉成實體，不會在留言裡渲染成標籤', () => {
    expect(escapeMarkdown('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(escapeMarkdown('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('& 先處理，不會把自己插入的實體再逃逸一次', () => {
    expect(escapeMarkdown('A&B')).toBe('A&amp;B');
    expect(escapeMarkdown('&lt;')).toBe('&amp;lt;');
  });

  it('@ 轉成 &#64;：顯示仍是 @，但不會提及到無關的人', () => {
    expect(escapeMarkdown('@NatsuYukiowob')).toBe('&#64;NatsuYukiowob');
  });

  it('Markdown 行內語法字元被反斜線逃逸，連結與程式碼區塊不會成形', () => {
    // 連結語法被拆掉，網址本體的 `://` 也一併中和——否則 GFM 會把裸網址自動連成可點的連結。
    expect(escapeMarkdown('[看這裡](http://evil.example)')).toBe('\\[看這裡\\](http:&#47;&#47;evil.example)');
    expect(escapeMarkdown('`rm -rf /`')).toBe('\\`rm -rf /\\`');
    expect(escapeMarkdown('a|b')).toBe('a\\|b');
    expect(escapeMarkdown('*粗*_斜_~刪~')).toBe('\\*粗\\*\\_斜\\_\\~刪\\~');
  });

  it('一般名稱原樣通過', () => {
    expect(escapeMarkdown('火骰子')).toBe('火骰子');
  });
});

describe('buildDiffSummary 的留言標記與逃逸', () => {
  it('永遠帶識別標記，pr-comment 才找得到上一則就地更新', () => {
    const base = tree([n({ id: '1001' })], [], { core: 10, gold: 1000 });
    const head = tree([n({ id: '1002' })], [], { core: 10, gold: 1000 });

    expect(buildDiffSummary(base, head)).toContain(SUMMARY_MARKER);
  });

  it('兩份 tree.json 逐字元相同時標成「無變動」，pr-comment 據此不貼留言', () => {
    const same = () => tree([n({ id: '1001' })], [['1001', '1002']], { core: 10, gold: 1000 });

    expect(buildDiffSummary(same(), same())).toContain(NO_CHANGE_MARKER);
  });

  it('只要有任何差異就不標「無變動」——包含只有邊被改接（節點計數全部是 0）的情況', () => {
    const base = tree([n({ id: '1001' })], [['1001', '1002']], { core: 10, gold: 1000 });
    const head = tree([n({ id: '1001' })], [['1001', '1003']], { core: 10, gold: 1000 });

    const summary = buildDiffSummary(base, head);

    expect(summary).toContain('新增 0｜刪除 0｜修改 0');
    expect(summary).not.toContain(NO_CHANGE_MARKER);
  });

  it('修改清單裡的節點名稱有逃逸', () => {
    const base = tree([n({ id: '1001', name: '火骰子', unlockCost: { core: 10, gold: 1000 } })]);
    const head = tree([n({ id: '1001', name: '<img src=x onerror=alert(1)> @yuki', unlockCost: { core: 20, gold: 1000 } })]);

    const summary = buildDiffSummary(base, head);

    expect(summary).toContain('&lt;img src=x onerror=alert(1)&gt; &#64;yuki');
    expect(summary).not.toContain('<img src=x');
  });

  it('id 消失警告裡的 id 有逃逸', () => {
    const base = tree([n({ id: '1001' }), n({ id: '<b>1002</b>' })]);
    const head = tree([n({ id: '1001' })]);

    const summary = buildDiffSummary(base, head);

    expect(summary).toContain('&lt;b&gt;1002&lt;/b&gt;');
    expect(summary).not.toContain('<b>1002</b>');
  });
});

/**
 * 2026-08-19 review 報告 P3：摘要要看得見「邊」。
 *
 * 在這之前，摘要只比節點集合、逐節點內容、以及**邊的數量**——把一條前置改接到別的節點，
 * 產出的摘要與「完全沒改」逐字相同。維護者不可能逐行讀 SVG 的 diff，這則留言是唯一的替代品，
 * 所以它看不見的東西，等於沒有人在看。
 */
describe('buildDiffSummary：邊與 wip 的變化（P3）', () => {
  const withEdges = (edges: Edge[], extra: Partial<TreeNode>[] = []) =>
    tree([n({ id: '1001', name: '火骰子' }), n({ id: '1002', name: '尖刺骰子' }), n({ id: '1003', name: '冰骰子' }),
      ...extra.map(p => n(p))], edges, { core: 10, gold: 1000 });

  it('邊數不變但接法變了：要有顯眼警告，且摘要不能跟「完全沒改」長得一樣', () => {
    const base = withEdges([['1001', '1002']]);
    const head = withEdges([['1001', '1003']]);

    const summary = buildDiffSummary(base, head);

    expect(summary).toContain('邊數不變但前置關係被改動');
    expect(summary).not.toBe(buildDiffSummary(base, base));
  });

  it('列出新增與刪除的邊，並帶上兩端節點的名稱', () => {
    const base = withEdges([['1001', '1002']]);
    const head = withEdges([['1001', '1003']]);

    const summary = buildDiffSummary(base, head);

    expect(summary).toContain('1001 火骰子');
    expect(summary).toContain('1003 冰骰子');
    expect(summary).toContain('1002 尖刺骰子');
  });

  it('邊完全沒動時不出現邊的區塊', () => {
    const base = withEdges([['1001', '1002']]);

    expect(buildDiffSummary(base, base)).not.toContain('邊數不變但前置關係被改動');
  });

  it('wip 集合的變化要列出來——那個標記會讓節點豁免圖結構檢查', () => {
    const base = withEdges([['1001', '1002']]);
    const head = tree(
      [n({ id: '1001', name: '火骰子' }), n({ id: '1002', name: '尖刺骰子' }), n({ id: '1003', name: '冰骰子', wip: true })],
      [['1001', '1002']], { core: 10, gold: 1000 },
    );

    const summary = buildDiffSummary(base, head);

    expect(summary).toContain('待接線');
    expect(summary).toContain('1003');
  });

  it('邊的改動很多時截斷，並說明還有幾條', () => {
    const many = (offset: number): Edge[] =>
      Array.from({ length: 50 }, (_, i) => ['1001', String(2000 + i + offset)] as Edge);
    const base = withEdges(many(0));
    const head = withEdges(many(100));

    const summary = buildDiffSummary(base, head);

    expect(summary).toContain('…還有');
    expect(summary.length).toBeLessThan(20000);
  });
});
