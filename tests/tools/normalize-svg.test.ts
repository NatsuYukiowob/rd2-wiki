import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { normalizeSvg, encodeAttributeNewlines } from '../../tools/normalize-svg';

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
  it('屬性值內的換行編成 &#10; 實體，<title> 元素內容的換行維持字面換行', () => {
    const out = normalizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg">' +
        '<g class="node" transform="translate(1,2)" data-cost="金幣 2,000&#10;最高 50 級">' +
        '<title>A&#10;B</title>' +
        '</g></svg>',
    );
    expect(out).toContain('data-cost="金幣 2,000&#10;最高 50 級"');
    expect(out).toContain('<title>A\nB</title>');
  });

  it('真實檔案輸出後，屬性值內不得殘留字面換行', () => {
    const out = normalizeSvg(readFileSync('data/dice-tree.svg', 'utf8'));
    const offenders = out.match(/data-(?:cost|description|name)="[^"]*\n[^"]*"/g) ?? [];
    expect(offenders).toEqual([]);
  });
});

describe('encodeAttributeNewlines', () => {
  it('註解內奇數個引號不會誤觸發屬性值的 quote 狀態（GUI 匯出工具常見的產生器註解，例如撇號）', () => {
    // 這是實測重現過的 Critical bug：舊版狀態機把 <!-- ... --> 當一般標籤掃描，註解裡的撇號
    // 會把 quote 旗標卡在開啟狀態、再也關不上（註解結尾 "-->" 的 > 也被誤判成引號內的普通字元，
    // 不會結束 inTag），導致註解之後的每一個字面換行——包括這裡 <title> 元素內容的換行——
    // 都被誤編成 &#10;，直接違反「元素內容的換行維持字面換行」這條不變量。
    const out = encodeAttributeNewlines(
      "<svg xmlns=\"http://www.w3.org/2000/svg\"><!-- Bob's export -->" +
        '<g class="node" data-id="1"><title>Line1\nLine2</title></g></svg>',
    );
    expect(out).toContain('<title>Line1\nLine2</title>');
    expect(out).not.toContain('&#10;');
  });

  it('元素內容裡的引號（例如 <title> 文字含 " 或 \'）不會被誤判成屬性值的 quote', () => {
    const out = encodeAttributeNewlines(
      '<g data-cost="A\nB"><title>He said "hi" and it\'s fine</title></g>',
    );
    expect(out).toContain('data-cost="A&#10;B"');
    expect(out).toContain('<title>He said "hi" and it\'s fine</title>');
  });

  it('屬性值裡的 > 不會被誤判成標籤結束', () => {
    const out = encodeAttributeNewlines('<g data-description="A > B\nC"><title>x</title></g>');
    expect(out).toContain('data-description="A > B&#10;C"');
  });

  it('同一個標籤內混用單引號與雙引號屬性，各自獨立正確編碼換行', () => {
    const out = encodeAttributeNewlines(`<g data-cost='A\nB' data-description="C\nD">`);
    expect(out).toContain(`data-cost='A&#10;B'`);
    expect(out).toContain('data-description="C&#10;D"');
  });

  it('CJK／astral 字元（surrogate pair）不被逐 code point 掃描切壞，緊鄰的換行仍正確編碼', () => {
    // 🎲（U+1F3B2）是 astral 字元，UTF-16 下是 surrogate pair；用來驗證狀態機是用
    // Array.from（依 code point 切）而不是直接用字串索引（會把 surrogate pair 劈成兩半）。
    const out = encodeAttributeNewlines('<g data-description="骰子🎲\n測試"><title>骰子🎲test</title></g>');
    expect(out).toContain('data-description="骰子🎲&#10;測試"');
    expect(out).toContain('<title>骰子🎲test</title>');
  });
});
