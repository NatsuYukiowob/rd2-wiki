import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { visibleNodeIds, upgradeIcons } from '../../src/lib/hires';
import { renderTree } from '../../src/lib/render';
import type { TreeData } from '../../src/lib/types';

const data: TreeData = JSON.parse(readFileSync('src/generated/tree.json', 'utf8'));

describe('visibleNodeIds', () => {
  it('只回傳落在指定矩形內的節點', () => {
    // 矩形以節點 1001 的實際座標為中心現算，不寫死——版面一改，寫死的矩形就會落在空白處，
    // 測試變成「空集合不含 1001」的假紅（或更糟：改成含別的節點時假綠）。
    const root = data.nodes.find(n => n.id === '1001')!;
    const ids = visibleNodeIds(data, { x: root.x - 50, y: root.y - 50, w: 100, h: 100 });
    expect(ids).toContain('1001');
    expect(ids.length).toBeLessThan(data.nodes.length);
  });
  it('整張畫布時回傳全部', () => {
    const [vx, vy, vw, vh] = data.meta.viewBox;
    expect(visibleNodeIds(data, { x: vx, y: vy, w: vw, h: vh })).toHaveLength(data.nodes.length);
  });
});

/** 用真正的 renderTree() 建一份完整 SVG DOM 給 upgradeIcons() 操作，而不是手刻一份簡化
 * 結構——理由跟 render.test.ts 一樣：只有這樣才能保證測的是「upgradeIcons 跟 render.ts
 * 產生的實際 DOM 結構真的對得上」，不是自己假設一份跟正式輸出可能不一致的結構。 */
function renderInto() {
  const { document } = parseHTML('<html><body></body></html>');
  const svg = renderTree(data, document as unknown as Document);
  return svg;
}

function iconRect(svg: SVGSVGElement, id: string): SVGRectElement {
  return svg.querySelector<SVGRectElement>(`g.node[data-id="${id}"] > rect.icon`)!;
}

describe('upgradeIcons', () => {
  it('把 rect 的 fill 換成指到高解析 pattern（不是 sprite pattern），rect 本身的 x/y/width/height 完全不變', () => {
    const svg = renderInto();
    const node = data.nodes.find(n => n.id === '1001')!;
    const icon = iconRect(svg, '1001');
    const hash = icon.getAttribute('data-icon')!;
    expect(hash).toBeTruthy();
    expect(icon.getAttribute('fill')).toBe(`url(#icon-pattern-${hash})`); // 升級前：sprite pattern

    const xBefore = icon.getAttribute('x');
    const yBefore = icon.getAttribute('y');
    const wBefore = icon.getAttribute('width');
    const hBefore = icon.getAttribute('height');

    upgradeIcons(['1001'], svg);

    expect(icon.getAttribute('fill')).toBe(`url(#icon-hires-${hash})`);
    // rect 自己的幾何完全不動——這正是這個設計的重點：bbox 正確性從一開始就跟 fill 內容
    // 無關，升級高解析圖示不需要、也不會影響 x/y/width/height。
    expect(icon.getAttribute('x')).toBe(xBefore);
    expect(icon.getAttribute('y')).toBe(yBefore);
    expect(icon.getAttribute('width')).toBe(wBefore);
    expect(icon.getAttribute('height')).toBe(hBefore);
    expect(icon.getAttribute('width')).toBe(String(node.size[0]));
    expect(icon.getAttribute('height')).toBe(String(node.size[1]));
  });

  it('高解析 pattern 裡的 image href 指到 base/hash.webp，尺寸跟節點顯示尺寸一致（圖本身已經是裁好的單張圖，不需要位移）', () => {
    const svg = renderInto();
    const node = data.nodes.find(n => n.id === '1001')!;
    const icon = iconRect(svg, '1001');
    const hash = icon.getAttribute('data-icon')!;

    upgradeIcons(['1001'], svg);

    const pattern = svg.querySelector(`defs > pattern#icon-hires-${hash}`)!;
    expect(pattern).not.toBeNull();
    expect(pattern.getAttribute('width')).toBe(String(node.size[0]));
    expect(pattern.getAttribute('height')).toBe(String(node.size[1]));
    const img = pattern.querySelector<SVGImageElement>('image')!;
    expect(img.getAttribute('href')).toBe(`/assets/icons/${hash}.webp`);
    expect(img.getAttribute('width')).toBe(String(node.size[0]));
    expect(img.getAttribute('height')).toBe(String(node.size[1]));
  });

  it('高解析 pattern 的 x/y 跟 <rect> 自己的 x/y 對齊，不會讓圖示從中間裂開拼接（跟 render.ts 的 sprite pattern 同一個修正）', () => {
    const svg = renderInto();
    const icon = iconRect(svg, '1001');
    const hash = icon.getAttribute('data-icon')!;
    const rectX = icon.getAttribute('x');
    const rectY = icon.getAttribute('y');

    upgradeIcons(['1001'], svg);

    const pattern = svg.querySelector(`defs > pattern#icon-hires-${hash}`)!;
    expect(pattern.getAttribute('x')).toBe(rectX);
    expect(pattern.getAttribute('y')).toBe(rectY);
  });

  it('同一個節點只升級一次：第二次呼叫不重複改寫（用 data-hires 記錄）', () => {
    const svg = renderInto();
    const icon = iconRect(svg, '1001');
    upgradeIcons(['1001'], svg);
    const fillAfterFirst = icon.getAttribute('fill');
    expect(icon.dataset.hires).toBe('1');

    // 故意把 fill 改掉，確認第二次呼叫不會再跑進 if 區塊把它蓋回去。
    icon.setAttribute('fill', 'url(#should-not-change)');
    upgradeIcons(['1001'], svg);
    expect(icon.getAttribute('fill')).toBe('url(#should-not-change)');
    expect(icon.getAttribute('fill')).not.toBe(fillAfterFirst);
  });

  it('多個節點共用同一個圖示雜湊時，只會建立一個高解析 pattern，不重複建立（1101/1110 共用 a5caff6da1d2）', () => {
    const svg = renderInto();
    const icon1101 = iconRect(svg, '1101');
    const icon1110 = iconRect(svg, '1110');
    const hash = icon1101.getAttribute('data-icon')!;
    expect(icon1110.getAttribute('data-icon')).toBe(hash); // 前提：測試資料真的共用同一張圖，不然這條測試沒有意義

    upgradeIcons(['1101', '1110'], svg);

    expect(svg.querySelectorAll(`defs > pattern#icon-hires-${hash}`)).toHaveLength(1);
    expect(icon1101.getAttribute('fill')).toBe(`url(#icon-hires-${hash})`);
    expect(icon1110.getAttribute('fill')).toBe(`url(#icon-hires-${hash})`);
  });

  it('對不存在的節點 id 不拋錯，靜默略過', () => {
    const svg = renderInto();
    expect(() => upgradeIcons(['not-a-real-id'], svg)).not.toThrow();
  });

  it('base 參數可自訂圖示路徑前綴', () => {
    const svg = renderInto();
    const icon = iconRect(svg, '1001');
    const hash = icon.getAttribute('data-icon')!;
    upgradeIcons(['1001'], svg, '/custom/base');
    const pattern = svg.querySelector(`defs > pattern#icon-hires-${hash}`)!;
    const img = pattern.querySelector<SVGImageElement>('image')!;
    expect(img.getAttribute('href')).toBe(`/custom/base/${hash}.webp`);
  });
});
