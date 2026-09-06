import { describe, it, expect, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { buildScene } from '../../../src/lib/canvas/scene';
import { mountNodeButtons } from '../../../src/lib/canvas/a11y';
import type { TreeData } from '../../../src/lib/types';
const scene = buildScene(JSON.parse(readFileSync('src/generated/tree.json', 'utf8')) as TreeData);

// linkedom 沒有可用的 KeyboardEvent 建構子（建得出來也沒有 key），
// 用 Event 手動掛一個 key 屬性頂替，斷言標的不變：defaultPrevented 與呼叫次數。
function keydown(document: Document, key: string): Event & { key: string } {
  const ev = new (document.defaultView as unknown as { Event: typeof Event }).Event('keydown', { cancelable: true }) as Event & { key: string };
  Object.defineProperty(ev, 'key', { value: key });
  return ev;
}

describe('mountNodeButtons', () => {
  it('每顆節點一顆 button，data-id 與 aria-label 對得上，數量雙射', () => {
    const { document } = parseHTML('<div id="host"></div>');
    const host = document.getElementById('host') as HTMLElement;
    const { byId, list } = mountNodeButtons(document, host, scene, { onFocus: vi.fn(), onBlur: vi.fn(), onActivate: vi.fn() });
    expect(byId.size).toBe(scene.nodes.length);
    expect(list.querySelectorAll('button')).toHaveLength(scene.nodes.length);
    expect(byId.get('1001')!.getAttribute('aria-label')).toBe(scene.byId.get('1001')!.ariaLabel);
    expect(list.getAttribute('hidden')).toBeNull();        // 不能 hidden：會退出 Tab 順序
  });
  it('Enter／Space 觸發 onActivate 並 preventDefault；方向鍵不攔', () => {
    const { document } = parseHTML('<div id="host"></div>');
    const onActivate = vi.fn();
    const { byId } = mountNodeButtons(document, document.getElementById('host') as HTMLElement, scene, { onFocus: vi.fn(), onBlur: vi.fn(), onActivate });
    const btn = byId.get('1201')!;
    for (const key of ['Enter', ' ']) { const ev = keydown(document, key); btn.dispatchEvent(ev); expect(ev.defaultPrevented).toBe(true); }
    expect(onActivate).toHaveBeenCalledTimes(2); expect(onActivate).toHaveBeenLastCalledWith('1201');
    const arrow = keydown(document, 'ArrowLeft'); btn.dispatchEvent(arrow);
    expect(arrow.defaultPrevented).toBe(false);
  });
});

// ── 高對比模式的視覺契約（I1，2026-09-06 最終審查）─────────────────────────────
// 這份清單平常被 `clip-path` 裁到 1px，只有 `forced-colors: active` 下才需要現形——
// 但 canvas 的像素不會被高對比重新著色，那張樹本來就看得見，**整份 241 顆現形等於
// 用自己的無障礙備援把畫面蓋掉**（<ul> 是 #canvas-host 裡的 absolute 元素，241 個
// <li> 每個都帶可見文字，總高約 3,800px，被 host 裁到剛好蓋滿可視區）。
// 規則因此是：容器永遠不撐開，只有拿到焦點的那一顆現形。
// linkedom 沒有樣式引擎、E2E 也沒有 forced-colors project，所以直接讀 CSS 釘住。
describe('canvas.css 的 forced-colors 區塊', () => {
  const css = readFileSync('src/styles/canvas.css', 'utf8');
  const block = /@media \(forced-colors: active\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
  /** 從區塊裡挑出某個選擇器那一條規則的宣告本體（找不到回空字串）。 */
  const rule = (sel: string): string => {
    const i = block.indexOf(`\n  ${sel} {`);
    if (i < 0) return '';
    const from = block.indexOf('{', i) + 1;
    return block.slice(from, block.indexOf('\n  }', from));
  };

  it('存在，且保留 pointer-events: none（Ruling M：現形的元素不可以吃掉畫布點擊）', () => {
    expect(block).not.toBe('');
    expect(rule('.tree-a11y')).toMatch(/pointer-events:\s*none/);
  });
  it('容器不撐開成 241 行：.tree-a11y 不得拿回 auto 的高度', () => {
    expect(rule('.tree-a11y')).not.toMatch(/height:\s*auto/);
  });
  it('只有拿到焦點的那一顆現形（:focus-within），而且它自己解除裁切', () => {
    const focused = rule('.tree-a11y li:focus-within');
    expect(focused).toMatch(/clip-path:\s*none/);
    expect(focused).toMatch(/width:\s*auto/);
    // 高對比配色只吃系統顏色關鍵字，寫死的十六進位色在那個模式下會被整個換掉。
    expect(focused).toMatch(/background:\s*Canvas\b/);
    expect(focused).toMatch(/color:\s*CanvasText\b/);
  });
});
