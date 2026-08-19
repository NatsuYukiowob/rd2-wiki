import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { visibleNodeIds, upgradeIcons, downgradeIcons, resetFailedIcons } from '../../src/lib/hires';
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

  it('多個節點共用同一個圖示雜湊時，只會建立一個高解析 pattern，不重複建立', () => {
    // 共用同一張圖的那一對節點從資料現找，不寫死 id 與雜湊：圖示是逐節點渲染出來、再依內容
    // 雜湊命名的，遊戲改版重跑一次 tools/render-nodes.ts，哪兩個節點剛好長一樣就會變。
    const byIcon = new Map<string, string[]>();
    for (const n of data.nodes) byIcon.set(n.icon, [...(byIcon.get(n.icon) ?? []), n.id]);
    const shared = [...byIcon.values()].find(ids => ids.length >= 2);
    expect(shared).toBeDefined(); // 前提：真的有節點共用同一張圖，不然這條測試沒有意義
    const [idA, idB] = shared!;

    const svg = renderInto();
    const iconA = iconRect(svg, idA!);
    const iconB = iconRect(svg, idB!);
    const hash = iconA.getAttribute('data-icon')!;
    expect(iconB.getAttribute('data-icon')).toBe(hash);

    upgradeIcons([idA!, idB!], svg);

    expect(svg.querySelectorAll(`defs > pattern#icon-hires-${hash}`)).toHaveLength(1);
    expect(iconA.getAttribute('fill')).toBe(`url(#icon-hires-${hash})`);
    expect(iconB.getAttribute('fill')).toBe(`url(#icon-hires-${hash})`);
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

describe('降級與載入失敗（2026-08-19 review 追加）', () => {
  beforeEach(() => resetFailedIcons());

  it('降級不只換 fill，還要把沒人用的 pattern 從 <defs> 移掉——那才是真的把記憶體還回去', () => {
    const svg = renderInto();
    upgradeIcons(['1001'], svg);
    expect(svg.querySelectorAll('defs > pattern[id^=icon-hires-]')).toHaveLength(1);

    downgradeIcons([...svg.querySelectorAll<SVGRectElement>('rect.icon')], svg);

    expect(svg.querySelectorAll('defs > pattern[id^=icon-hires-]')).toHaveLength(0);
    expect(iconRect(svg, '1001').getAttribute('fill')).toMatch(/icon-pattern-/);
  });

  it('還有節點在用的 pattern 不會被誤刪', () => {
    const svg = renderInto();
    upgradeIcons(['1001', '1002'], svg);
    const first = iconRect(svg, '1001');
    const second = iconRect(svg, '1002');
    // 兩個節點各有各的圖示雜湊時互不影響；只降級第一個，第二個的 pattern 要留著。
    downgradeIcons([first], svg);
    expect(second.getAttribute('fill')).toMatch(/icon-hires-/);
    expect(svg.querySelector(`#icon-hires-${second.getAttribute('data-icon')}`)).not.toBeNull();
  });

  it('沒有 fill 可記的節點不升級——升了就永遠降不回來，連載入失敗都救不了', () => {
    const svg = renderInto();
    const icon = iconRect(svg, '1001');
    icon.removeAttribute('fill');

    upgradeIcons(['1001'], svg);

    expect(icon.dataset.hires).toBeUndefined();
    expect(svg.querySelectorAll('defs > pattern[id^=icon-hires-]')).toHaveLength(0);
  });
});

describe('載入失敗不會變成無限重抓', () => {
  beforeEach(() => resetFailedIcons());

  it('高解析圖載入失敗後：換回 sprite、移除 pattern，而且下一次不再重抓同一張', () => {
    const svg = renderInto();
    upgradeIcons(['1001'], svg);
    const icon = iconRect(svg, '1001');
    const hash = icon.getAttribute('data-icon')!;
    expect(icon.getAttribute('fill')).toBe(`url(#icon-hires-${hash})`);

    // 模擬那張 webp 404（雜湊改了沒重建圖，就是 CLAUDE.md 記過的 render-nodes 事故）。
    // linkedom 的 dispatchEvent 只吃它自己那個 Event 類別，Node 的全域 Event 會在
    // 設定 eventPhase 時炸掉（只有 getter）。從文件的 defaultView 取。
    const LinkedomEvent = (svg.ownerDocument as unknown as { defaultView: { Event: typeof Event } }).defaultView.Event;
    svg.querySelector(`#icon-hires-${hash} image`)!.dispatchEvent(new LinkedomEvent('error'));

    expect(icon.getAttribute('fill')).toMatch(/icon-pattern-/);
    expect(svg.querySelector(`#icon-hires-${hash}`)).toBeNull();

    // 關鍵：再升一次不可以又把它建回來。沒有失敗名單的話，「pattern 不存在」與
    // 「節點沒升級過」兩個條件又同時成立，於是重建 pattern、重發那個 404——使用者每滾一次
    // 滾輪就重演一次，節點還會 sprite→空白→sprite 閃一下。
    upgradeIcons(['1001'], svg);
    expect(svg.querySelector(`#icon-hires-${hash}`)).toBeNull();
    expect(icon.getAttribute('fill')).toMatch(/icon-pattern-/);
  });
});
