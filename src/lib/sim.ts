// `/sim` 骰子樹模擬器的狀態機。純函式、不碰 DOM——畫面組裝在 src/scripts/sim.ts。
//
// 每個操作都回傳一份**新的**狀態而不是就地改：undo／redo 直接把整份狀態推進堆疊就好，
// 不必為每種操作各寫一次反向操作（而反向操作正是最容易漏掉連帶效果的地方——取消一顆節點
// 要連帶取消後續、清掉等級、扣回兩種成本）。239 個節點的 Set 複製一次是幾微秒的事。
import { buildAdjacency, sumUnlockCost } from './graph.js';
import { levelTableFor, upgradeExtraCost } from './upgrade-tiers.js';
import type {
  Branch, Cost, GrowthUnit, PassiveUpgradeCost, TreeData, TreeNode, UpgradeCostTable,
} from './types.js';

export interface SimState {
  /** 玩家自己花資源解開的節點。**不含**起始骰子與勾選的初始骰子（那兩種沒付錢）。 */
  unlocked: ReadonlySet<string>;
  /** 節點 id → 當前等級。只有已取得且 maxLevel > 1 的節點才有。 */
  levels: ReadonlyMap<string, number>;
  /** 玩家勾選的「可選初始骰子」。 */
  initial: ReadonlySet<string>;
}

export interface SimContext {
  byId: Map<string, TreeNode>;
  parents: Map<string, string[]>;
  children: Map<string, string[]>;
  /** 遊戲一開始就給的節點（`unlockVia === 'default'`）。不可取消，也不計入資源。 */
  free: Set<string>;
  /**
   * 「可選初始骰子」：不用付錢、也不必解骰子樹前置就拿得到的節點（陰陽／貪婪／空虛）。
   *
   * 從資料推導（`unlockVia` 非 cost、非 default，且沒有 `unlockPaid`），不是硬編碼 id 清單
   * ——官方哪天多送一顆，只要 `data/unlock-exceptions.json` 改一行 `/sim` 就跟著對。
   * ⚠️ 恐懼骰子（`5002`）不在這裡：它是成就開門但**仍要付 8 核心**（`unlockPaid`），
   * 走的是一般解鎖流程，混進來玩家就免費拿到它了。
   */
  optional: Set<string>;
  /**
   * 「跨系別的同名效果」的名稱集合，例如「所有骰子傷害」在五個系各有節點。
   *
   * ⚠️ 判準是**整份資料**裡跨不跨系，不是玩家現在解了哪幾顆——用後者的話同一個效果會隨解鎖
   * 進度在分組之間跳來跳去（解一顆時歸在該系、解第二顆時突然變成全域）。
   */
  globalNames: Set<string>;
  tables: PassiveUpgradeCost;
  runeTable: UpgradeCostTable | null;
}

export type AbilityGroup = 'global' | Branch;

export interface AbilityEntry {
  name: string;
  /** 有成長值時：依當前等級算出來的合計與單位。沒有成長值的節點是 null。 */
  total: { value: number; unit: GrowthUnit } | null;
  /**
   * 沒有成長值時的原始描述與出現次數。
   *
   * 刻意不去解析「起始SP增加40」這種固定值：那要另寫一組認得「增加／減少／機率／折扣」四種
   * 句型的正則，而那組正則挖錯不會有任何地方說話（同 `growth` 需要規則 17 反向驗算的理由）。
   * 照實列出來，玩家自己看得懂 `起始SP增加40 ×5`。
   */
  fixed: { description: string; count: number }[];
  /** 貢獻這一筆的已取得節點數。 */
  count: number;
}

const GROUP_ORDER: AbilityGroup[] = ['global', 'nature', 'engineering', 'magic', 'order', 'chaos'];

export function buildSimContext(data: TreeData, tables: PassiveUpgradeCost): SimContext {
  const { parents, children } = buildAdjacency(data.edges);
  const byId = new Map(data.nodes.map(x => [x.id, x]));
  const free = new Set<string>();
  const optional = new Set<string>();
  for (const x of data.nodes) {
    if (x.unlockVia === 'default') free.add(x.id);
    else if (x.unlockVia !== 'cost' && !x.unlockPaid) optional.add(x.id);
  }
  const branchesByName = new Map<string, Set<Branch>>();
  for (const x of data.nodes) {
    if (x.type !== 'passive' && x.type !== 'support') continue;
    if (!branchesByName.has(x.name)) branchesByName.set(x.name, new Set());
    branchesByName.get(x.name)!.add(x.branch);
  }
  const globalNames = new Set(
    [...branchesByName].filter(([, bs]) => bs.size > 1).map(([name]) => name),
  );
  return { byId, parents, children, free, optional, globalNames, tables, runeTable: data.meta.upgradeCostTable };
}

export function initialSimState(ctx: SimContext): SimState {
  // 可選初始骰子預設**不勾**：預設勾起來等於替玩家假設他已經打完合作 2100 擊殺與競技場 300 分。
  void ctx;
  return { unlocked: new Set(), levels: new Map(), initial: new Set() };
}

/** 玩家現在手上有的全部節點＝起始骰子 ∪ 勾選的初始骰子 ∪ 自己解開的。 */
export function ownedIds(state: SimState, ctx: SimContext): Set<string> {
  return new Set([...ctx.free, ...state.initial, ...state.unlocked]);
}

export function isAvailable(id: string, state: SimState, ctx: SimContext): boolean {
  if (!ctx.byId.has(id)) return false;
  // 可選初始骰子不花錢，讓玩家在樹上點一下就拿到等於送他一顆。
  if (ctx.optional.has(id)) return false;
  const owned = ownedIds(state, ctx);
  if (owned.has(id)) return false;
  return (ctx.parents.get(id) ?? []).every(p => owned.has(p));
}

export function missingParents(id: string, state: SimState, ctx: SimContext): string[] {
  const owned = ownedIds(state, ctx);
  return (ctx.parents.get(id) ?? []).filter(p => !owned.has(p));
}

/** 這顆節點的等級能調到多少？查不到費用表就是不能升級。 */
export function maxSelectableLevel(node: TreeNode, ctx: SimContext): number {
  return levelTableFor(node, ctx.tables, ctx.runeTable) ? node.maxLevel : 1;
}

function withLevel(levels: ReadonlyMap<string, number>, node: TreeNode, ctx: SimContext): Map<string, number> {
  const next = new Map(levels);
  if (maxSelectableLevel(node, ctx) > 1) next.set(node.id, 1);
  return next;
}

/** 解鎖一顆節點；前置沒齊、已經有了、或它是可選初始骰子時回 null。 */
export function unlockNode(state: SimState, ctx: SimContext, id: string): SimState | null {
  if (!isAvailable(id, state, ctx)) return null;
  const node = ctx.byId.get(id)!;
  return {
    unlocked: new Set([...state.unlocked, id]),
    levels: withLevel(state.levels, node, ctx),
    initial: state.initial,
  };
}

/** 一次解鎖一串節點（呼叫端負責先用 pathTo 取得拓樸序）。 */
export function unlockMany(state: SimState, ctx: SimContext, ids: readonly string[]): SimState {
  const unlocked = new Set(state.unlocked);
  const levels = new Map(state.levels);
  for (const id of ids) {
    const node = ctx.byId.get(id);
    if (!node || ctx.free.has(id) || ctx.optional.has(id)) continue;
    unlocked.add(id);
    if (maxSelectableLevel(node, ctx) > 1) levels.set(id, 1);
  }
  return { unlocked, levels, initial: state.initial };
}

/**
 * 把「前置已經不成立」的節點全部取消掉，直到收斂。
 *
 * 要跑到收斂而不是掃一遍：取消 B 會讓 D 失去前置，而 D 可能又是 F 的前置——一遍掃完只會
 * 清掉第一層，剩下的節點會留在畫面上，成本也還算著。
 */
function cascade(unlocked: Set<string>, levels: Map<string, number>, initial: ReadonlySet<string>, ctx: SimContext): void {
  let changed = true;
  while (changed) {
    changed = false;
    const owned = new Set([...ctx.free, ...initial, ...unlocked]);
    for (const id of unlocked) {
      if ((ctx.parents.get(id) ?? []).every(p => owned.has(p))) continue;
      unlocked.delete(id);
      levels.delete(id);
      changed = true;
    }
  }
}

/** 取消一顆已解鎖的節點，連帶取消所有依賴它的節點。起始骰子或沒解鎖的節點回 null。 */
export function removeNode(state: SimState, ctx: SimContext, id: string): SimState | null {
  if (!state.unlocked.has(id)) return null;
  const unlocked = new Set(state.unlocked);
  const levels = new Map(state.levels);
  unlocked.delete(id);
  levels.delete(id);
  cascade(unlocked, levels, state.initial, ctx);
  return { unlocked, levels, initial: state.initial };
}

/** 勾選／取消一顆可選初始骰子；取消時連帶取消依賴它的節點。不是可選初始骰子時回 null。 */
export function setInitialDice(state: SimState, ctx: SimContext, id: string, on: boolean): SimState | null {
  if (!ctx.optional.has(id)) return null;
  if (state.initial.has(id) === on) return state;
  const initial = new Set(state.initial);
  const unlocked = new Set(state.unlocked);
  const levels = new Map(state.levels);
  if (on) initial.add(id);
  else { initial.delete(id); cascade(unlocked, levels, initial, ctx); }
  return { unlocked, levels, initial };
}

/** 設定等級；節點還沒取得、不能升級、或等級超出範圍時回 null。 */
export function setNodeLevel(state: SimState, ctx: SimContext, id: string, level: number): SimState | null {
  const node = ctx.byId.get(id);
  if (!node || !ownedIds(state, ctx).has(id)) return null;
  const cap = maxSelectableLevel(node, ctx);
  if (cap <= 1 || !Number.isInteger(level) || level < 1 || level > cap) return null;
  const levels = new Map(state.levels);
  levels.set(id, level);
  return { unlocked: state.unlocked, levels, initial: state.initial };
}

/**
 * 「一鍵點亮到這裡」要解哪些節點。
 *
 * `need` 是拓樸序（父節點排在子節點前面）；`blocked` 是鏈上還沒勾的初始骰子。
 * ⚠️ `blocked` 非空時 `need` 一律是空陣列——**不做半套**。解一半的話玩家會花掉資源、
 * 目標節點卻仍然點不開，而畫面上只會說「還缺前置」，看不出剛才那些錢是為了什麼花的。
 */
export function pathTo(id: string, state: SimState, ctx: SimContext): { need: string[]; blocked: string[] } {
  const owned = ownedIds(state, ctx);
  const need: string[] = [];
  const seen = new Set<string>();
  const blocked = new Set<string>();
  const visit = (cur: string): void => {
    if (owned.has(cur) || seen.has(cur)) return;
    seen.add(cur);
    // 可選初始骰子擋在這裡就停：它的祖先玩家根本不必解（那顆是從骰子樹外面領的）。
    if (ctx.optional.has(cur)) { blocked.add(cur); return; }
    for (const p of ctx.parents.get(cur) ?? []) visit(p);
    need.push(cur);
  };
  visit(id);
  return blocked.size > 0 ? { need: [], blocked: [...blocked] } : { need, blocked: [] };
}

export interface SimTotals { unlock: Cost; upgrade: Cost; total: Cost }

export function simTotals(state: SimState, ctx: SimContext): SimTotals {
  // 起始骰子與勾選的初始骰子不在 state.unlocked 裡，所以這裡自然不會算到它們；
  // sumUnlockCost 另外擋掉「靠成就開門又不用付錢」的節點（同 /tree 的前置鏈成本）。
  const { cost: unlock } = sumUnlockCost(state.unlocked, ctx.byId);
  const upgrade: Cost = { core: 0, gold: 0 };
  for (const [id, level] of state.levels) {
    if (level <= 1) continue;
    const node = ctx.byId.get(id);
    if (!node) continue;
    const table = levelTableFor(node, ctx.tables, ctx.runeTable);
    const extra = table ? upgradeExtraCost(table, level) : null;
    if (!extra) continue;
    upgrade.core += extra.core;
    upgrade.gold += extra.gold;
  }
  return { unlock, upgrade, total: { core: unlock.core + upgrade.core, gold: unlock.gold + upgrade.gold } };
}

/**
 * 總資源有沒有超出玩家設定的上限？回傳超出項目的說明（空陣列＝沒超出）。
 *
 * `previous` 是「這個操作之前的總額」：**傳了它就只擋會讓事情變糟的方向**。
 * ⚠️ 這不是可有可無的細節。玩家的實際用法是「先規劃、事後才填上限」，填完的那一刻通常
 * 已經超支；若連「取消節點」「降等級」這些會讓成本下降的操作都一起擋掉，他除了 undo 或
 * 整份重置之外沒有出路——上限欄位反而把人鎖死在自己正想改掉的那份規劃裡。
 * 不傳 `previous` 的呼叫端（畫面上那行「已超出設定的上限」）要的是純粹的現況，不受影響。
 */
export function exceedsLimit(
  total: Cost,
  limits: { core: number | null; gold: number | null },
  previous?: Cost,
): string[] {
  const out: string[] = [];
  const fmt = (n: number) => n.toLocaleString('en-US');
  const worse = (now: number, before: number | undefined) => before === undefined || now > before;
  if (limits.core !== null && total.core > limits.core && worse(total.core, previous?.core)) {
    out.push(`核心 ${fmt(total.core)} / ${fmt(limits.core)}`);
  }
  if (limits.gold !== null && total.gold > limits.gold && worse(total.gold, previous?.gold)) {
    out.push(`金幣 ${fmt(total.gold)} / ${fmt(limits.gold)}`);
  }
  return out;
}

/**
 * 這條邊的兩端都在手上嗎？——也就是這條路通不通。
 *
 * 跟 `edgeWasUsed()` 是兩件事，畫面上也是兩種樣子：**連通＝正常亮度**（不淡出），
 * **走過＝再加金色**。火骰子連著風與冰，三顆都是遊戲一開始就送的，那條路是通的，
 * 卻不是玩家走出來的——只有「走過」一種狀態的話，它們不是被畫成金線（看起來像自己解過），
 * 就是跟「還沒走到的路」一樣暗（Yuki 2026-08-23 兩次回報，正好是這條界線的兩邊）。
 *
 * ⚠️ **`edgeWasUsed` 是這個的子集**（它多要求終點不是白拿的）。CSS 靠這個包含關係把兩件事
 * 拆成互不搶屬性的兩條規則：`.sim-linked` 只設 opacity、`.sim-active` 只設 stroke。
 */
export function edgeIsLinked(from: string, to: string, state: SimState, ctx: SimContext): boolean {
  const owned = ownedIds(state, ctx);
  return owned.has(from) && owned.has(to);
}

/**
 * 這條邊「被玩家走過」了嗎？——也就是畫面上該不該把它畫成金線。
 *
 * ⚠️ 判準**不是**「兩端都取得」。遊戲一開始就送的 5 顆骰子裡，`1001` 火骰子連著 `1005` 風
 * 與 `1007` 冰，兩端從第一秒起就都在手上，但玩家從來沒有靠火骰子去解開它們——只看兩端的話，
 * 一進頁面就有兩條金線亮著，玩家會以為自己已經解了什麼。可選初始骰子（貪婪／空虛）同理：
 * 那是從討伐獎勵與競技場通行證直接領的，指向它的那條邊沒有被使用過。
 */
export function edgeWasUsed(from: string, to: string, state: SimState, ctx: SimContext): boolean {
  if (ctx.free.has(to) || ctx.optional.has(to)) return false;
  return edgeIsLinked(from, to, state, ctx);
}

/**
 * 已取得的玩家被動與支援節點合併成一份能力清單。
 *
 * 只收 passive／support：骰子與符文的加成是加在**某一顆骰子**身上的，跟玩家被動不同量綱，
 * 混在一起相加會得到一個沒有意義的數字。
 */
export function summarizeAbilities(state: SimState, ctx: SimContext): { group: AbilityGroup; entries: AbilityEntry[] }[] {
  const byGroup = new Map<AbilityGroup, Map<string, AbilityEntry>>();
  for (const id of ownedIds(state, ctx)) {
    const node = ctx.byId.get(id);
    if (!node || (node.type !== 'passive' && node.type !== 'support')) continue;
    const group: AbilityGroup = ctx.globalNames.has(node.name) ? 'global' : node.branch;
    if (!byGroup.has(group)) byGroup.set(group, new Map());
    const entries = byGroup.get(group)!;
    let entry = entries.get(node.name);
    if (!entry) {
      entry = { name: node.name, total: null, fixed: [], count: 0 };
      entries.set(node.name, entry);
    }
    entry.count += 1;
    if (node.growth) {
      const level = state.levels.get(id) ?? 1;
      const value = node.growth.base + node.growth.perLevel * (level - 1);
      // 浮點誤差會讓 10 + 1.2 × 3 印成 13.600000000000001。資料本身就是從 float32 抄來的，
      // 兩位小數是它的有效精度（同 growth.ts 的 round2）。
      const rounded = Math.round((entry.total ? entry.total.value + value : value) * 100) / 100;
      entry.total = { value: rounded, unit: node.growth.unit };
    } else {
      const hit = entry.fixed.find(f => f.description === node.description);
      if (hit) hit.count += 1;
      else entry.fixed.push({ description: node.description, count: 1 });
    }
  }
  return GROUP_ORDER
    .filter(g => byGroup.has(g))
    .map(g => ({ group: g, entries: [...byGroup.get(g)!.values()] }));
}
