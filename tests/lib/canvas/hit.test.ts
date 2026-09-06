// tests/lib/canvas/hit.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildScene } from '../../../src/lib/canvas/scene';
import { buildHitIndex, hitTest } from '../../../src/lib/canvas/hit';
import type { Scene, SceneNode } from '../../../src/lib/canvas/scene';
import type { TreeData } from '../../../src/lib/types';

const scene = buildScene(JSON.parse(readFileSync('src/generated/tree.json', 'utf8')) as TreeData);
const index = buildHitIndex(scene);

describe('hitTest（真實資料）', () => {
  it('每顆節點的中心點打到的是它自己', () => {
    const wrong = scene.nodes.filter(n => hitTest(index, n.x, n.y) !== n.id).map(n => n.id);
    expect(wrong).toEqual([]);
  });
  it('節點框外 1 單位打不到；空白處回 null', () => {
    const n = scene.byId.get('1001')!;
    expect(hitTest(index, n.x + n.w / 2 + 1, n.y)).not.toBe('1001');
    expect(hitTest(index, -500, -500)).toBeNull();
  });
});

// 真實資料裡沒有一顆節點同時橫跨 x 與 y 兩條格線（節點 1001 的 x 範圍 [975,1025] floor 後兩端都是
// 第 12 格，並沒有真的跨格；會跨格的是它的 y），測「跨格塞進每一格」不能靠 tree.json 現成的座標，
// 得自己搭合成 Scene。buildHitIndex／hitTest 只讀 SceneNode 的 id/x/y/w/h，其餘欄位用型別斷言略過。
function makeNode(id: string, x: number, y: number, w: number, h: number): SceneNode {
  return { id, x, y, w, h } as unknown as SceneNode;
}
function makeScene(nodes: SceneNode[]): Scene {
  return { nodes } as unknown as Scene;
}

describe('hitTest（合成資料）', () => {
  it('橫跨 x、y 兩條格線的節點，四個角都查得到（cell=80，中心 (80,80)、w=h=40）', () => {
    // 外接矩形 x∈[60,100]、y∈[60,100]：x 跨第 0/1 格、y 也跨第 0/1 格，共蓋住四格
    const idx = buildHitIndex(makeScene([makeNode('A', 80, 80, 40, 40)]));
    expect(hitTest(idx, 62, 62)).toBe('A');
    expect(hitTest(idx, 98, 62)).toBe('A');
    expect(hitTest(idx, 62, 98)).toBe('A');
    expect(hitTest(idx, 98, 98)).toBe('A');
  });

  it('同一格兩顆重疊節點時，命中回陣列後者（跟 DOM 疊序一致，後畫的在上面）', () => {
    const idx = buildHitIndex(makeScene([
      makeNode('A', 80, 80, 40, 40),
      makeNode('B', 80, 80, 40, 40),
    ]));
    expect(hitTest(idx, 80, 80)).toBe('B');
  });

  it('節點邊界剛好落在格線上仍算命中（中心 (60,60)、w=h=40 → 左緣 40、右緣 80 正好是格線）', () => {
    const idx = buildHitIndex(makeScene([makeNode('C', 60, 60, 40, 40)]));
    expect(hitTest(idx, 80, 60)).toBe('C');
    expect(hitTest(idx, 40, 60)).toBe('C');
  });
});
