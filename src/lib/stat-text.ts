// `data/dice-stats.json` 的文字（項目名、固定值、成長寫法、備註）在畫面上的譯文。
//
// ⚠️ 只在**顯示**時換：/board 的局外加成用中文項目名對 `offgame-effects.json` 的 `label`
// （src/lib/offgame-calc.ts），資料本身換成譯文會讓那層對照全部落空而畫面不報錯。
// 整句對得上的查 `data/i18n/<lang>/dice-stats.json`，帶數字的寫法（單位、「每提升N骰點」）走下面的樣式。
import vi from '../../data/i18n/vi/dice-stats.json';
import type { Lang } from './i18n.js';

const TERMS: Partial<Record<Lang, Record<string, string>>> = { vi };

const PATTERNS: Partial<Record<Lang, readonly [RegExp, string][]>> = {
  vi: [
    [/^每提升(\d+)骰點：/, 'Mỗi +$1 chấm: '],
    [/^每強化(\d+)級：/, 'Mỗi +$1 cấp cường hóa: '],
    [/^無變化$/, 'Không đổi'],
    [/^骰點不變$/, 'Không đổi theo chấm'],
    [/^基礎值 ÷ 骰點$/, 'Giá trị gốc ÷ số chấm'],
    [/秒\/次/g, 'giây/lần'],
    [/傷害\/層/g, 'sát thương/tầng'],
    [/(\d)倍/g, '$1 lần'],
  ],
};

/** 一段骰子數值表的文字在該語言的寫法；沒有譯本的語言原樣交回。 */
export function statText(text: string, lang: Lang): string {
  const terms = TERMS[lang];
  if (!terms) return text;
  const whole = terms[text];
  if (whole !== undefined) return whole;
  let out = text;
  for (const [re, to] of PATTERNS[lang] ?? []) out = out.replace(re, to);
  return out;
}
