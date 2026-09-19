// /board 數值卡片的計算層：從 data/dice-stats.json 的四個檔位反推每一項的成長參數，
// 再算任意（骰點, 局內強化 Lv）組合的顯示字串。純函式，不碰 DOM。
//
// ⚠️ 參數是「反推」出來的，刻意不另存一份：四檔本身就是拿客戶端表的 _LvAdd（骰點）／
// _UpAdd（局內強化）算出來的（見 CLAUDE.md「data/dice-stats.json」第 4 點），這裡只做代數還原。
// 還原的前提是兩軸各自等差、彼此可加——deriveParams() 對每一項驗這個前提，不成立就丟例外。
// 規則 23(i)（tools/validate.ts）與 board.astro 的建置期注入共用這一支，不要複製第二份。
import type { DiceStat, DiceStatsTable } from './types.js';

/** 官方對「攻擊間隔隨骰點等分」的寫法，逐字比對 dice-stats.json 的 diceGrowth。 */
export const INTERVAL_GROWTH = '基礎值 ÷ 骰點';
/** 官方自己空著的格子（CLAUDE.md 明文允許的值），處理方式見 deriveParams() 的說明。 */
export const PENDING = '待實測';
/** 攻擊間隔一律顯示到小數第 3 位——官方四檔就是這個精度（例：0.143 秒/次）。 */
const INTERVAL_DECIMALS = 3;
/** 攻擊間隔 ÷7 檢查的容差：官方值已四捨五入到 3 位，誤差上限 0.0005。 */
const INTERVAL_TOLERANCE = 0.0005;

export type StatParams =
  | { kind: 'const'; label: string; text: string }
  | { kind: 'pending'; label: string; base: string }
  | { kind: 'linear'; label: string; base: number; perPip: number; perLevel: number; unit: string; decimals: number }
  | { kind: 'interval'; label: string; base: number; perLevel: number; unit: string; decimals: number };

const NUM = /^(-?\d+(?:\.\d+)?)(.*)$/;

export interface Parsed { value: number; unit: string; decimals: number }

/** 把「750」「0.5秒」這種字串拆成數值／單位／小數位；開頭不是數字就回 null。numericAt() 的常數列也共用這支。 */
export function parseNumber(text: string): Parsed | null {
  const m = NUM.exec(text);
  if (!m) return null;
  const digits = m[1]!;
  const dot = digits.indexOf('.');
  return { value: Number(digits), unit: m[2]!, decimals: dot < 0 ? 0 : digits.length - dot - 1 };
}

function parse(label: string, key: string, text: string): Parsed {
  const p = parseNumber(text);
  if (!p) throw new Error(`${label} 的 ${key}「${text}」開頭不是數字`);
  return p;
}

/** 收到 9 位小數，吸收浮點雜訊（例：(1.5 − 1.2) / 6 = 0.04999999999999999）。 */
export function round9(n: number): number {
  return Math.round(n * 1e9) / 1e9;
}

export function decimalsOf(n: number): number {
  return round9(Math.abs(n)).toFixed(9).split('.')[1]!.replace(/0+$/, '').length;
}

function assertClean(label: string, what: string, delta: number): void {
  const scaled = delta * 1000;
  if (Math.abs(scaled - Math.round(scaled)) > 1e-6) {
    throw new Error(`${label} 反推出的${what}成長 ${delta} 超過 3 位小數（四檔之間可能不是等差）`);
  }
}

/**
 * 四捨五入（half-up）到 decimals 位，再去掉尾端的 0。
 *
 * 先 round9 再走「字串指數」（`'1.005000000e2'`），避開 `1.005 * 100 = 100.49999…` 那種乘法捨入誤差。
 * ⚠️ 只對非負數保證 half-up（Math.round 對負數的 .5 是往 +∞）：四檔全是非負、兩軸單調，中間值也非負。
 */
export function formatNumber(n: number, decimals: number): string {
  const r = Math.round(Number(`${round9(n).toFixed(9)}e${decimals}`)) / 10 ** decimals;
  return String(Object.is(r, -0) ? 0 : r);
}

/**
 * 一項數值的成長參數。
 *
 * - 沒有四檔 → `const`（原字串照印）。
 * - 任一檔是「待實測」→ `pending`：(1,1) 印 base，其餘一律「待實測」。⚠️ 不能讓它觸發下面的守門
 *   ——那是 CLAUDE.md 明文允許的值，觸發就等於把 CI 弄紅；也不能退回 base，那會冒充「不會變」。
 * - `diceGrowth === INTERVAL_GROWTH` → `interval`：(base + perLevel×(Lv−1)) ÷ 骰點。
 * - 其餘 → `linear`：base + perPip×(骰點−1) + perLevel×(Lv−1)。
 *
 * 守門（任一不成立就丟例外，訊息以 label 開頭）：四檔開頭都是數字、單位後綴一致、Δ 在 3 位小數內、
 * linear 的 lv15dice7 ＝ dice7 ＋ lv15 − base（兩軸可加）、interval 的 dice7 ≈ base÷7 且 lv15dice7 ≈ lv15÷7。
 * 小數位＝max(四檔字串的小數位, Δ 的小數位)：有 12 項的 Δ 比四檔還細（D005 尖刺持續時間 Lv.2＝7.25s）。
 */
export function deriveParams(stat: DiceStat): StatParams {
  const { label, dice7, lv15, lv15dice7 } = stat;
  if (dice7 === undefined || lv15 === undefined || lv15dice7 === undefined) {
    return { kind: 'const', label, text: stat.base };
  }
  const texts = [stat.base, dice7, lv15, lv15dice7];
  if (texts.includes(PENDING)) return { kind: 'pending', label, base: stat.base };

  const b = parse(label, 'base', stat.base);
  const d7 = parse(label, 'dice7', dice7);
  const l15 = parse(label, 'lv15', lv15);
  const both = parse(label, 'lv15dice7', lv15dice7);
  const all = [b, d7, l15, both];
  if (all.some(p => p.unit !== b.unit)) {
    throw new Error(`${label} 四個檔位的單位不一致：${texts.join('／')}`);
  }

  const perLevel = round9((l15.value - b.value) / 14);
  assertClean(label, '每級強化', perLevel);

  if (stat.diceGrowth === INTERVAL_GROWTH) {
    const pairs: [Parsed, Parsed, string][] = [[b, d7, 'dice7'], [l15, both, 'lv15dice7']];
    for (const [one, seven, key] of pairs) {
      if (Math.abs(seven.value - one.value / 7) > INTERVAL_TOLERANCE) {
        throw new Error(`${label} 標成「${INTERVAL_GROWTH}」，但 ${key} 是 ${seven.value}，不等於 ${one.value} ÷ 7`);
      }
    }
    return { kind: 'interval', label, base: b.value, perLevel, unit: b.unit, decimals: INTERVAL_DECIMALS };
  }

  const perPip = round9((d7.value - b.value) / 6);
  assertClean(label, '每骰點', perPip);
  const additive = round9(d7.value + l15.value - b.value);
  if (Math.abs(both.value - additive) > 1e-6) {
    throw new Error(`${label} 兩軸不可加：lv15dice7 是 ${both.value}，dice7＋lv15−base 是 ${additive}（成長可能不是等差）`);
  }
  const decimals = Math.max(...all.map(p => p.decimals), decimalsOf(perPip), decimalsOf(perLevel));
  return { kind: 'linear', label, base: b.value, perPip, perLevel, unit: b.unit, decimals };
}

/**
 * 這一項在（骰點, 強化 Lv）時的數值；不是數字（「前方」「—」「待實測」）時回 null。
 * 成長公式只寫在這裡：valueAt() 的顯示字串與 offgame-calc.ts 的局外加成都從這支取值，改公式兩邊一起跟上。
 */
export function numericAt(p: StatParams, pips: number, level: number): Parsed | null {
  switch (p.kind) {
    case 'pending':
      return null;
    case 'const':
      return parseNumber(p.text);
    case 'interval':
      return { value: (p.base + p.perLevel * (level - 1)) / pips, unit: p.unit, decimals: p.decimals };
    case 'linear':
      return { value: round9(p.base + p.perPip * (pips - 1) + p.perLevel * (level - 1)), unit: p.unit, decimals: p.decimals };
  }
}

/** 骰點 pips、局內強化 level 時這一項的顯示字串。夾制是呼叫端的事（clampPips／clampSp）。 */
export function valueAt(p: StatParams, pips: number, level: number): string {
  switch (p.kind) {
    case 'const':
      return p.text;
    case 'pending':
      return pips === 1 && level === 1 ? p.base : PENDING;
    case 'interval':
    case 'linear': {
      const n = numericAt(p, pips, level)!;
      return formatNumber(n.value, n.decimals) + n.unit;
    }
  }
}

/** 整張表反推，鍵＝gameId。任一項不成立就丟例外，訊息前面補上 gameId 與骰子名——給建置期用。 */
export function deriveTable(table: DiceStatsTable): Record<string, StatParams[]> {
  const out: Record<string, StatParams[]> = {};
  for (const [gameId, entry] of Object.entries(table)) {
    out[gameId] = entry.stats.map(s => {
      try {
        return deriveParams(s);
      } catch (err) {
        throw new Error(`${gameId}（${entry.name}）${(err as Error).message}`);
      }
    });
  }
  return out;
}
