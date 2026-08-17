import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { renderDetail } from '../../src/components/NodeDetail';
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
  renderDetail(node, sel, host);
  return { host, node, sel };
}

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

  it('任務／預設解鎖節點被排除時，面板標示排除數量', () => {
    const { host, sel } = renderNode('4008');
    expect(sel.skipped).toContain('4008');
    expect(host.textContent ?? '').toContain(`已排除 ${sel.skipped.length} 個任務／預設解鎖節點`);
  });

  it('滿級成長換算會顯示在 .growth', () => {
    // 1201：maxLevel 50、growth { base:20, perLevel:4, unit:'%' }，無 dataIssue。
    const { host } = renderNode('1201');
    expect(host.querySelector('.growth')?.textContent).toBe('1 級 20% → 50 級 216%');
  });

  it('佔位符資料節點顯示待補警告', () => {
    // 2403：dataIssue 為 'placeholder'（描述含未替換的 {1}）。
    const { host } = renderNode('2403');
    expect(host.querySelector('.warn')?.textContent).toBe('數值待補（遊戲資料含未替換佔位符）');
  });

  // 審查回饋（2026-08-17 第 1 輪修正）：unlockVia 為 quest／default 的節點不能在 meta 列
  // 顯示 unlockCost 的金額，否則會暗示玩家能直接花錢買到（實際上只能靠任務／預設取得），
  // 且與下方成本區塊「已排除」的標示自相矛盾。
  it('任務解鎖節點（4008 陰陽骰子）的 meta 列顯示「任務解鎖」，不顯示成本數字', () => {
    const { host } = renderNode('4008');
    const meta = host.querySelectorAll('.meta')[0]?.textContent ?? '';
    expect(meta).toBe('秩序 · 骰子 · 任務解鎖');
    expect(meta).not.toContain('核心');
    expect(meta).not.toContain('金幣');
  });

  it('預設解鎖節點（2001 鐵甲骰子）的 meta 列顯示「預設解鎖」，不顯示成本數字', () => {
    const { host } = renderNode('2001');
    const meta = host.querySelectorAll('.meta')[0]?.textContent ?? '';
    expect(meta).toBe('工學 · 骰子 · 預設解鎖');
    expect(meta).not.toContain('核心');
    expect(meta).not.toContain('金幣');
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
