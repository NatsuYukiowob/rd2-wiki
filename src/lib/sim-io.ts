// `/sim` 的存檔與文字報告。純函式——`localStorage` 的實際讀寫在 src/scripts/sim.ts，
// 這裡只負責「狀態 ↔ 字串」，才測得動（jsdom 的 storage 替身跟真的瀏覽器行為不完全一樣）。
import { maxSelectableLevel, minSelectableLevel, ownedIds, simTotals } from './sim.js';
import type { SimContext, SimState } from './sim.js';
import type { Cost } from './types.js';

/**
 * 存檔的鍵名。**版本號寫在鍵名裡**：格式改了就換一個鍵，舊資料自然失效，
 * 不必寫遷移程式，也不會有「讀到一半發現欄位對不上」的中間狀態。
 */
export const SIM_STORAGE_KEY = 'rd2-sim-v1';
const FORMAT_VERSION = 1;

export function serializeSim(state: SimState): string {
  return JSON.stringify({
    v: FORMAT_VERSION,
    unlocked: [...state.unlocked].sort(),
    levels: Object.fromEntries([...state.levels].filter(([, lv]) => lv > 1)),
    initial: [...state.initial].sort(),
  });
}

/**
 * 讀回存檔；沒有存檔、格式不合、或版本不符時回 null（呼叫端退回 `initialSimState()`）。
 *
 * ⚠️ 存檔是使用者瀏覽器裡的舊資料，而骰子樹會改版。四種漂移都在這裡收掉：節點被移除
 * （丟掉那筆）、等級上限被調低（夾回上限）、前置邊被拿掉（連帶清掉前置不齊的節點）、
 * **新增了「祖先要練到某等級」的條件**（把那顆祖先的等級補到門檻）。
 * 不收的話玩家會看到一份算錯的資源總額，而畫面上不會有任何地方說話。
 */
export function deserializeSim(text: string | null, ctx: SimContext): SimState | null {
  if (text === null) return null;
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const { v, unlocked, levels, initial } = raw as Record<string, unknown>;
  if (v !== FORMAT_VERSION) return null;
  if (!Array.isArray(unlocked) || !Array.isArray(initial)) return null;
  if (typeof levels !== 'object' || levels === null || Array.isArray(levels)) return null;

  const nextInitial = new Set(initial.filter((id): id is string => typeof id === 'string' && ctx.optional.has(id)));
  const nextUnlocked = new Set(unlocked.filter((id): id is string =>
    typeof id === 'string' && ctx.byId.has(id) && !ctx.free.has(id) && !ctx.optional.has(id)));

  // 前置不齊的節點連帶清掉，跟 removeNode 用的是同一種收斂：清掉一顆可能讓它的後續也失去前置。
  let changed = true;
  while (changed) {
    changed = false;
    const owned = new Set([...ctx.free, ...nextInitial, ...nextUnlocked]);
    for (const id of nextUnlocked) {
      if ((ctx.parents.get(id) ?? []).every(p => owned.has(p))) continue;
      nextUnlocked.delete(id);
      changed = true;
    }
  }

  const nextLevels = new Map<string, number>();
  for (const id of [...ctx.free, ...nextInitial, ...nextUnlocked]) {
    const node = ctx.byId.get(id);
    if (!node) continue;
    const cap = maxSelectableLevel(node, ctx);
    if (cap <= 1) continue;
    const saved = (levels as Record<string, unknown>)[id];
    const lv = typeof saved === 'number' && Number.isInteger(saved) ? Math.min(Math.max(saved, 1), cap) : 1;
    nextLevels.set(id, lv);
  }

  // 等級條件是 1.1.0 才有的東西（太陽骰子要求 1201 練滿 Lv.50），所以存檔裡可能有一份
  // 「1501 已取得、1201 停在 Lv.1」的組合——那在遊戲裡不存在。**往上補到門檻而不是把 1501
  // 丟掉**：玩家真的解開過它，就代表那段等級他也真的練過；丟掉節點反而是憑空改掉他的規劃。
  // ⚠️ 這一輪要排在等級夾制之後（它讀的是夾完的 nextLevels），也要排在 unlocked 收斂之後
  // （下限的來源是「已取得的後續節點」）。
  const repaired: SimState = { unlocked: nextUnlocked, levels: nextLevels, initial: nextInitial };
  for (const [id, lv] of nextLevels) {
    const node = ctx.byId.get(id);
    if (!node) continue;
    const floor = Math.min(minSelectableLevel(node, repaired, ctx), maxSelectableLevel(node, ctx));
    if (lv < floor) nextLevels.set(id, floor);
  }
  return repaired;
}

const num = (n: number) => n.toLocaleString('en-US');

/** 可貼進聊天室的純文字報告。刻意不含表格或色碼——它會被貼到哪裡我們控制不了。 */
export function simReport(state: SimState, ctx: SimContext): string {
  const t = simTotals(state, ctx);
  // 太陽核心只在這份規劃真的用得到時才進報告——沒用到就一個字都不多印，既有的報告格式
  // 逐位元組不變。⚠️ 判準是**總計**而不是逐行：三行是同一個區塊，只有其中一行多一段的話
  // 讀報告的人得自己去推「另外兩行是 0 還是這個欄位不適用」。
  const showSolar = t.total.solar > 0;
  const money = (c: Cost) =>
    `核心 ${num(c.core)} ／金幣 ${num(c.gold)}` + (showSolar ? ` ／太陽核心 ${num(c.solar)}` : '');
  const owned = ownedIds(state, ctx);
  const initialNames = [...state.initial].map(id => ctx.byId.get(id)?.name ?? id);
  // 起始骰子不列進清單：玩家沒有為它們做過任何選擇，列出來只是稀釋掉真正的規劃內容。
  const picked = [...state.unlocked]
    .map(id => ctx.byId.get(id))
    .filter((x): x is NonNullable<typeof x> => x !== undefined)
    .sort((a, b) => a.id.localeCompare(b.id));
  const lines = [
    'Random Dice 2 骰子樹模擬結果',
    `初始骰子：${initialNames.length > 0 ? initialNames.join('、') : '無（只有起始的 5 顆）'}`,
    `已取得節點：${owned.size} / ${ctx.byId.size}`,
    '',
    `總資源：${money(t.total)}`,
    `解鎖：${money(t.unlock)}`,
    `升級：${money(t.upgrade)}`,
    '',
    '取得節點：',
  ];
  for (const n of picked) {
    const cap = maxSelectableLevel(n, ctx);
    const lv = cap > 1 ? ` Lv.${state.levels.get(n.id) ?? 1}/${n.maxLevel}` : '';
    lines.push(`${n.id} ${n.name}${lv}`);
  }
  return lines.join('\n');
}
