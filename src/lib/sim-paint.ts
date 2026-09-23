// 模擬器狀態 → 畫布的 `SimPaint`。畫面（src/scripts/sim.ts 的 renderCanvas）與匯出圖片
// （完整版）共用這一份：兩邊各組一次的話，日後改了「哪些邊算走過」只有一邊會跟上，
// 而圖跟畫面不一樣時不會有任何地方報錯。
import { edgeKey, type SimPaint } from './canvas/state.js';
import { edgeIsLinked, edgeWasUsed, isAvailable, maxSelectableLevel, ownedIds } from './sim.js';
import type { SimContext, SimState } from './sim.js';
import type { TreeData } from './types.js';

export function simPaintFor(
  state: SimState, ctx: SimContext, data: Pick<TreeData, 'nodes' | 'edges'>, selected: string | null,
): SimPaint {
  const owned = ownedIds(state, ctx);
  const available = new Set(
    data.nodes.filter(n => !owned.has(n.id) && isAvailable(n.id, state, ctx)).map(n => n.id),
  );
  const linked = new Set<string>();
  const active = new Set<string>();
  const ready = new Set<string>();
  for (const [from, to] of data.edges) {
    // 三階：沒到手＝暗、兩端都在手上＝正常亮度（edgeIsLinked）、真的走過＝再加金色
    // （edgeWasUsed，是 linked 的子集）。少了中間那階，火骰子連著風與冰那兩條（三顆都是
    // 遊戲一開始就送的）不是被畫成金線＝看起來像自己解過，就是跟沒走到的路一樣暗。
    if (edgeIsLinked(from, to, state, ctx)) linked.add(edgeKey(from, to));
    if (edgeWasUsed(from, to, state, ctx)) active.add(edgeKey(from, to));
    if (owned.has(from) && !owned.has(to) && isAvailable(to, state, ctx)) ready.add(edgeKey(from, to));
  }
  return {
    owned, available, selected, linked, active, ready,
    // 只帶已取得的等級：painter 也只畫 owned 的牌子，未取得的節點送過去只是白佔快取簽章。
    levels: new Map([...owned].map(id => [id, state.levels.get(id) ?? 1])),
    // 上限走 maxSelectableLevel 而不是 node.maxLevel：查不到費用表的節點在模擬器裡根本
    // 不能升級（回 1），painter 的 `max <= 1` 就是靠這個判斷「這顆不該有牌子」。
    maxLevels: new Map(data.nodes.map(n => [n.id, maxSelectableLevel(n, ctx)])),
  };
}
