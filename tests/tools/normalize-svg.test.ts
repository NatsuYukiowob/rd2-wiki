import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { normalizeSvg } from '../../tools/normalize-svg';

describe('normalizeSvg', () => {
  it('把 matrix 轉回 translate', () => {
    const out = normalizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><g class="node" transform="matrix(1,0,0,1,170,127.5)"/></svg>');
    expect(out).toContain('transform="translate(170.00,127.50)"');
  });
  it('matrix 也要接受空白分隔（SVG 規範允許，不是只能逗號分隔——同一個函式的 translate 分支已經接受空白，matrix 分支之前漏改）', () => {
    const out = normalizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><g class="node" transform="matrix(1 0 0 1 170 127.5)"/></svg>');
    expect(out).toContain('transform="translate(170.00,127.50)"');
  });
  it('把相對路徑指令轉回絕對 M/L', () => {
    const out = normalizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><path class="edge" d="m 100,200 -50,-50"/></svg>');
    expect(out).toContain('d="M 100.00 200.00 L 50.00 150.00"');
  });
  it('攤平巢狀圖層 group 並把位移併入節點；圖層裡的邊也要保留、座標一併加上圖層位移', () => {
    // 過去這個測試只在 wrapper 裡放一個節點，剛好避開「攤平時把 wrapper 整組連同裡面的邊
    // 一起刪掉」這條路徑——這裡改成節點與邊都放在同一個圖層裡，兩者都要驗證：
    // 節點的 transform 位移正確併入（既有行為），邊要「還在」（不能被 wrapper.remove() 連坐
    // 刪除）且座標也要加上圖層位移（過去節點有做這件事，邊沒有）。
    const out = normalizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg">' +
        '<g transform="translate(10,10)">' +
        '<g class="node" transform="translate(5,5)"/>' +
        '<path class="edge" d="M 0,0 L 20,20" marker-end="url(#arrow)"/>' +
        '</g>' +
        '</svg>',
    );
    expect(out).toContain('transform="translate(15.00,15.00)"');
    expect(out).toContain('class="edge"');
    expect(out).toContain('d="M 10.00 10.00 L 30.00 30.00"');
  });
  it('對已正規化的真實檔案是冪等的', () => {
    const src = readFileSync('data/dice-tree.svg', 'utf8');
    expect(normalizeSvg(normalizeSvg(src))).toBe(normalizeSvg(src));
  });
});
