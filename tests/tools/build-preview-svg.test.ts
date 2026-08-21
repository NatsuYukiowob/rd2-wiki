import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildPreviewSvg } from '../../tools/build-preview-svg';
import { normalizeSvg } from '../../tools/normalize-svg';
import { loadNodeText, MAX_TEXT_LENGTH, type NodeTextMap } from '../../tools/lib/node-text';
import { parseTree } from '../../tools/lib/svg-parse';
import { loadSvg } from '../../tools/lib/dom';

const canonical = readFileSync('data/dice-tree.svg', 'utf8');
const nodeText = loadNodeText(JSON.parse(readFileSync('data/nodes.json', 'utf8')), MAX_TEXT_LENGTH);

describe('buildPreviewSvg（真實資料）', () => {
  const preview = buildPreviewSvg(canonical, nodeText);

  // 這條是整個機制的守門員：正本 →（注回標籤）→ 預覽檔 →（normalize）→ 正本，必須逐位元組
  // 回到原點。它同時證明三件事——預覽檔沒有改到幾何、normalize 刪得乾淨（含檔頭註解與它
  // 後面那個換行）、而且「拿預覽檔進 GUI 改完存回正本」這條給貢獻者的動線是安全的。
  it('正本 → 預覽 → normalize 逐位元組回到正本', () => {
    expect(normalizeSvg(preview)).toBe(canonical);
  });

  it('239 個節點各注回一個標籤，內容等於 nodes.json 的 label', () => {
    const labels = [...preview.matchAll(/<text class="(?:dice|mini)-label"[^>]*>([^<]*)<\/text>/g)].map(m => m[1]!);
    expect(labels).toHaveLength(239);
    const ids = [...preview.matchAll(/<text class="id" y="[-\d.]+">(\d+)<\/text>/g)].map(m => m[1]!);
    expect(ids).toHaveLength(239);
    expect(new Set(ids)).toEqual(new Set(Object.keys(nodeText)));
    for (const id of ids) {
      const block = new RegExp(`data-id="${id}"[\\s\\S]*?</g>`).exec(preview)![0];
      expect(/<text class="(?:dice|mini)-label"[^>]*>([^<]*)</.exec(block)![1]).toBe(nodeText[id]!.label);
    }
  });

  it('class 由 type 決定：骰子 41 個 dice-label，其餘 198 個 mini-label', () => {
    expect([...preview.matchAll(/class="dice-label"/g)]).toHaveLength(41);
    expect([...preview.matchAll(/class="mini-label"/g)]).toHaveLength(198);
  });

  // y 是幾何的函數（`h/2 + 15`，跟 src/lib/render.ts 同一條公式），不是存起來的資料——
  // 這條防的是公式跟站台端漂開，那會讓預覽檔上的版面跟使用者看到的不一樣。
  it('標籤的 y 等於 h/2 + 15，id 標記在圖示上方', () => {
    for (const n of parseTree(canonical).nodes) {
      const block = new RegExp(`data-id="${n.id}"[\\s\\S]*?</g>`).exec(preview)![0];
      const labelY = /<text class="(?:dice|mini)-label" y="([-\d.]+)"/.exec(block)![1];
      const idTagY = /<text class="id" y="([-\d.]+)"/.exec(block)![1];
      expect(Number(labelY)).toBe(Math.round(n.size[1] / 2 + 15));
      expect(Number(idTagY)).toBeLessThan(-n.size[1] / 2);
    }
  });

  it('字級階梯只套在 mini-label 上，dice-label 一律用 class 預設', () => {
    expect(/<text class="dice-label"[^>]*style=/.test(preview)).toBe(false);
    for (const m of preview.matchAll(/<text class="mini-label"[^>]*?(?: style="font-size:([\d.]+)px")?>([^<]*)</g)) {
      const len = [...m[2]!].length;
      const expected = len >= 10 ? '5.5' : len >= 8 ? '6' : len >= 6 ? '7' : undefined;
      expect(m[1]).toBe(expected);
    }
  });

  it('檔頭有「勿存回正本」的註解——預覽檔唯一會在編輯器裡提醒人的地方', () => {
    expect(preview.split('\n')[1]).toContain('請勿編輯');
    expect(preview.split('\n')[1]).toContain('data/nodes.json');
  });
});

describe('buildPreviewSvg（兩邊對不上時直接拋錯，不安靜少畫一顆）', () => {
  const wrap = (inner: string) =>
    `<?xml version="1.0" encoding="utf-8"?>\n<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
  const node = (id: string) =>
    `<g class="node" transform="translate(1,2)" data-id="${id}">` +
    `<rect x="-13" y="-13" width="26" height="26" stroke="#fff"/>` +
    `<image href="icons/000000000000.png" x="-13" y="-13" width="26" height="26"/></g>`;
  const text = (over: Record<string, unknown>) => over as unknown as NodeTextMap;
  const one = { name: '測試', label: '測試', type: '骰子', gameId: 'D999', cost: '核心 5', maxLevel: 1, description: '測試' };

  it('SVG 有節點但 nodes.json 沒有 → 報出該 id', () => {
    expect(() => buildPreviewSvg(wrap(node('9001')), text({}))).toThrow(/9001.*沒有對應文案/);
  });

  it('nodes.json 有殘餘 → 逐一列出 id', () => {
    expect(() => buildPreviewSvg(wrap(node('9001')), text({ '9001': one, '9002': one })))
      .toThrow(/9002/);
  });

  it('節點缺 data-id → 報錯而不是安靜跳過', () => {
    const noId = '<g class="node" transform="translate(1,2)"><image href="icons/000000000000.png" width="26" height="26"/></g>';
    expect(() => buildPreviewSvg(wrap(noId), text({}))).toThrow(/缺少 data-id/);
  });

  it('標籤裡的 & 與 < 會被跳脫，解回來仍是原字', () => {
    // 不跳脫的話 `A&B` 會讓瀏覽器把預覽檔判成格式錯誤的 XML 而整份拒繪，`A<C` 則會被
    // 當成標籤開頭——預覽檔開起來是空白或亂掉，而產生它的指令回報成功。
    const out = buildPreviewSvg(wrap(node('9001')), text({ '9001': { ...one, label: 'A&B<C' } }));
    expect(out).toContain('>A&amp;B&lt;C<');
    const el = loadSvg(out).querySelector('text.dice-label');
    expect(el?.textContent).toBe('A&B<C');
  });
});
