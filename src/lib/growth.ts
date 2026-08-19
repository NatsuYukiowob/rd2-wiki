import type { Growth, GrowthUnit } from './types.js';

/**
 * 成長值的字面格式，例如「20%(+4%)」「50倍(+10)」「1.5秒(+-0.2秒)」。
 *
 * ⚠️ 數字部分刻意寫成 `\d{1,6}(?:\.\d{1,20})?` 而不是 `[\d.]+`：
 *
 * - `[\d.]+` 是「數字或小數點」的字元類，配上後面的 `\s*\(` 會產生災難性回溯——
 *   一段 20 萬位的數字（描述欄位是貢獻者填的）能讓這個正則跑上數十秒，而 validate 是
 *   fork PR 也會跑到的工作，等於送人一個燒 CI 額度的按鈕。
 * - 它也會吃下 `1.2.3`、`...` 這種東西，`Number()` 給回 NaN 卻沒有人發現。
 *
 * 位數上限本身就是資料規則，但小數位要留得夠寬：正本裡的數值是從遊戲的 float32 抄出來的，
 * 帶著 `1.2000000476837158` 這種 17 位小數的雜訊（round2() 就是為了它存在）。整數位實測最長 4 位。
 */
const PATTERN = /(-?\d{1,6}(?:\.\d{1,20})?)\s*(%|秒|次|個|倍)?\s*\(\+(-?\d{1,6}(?:\.\d{1,20})?)\s*(%|秒|次|個|倍)?\)/;

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toUnit(raw: string | undefined): GrowthUnit {
  if (raw === '%') return '%';
  if (raw === '秒') return 's';
  if (raw === '次' || raw === '個') return 'count';
  if (raw === '倍') return 'x';
  return '';
}

export function parseGrowth(description: string): { growth: Growth | null; dataIssue: 'placeholder' | null } {
  if (/\{\d+\}/.test(description)) return { growth: null, dataIssue: 'placeholder' };
  const m = PATTERN.exec(description);
  if (!m) return { growth: null, dataIssue: null };
  // 正則沒有錨點（成長值可以出現在描述中間），所以「位數上限」只擋得住整段比對，擋不住
  // 「從第二位數字開始比對」——`9999999%(+1%)` 會match到後六位、`1.2.3%(+1%)` 會match到 `2.3`，
  // 兩種都是安靜地解出半個數字。比對位置的前一個字元是數字或小數點時，代表這段數字本身就寫壞了。
  // （刻意用「比對後再檢查」而不是 lookbehind：這支程式也會被打包進瀏覽器端，而
  // 負向 lookbehind 在較舊的 Safari 上是 parse-time 語法錯誤，會讓整包 JS 直接不執行。）
  const before = m.index > 0 ? description[m.index - 1]! : '';
  if (/[\d.]/.test(before)) {
    throw new Error(`成長值的數字寫壞了（位數超過上限或含多個小數點）: ${description}`);
  }
  const outer = toUnit(m[2]);
  const inner = toUnit(m[4]);
  // 兩邊都明確標了單位卻不同，才視為資料錯誤（例如「20%(+4秒)」）。
  // 節點 2208「距離等比傷害倍率增加50倍(+10)」括號內省略了單位，此時視為沿用
  // 括號外已標記的單位，不當成錯誤——全站掃過只有這一個節點是這種省略寫法。
  if (m[2] !== undefined && m[4] !== undefined && outer !== inner) {
    throw new Error(`成長值單位不一致 (${m[2]} vs ${m[4]}): ${description}`);
  }
  const unit = outer || inner;
  const base = Number(m[1]);
  const perLevel = Number(m[3]);
  // 正則已經擋掉多數壞格式，這裡是最後一道：NaN／Infinity 一旦進到 growth，站台會顯示
  // 「NaN%」而所有檢查照樣全綠。
  if (!Number.isFinite(base) || !Number.isFinite(perLevel)) {
    throw new Error(`成長值不是有限數 (${m[1]} / ${m[3]}): ${description}`);
  }
  return {
    growth: { base: round2(base), perLevel: round2(perLevel), unit },
    dataIssue: null,
  };
}

export function maxLevelValue(growth: Growth, maxLevel: number): number {
  return round2(growth.base + growth.perLevel * (maxLevel - 1));
}
