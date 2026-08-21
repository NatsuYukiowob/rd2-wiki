import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseTree, parseTranslate, parseEdgePath } from '../../tools/lib/svg-parse';
import { loadSvg, attr } from '../../tools/lib/dom';

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
  const nodeText: Record<string, { name: string; label: string }> = JSON.parse(readFileSync('data/nodes.json', 'utf8'));
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
    // x 從正本現讀：樞紐的尺寸會隨 tools/render-nodes.ts 重跑而變，寫死就會變成 no-op。
    const x = /<image href="tree-center\.png" x="([-\d.]+)"/.exec(svg)![1]!;
    const off = svg.replace(`x="${x}"`, `x="${Number(x) - 50}"`);
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
  // #21（2026-08-22）之後 parseTree 只認幾何。這條守的是「文案沒有從後門溜回 SVG」——
  // 少了它，有人在正本上補回 `data-name` 而解析器照讀，就會出現兩份會漂移的文案，
  // 而所有其他測試都是綠的。
  it('parseTree 只回幾何，回傳物件上不存在任何文案欄位', () => {
    const keys = new Set(Object.keys(r.nodes[0]!));
    for (const k of ['typeZh', 'name', 'label', 'description', 'awakening', 'gameId', 'categoryZh', 'costRaw', 'titleMaxLevel']) {
      expect(keys.has(k)).toBe(false);
    }
    expect([...keys].sort()).toEqual(['icon', 'id', 'shape', 'size', 'stroke', 'wip', 'x', 'y']);
  });

  it('label 是獨立資料，不是 name 的副本（實測 60 個不同）——所以它是欄位不是衍生值', () => {
    // 若兩者永遠相同，label 就該從 nodes.json 拿掉、由 name 推導。60/239 是縮寫
    // （`所有骰子傷害` → `全骰傷害`），所以它得自己一欄。這條測的是那個前提還成立。
    const ids = Object.keys(nodeText);
    expect(ids).toHaveLength(239);
    expect(ids.filter(id => nodeText[id]!.label !== nodeText[id]!.name)).toHaveLength(60);
  });

  it('正本裡不准有 <title>——那是規則 1 舊版要守的那份副本', () => {
    const withTitle = svg.replace('data-id="1001">', 'data-id="1001"><title>骰子｜火骰子｜偷渡回來的副本</title>');
    expect(withTitle).not.toBe(svg);
    expect(() => parseTree(withTitle)).toThrow(/1001.*不可含 <title>/);
  });
  // #21 PR2：標籤搬進 nodes.json 之後，正本上的 `<text>` 只可能有兩個來源——把
  // `npm run preview` 產的預覽檔存回正本，或有人手動加回去。兩種都是第二份會漂移的文案，
  // 而且畫面上看不出任何差別（站台讀的是 tree.json，不解析正本）。少了這道，
  // 標籤改在 SVG、名稱改在 JSON 兩邊各說各話，CI 全綠。
  it('正本裡不准有 <text>——標籤的正本是 nodes.json 的 label', () => {
    const withText = svg.replace('data-id="1001">', 'data-id="1001"><text class="dice-label" y="42">偷渡回來的標籤</text>');
    expect(withText).not.toBe(svg);
    expect(() => parseTree(withText)).toThrow(/1001.*不可含 <text>/);
    expect(() => parseTree(withText)).toThrow(/normalize/);
  });

  it('<svg> 根底下的 <text> 一樣被擋——解散群組會把標籤丟到那裡', () => {
    const stray = svg.replace('</svg>', '<text class="dice-label" x="1000" y="900">漂掉的標籤</text>\n</svg>');
    expect(stray).not.toBe(svg);
    expect(() => parseTree(stray)).toThrow(/不屬於任何節點的 <text>（內容「漂掉的標籤」）/);
  });

  it('樞紐的 <text> 是唯一合法的那一個（它不是節點，沒有 id 可以當 JSON 的鍵）', () => {
    expect(svg).toContain('tree-center-label');
    expect(() => parseTree(svg)).not.toThrow();
  });

  it('每個節點都有圖示雜湊', () => {
    expect(r.nodes.every(n => /^[0-9a-f]{12}$/.test(n.icon))).toBe(true);
  });
});

describe('parseTree（畸形資料的錯誤訊息要能定位是哪個節點／哪條邊）', () => {
  const wrap = (inner: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10" data-version="0.0.0" data-updated="2026-01-01">${inner}</svg>`;

  it('polygon 頂點數異常時報出該節點的 data-id', () => {
    const svg = wrap(`
      <g class="node" transform="translate(1,2)" data-id="9001">
        <polygon points="0,-1 1,0 -1,0" fill="#000" stroke="#fff" />
        <image href="icons/000000000000.png" x="0" y="0" width="1" height="1" />
      </g>
    `);
    expect(() => parseTree(svg)).toThrow(/9001/);
  });

  it('節點缺少形狀元素時報出該節點的 data-id', () => {
    const svg = wrap(`
      <g class="node" transform="translate(1,2)" data-id="9002">
        <image href="icons/000000000000.png" x="0" y="0" width="1" height="1" />
      </g>
    `);
    expect(() => parseTree(svg)).toThrow(/9002/);
  });

  it('節點缺少 stroke 時報出該節點的 data-id', () => {
    const svg = wrap(`
      <g class="node" transform="translate(1,2)" data-id="9003">
        <rect x="-1" y="-1" width="2" height="2" fill="#000" />
        <image href="icons/000000000000.png" x="0" y="0" width="1" height="1" />
      </g>
    `);
    expect(() => parseTree(svg)).toThrow(/9003/);
  });

  it('節點非 <svg> 直屬子元素時報出該節點的 data-id，且保留 normalize 引導語', () => {
    const svg = wrap(`
      <g>
        <g class="node" transform="translate(1,2)" data-id="9005">
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
      <g class="node" transform="translate(1,2)" data-id="9004">
        <rect x="-1" y="-1" width="2" height="2" fill="#000" stroke="#fff" />
        <image href="icons/000000000000.png" x="0" y="0" width="1" height="1" />
      </g>
      <path class="edge" d="M 1 2 L 3 4" />
    `);
    expect(() => parseTree(svg)).toThrow('M 1 2 L 3 4');
  });
});


describe('attr（linkedom 的屬性實體沒解掉）', () => {
  const doc = loadSvg('<svg xmlns="http://www.w3.org/2000/svg"><g data-a="A&amp;B" data-b="&amp;lt;" data-c="&lt;i&gt;" /></svg>');
  const g = doc.querySelector('g')!;

  it('屬性裡的實體會被解回原字元——名稱含 & 的節點才過得了規則 1', () => {
    // linkedom 解 <title> 的實體、不解屬性的：data-name="A&amp;B" 讀出 "A&amp;B"、
    // <title>A&amp;B</title> 讀出 "A&B"，規則 1 的全等比對就永遠對不起來。
    expect(g.getAttribute('data-a')).toBe('A&amp;B');
    expect(attr(g, 'data-a')).toBe('A&B');
    expect(attr(g, 'data-c')).toBe('<i>');
  });

  it('&amp; 最後解：`&amp;lt;` 是要顯示的字面文字，不能被連解兩次變成 <', () => {
    expect(attr(g, 'data-b')).toBe('&lt;');
  });

  it('屬性不存在時回空字串', () => {
    expect(attr(g, 'data-zzz')).toBe('');
    expect(attr(null, 'data-a')).toBe('');
  });
});
