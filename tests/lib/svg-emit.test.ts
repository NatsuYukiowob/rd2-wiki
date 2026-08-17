import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseNodeBlock, emitNodeBlock, emitEdgeLine, newNodeBlock, setLabelText } from '../../src/lib/svg-emit';

const svgText = readFileSync('data/dice-tree.svg', 'utf8');

/** 從真實檔案切出全部 239 個 `<g class="node">…</g>` 區塊（跨行的節點要整塊取到 </g>）。 */
function allNodeBlocks(text: string): string[] {
  return [...text.matchAll(/<g class="node"[\s\S]*?<\/g>/g)].map(m => m[0]);
}

describe('svg-emit', () => {
  it('對真實檔案的 239 個節點，parse → emit 後位元組完全相同', () => {
    const blocks = allNodeBlocks(svgText);
    expect(blocks.length).toBe(239);
    const mismatches = blocks.filter(b => emitNodeBlock(parseNodeBlock(b)) !== b);
    // 印出第一個不符的區塊，方便定位是哪個欄位沒被模型涵蓋
    expect(mismatches.slice(0, 1)).toEqual([]);
  });

  it('保留符文標籤的 inline font-size', () => {
    const block = allNodeBlocks(svgText).find(b => b.includes('style="font-size:7px"'))!;
    expect(emitNodeBlock(parseNodeBlock(block))).toContain('style="font-size:7px"');
  });

  it('改名字會同步更新 data-name、<title> 與標籤文字', () => {
    const block = allNodeBlocks(svgText).find(b => b.includes('data-id="1002"'))!;
    const n = parseNodeBlock(block);
    const out = emitNodeBlock({ ...n, name: '新名字', labelXml: setLabelText(n.labelXml, '新名字') });
    expect(out).toContain('data-name="新名字"');
    expect(out).toContain('<title>骰子｜新名字｜');
    expect(out).toContain('>新名字</text>');
  });

  it('屬性值的換行編成 &#10;，<title> 用字面換行', () => {
    const n = newNodeBlock({
      x: 100, y: 200, id: '1099', type: 'passive', typeZh: '玩家被動',
      name: '測試被動', label: '測試', cost: '金幣 8,000', description: '第一行\n第二行',
      maxLevel: 15, stroke: '#ef625e', iconHash: 'a5caff6da1d2',
    });
    const out = emitNodeBlock(n);
    expect(out).toContain('data-description="第一行&#10;第二行"');
    expect(out).toContain('<title>玩家被動｜測試被動｜第一行\n第二行\n最高等級：15</title>');
    expect(out).not.toMatch(/data-description="[^"]*\n/);
  });

  it('產生的邊格式與既有資料一致', () => {
    expect(emitEdgeLine([1700, 1271.53], [1506.53, 1078.06]))
      .toBe('<path class="edge" marker-end="url(#arrow)" d="M 1700.00 1271.53 L 1506.53 1078.06" />');
  });

  // ── data-wip 覆蓋缺口補測（現行 239 個真實節點裡 0 個帶 data-wip，主測試完全涵蓋不到這個欄位）──
  // data-wip="1" 是「先佔位、之後再接線」的標記，validate 規則 6 靠它豁免可達性檢查。
  // 若 emitter 沒正確保留它，情境是：貢獻者手動加的 data-wip 節點被編輯器改過一次後，
  // 屬性靜默消失 → 節點從根不可達 → CI 報一個看不懂的錯（跟這個屬性完全無關）。
  describe('data-wip', () => {
    it('帶 data-wip="1" 的區塊 parse → emit 後位元組相同', () => {
      const block = allNodeBlocks(svgText).find(b => b.includes('data-id="1002"'))!;
      // 真實資料裡沒有 data-wip 節點，用既有區塊手動插入這個屬性來構造測試樣本
      // （插入位置遵照簡報規則：接在 data-description 之後、右角括號之前）。
      const withWip = block.replace(/(data-description="[^"]*")/, '$1 data-wip="1"');
      expect(withWip).toContain('data-wip="1"');
      const n = parseNodeBlock(withWip);
      expect(n.wip).toBe(true);
      expect(emitNodeBlock(n)).toBe(withWip);
    });

    it('沒有 data-wip 屬性的區塊，parse 後 wip 為 false，emit 也不會憑空生出這個屬性', () => {
      const block = allNodeBlocks(svgText).find(b => b.includes('data-id="1002"'))!;
      const n = parseNodeBlock(block);
      expect(n.wip).toBe(false);
      expect(emitNodeBlock(n)).not.toContain('data-wip');
    });

    it('newNodeBlock 產生的新節點預設不是 wip（介面沒有開放呼叫端指定）', () => {
      const n = newNodeBlock({
        x: 100, y: 200, id: '1099', type: 'dice', typeZh: '骰子',
        name: '測試骰子', label: '測試', cost: '核心 5', description: '測試描述',
        maxLevel: null, stroke: '#ef625e', iconHash: 'a5caff6da1d2',
      });
      expect(n.wip).toBe(false);
      expect(emitNodeBlock(n)).not.toContain('data-wip');
    });
  });
});
