import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { renderTree } from '../../src/lib/render';
import type { TreeData } from '../../src/lib/types';

const data: TreeData = JSON.parse(readFileSync('src/generated/tree.json', 'utf8'));

describe('renderTree', () => {
  const { document } = parseHTML('<html><body></body></html>');
  const svg = renderTree(data, document as unknown as Document);

  it('產生 239 個節點與 248 條邊', () => {
    expect(svg.querySelectorAll('g.node')).toHaveLength(239);
    expect(svg.querySelectorAll('line.edge')).toHaveLength(248);
  });
  it('節點帶有 data-id / data-branch / data-type 供篩選使用', () => {
    const n = svg.querySelector('g.node[data-id="1001"]')!;
    expect(n.getAttribute('data-branch')).toBe('nature');
    expect(n.getAttribute('data-type')).toBe('dice');
  });
  it('節點可被鍵盤聚焦且有無障礙標籤', () => {
    const n = svg.querySelector('g.node[data-id="1001"]')!;
    expect(n.getAttribute('tabindex')).toBe('0');
    expect(n.getAttribute('aria-label')).toContain('火骰子');
  });
  it('aria-label 的成本文字改用 formatUnlockVia()，核心與金幣同時有值時兩者都要唸出來（不是只有 formatCost 修過的面板，這裡是第二條沒跟著修的路徑）', () => {
    // 節點 1301「火焰射程增加」：核心 10、金幣 10,000 同時有值。舊版寫法
    // `core>0 ? 核心... : 金幣...` 會整個吃掉金幣，只剩「核心 10」。
    const n = svg.querySelector('g.node[data-id="1301"]')!;
    const label = n.getAttribute('aria-label') ?? '';
    expect(label).toContain('核心 10');
    expect(label).toContain('金幣 10,000');
  });
  it('任務／預設解鎖節點的 aria-label 不能暗示玩家可以花核心買到（4008 任務解鎖、2001 預設解鎖）', () => {
    const quest = svg.querySelector('g.node[data-id="4008"]')!;
    const byDefault = svg.querySelector('g.node[data-id="2001"]')!;
    expect(quest.getAttribute('aria-label')).toContain('任務解鎖');
    expect(quest.getAttribute('aria-label')).not.toContain('核心 8');
    expect(byDefault.getAttribute('aria-label')).toContain('預設解鎖');
    expect(byDefault.getAttribute('aria-label')).not.toContain('核心 5');
  });
  it('每個節點都有 <title> 子元素供瀏覽器原生 hover tooltip 使用（spec §6.2 第 2 點）', () => {
    const n = svg.querySelector('g.node[data-id="1001"]')!;
    const title = n.querySelector('title');
    expect(title).not.toBeNull();
    // name「火骰子」(3) ＋ description 第一行（21 字，沒有 \n）＝ 24 字，剛好不超過上限，
    // 不截斷、不加 …。
    expect(title!.textContent).toBe('火骰子基本攻擊擊中時，對目標周遭怪物額外造成傷害');
  });
  it('tooltip 超過 24 字時用 … 截斷（節點 1202 name＋description 第一行合計 29 字）', () => {
    const n = svg.querySelector('g.node[data-id="1202"]')!;
    const title = n.querySelector('title')!;
    expect(title.textContent).toHaveLength(25); // 24 字內容 + 1 個 …
    expect(title.textContent!.endsWith('…')).toBe(true);
    expect(title.textContent).toBe('尖刺+3產生#尖刺時，20%(+1.2%)機率額…');
  });
  it('邊記錄前置與後繼，供高亮使用', () => {
    const e = svg.querySelector('line.edge')!;
    expect(e.getAttribute('data-from')).toMatch(/^\d{4}$/);
    expect(e.getAttribute('data-to')).toMatch(/^\d{4}$/);
  });
  it('所有節點都在單一可平移的根 g 之下', () => {
    expect(svg.querySelectorAll('g#viewport > g.node')).toHaveLength(239);
  });

  // 以下幾條是 task-18 bug 修正後補的：圖示裁切經過兩輪嘗試（巢狀 svg + viewBox → <g
  // clip-path>），最後改成「<rect fill="url(#pattern)">」，見 render.ts 開頭的說明——理由
  // 是 Chromium 算 getBoundingClientRect() 時完全不考慮任何裁剪機制（viewBox／clip-path／
  // overflow 都一樣），只要節點底下還放著一張完整未裁切的 sprite <image>，不管外面包幾層
  // 裁剪，量出來的還是那張整圖的幾何框；<rect> 的幾何只看自己的 x/y/width/height，
  // 不受 fill 裡貼的圖案（這裡是 sprite 裁出來的一格）影響，才是真的修好。
  it('<defs> 底下每個「用到的圖示」各有一個 pattern（202 種不重複圖示，不是 239 個節點各自一個）', () => {
    const uniqueIcons = new Set(data.nodes.map(n => n.icon));
    const patterns = svg.querySelectorAll('defs > pattern');
    expect(patterns).toHaveLength(uniqueIcons.size);
    expect(patterns.length).toBeLessThan(data.nodes.length); // 202 < 239，確認真的有共用
  });
  it('節點圖示是貼了 pattern 的 <rect>，不是巢狀 <svg> 或 <g clip-path>；x/y/width/height 就是顯示尺寸', () => {
    const node = data.nodes.find(n => n.id === '1001')!;
    const icon = svg.querySelector<SVGRectElement>('g.node[data-id="1001"] > rect.icon')!;
    expect(icon).not.toBeNull();
    expect(icon.tagName.toLowerCase()).toBe('rect');
    expect(icon.getAttribute('x')).toBe(String(-node.size[0] / 2));
    expect(icon.getAttribute('y')).toBe(String(-node.size[1] / 2));
    expect(icon.getAttribute('width')).toBe(String(node.size[0]));
    expect(icon.getAttribute('height')).toBe(String(node.size[1]));
    expect(icon.getAttribute('fill')).toBe(`url(#icon-pattern-${node.icon})`);
    expect(icon.getAttribute('data-icon')).toBe(node.icon);
  });
  it('pattern 自己的 x/y 跟參照它的 <rect> 對齊（-w/2, -h/2），tile 邊界不會落在圖示中間', () => {
    // 圖示破圖的真實 bug（截圖比對才發現，統計顏色數量的自動化檢查測不出來）：pattern 沒有
    // 自己設 x/y 時預設是 0，但 <rect> 是用 x=-w/2 定位，跟 tile 邊界差半個 tile
    // （-w/2 對 tile 寬度 w 取餘數是 w/2，不是 0），每個圖示會從正中央被切開、跟旁邊的
    // tile 鏡射拼接。這裡驗證 pattern 的 x/y 有跟著往負方向位移半個 tile，對齊 rect 自己
    // 的位置。
    const node = data.nodes.find(n => n.id === '1001')!;
    const icon = svg.querySelector<SVGRectElement>('g.node[data-id="1001"] > rect.icon')!;
    const pattern = svg.querySelector(`defs > pattern#icon-pattern-${node.icon}`)!;
    expect(pattern.getAttribute('x')).toBe(icon.getAttribute('x'));
    expect(pattern.getAttribute('y')).toBe(icon.getAttribute('y'));
    expect(pattern.getAttribute('x')).toBe(String(-node.size[0] / 2));
    expect(pattern.getAttribute('y')).toBe(String(-node.size[1] / 2));
  });
  it('pattern 的 tile 尺寸跟該圖示的顯示尺寸一致，pattern 裡的 image 位移量把 sprite 格子左上角對齊 pattern 原點', () => {
    const node = data.nodes.find(n => n.id === '1001')!;
    const cell = data.meta.sprite.index[node.icon]!;
    const pattern = svg.querySelector(`defs > pattern#icon-pattern-${node.icon}`)!;
    expect(pattern.getAttribute('width')).toBe(String(cell[2]));
    expect(pattern.getAttribute('height')).toBe(String(cell[3]));
    expect(pattern.getAttribute('patternUnits')).toBe('userSpaceOnUse');

    const img = pattern.querySelector<SVGImageElement>('image')!;
    expect(img.getAttribute('x')).toBe(String(-cell[0]));
    expect(img.getAttribute('y')).toBe(String(-cell[1]));
  });
  it('多個節點共用同一個圖示雜湊時，只會產生一個 pattern（不重複產生）', () => {
    // 找一個真的被多個節點共用的圖示（見 tools/build-data.test.ts 已知有這種重複）。
    const counts = new Map<string, number>();
    for (const n of data.nodes) counts.set(n.icon, (counts.get(n.icon) ?? 0) + 1);
    const shared = [...counts.entries()].find(([, count]) => count > 1);
    expect(shared).toBeDefined(); // 前提：測試資料裡真的有共用圖示，不然這條測試沒有意義
    const [icon] = shared!;
    expect(svg.querySelectorAll(`defs > pattern#icon-pattern-${icon}`)).toHaveLength(1);
  });
});
