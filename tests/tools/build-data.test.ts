import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { buildTreeData } from '../../tools/build-data';
import { buildSprite, type IconEntry } from '../../tools/lib/icons';
import { parseTree } from '../../tools/lib/svg-parse';
import { typeOfZh } from '../../src/lib/taxonomy';
import { buildTreeDataWith } from '../../src/lib/build-tree';
import { loadSvg } from '../../tools/lib/dom';

const svg = readFileSync('data/dice-tree.svg', 'utf8');
const opts = {
  keywords: JSON.parse(readFileSync('data/keywords.json', 'utf8')) as string[],
  unlockExceptions: JSON.parse(readFileSync('data/unlock-exceptions.json', 'utf8')) as Record<string, { unlockVia: 'quest' | 'default' }>,
  spriteIndex: Object.fromEntries(readdirSync('data/icons').map(f => [f.replace('.png', ''), [0, 0, 48, 52]])) as Record<string, [number, number, number, number]>,
  // 這裡的尺寸只是測試替身，不代表真實 sprite.webp 大小；真實數字由 tools/build-data.ts 的
  // CLI 區塊從 buildSprite() 的回傳值取得。
  spriteSize: [768, 458] as [number, number],
};
const data = buildTreeData(svg, opts);

describe('buildTreeData', () => {
  it('節點與邊數量正確', () => {
    expect(data.nodes).toHaveLength(239);
    expect(data.edges).toHaveLength(248);
  });
  it('edges 方向為 [前置, 被解鎖]', () => {
    const fromRoot = data.edges.filter(([from]) => from === '1001');
    expect(fromRoot.length).toBeGreaterThan(0);
    expect(data.edges.some(([, to]) => to === '1001')).toBe(false);
  });
  it('meta.roots 為五顆起手骰', () => {
    expect(data.meta.roots.sort()).toEqual(['1001', '2001', '3001', '4008', '5002']);
  });
  it('全樹解鎖成本符合實測值', () => {
    expect(data.meta.totalUnlockCost).toEqual({ core: 1772, gold: 6662000 });
  });
  it('玩家被動的等級上限來自 title', () => {
    const n = data.nodes.find(x => x.id === '1101')!;
    expect(n.maxLevel).toBeGreaterThan(1);
  });
  it('解鎖例外被標記', () => {
    expect(data.nodes.find(x => x.id === '4008')!.unlockVia).toBe('quest');
    expect(data.nodes.find(x => x.id === '2001')!.unlockVia).toBe('default');
  });
  it('佔位符節點被標記為 dataIssue', () => {
    expect(data.nodes.filter(n => n.dataIssue === 'placeholder')).toHaveLength(4);
  });
  it('支援節點的 branch 跟著 id 首碼，element 為 support', () => {
    const n = data.nodes.find(x => x.id === '1114')!;
    expect(n.branch).toBe('nature');
    expect(n.element).toBe('support');
  });
  it('gzip 後符合效能預算（≤ 20 KB）', () => {
    expect(gzipSync(Buffer.from(JSON.stringify(data))).length).toBeLessThanOrEqual(20 * 1024);
  });
  // 追加 1：spec §11 的 sprite 400 KB 預算，過去只有 CLI（build-data.ts 的 CLI 區塊）在檢查、
  // 本機跑 `npm test` 抓不到；這裡用 data/icons/ 的真實圖示組出真正的 sprite（不是替身
  // spriteIndex），量測結果才跟 CLI 一致。
  it('data/icons/ 真實圖示組出的 sprite 符合效能預算（≤ 400 KB）', async () => {
    const { nodes: rawNodes } = parseTree(svg);
    const typeByHash = new Map(rawNodes.map(n => [n.icon, typeOfZh(n.typeZh)]));
    const entries: IconEntry[] = readdirSync('data/icons')
      .filter(f => f.endsWith('.png'))
      .map(f => {
        const hash = f.replace('.png', '');
        return { hash, buf: readFileSync(`data/icons/${f}`), type: typeByHash.get(hash) ?? 'dice' };
      });
    const { sprite } = await buildSprite(entries);
    expect(sprite.length).toBeLessThanOrEqual(400 * 1024);
  });
});

describe('buildTreeDataWith（瀏覽器可用版）', () => {
  it('注入 linkedom 時與 tools 版 buildTreeData 產生完全相同的 TreeData', () => {
    const svgText = readFileSync('data/dice-tree.svg', 'utf8');
    const opts = {
      keywords: JSON.parse(readFileSync('data/keywords.json', 'utf8')),
      unlockExceptions: JSON.parse(readFileSync('data/unlock-exceptions.json', 'utf8')),
      spriteIndex: {} as Record<string, [number, number, number, number]>,
      spriteSize: [1, 1] as [number, number],
    };
    const a = buildTreeData(svgText, opts);
    const b = buildTreeDataWith(svgText, opts, loadSvg);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(b.nodes.length).toBe(239);
    expect(b.meta.totalUnlockCost).toEqual({ core: 1772, gold: 6662000 });
  });
});

describe('編輯器資料產出', () => {
  it('build:data 後 public/data/ 有編輯器需要的四個檔案且內容與正本一致', () => {
    // 這支測試假設已經跑過 npm run build:data（vitest 的 pretest 會自動跑）
    expect(readFileSync('public/data/dice-tree.svg', 'utf8')).toBe(readFileSync('data/dice-tree.svg', 'utf8'));
    expect(readFileSync('public/data/keywords.json', 'utf8')).toBe(readFileSync('data/keywords.json', 'utf8'));
    expect(readFileSync('public/data/unlock-exceptions.json', 'utf8')).toBe(readFileSync('data/unlock-exceptions.json', 'utf8'));
    const hashes = JSON.parse(readFileSync('public/data/icon-hashes.json', 'utf8')) as string[];
    expect(hashes.length).toBe(202);
    expect(hashes.every(h => /^[0-9a-f]{12}$/.test(h))).toBe(true);
  });
});
