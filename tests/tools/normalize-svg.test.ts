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
  it('中央樞紐的 g 不會被當成圖層攤平，放射線的 d 仍然照樣正規化', () => {
    // 攤平圖層那段用的是 `svg > g:not(.node)`，中央樞紐是 <svg> 的直屬 <g>，剛好長得像
    // Inkscape 留下的圖層 wrapper——少了 `:not(.tree-center)` 就會被拆散、子元素散到 <svg>
    // 底下，parseTree 找不到 g.tree-center 就當作「這份正本沒有樞紐」，站台安靜地少畫一塊，
    // validate 也不會抱怨（規則 10 只在 center 存在時才檢查）。
    const out = normalizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg">' +
        '<g class="tree-center" data-links="1001">' +
        '<path class="tree-center-link" d="m 100,200 -50,-50"/>' +
        '<image href="tree-center.png" x="1" y="2" width="96" height="61"/>' +
        '</g>' +
        '</svg>',
    );
    expect(out).toContain('<g class="tree-center"');
    expect(out).toContain('d="M 100.00 200.00 L 50.00 150.00"');
    // 圖與放射線都還留在群組裡（不是被搬到 <svg> 底下）
    expect(/<g class="tree-center"[^>]*>[\s\S]*tree-center-link[\s\S]*<image[\s\S]*<\/g>/.test(out)).toBe(true);
  });

  it('樞紐自己帶 transform 時：位移只併入一次、transform 清掉，重跑不會再飄', () => {
    // 只折 d、不清 transform 的話，位移會被套兩次（座標加過了、transform 還在），而且每跑
    // 一次 normalize 就再飄一次——冪等性直接破功，且 parseTree 讀到的樞紐中心會一直移動，
    // validate 全程綠燈。
    const src =
      '<svg xmlns="http://www.w3.org/2000/svg"><g class="tree-center" data-links="1001" transform="translate(10,20)">' +
      '<path class="tree-center-link" d="M 100 200 L 150 250"/>' +
      '<image href="tree-center.png" x="52" y="70" width="96" height="61"/>' +
      '</g></svg>';
    const once = normalizeSvg(src);
    expect(once).toContain('d="M 110.00 220.00 L 160.00 270.00"');
    expect(once).toContain('x="62.00"');
    expect(once).toContain('y="90.00"');
    expect(/class="tree-center"[^>]*transform/.test(once)).toBe(false);
    expect(normalizeSvg(once)).toBe(once); // 冪等
  });

  it('樞紐包在圖層裡時：放射線與圖／標籤一起併入圖層位移，不會只搬一半', () => {
    // 只折放射線、不折圖與標籤的 x/y，圖層被攤平刪掉之後，五條腳跑到新位置、樹的圖還留在
    // 原地——正本看起來就是「圖跟腳分家」，而 validate 與測試都看不出來。
    const src =
      '<svg xmlns="http://www.w3.org/2000/svg"><g id="layer1" transform="translate(10,20)">' +
      '<g class="tree-center" data-links="1001">' +
      '<path class="tree-center-link" d="M 100 200 L 150 250"/>' +
      '<image href="tree-center.png" x="52" y="70" width="96" height="61"/>' +
      '<text class="tree-center-label" x="100" y="240">骰子樹</text>' +
      '</g></g></svg>';
    const out = normalizeSvg(src);
    expect(out).toContain('d="M 110.00 220.00 L 160.00 270.00"');
    expect(out).toContain('x="62.00"'); // image
    expect(out).toContain('x="110.00"'); // text
    expect(out).toContain('y="260.00"'); // text
    expect(out).not.toContain('layer1');
    expect(normalizeSvg(out)).toBe(out);
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
