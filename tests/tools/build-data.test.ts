import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { buildTreeData } from '../../tools/build-data';
import { buildSprite, type IconEntry } from '../../tools/lib/icons';
import { parseTree } from '../../tools/lib/svg-parse';
import type { NodeTextMap } from '../../tools/lib/node-text';
import type { GlossaryEntry, UpgradeCostTable } from '../../src/lib/types';

const svg = readFileSync('data/dice-tree.svg', 'utf8');
const opts = {
  keywords: JSON.parse(readFileSync('data/keywords.json', 'utf8')) as Record<string, GlossaryEntry>,
  // 正本 SVG 自 2026-08-22（#21）起只剩幾何，文案在這一份；兩邊在 buildTreeData 內依 id 合併。
  nodeText: JSON.parse(readFileSync('data/nodes.json', 'utf8')) as NodeTextMap,
  unlockExceptions: JSON.parse(readFileSync('data/unlock-exceptions.json', 'utf8')) as Record<string, { unlockVia: 'quest' | 'default' | 'achievement'; note?: string }>,
  // ⚠️ 這一項漏了的話，下面那條 20 KB 效能預算斷言量的就不是真正上線的產物：
  // meta.upgradeCostTable 會是 null，少量 292 B gzip，測試綠燈而 CLI 寫出的檔案已經超標。
  upgradeCostTable: JSON.parse(readFileSync('data/upgrade-cost.json', 'utf8')) as UpgradeCostTable,
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
  it('正本目前一個佔位符都沒有，但機制還在（注入一個就會被標記）', () => {
    // 2026-08-20：四個帶 `{n}` 的描述全部改成遊戲內實際顯示的文字（遊戲把沒填值的佔位符
    // 直接渲染成空字串），所以真實資料的佔位符歸零。
    expect(data.nodes.filter(n => n.dataIssue === 'placeholder')).toHaveLength(0);

    // ⚠️ 但偵測機制必須留著——上游隨時可能再冒出新的 `{n}`，這是唯一會提醒我們的東西。
    // 沒有這一段的話，上面那條「等於 0」會變成一個「拿掉整個偵測邏輯也照樣綠」的斷言。
    // #21 之前這裡要同時改 data-description 與 <title>（舊的規則 1 要求兩者逐字相同）；
    // 文案搬進 nodes.json 之後只有一個位置可以改。
    const nodeText = { ...opts.nodeText, '2403': { ...opts.nodeText['2403']!, description: '連接齒輪骰子時，攻擊速度增加5%(+{1}%)' } };
    const rebuilt = buildTreeData(svg, { ...opts, nodeText });
    expect(rebuilt.nodes.filter(n => n.dataIssue === 'placeholder').map(n => n.id)).toEqual(['2403']);
  });
  it('meta.glossary 涵蓋所有節點用到的關鍵字，且不含站台用不到的 code', () => {
    const used = new Set(data.nodes.flatMap(n => n.keywords));
    expect(used.size).toBeGreaterThan(0);
    for (const w of used) expect(data.meta.glossary[w]).toBeDefined();
    for (const entry of Object.values(data.meta.glossary)) {
      expect(entry.desc.length).toBeGreaterThan(0);
      expect(entry.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      // code 只給貢獻者比對遊戲資源檔用，站台一個字都不顯示，不該佔 gzip 預算
      expect(entry).not.toHaveProperty('code');
    }
  });

  it('meta.glossary 含解釋文字自己引用到的詞（傳遞閉包），且 key 已排序', () => {
    // #破滅 的解釋裡寫著「範圍內的#一般怪物暴斃，對#菁英怪物造成…」——#菁英怪物 沒有任何節點
    // 的描述用到，只出現在別的解釋裡。少了這一層閉包，面板上那個標記就查不到東西。
    expect(data.nodes.some(n => n.keywords.includes('菁英怪物'))).toBe(false);
    expect(data.meta.glossary['菁英怪物']).toBeDefined();
    const keys = Object.keys(data.meta.glossary);
    // 插入順序照的是閉包展開的堆疊順序，不排序的話資料沒變 diff 也會整段翻掉
    expect(keys).toEqual([...keys].sort());
  });

  it('41 顆骰子都有覺醒，其他 198 個節點都沒有', () => {
    const withAwakening = data.nodes.filter(n => n.awakening !== undefined);
    expect(withAwakening).toHaveLength(41);
    expect(withAwakening.every(n => n.type === 'dice')).toBe(true);
    expect(withAwakening.every(n => (n.awakening ?? '').length > 0)).toBe(true);
  });

  it('覺醒文字裡的 # 標記也進得了 meta.glossary（含只出現在覺醒裡的別名）', () => {
    // #播種 只出現在花骰子的覺醒、#傳送 只出現在貪婪骰子的覺醒，兩個都不在任何 description 裡
    expect(data.nodes.some(n => n.description.includes('#播種'))).toBe(false);
    expect(data.nodes.find(n => n.id === '1003')!.awakening).toContain('#播種');
    // 別名展開成本尊的解釋，不是自己抄一份
    expect(data.meta.glossary['播種']!.desc).toBe(data.meta.glossary['果實']?.desc ?? '擊中骰子時，對象骰點+1\n擊中空格時，召喚1骰點骰子');
    expect(data.meta.glossary['傳送']!.desc).toBe(data.meta.glossary['SP怪物']!.desc);
  });

  it('70 個玩家被動都有細分類，其他節點都沒有；管理 ID 刻意不進 tree.json', () => {
    const withCat = data.nodes.filter(n => n.category !== undefined);
    expect(withCat).toHaveLength(70);
    expect(withCat.every(n => n.type === 'passive')).toBe(true);
    const counts = withCat.reduce<Record<string, number>>((a, n) => ({ ...a, [n.category!]: (a[n.category!] ?? 0) + 1 }), {});
    expect(counts).toEqual({
      'branch-stat': 25, 'global-stat': 15, 'branch-skill': 15, 'player-passive': 10, 'support-upgrade': 5,
    });
    // data-game-id 是給貢獻者比對遊戲資源檔的，站台不顯示；239 個節點各帶一個字串要吃掉
    // 0.55 KB gzip，而預算只剩 1 KB 出頭。它留在正本裡，不進建置產物。
    expect(data.nodes.every(n => !('gameId' in n))).toBe(true);
  });

  it('支援節點的 branch 跟著 id 首碼，element 為 support', () => {
    const n = data.nodes.find(x => x.id === '1114')!;
    expect(n.branch).toBe('nature');
    expect(n.element).toBe('support');
  });
  it('meta.center 帶出中央樞紐：連線就是五顆起手骰、圖換成建置期輸出的 WebP 網址', () => {
    const c = data.meta.center!;
    expect(c).not.toBeNull();
    // 樞紐畫的是「五顆起手骰從樹心長出來」，連線集合與 meta.roots 必須是同一組
    expect([...c.links].sort()).toEqual(data.meta.roots);
    // 正本存 PNG、站台載 WebP：網址是從正本的 href 換副檔名推導的，不是另外寫死一份檔名。
    // 建置期轉檔用的也是同一個字串（見 build-data.ts 的 CLI 區塊），兩邊各寫一份的話，
    // 改了 href 就會變成「轉出舊圖、tree.json 指向新網址」，樞紐靜靜地變成 404 破圖。
    const svgHref = /<image href="([^"]+)"[^>]*\/>\s*<text class="tree-center-label"/.exec(
      readFileSync('data/dice-tree.svg', 'utf8'),
    )![1]!;
    expect(c.url).toBe(`/assets/${svgHref.replace(/\.png$/, '.webp')}`);
    expect(c.size[0]).toBeGreaterThan(0);
    expect(c.size[1]).toBeGreaterThan(0);
  });

  it('樞紐不佔節點名額：nodes 裡沒有它，成本總和也不含它', () => {
    const c = data.meta.center!;
    expect(data.nodes.some(n => n.x === c.x && n.y === c.y)).toBe(false);
    expect(data.nodes).toHaveLength(239);
  });

  it('gzip 後符合效能預算（≤ 20 KB）', () => {
    expect(gzipSync(Buffer.from(JSON.stringify(data))).length).toBeLessThanOrEqual(20 * 1024);
  });

  // ⚠️ 上面那條量的是這支測試自己組出來的產物，而它的 spriteIndex 是 238 筆全同值 [0,0,48,52]
  // 的替身——全同值壓得比真實座標好，量出來的數字比實際上線的小（實測差約 0.5 KB）。
  // 餘裕只剩 1 KB 的現在，那個差距足以讓「本機全綠、CI 的硬斷言爆掉」。
  // 這一條直接量 `pretest` 用 CLI 寫出來的那份檔案，也就是真正會被下載的位元組。
  it('CLI 實際寫出的 src/generated/tree.json 也符合預算（替身 spriteIndex 會低估）', () => {
    const shipped = gzipSync(readFileSync('src/generated/tree.json')).length;
    expect(shipped).toBeLessThanOrEqual(20 * 1024);
    // 替身版本不得反過來比實際大，否則上面那條就不是「寬鬆版」而是另一個數字
    expect(gzipSync(Buffer.from(JSON.stringify(data))).length).toBeLessThanOrEqual(shipped);
  });
  // 追加 1：spec §11 的 sprite 400 KB 預算，過去只有 CLI（build-data.ts 的 CLI 區塊）在檢查、
  // 本機跑 `npm test` 抓不到；這裡用 data/icons/ 的真實圖示組出真正的 sprite（不是替身
  // spriteIndex），量測結果才跟 CLI 一致。
  it('data/icons/ 真實圖示組出的 sprite 符合效能預算（≤ 400 KB）', async () => {
    const { nodes: rawNodes } = parseTree(svg);
    const sizeByHash = new Map(rawNodes.map(n => [n.icon, n.size]));
    const entries: IconEntry[] = readdirSync('data/icons')
      .filter(f => f.endsWith('.png'))
      .map(f => {
        const hash = f.replace('.png', '');
        return { hash, buf: readFileSync(`data/icons/${f}`), size: sizeByHash.get(hash) ?? ([48, 52] as [number, number]) };
      });
    const { sprite } = await buildSprite(entries);
    expect(sprite.length).toBeLessThanOrEqual(400 * 1024);
  });
});
