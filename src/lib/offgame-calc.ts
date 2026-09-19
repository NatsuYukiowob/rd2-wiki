// /board 數值卡片的局外加成（骰子樹符文／玩家被動）計算。純函式，不碰 DOM——畫面在 src/scripts/board.ts。
//
// 疊加規則全部來自遊戲客戶端的逆向結果，要點：
// - 攻擊%池（attackPct）：所有攻擊%被動（全骰、系別）先相加，對局內攻擊力只乘一次、無條件進位
//   （客戶端 PlayerComp.CheckStatBuff4Defender）。這個值就是遊戲局內面板的攻擊力。
// - 子彈%符文（bulletPct）不在池裡：發射時才對面板攻擊力另乘、無條件進位（RuneManager
//   .GetFinalBulletAttackWithRuneEffect）→ 卡片多一行「子彈實際」；花的綻放（hitAttackMul）、齒輪的
//   基本傷害（hitAttackFlat）是命中時的加成，一起併在這一行。
// - 攻速（intervalPct）：每個「來源」各自減 I0×r/(1+r)——同一個 scope 的幾條被動先相加成一個來源——
//   夾 0.01 秒；攻速%符文（bulletIntervalPct）在發射時再 ÷(1+x)，再夾一次 0.01。
// - 專屬列（statAdd／statSet／statMul）：符文在骰點／強化成長之後才作用，順序是覆寫 → 加 → 乘。
// - critPct（暴擊率）與 mechanic（機制）不改卡片，只進明細面板；conditional／none 在建置期就被
//   namedEffects() 拿掉了，這裡不會看到。board（盤面增益用的符文）要看骰盤擺位，由 board-buffs.ts 消費，
//   appliedEffects() 不收。
// - 盤面加成（BoardBonus，board-buffs.ts 算）：攻擊%跟被動同一個池；陰陽直排是狀態效果池，另外 ceil（客戶端
//   DefenderComp.CheckStatBuff）；每個盤面攻速來源各自減；霓虹在攻速%符文之後再 ÷(1+x)、再夾一次 0.01。
// ⚠️ 遊戲內部是 Q48.16 定點數，這裡用 double：個別組合可能差 1。
import { cardTitle } from './board-card.js';
import { decimalsOf, formatNumber, numericAt, round9, valueAt, type StatParams } from './dice-calc.js';
import {
  ROW_TARGETS, effectValue, effectValue2, scopeApplies,
  type NamedEffect, type OffgameTarget,
} from './offgame.js';
import type { Branch } from './types.js';

export type OffgameMode = 'none' | 'sim' | 'max';

/** 一顆作用中的局外節點與它目前的等級（1..maxLevel）。 */
export interface AppliedEffect { id: string; effect: NamedEffect; level: number }

/** 讀進來的 /sim 存檔：手上有哪些節點、各練到幾級（沒記等級＝1）。 */
export interface SaveLevels { owned: ReadonlySet<string>; levels: ReadonlyMap<string, number> }

/** `bonus`：「(+516)」這種括號字串，沒有加成時是 null。`sub`：附屬行（子彈實際），畫成小一號。 */
export interface BonusRow { label: string; value: string; bonus: string | null; sub?: true }
export interface BonusCard { title: string; rows: BonusRow[] }
export interface DetailLines { offgame: string[]; mechanic: string[] }

/**
 * 一格的盤面加成裡卡片要的四個數（src/lib/board-buffs.ts 算，每一格一份）。
 * - attackPct：進被動那個攻擊%池（排序、排序疊加強化、三重共鳴），只乘一次。
 * - statusPct：狀態效果池（陰陽直排），跟被動池分開 ceil。
 * - intervalPcts：每個攻速來源一個百分比（光、共鳴、陰陽橫排、齒輪相連、齒輪二階），各自減 I0×r/(1+r)。
 * - neonPct：霓虹啟用時的攻速%，發射時 ÷(1+x/100)；0＝沒有。
 */
export interface BoardBonus {
  attackPct: number;
  statusPct: number;
  intervalPcts: readonly number[];
  neonPct: number;
}
export const NO_BOARD: BoardBonus = { attackPct: 0, statusPct: 0, intervalPcts: [], neonPct: 0 };

/** 客戶端 GameConstantsFP.MIN_ATTACK_INTERVAL。 */
export const MIN_INTERVAL = 0.01;
export const BULLET_LABEL = '子彈實際';
const ATTACK = '攻擊力';
const SPEED = '攻擊速度';
const BULLET_TARGETS: readonly OffgameTarget[] = ['bulletPct', 'hitAttackMul', 'hitAttackFlat'];
const MINUS = '−';

/** 客戶端的無條件進位。先收 9 位小數：750 × 68.8 / 100 在 double 裡是 516.0000000000001，直接 ceil 會多 1。 */
function ceilClean(n: number): number {
  return Math.ceil(round9(n));
}

/** 四捨五入到 decimals 位之後的數值（跟畫面上印的一樣）。 */
function roundTo(n: number, decimals: number): number {
  return Number(formatNumber(n, decimals));
}

function sumOf(applied: readonly AppliedEffect[], target: OffgameTarget): number {
  return round9(applied.reduce((s, a) => (a.effect.target === target ? s + effectValue(a.effect, a.level) : s), 0));
}

/** 三種模式各自的「這顆節點現在幾級」；0＝不算。 */
export function levelSource(mode: OffgameMode, save: SaveLevels | null): (id: string, e: NamedEffect) => number {
  if (mode === 'max') return (_id, e) => e.maxLevel;
  if (mode === 'sim' && save) return id => (save.owned.has(id) ? save.levels.get(id) ?? 1 : 0);
  return () => 0;
}

/** 作用在這顆骰子上、而且等級 ≥ 1 的節點（不含盤面增益用的 board），照節點 id 排序（明細面板的順序就是這個）。 */
export function appliedEffects(
  diceId: string,
  branch: Branch,
  effects: Record<string, NamedEffect>,
  levelOf: (id: string, e: NamedEffect) => number,
): AppliedEffect[] {
  const out: AppliedEffect[] = [];
  for (const [id, effect] of Object.entries(effects).sort(([a], [b]) => a.localeCompare(b))) {
    // 盤面增益用的符文（光增益範圍、霓虹…）不是這顆骰子自己的局外加成：board-buffs.ts 依擺位處理。
    if (effect.target === 'board' || !scopeApplies(effect.scope, diceId, branch)) continue;
    const level = levelOf(id, effect);
    if (level >= 1) out.push({ id, effect, level: Math.min(level, effect.maxLevel) });
  }
  return out;
}

/** 「(+516)」／「(−0.109)」；四捨五入後是 0 就回 null（不印括號）。 */
export function formatDelta(delta: number, decimals: number): string | null {
  const text = formatNumber(Math.abs(delta), decimals);
  if (Number(text) === 0) return null;
  return `(${delta > 0 ? '+' : MINUS}${text})`;
}

function bulletAttack(panel: number, applied: readonly AppliedEffect[]): number {
  let b = ceilClean(panel * (1 + sumOf(applied, 'bulletPct') / 100));
  const mul = sumOf(applied, 'hitAttackMul');
  if (mul !== 0) b = ceilClean(b * (1 + mul / 100));
  for (const a of applied) {
    if (a.effect.target === 'hitAttackFlat') b += Math.ceil(effectValue(a.effect, a.level));
  }
  return b;
}

function intervalAfter(i0: number, applied: readonly AppliedEffect[], board: BoardBonus): number {
  const sources = new Map<string, number>();
  for (const a of applied) {
    if (a.effect.target !== 'intervalPct') continue;
    sources.set(a.effect.scope, round9((sources.get(a.effect.scope) ?? 0) + effectValue(a.effect, a.level)));
  }
  let s = i0;
  for (const pct of [...sources.values(), ...board.intervalPcts]) {
    const r = pct / 100;
    s -= (i0 * r) / (1 + r);
  }
  s = Math.max(s, MIN_INTERVAL);
  const rune = sumOf(applied, 'bulletIntervalPct');
  if (rune !== 0) s = Math.max(s / (1 + rune / 100), MIN_INTERVAL);
  if (board.neonPct !== 0) s = Math.max(s / (1 + board.neonPct / 100), MIN_INTERVAL);
  return s;
}

function rowAfter(n0: number, fx: readonly AppliedEffect[]): number {
  let n = n0;
  for (const a of fx) {
    if (a.effect.target === 'statSet') n = (a.effect.setBase ?? 0) + Math.trunc(effectValue(a.effect, a.level));
  }
  for (const a of fx) {
    if (a.effect.target !== 'statAdd') continue;
    const v = effectValue(a.effect, a.level);
    n += (a.effect.sign ?? 1) * (a.effect.int ? Math.trunc(v) : v);
    if (a.effect.min !== undefined) n = Math.max(n, a.effect.min);
  }
  for (const a of fx) {
    if (a.effect.target === 'statMul') n *= 1 + effectValue(a.effect, a.level) / 100;
  }
  return round9(n);
}

/** 專屬列的小數位：列本身與加上去的值取細的；乘倍率的結果給到 3 位（formatNumber 會去掉尾端的 0）。 */
function rowDecimals(base: number, fx: readonly AppliedEffect[]): number {
  let d = base;
  for (const a of fx) d = Math.max(d, a.effect.target === 'statMul' ? 3 : decimalsOf(effectValue(a.effect, a.level)));
  return d;
}

/** 改 label 那一列的局外節點（statAdd／statSet／statMul）。卡片那一列與 rowValue() 共用，不要各寫一份篩選。 */
function rowEffects(applied: readonly AppliedEffect[], label: string): AppliedEffect[] {
  return applied.filter(a => a.effect.label === label && ROW_TARGETS.includes(a.effect.target));
}

/**
 * 這一列在（骰點, 強化 Lv）、套上局外加成之後的數值；列不存在或不是數字時回 null。
 * 盤面加成（board-buffs.ts）讀施加者的增益值用它：光「攻擊速度增益」＋1206 就是光給鄰格的攻速%，
 * 跟施加者自己卡片上那一列顯示的是同一個數。
 */
export function rowValue(
  params: readonly StatParams[],
  label: string,
  pips: number,
  level: number,
  applied: readonly AppliedEffect[],
): number | null {
  const p = params.find(x => x.label === label);
  const n = p ? numericAt(p, pips, level) : null;
  return n ? rowAfter(n.value, rowEffects(applied, label)) : null;
}

/**
 * 卡片內容。`applied` 是空陣列、`board` 沒傳（＝NO_BOARD）時，標題與每一列都跟一期 `cardModel()` 逐字相同、
 * 沒有括號、沒有子彈行（單元測試對全部骰子 × 骰點 × 強化 Lv 釘住）。
 */
export function bonusCardModel(
  name: string,
  pips: number,
  level: number,
  params: readonly StatParams[],
  applied: readonly AppliedEffect[],
  board: BoardBonus = NO_BOARD,
): BonusCard {
  const rows: BonusRow[] = [];
  for (const p of params) {
    const value = valueAt(p, pips, level);
    const n = numericAt(p, pips, level);
    if (!n) {
      rows.push({ label: p.label, value, bonus: null });
      continue;
    }
    if (p.label === ATTACK && p.kind === 'linear') {
      const pool = round9(sumOf(applied, 'attackPct') + board.attackPct);
      const panel = n.value + ceilClean((n.value * pool) / 100) + ceilClean((n.value * board.statusPct) / 100);
      rows.push({ label: p.label, value, bonus: formatDelta(panel - n.value, 0) });
      if (applied.some(a => BULLET_TARGETS.includes(a.effect.target))) {
        rows.push({ label: BULLET_LABEL, value: String(bulletAttack(panel, applied)), bonus: null, sub: true });
      }
      continue;
    }
    if (p.label === SPEED && p.kind === 'interval') {
      const final = intervalAfter(n.value, applied, board);
      rows.push({ label: p.label, value, bonus: formatDelta(round9(roundTo(final, n.decimals) - roundTo(n.value, n.decimals)), n.decimals) });
      continue;
    }
    const fx = rowEffects(applied, p.label);
    if (fx.length === 0) {
      rows.push({ label: p.label, value, bonus: null });
      continue;
    }
    const d = rowDecimals(n.decimals, fx);
    rows.push({ label: p.label, value, bonus: formatDelta(round9(roundTo(rowAfter(n.value, fx), d) - roundTo(n.value, d)), d) });
  }
  return { title: cardTitle(name, pips, level), rows };
}

const fmt = (n: number): string => formatNumber(n, 3);

function head(group: readonly AppliedEffect[]): string {
  const a = group[0]!;
  if (group.length > 1) return `${a.effect.name} ×${group.length}`;
  return a.effect.maxLevel > 1 ? `${a.effect.name} Lv.${a.level}` : a.effect.name;
}

function numericText(group: readonly AppliedEffect[], params: readonly StatParams[], pips: number, level: number): string {
  const e = group[0]!.effect;
  const v = round9(group.reduce((s, a) => s + effectValue(a.effect, a.level), 0));
  const p = params.find(x => x.label === e.label);
  const unit = (p && numericAt(p, pips, level)?.unit) ?? '';
  switch (e.target) {
    case 'attackPct': return `攻擊 +${fmt(v)}%`;
    case 'intervalPct': return `攻速 +${fmt(v)}%`;
    case 'bulletIntervalPct': return `子彈攻速 +${fmt(v)}%`;
    case 'critPct': return `暴擊率 +${fmt(v)}%`;
    case 'bulletPct':
    case 'hitAttackMul': return `子彈 ×${fmt(1 + v / 100)}`;
    case 'hitAttackFlat': return `子彈 +${fmt(Math.ceil(v))}`;
    case 'statMul': return `${e.label} ×${fmt(1 + v / 100)}`;
    case 'statSet': return `${e.label} ${fmt((e.setBase ?? 0) + Math.trunc(v))}${unit}`;
    case 'statAdd': {
      const d = (e.sign ?? 1) * (e.int ? Math.trunc(v) : v);
      return `${e.label} ${d < 0 ? MINUS : '+'}${fmt(Math.abs(d))}${unit}`;
    }
    default:
      return '';
  }
}

function mechanicText(a: AppliedEffect): string {
  const e = a.effect;
  if (!e.template) return e.text ?? '';
  return e.template.replaceAll('{V2}', fmt(effectValue2(e, a.level))).replaceAll('{V}', fmt(effectValue(e, a.level)));
}

/**
 * 明細面板的兩段：數值類（同名同 target 的節點合成一行，例：15 顆「所有骰子傷害」）與機制類。
 * 順序照 appliedEffects() 的節點 id 排序、以每一組第一次出現的位置為準。
 */
export function detailLines(
  params: readonly StatParams[],
  pips: number,
  level: number,
  applied: readonly AppliedEffect[],
): DetailLines {
  const mechanic: string[] = [];
  const groups = new Map<string, AppliedEffect[]>();
  for (const a of applied) {
    if (a.effect.target === 'mechanic') {
      mechanic.push(`${head([a])}：${mechanicText(a)}`);
      continue;
    }
    const key = `${a.effect.target} ${a.effect.name} ${a.effect.label ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  const offgame = [...groups.values()].map(g => `${head(g)}：${numericText(g, params, pips, level)}`);
  return { offgame, mechanic };
}
