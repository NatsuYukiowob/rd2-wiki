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
  /**
   * 「等級條件」的反向索引：祖先 id → 有哪些節點要求它練到幾級（`TreeNode.prereqRanks` 的轉置）。
   *
   * 正向那份（掛在節點身上）回答的是「我要解開這顆，得先練誰」；`minSelectableLevel()` 問的是
   * 反過來的「我這顆已經被誰卡著、還能不能降級」。每次降級都掃一遍 241 顆節點也算得出來，
   * 但那是一個 O(節點數) 的動作掛在滑桿的每一次 input 上。
   */
  rankHolders: Map<string, { id: string; rank: number }[]>;
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
  const rankHolders = new Map<string, { id: string; rank: number }[]>();
  for (const x of data.nodes) {
    for (const [prereqId, rank] of Object.entries(x.prereqRanks ?? {})) {
      if (!rankHolders.has(prereqId)) rankHolders.set(prereqId, []);
      rankHolders.get(prereqId)!.push({ id: x.id, rank });
    }
  }
  return {
    byId, parents, children, free, optional, globalNames, rankHolders,
    tables, runeTable: data.meta.upgradeCostTable,
  };
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
  if (!(ctx.parents.get(id) ?? []).every(p => owned.has(p))) return false;
  // 「前置都在手上」還不夠：太陽骰子另外要求 1201 練滿 Lv.50（TreeNode.prereqRanks）。
  // 少了這一句，畫面會把一顆遊戲裡點不開的節點標成「可取得」，玩家點下去才發現扣不了款。
  return missingPrereqRanks(id, state, ctx).length === 0;
}

export function missingParents(id: string, state: SimState, ctx: SimContext): string[] {
  const owned = ownedIds(state, ctx);
  return (ctx.parents.get(id) ?? []).filter(p => !owned.has(p));
}

/** 一條還沒滿足的「祖先要先練到某等級」條件。 */
export interface RankShortfall {
  /** 要被練起來的那顆祖先。 */
  id: string;
  /** 它的名稱——面板印的是名字，玩家看不懂 `1201`。 */
  name: string;
  /** 要達到的等級。 */
  rank: number;
  /** 它現在的等級（還沒取得時是 1）。 */
  level: number;
  /** 它取得了沒有。⚠️ 沒取得跟「取得了但等級不夠」在面板上是兩句不同的話。 */
  owned: boolean;
}

/**
 * 這顆節點還差哪些「祖先的等級」條件？全部滿足時回空陣列。
 *
 * ⚠️ 面板不可以只說「還缺前置」：太陽骰子的三顆前置全在手上、卻仍然點不開，那句話會讓玩家
 * 對著一棵已經解完的前置鏈找不到問題出在哪。所以這裡連「差多少」都帶出去
 *（「子彈傷害%增加需達 Lv.50（目前 Lv.12）」）。
 */
export function missingPrereqRanks(id: string, state: SimState, ctx: SimContext): RankShortfall[] {
  const owned = ownedIds(state, ctx);
  const out: RankShortfall[] = [];
  for (const [prereqId, rank] of Object.entries(ctx.byId.get(id)?.prereqRanks ?? {})) {
    const has = owned.has(prereqId);
    const level = has ? (state.levels.get(prereqId) ?? 1) : 1;
    if (has && level >= rank) continue;
    out.push({ id: prereqId, name: ctx.byId.get(prereqId)?.name ?? prereqId, rank, level, owned: has });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** 這顆節點的等級能調到多少？查不到費用表就是不能升級。 */
export function maxSelectableLevel(node: TreeNode, ctx: SimContext): number {
  return levelTableFor(node, ctx.tables, ctx.runeTable) ? node.maxLevel : 1;
}

/**
 * 這顆節點的等級**最低**能調到多少？沒有人卡著它時是 1。
 *
 * 遊戲裡沒有「把 1201 降回 49 級但保留太陽骰子」這種狀態——等級條件是解鎖時檢查、也持續成立
 * 的。模擬器要是讓玩家降下去，那份規劃的總資源會少算一段，而它對應的是一個遊戲裡不存在的
 * 局面。所以下限＝所有**已取得**的後續節點對它的要求裡最大的那一個。
 */
export function minSelectableLevel(node: TreeNode, state: SimState, ctx: SimContext): number {
  const owned = ownedIds(state, ctx);
  let floor = 1;
  for (const holder of ctx.rankHolders.get(node.id) ?? []) {
    if (owned.has(holder.id) && holder.rank > floor) floor = holder.rank;
  }
  return floor;
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

/**
 * 一次套用一份「一鍵點亮」計畫（`pathTo()` 的回傳值）。
 *
 * ⚠️ **參數刻意是整份計畫而不是一個 id 陣列**：計畫裡除了要解的節點，還有「哪幾顆要順便練到
 * 幾級」（太陽骰子要求 1201 練滿 Lv.50）。收 `string[]` 的話，呼叫端漏傳那一段就會產生一個
 * 「1501 已取得、1201 卻停在 Lv.1」的狀態——遊戲裡不存在，而畫面上看起來一切正常。
 */
export function unlockMany(
  state: SimState,
  ctx: SimContext,
  plan: { need: readonly string[]; levels?: readonly { id: string; level: number }[] },
): SimState {
  const unlocked = new Set(state.unlocked);
  const levels = new Map(state.levels);
  for (const id of plan.need) {
    const node = ctx.byId.get(id);
    if (!node || ctx.free.has(id) || ctx.optional.has(id)) continue;
    unlocked.add(id);
    if (maxSelectableLevel(node, ctx) > 1) levels.set(id, 1);
  }
  // 練等排在解鎖之後：上面那一行會把新解開的節點的等級設成 1，順序反了就被蓋掉。
  for (const { id, level } of plan.levels ?? []) {
    const node = ctx.byId.get(id);
    if (!node) continue;
    const cap = maxSelectableLevel(node, ctx);
    if (cap <= 1) continue;
    // 夾在上限內，而且只往上調：計畫要的是「至少到這一級」，玩家原本練得更高不該被降回去。
    levels.set(id, Math.min(Math.max(level, levels.get(id) ?? 1), cap));
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
  // 已取得的後續節點要求它至少練到某一級時，不准降到那一級以下——遊戲裡沒有
  // 「1201 降回 49 級但太陽骰子還在」這種局面（見 minSelectableLevel）。
  if (level < minSelectableLevel(node, state, ctx)) return null;
  const levels = new Map(state.levels);
  levels.set(id, level);
  return { unlocked: state.unlocked, levels, initial: state.initial };
}

/** 一份「一鍵點亮」計畫。⚠️ `need` 與 `levels` 要一起套用，見 unlockMany() 的說明。 */
export interface SimPlan {
  /** 要解的節點，拓樸序（父節點排在子節點前面）。 */
  need: string[];
  /** 鏈上還沒勾的可選初始骰子；非空時 `need` 與 `levels` 一律是空的（不做半套）。 */
  blocked: string[];
  /** 要順便練起來的節點與目標等級（太陽骰子要求 1201 練滿 Lv.50）。 */
  levels: { id: string; level: number }[];
}

/**
 * 「一鍵點亮到這裡」要解哪些節點。
 *
 * `need` 是拓樸序（父節點排在子節點前面）；`blocked` 是鏈上還沒勾的初始骰子；
 * `levels` 是「順便要練到幾級」——太陽骰子除了兩條入邊，還要求 1201 練滿 Lv.50，那段升級
 * **是這條路徑的一部分**，不放進計畫的話玩家會花掉 13 萬金幣、目標卻仍然點不開。
 * ⚠️ `blocked` 非空時 `need` 與 `levels` 一律是空陣列——**不做半套**。解一半的話玩家會花掉
 * 資源、目標節點卻仍然點不開，而畫面上只會說「還缺前置」，看不出剛才那些錢是為了什麼花的。
 */
export function pathTo(id: string, state: SimState, ctx: SimContext): SimPlan {
  const owned = ownedIds(state, ctx);
  const need: string[] = [];
  const seen = new Set<string>();
  const blocked = new Set<string>();
  const ranks = new Map<string, number>();
  const visit = (cur: string): void => {
    if (owned.has(cur) || seen.has(cur)) return;
    seen.add(cur);
    // 可選初始骰子擋在這裡就停：它的祖先玩家根本不必解（那顆是從骰子樹外面領的）。
    if (ctx.optional.has(cur)) { blocked.add(cur); return; }
    for (const p of ctx.parents.get(cur) ?? []) visit(p);
    // 等級條件的那顆祖先**不一定是直接前置**（規則 26 只保證它在祖先集合裡），所以要自己
    // 再走一次：先確保它會被取得（排在 cur 前面才是合法的拓樸序），再記下要練到幾級。
    for (const [prereqId, rank] of Object.entries(ctx.byId.get(cur)?.prereqRanks ?? {})) {
      visit(prereqId);
      ranks.set(prereqId, Math.max(ranks.get(prereqId) ?? 0, rank));
    }
    need.push(cur);
  };
  visit(id);
  if (blocked.size > 0) return { need: [], blocked: [...blocked], levels: [] };
  // 已經練得夠高的就不必列進計畫（畫面上那句「已點亮 N 個節點」與成本都跟著少一段）。
  const levels = [...ranks]
    .filter(([prereqId, rank]) => (state.levels.get(prereqId) ?? 1) < rank)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([prereqId, level]) => ({ id: prereqId, level }));
  return { need, blocked: [], levels };
}

export interface SimTotals { unlock: Cost; upgrade: Cost; total: Cost }

export function simTotals(state: SimState, ctx: SimContext): SimTotals {
  // 起始骰子與勾選的初始骰子不在 state.unlocked 裡，所以這裡自然不會算到它們；
  // sumUnlockCost 另外擋掉「靠成就開門又不用付錢」的節點（同 /tree 的前置鏈成本）。
  const { cost: unlock } = sumUnlockCost(state.unlocked, ctx.byId);
  const upgrade: Cost = { core: 0, gold: 0, solar: 0 };
  for (const [id, level] of state.levels) {
    if (level <= 1) continue;
    const node = ctx.byId.get(id);
    if (!node) continue;
    const table = levelTableFor(node, ctx.tables, ctx.runeTable);
    const extra = table ? upgradeExtraCost(table, level) : null;
    if (!extra) continue;
    upgrade.core += extra.core;
    upgrade.gold += extra.gold;
    upgrade.solar += extra.solar;
  }
  return {
    unlock,
    upgrade,
    total: {
      core: unlock.core + upgrade.core,
      gold: unlock.gold + upgrade.gold,
      solar: unlock.solar + upgrade.solar,
    },
  };
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
  limits: { core: number | null; gold: number | null; solar: number | null },
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
  // 太陽核心走同一條路徑（含「只擋會變貴的方向」那條語意）——三種貨幣任一種超出都要擋，
  // 不然玩家設了太陽核心上限卻照樣買得下去，而畫面上完全沒有東西說話。
  if (limits.solar !== null && total.solar > limits.solar && worse(total.solar, previous?.solar)) {
    out.push(`太陽核心 ${fmt(total.solar)} / ${fmt(limits.solar)}`);
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
