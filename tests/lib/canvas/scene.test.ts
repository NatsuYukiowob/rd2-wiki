import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildScene } from '../../../src/lib/canvas/scene';
import type { TreeData } from '../../../src/lib/types';
const data = JSON.parse(readFileSync('src/generated/tree.json', 'utf8')) as TreeData;

describe('buildScene（真實資料）', () => {
  const scene = buildScene(data);
  it('節點與邊的數量等於 tree.json', () => {
    expect(scene.nodes).toHaveLength(data.nodes.length);
    expect(scene.edges).toHaveLength(data.edges.length);
  });
  it('每顆節點都對得到 sprite 格', () => {
    expect(scene.nodes.filter(n => n.cell === null)).toEqual([]);
  });
  it('骰子與支援的標籤常駐，符文與被動不常駐', () => {
    const always = scene.nodes.filter(n => n.labelAlways).map(n => n.type);
    expect(new Set(always)).toEqual(new Set(['dice', 'support']));
  });
  // 1001 火骰子的 unlockVia 是 'default'（data/unlock-exceptions.json 的初始解鎖節點），
  // formatUnlockVia() 對它回傳 unlockNote 而非成本字串；改用 1002 尖刺骰子（unlockVia 'cost'）
  // 才是「名稱，類型，成本」三段格式的代表樣本。
  it('aria-label 是「名稱，類型，成本」三段', () => {
    expect(scene.byId.get('1002')!.ariaLabel).toBe('尖刺骰子，骰子，核心 8');
  });
  it('可跳過前置的入邊標成 bypassable，而且只有那兩條', () => {
    expect(scene.edges.filter(e => e.bypassable).map(e => e.to).sort()).toEqual(['5006', '5008']);
  });
});
