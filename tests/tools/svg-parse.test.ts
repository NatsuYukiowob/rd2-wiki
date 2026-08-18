import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseTree, parseTranslate, parseEdgePath } from '../../tools/lib/svg-parse';

describe('parseTranslate', () => {
  it('解析標準 translate', () => {
    expect(parseTranslate('translate(1700.00,1271.53)')).toEqual([1700, 1271.53]);
  });
  it('拒絕 matrix 形式（要求先跑 normalize）', () => {
    expect(() => parseTranslate('matrix(1,0,0,1,1700,1271.53)')).toThrow(/normalize/);
  });
});

describe('parseEdgePath', () => {
  it('解析絕對 M/L', () => {
    expect(parseEdgePath('M 1700.00 1271.53 L 1506.53 1078.06'))
      .toEqual({ from: [1700, 1271.53], to: [1506.53, 1078.06] });
  });
  it('拒絕相對指令', () => {
    expect(() => parseEdgePath('m 1700,1271.53 -193.47,-193.47')).toThrow(/normalize/);
  });
});

describe('parseTree（真實資料）', () => {
  const svg = readFileSync('data/dice-tree.svg', 'utf8');
  const r = parseTree(svg);

  it('節點與邊的數量正確', () => {
    expect(r.nodes).toHaveLength(239);
    expect(r.edges).toHaveLength(248);
  });
  it('meta 來自 svg 屬性與 metadata', () => {
    // 期望值從正本的原始文字現場取，不寫死版本號與畫布尺寸。這條測的是「parser 有沒有把
    // 屬性讀對」這個性質，不是「現在剛好是 1.0.4 / 3400x2850」這個事實；寫死的話每次改版面
    // 或改版本都得回來改測試，而真正該擋的（parser 讀錯欄位）反而測不出來。
    const attr = (name: string) => new RegExp(`${name}="([^"]*)"`).exec(svg)![1]!;
    expect(r.meta.svgVersion).toBe(attr('data-version'));
    expect(r.meta.updated).toBe(attr('data-updated'));
    expect(r.meta.gameBundle).toBe(/resource bundle ([\d.]+)/.exec(svg)![1]);
    expect(r.meta.viewBox).toEqual(attr('viewBox').split(/\s+/).map(Number));
  });
  it('meta.center 解析出樞紐的中心、尺寸、圖檔與連線 id', () => {
    const c = r.meta.center!;
    expect(c).not.toBeNull();
    // 中心取自放射線的共同起點，不是圖的左上角
    const first = /tree-center-link" d="M ([\d.]+) ([\d.]+)/.exec(svg)!;
    expect([c.x, c.y]).toEqual([Number(first[1]), Number(first[2])]);
    expect(c.image).toBe('tree-center.png');
    expect(c.links).toEqual(['1001', '2001', '3001', '4008', '5002']);
    expect(c.label).toBe('骰子樹');
  });
  it('沒有 g.tree-center 時 meta.center 是 null，不拋錯（樞紐是選用的）', () => {
    const without = svg.replace(/<g class="tree-center"[\s\S]*?<\/g>\n/, '');
    expect(without).not.toBe(svg);
    expect(parseTree(without).meta.center).toBeNull();
  });
  it('放射線起點不一致時直接拋錯，不畫出五條從不同位置發散的線', () => {
    const broken = svg.replace('<path class="tree-center-link" d="M ', '<path class="tree-center-link" d="M 1 1 L 2 2" data-x="');
    expect(broken).not.toBe(svg);
    expect(() => parseTree(broken)).toThrow(/起點不一致/);
  });
  it('樞紐沒跑過 normalize（包在圖層裡或帶 transform）時直接擋下，不悄悄畫錯位置', () => {
    const nested = svg
      .replace('<g class="tree-center"', '<g id="layer1" transform="translate(200,150)"><g class="tree-center"')
      .replace('</g>\n<g class="node"', '</g></g>\n<g class="node"');
    expect(() => parseTree(nested)).toThrow(/normalize/);
    const withTransform = svg.replace('<g class="tree-center" ', '<g class="tree-center" transform="translate(5,5)" ');
    expect(withTransform).not.toBe(svg);
    expect(() => parseTree(withTransform)).toThrow(/transform/);
  });
  it('樞紐的 <image> href 只接受 data/ 底下的純檔名，擋掉路徑穿越', () => {
    // validate 會拿這個字串做 readFileSync，而 validate 是唯一跑在不受信任 fork PR 上的工作。
    const evil = svg.replace('href="tree-center.png"', 'href="../../../../etc/passwd"');
    expect(() => parseTree(evil)).toThrow(/不可含路徑/);
    const sub = svg.replace('href="tree-center.png"', 'href="sub/dir/x.png"');
    expect(() => parseTree(sub)).toThrow(/不可含路徑/);
  });
  it('樞紐的圖沒有以中心對齊時擋下（正本與站台會畫在不同位置）', () => {
    const off = svg.replace('<image href="tree-center.png" x="952.00"', '<image href="tree-center.png" x="900.00"');
    expect(off).not.toBe(svg);
    expect(() => parseTree(off)).toThrow(/以樞紐中心對齊/);
  });
  it('形狀由子元素判定：rect / 4 點 polygon / circle / 6 點 polygon', () => {
    const count = (s: string) => r.nodes.filter(n => n.shape === s).length;
    expect(count('rect')).toBe(41);
    expect(count('diamond')).toBe(123);
    expect(count('circle')).toBe(70);
    expect(count('hex')).toBe(5);
  });
  it('玩家被動的等級上限來自 title 最後一行（真實資料目前 40 個都剛好落在 index 1，跟「最後一行」等價，不代表兩種判定方式在其他情況下也等價，見下面「等級行判定」測試）', () => {
    const withTitleLevel = r.nodes.filter(n => n.titleMaxLevel !== null);
    expect(withTitleLevel).toHaveLength(40);
    expect(withTitleLevel.every(n => n.typeZh === '玩家被動')).toBe(true);
  });
  it('label 可能與 name 不同（實測 60 個）', () => {
    expect(r.nodes.filter(n => n.label !== n.name)).toHaveLength(60);
  });
  it('每個節點都有圖示雜湊', () => {
    expect(r.nodes.every(n => /^[0-9a-f]{12}$/.test(n.icon))).toBe(true);
  });
});

describe('parseTree（等級行判定：取「最後一行」，不是固定「第二行」）', () => {
  const wrap = (inner: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10" data-version="0.0.0" data-updated="2026-01-01">${inner}</svg>`;

  // 過去 tools/lib/svg-parse.ts 固定取 title.split('\n')[1]（第二行），跟
  // tools/validate.ts 的「最後一行」判定不一致；真實資料目前 40 個等級行剛好都落在
  // index 1，這條規則沒被真正測到。這裡用「描述本身含 2 個換行（共 3 行）＋ 最後再附加一行
  // 等級行」的合成資料重現：若還是取第二行，會抓到描述的第二行、maxLevel 靜默變成 1。
  it('描述本身有 3 行（含 2 個換行）時，等級行仍要正確抓到最後一行，不是描述的第二行', () => {
    const svg = wrap(`
      <g class="node" transform="translate(1,2)" data-id="9006" data-type="玩家被動" data-name="測試多行等級">
        <circle r="12" fill="#000" stroke="#ef625e" stroke-width="2" />
        <image href="icons/000000000000.png" x="0" y="0" width="1" height="1" />
        <title>玩家被動｜測試多行等級｜第一行
第二行
第三行
最高等級：15</title>
      </g>
    `);
    const r = parseTree(svg);
    const n = r.nodes.find(x => x.id === '9006')!;
    expect(n.titleMaxLevel).toBe(15);
  });

  it('單行 title（沒有等級行）時 titleMaxLevel 為 null，不會誤把整段 title 當等級行比對', () => {
    const svg = wrap(`
      <g class="node" transform="translate(1,2)" data-id="9007" data-type="骰子" data-name="測試無等級行">
        <rect x="-1" y="-1" width="2" height="2" fill="#000" stroke="#fff" />
        <image href="icons/000000000000.png" x="0" y="0" width="1" height="1" />
        <title>骰子｜測試無等級行｜效果說明</title>
      </g>
    `);
    const r = parseTree(svg);
    const n = r.nodes.find(x => x.id === '9007')!;
    expect(n.titleMaxLevel).toBeNull();
  });
});

describe('parseTree（畸形資料的錯誤訊息要能定位是哪個節點／哪條邊）', () => {
  const wrap = (inner: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10" data-version="0.0.0" data-updated="2026-01-01">${inner}</svg>`;

  it('polygon 頂點數異常時報出該節點的 data-id', () => {
    const svg = wrap(`
      <g class="node" transform="translate(1,2)" data-id="9001" data-type="支援" data-name="測試三角形">
        <polygon points="0,-1 1,0 -1,0" fill="#000" stroke="#fff" />
        <image href="icons/000000000000.png" x="0" y="0" width="1" height="1" />
      </g>
    `);
    expect(() => parseTree(svg)).toThrow(/9001/);
  });

  it('節點缺少形狀元素時報出該節點的 data-id', () => {
    const svg = wrap(`
      <g class="node" transform="translate(1,2)" data-id="9002" data-type="骰子" data-name="測試無形狀">
        <image href="icons/000000000000.png" x="0" y="0" width="1" height="1" />
      </g>
    `);
    expect(() => parseTree(svg)).toThrow(/9002/);
  });

  it('節點缺少 stroke 時報出該節點的 data-id', () => {
    const svg = wrap(`
      <g class="node" transform="translate(1,2)" data-id="9003" data-type="骰子" data-name="測試缺stroke">
        <rect x="-1" y="-1" width="2" height="2" fill="#000" />
        <image href="icons/000000000000.png" x="0" y="0" width="1" height="1" />
      </g>
    `);
    expect(() => parseTree(svg)).toThrow(/9003/);
  });

  it('節點非 <svg> 直屬子元素時報出該節點的 data-id，且保留 normalize 引導語', () => {
    const svg = wrap(`
      <g>
        <g class="node" transform="translate(1,2)" data-id="9005" data-type="骰子" data-name="測試巢狀">
          <rect x="-1" y="-1" width="2" height="2" fill="#000" stroke="#fff" />
          <image href="icons/000000000000.png" x="0" y="0" width="1" height="1" />
        </g>
      </g>
    `);
    expect(() => parseTree(svg)).toThrow(/9005/);
    expect(() => parseTree(svg)).toThrow(/normalize/);
  });

  it('邊缺少 marker-end 時報出該邊的 d 屬性值', () => {
    const svg = wrap(`
      <g class="node" transform="translate(1,2)" data-id="9004" data-type="骰子" data-name="測試邊">
        <rect x="-1" y="-1" width="2" height="2" fill="#000" stroke="#fff" />
        <image href="icons/000000000000.png" x="0" y="0" width="1" height="1" />
      </g>
      <path class="edge" d="M 1 2 L 3 4" />
    `);
    expect(() => parseTree(svg)).toThrow('M 1 2 L 3 4');
  });
});
