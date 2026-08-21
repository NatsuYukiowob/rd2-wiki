import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { renderDetail, termViewHtml, awakeningViewHtml } from '../../src/components/NodeDetail';
import { computeSelection } from '../../src/lib/selection';
import { formatCost } from '../../src/lib/format';
import type { TreeData } from '../../src/lib/types';

const data: TreeData = JSON.parse(readFileSync('src/generated/tree.json', 'utf8'));
const byId = new Map(data.nodes.map(n => [n.id, n]));

function renderNode(id: string) {
  const { document } = parseHTML('<html><body><div id="detail"></div></body></html>');
  const host = document.getElementById('detail') as unknown as HTMLElement;
  const node = byId.get(id);
  if (!node) throw new Error(`測試資料中找不到節點 ${id}`);
  const sel = computeSelection(id, data);
  renderDetail(node, sel, host, data.meta.glossary, data.meta.upgradeCostTable);
  return { host, node, sel };
}

describe('視圖：節點頁', () => {
  it('關鍵字是可聚焦的按鈕、帶遊戲內底色與詞條 id（點下去換頁，不是靠 hover tooltip）', () => {
    const { host } = renderNode('4008');
    const kw = host.querySelector('.kw') as HTMLElement;
    expect(kw.tagName).toBe('BUTTON');
    expect(kw.textContent).toBe('#陰陽');
    expect(kw.getAttribute('data-term')).toBe('陰陽');
    expect(kw.getAttribute('style')).toContain(data.meta.glossary['陰陽']!.color);
  });

  it('節點頁不再攤平解釋清單——那些內容移到各自的關鍵字頁', () => {
    const { host } = renderNode('5004');
    expect(host.querySelector('.glossary')).toBeNull();
    expect(host.querySelectorAll('.kw')).toHaveLength(1);
  });

  it('骰子只留一列覺醒入口，內容在覺醒頁；非骰子沒有這一列', () => {
    const { host, node } = renderNode('1003');
    expect(node.awakening).toBe('達到7骰點時爆炸\n於骰盤上隨機格子發射7個#播種');
    const link = host.querySelector('.awakening-link') as HTMLElement;
    expect(link.tagName).toBe('BUTTON');
    expect(link.hasAttribute('data-detail-awakening')).toBe(true);
    expect(link.querySelector('.cond')?.textContent).toBe('7 骰點時啟用');
    // 入口列只是入口，不該把覺醒全文也印上去
    expect(host.textContent).not.toContain('於骰盤上隨機格子發射');

    expect(renderNode('1101').host.querySelector('.awakening-link')).toBeNull();
  });

  it('根視圖有 ✕ 沒有 ←（它是堆疊最底層）', () => {
    const { host } = renderNode('1001');
    expect(host.querySelector('[data-detail-close]')).not.toBeNull();
    expect(host.querySelector('[data-detail-back]')).toBeNull();
  });
});

describe('視圖：關鍵字頁與覺醒頁', () => {
  it('關鍵字頁顯示解釋、帶返回與搜尋按鈕', () => {
    const { document } = parseHTML('<html><body><div id="h"></div></body></html>');
    const host = document.getElementById('h') as unknown as HTMLElement;
    host.innerHTML = termViewHtml('破滅', data.meta.glossary);
    expect(host.querySelector('h2')?.textContent).toBe('#破滅');
    expect(host.querySelector('.desc')?.textContent).toBe(data.meta.glossary['破滅']!.desc);
    expect(host.querySelector('[data-detail-back]')).not.toBeNull();
    const search = host.querySelector('[data-detail-search]') as HTMLElement;
    expect(search.getAttribute('data-detail-search')).toBe('破滅');
    expect(search.textContent).toBe('搜尋 #破滅');
  });

  it('關鍵字頁裡的巢狀關鍵字照樣可點——這就是取代常駐清單的理由', () => {
    const { document } = parseHTML('<html><body><div id="h"></div></body></html>');
    const host = document.getElementById('h') as unknown as HTMLElement;
    host.innerHTML = termViewHtml('破滅', data.meta.glossary);
    expect([...host.querySelectorAll('.desc .kw')].map(e => e.getAttribute('data-term')))
      .toEqual(['一般怪物', '菁英怪物']);
  });

  it('詞彙表查不到的詞不會渲染出一張空白卡片', () => {
    const { document } = parseHTML('<html><body><div id="h"></div></body></html>');
    const host = document.getElementById('h') as unknown as HTMLElement;
    host.innerHTML = termViewHtml('根本沒這個詞', data.meta.glossary);
    expect(host.querySelector('.warn')?.textContent).toBe('這個詞不在詞彙表裡');
    expect(host.querySelector('[data-detail-search]')).toBeNull();
  });

  it('覺醒頁：標題、所屬骰子與啟用條件、換行與關鍵字都在', () => {
    const { document } = parseHTML('<html><body><div id="h"></div></body></html>');
    const host = document.getElementById('h') as unknown as HTMLElement;
    const node = byId.get('1003')!;
    host.innerHTML = awakeningViewHtml(node, data.meta.glossary);
    expect(host.querySelector('h2')?.textContent).toBe('骰子覺醒');
    expect(host.querySelector('.meta')?.textContent).toBe('花骰子 · 7 骰點時啟用');
    expect(host.querySelectorAll('.desc br')).toHaveLength(1);
    expect(host.querySelector('.desc .kw')?.getAttribute('data-term')).toBe('播種');
    expect(host.querySelector('[data-detail-back]')).not.toBeNull();
  });
});

describe('renderDetail', () => {
  it('成本數字放在 .cost class（E2E 依此抓取，見 DOM id 契約）', () => {
    const { host, sel } = renderNode('1002');
    expect(host.querySelector('.cost')?.textContent).toBe(formatCost(sel.cost));
  });

  it('必須出現三段警語：AND 上限值、不含強化費用、重置災情警告', () => {
    const { host } = renderNode('1002');
    const text = host.textContent ?? '';
    expect(text).toContain('此為 AND 假設下的上限值');
    expect(text).toContain('不含強化費用');
    expect(text).toContain('⚠️ 骰子樹重置需要初期化券，且有已解鎖骰子消失的災情回報，重置前請先確認。');
  });

  it('非成本解鎖節點被排除時，面板標示排除數量', () => {
    const { host, sel } = renderNode('4008');
    expect(sel.skipped).toContain('4008');
    expect(host.textContent ?? '').toContain(`已排除 ${sel.skipped.length} 個非成本解鎖節點`);
  });

  it('滿級成長換算會顯示在 .growth', () => {
    // 1201：maxLevel 50、growth { base:20, perLevel:4, unit:'%' }，無 dataIssue。
    const { host } = renderNode('1201');
    expect(host.querySelector('.growth')?.textContent).toBe('1 級 20% → 50 級 216%');
  });

  it('佔位符資料節點顯示待補警告', () => {
    // ⚠️ 用**合成**節點，不是拿真實資料裡剛好有佔位符的那一顆。2026-08-20 起正本裡一個
    // 佔位符都沒有了（描述改成遊戲內實際顯示的文字），綁真實節點的話這條測試會跟著消失，
    // 而這段顯示邏輯還在、上游隨時可能再冒出新的 `{n}`——那時就沒有任何東西守著它。
    const { document } = parseHTML('<html><body><div id="detail"></div></body></html>');
    const host = document.getElementById('detail') as unknown as HTMLElement;
    const node = { ...byId.get('2403')!, dataIssue: 'placeholder' as const };
    renderDetail(node, computeSelection('2403', data), host, data.meta.glossary, data.meta.upgradeCostTable);
    expect(host.querySelector('.warn')?.textContent).toBe('數值待補（遊戲資料含未替換佔位符）');

    // 正本現在沒有佔位符，所以同一顆節點照原樣渲染不該出現警告
    expect(renderNode('2403').host.querySelector('.warn')).toBeNull();
  });

  // 審查回饋（2026-08-17 第 1 輪修正）：unlockVia 為 quest／default 的節點不能在 meta 列
  // 顯示 unlockCost 的金額，否則會暗示玩家能直接花錢買到（實際上只能靠任務／預設取得），
  // 且與下方成本區塊「已排除」的標示自相矛盾。
  it('任務解鎖節點（4008 陰陽骰子）的 meta 列顯示官方取得條件，不顯示成本數字', () => {
    const { host } = renderNode('4008');
    const meta = host.querySelectorAll('.meta')[0]?.textContent ?? '';
    expect(meta).toBe('秩序 · 骰子 · 新手任務 700 點獎勵');
    expect(meta).not.toContain('核心');
    expect(meta).not.toContain('金幣');
  });

  it('預設解鎖節點（2001 鐵甲骰子）的 meta 列顯示官方取得條件，不顯示成本數字', () => {
    const { host } = renderNode('2001');
    const meta = host.querySelectorAll('.meta')[0]?.textContent ?? '';
    expect(meta).toBe('工學 · 骰子 · 初始解鎖');
    expect(meta).not.toContain('核心');
    expect(meta).not.toContain('金幣');
  });

  // 2026-08-21 新增的第三種取得方式。這三顆骰子（合作擊殺數／合作波數／競技場積分）
  // 如果只顯示分類詞「成就解鎖」，玩家看到的三張卡片會一模一樣——差別全在原文裡。
  it('成就解鎖節點（5008 空虛骰子）的 meta 列顯示官方取得條件，不顯示成本數字', () => {
    const { host } = renderNode('5008');
    const meta = host.querySelectorAll('.meta')[0]?.textContent ?? '';
    expect(meta).toBe('渾沌 · 骰子 · 競技場 300 分獎勵');
    expect(meta).not.toContain('核心');
    expect(meta).not.toContain('金幣');
  });

  // unlockNote 是資料檔裡的自由文字，而 renderDetail 是用 innerHTML 塞的。這個 repo 的
  // 威脅模型就是「由社群發 PR 維護」——一個 PR 只要在 unlock-exceptions.json 裡寫一段標記，
  // 就會變成面板上活的 DOM。formatUnlockVia 以前只回得出兩個字面值或數字，所以不必跳脫；
  // 現在不是了。（規則 18 擋長度與型別，擋不住內容。）
  it('unlockNote 帶標記時會被跳脫，不會變成活的 DOM', () => {
    const { document } = parseHTML('<html><body><div id="detail"></div></body></html>');
    const host = document.getElementById('detail') as unknown as HTMLElement;
    const node = { ...byId.get('5008')!, unlockNote: '<img src=x onerror=alert(1)>' };
    renderDetail(node, computeSelection('5008', data), host, data.meta.glossary, data.meta.upgradeCostTable);
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelectorAll('.meta')[0]?.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(host.innerHTML).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('#關鍵字 只框住白名單詞本身，不會把後面整句吃進去（見 spec 異常 8）', () => {
    // 4008 描述：「...該排啟用#陰陽 / 對兩個方向啟用#陰陽效果的骰子發動#極致和諧」
    // 第二個 #陰陽 後面緊接「效果的骰子發動」沒有空白或 #，naive 正規表達式
    // （/#([^\s#]+)/）會把「陰陽效果的骰子發動」整段誤判成關鍵字。
    const { host, node } = renderNode('4008');
    const spans = [...host.querySelectorAll('.desc .kw')].map(el => el.textContent);
    expect(spans).toEqual(['#陰陽', '#陰陽', '#極致和諧']);
    // 完整描述文字（不含 HTML 標籤）必須原封不動保留，不能因為包 span 而漏字或多字。
    const descText = host.querySelector('.desc')?.textContent ?? '';
    expect(descText).toBe(node.description);
  });
});
