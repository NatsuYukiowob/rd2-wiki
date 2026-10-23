// 戰術與怪物圖鑑的譯本（`data/i18n/<lang>/tactics.json`／`boss.json`）：以 id 為鍵，只蓋文字欄位，
// 階段、可用模式、圖示這些 join key 一律沿用正本。`#標記` 寫譯名（見 tree-locale.ts 檔頭）。
import { extractKeywords } from './keywords.js';
import type { Boss, Tactic } from './types.js';

export interface LocaleTactic {
  name: string;
  versus?: string;
  coop?: string;
  options?: Record<string, { name: string; text: string }>;
}
export interface LocaleBoss { name: string; effect: string }

export function localizeTactics(source: Tactic[], local?: Record<string, LocaleTactic>): Tactic[] {
  if (!local) return source;
  return source.map(t => {
    const o = local[t.id];
    if (!o) return t;
    const out: Tactic = { ...t, name: o.name };
    if (t.versus && o.versus) out.versus = o.versus;
    if (t.coop && o.coop) out.coop = o.coop;
    if (t.options) out.options = t.options.map(op => ({ ...op, ...o.options?.[op.id] }));
    return out;
  });
}

export function localizeBosses(source: Boss[], local?: Record<string, LocaleBoss>): Boss[] {
  if (!local) return source;
  return source.map(b => (local[b.id] ? { ...b, ...local[b.id] } : b));
}

const flatTactic = (t: { name: string; versus?: string; coop?: string }, options: [string, { name: string; text: string }][]) => {
  const out: Record<string, string> = { name: t.name };
  if (t.versus !== undefined) out.versus = t.versus;
  if (t.coop !== undefined) out.coop = t.coop;
  for (const [id, op] of options) {
    out[`${id}.name`] = op.name;
    out[`${id}.text`] = op.text;
  }
  return out;
};

const NUMBER = /\d+(?:\.\d+)?/g;
const numbers = (s: string) => (s.match(NUMBER) ?? []).sort().join();

function compare(
  label: string,
  source: Record<string, Record<string, string>>,
  local: Record<string, Record<string, string>>,
  sourceTerms: string[],
  terms: string[],
  translate: (term: string) => string | undefined,
): string[] {
  const issues: string[] = [];
  for (const id of Object.keys(source)) if (!local[id]) issues.push(`${label} ${id} 沒有譯文`);
  for (const id of Object.keys(local)) if (!source[id]) issues.push(`譯文 ${id} 不是正本的${label}`);
  for (const [id, src] of Object.entries(source)) {
    const loc = local[id];
    if (!loc) continue;
    const keys = new Set([...Object.keys(src), ...Object.keys(loc)]);
    for (const k of keys) {
      const [a, b] = [src[k], loc[k]];
      if (a === undefined || b === undefined) { issues.push(`${label} ${id} 的 ${k} 有無跟正本不一致`); continue; }
      if (!b.trim()) { issues.push(`${label} ${id} 的 ${k} 是空的`); continue; }
      if (numbers(a) !== numbers(b)) issues.push(`${label} ${id} 的 ${k} 數字對不上：正本 [${numbers(a)}]、譯文 [${numbers(b)}]`);
      try {
        const want = extractKeywords(a, sourceTerms).map(translate).sort().join();
        const got = extractKeywords(b, terms).sort().join();
        if (want !== got) issues.push(`${label} ${id} 的 ${k} #標記對不上：正本 [${want}]、譯文 [${got}]`);
      } catch (e) {
        issues.push(`${label} ${id} 的 ${k}：${(e as Error).message}`);
      }
    }
  }
  return issues;
}

export interface RecordTerms {
  /** 正本白名單（含別名）。 */
  sourceTerms: string[];
  /** 譯名白名單。 */
  terms: string[];
  /** 正本詞（含別名）→ 譯名。 */
  translate: (term: string) => string | undefined;
}

export function tacticLocaleIssues(source: Tactic[], local: Record<string, LocaleTactic>, k: RecordTerms): string[] {
  const src = Object.fromEntries(source.map(t => [t.id, flatTactic(t, (t.options ?? []).map(o => [o.id, o]))]));
  const loc = Object.fromEntries(Object.entries(local).map(([id, t]) => [id, flatTactic(t, Object.entries(t.options ?? {}))]));
  return compare('戰術', src, loc, k.sourceTerms, k.terms, k.translate);
}

export function bossLocaleIssues(source: Boss[], local: Record<string, LocaleBoss>, k: RecordTerms): string[] {
  const src = Object.fromEntries(source.map(b => [b.id, { name: b.name, effect: b.effect }]));
  const loc = Object.fromEntries(Object.entries(local).map(([id, b]) => [id, { name: b.name, effect: b.effect }]));
  return compare('怪物', src, loc, k.sourceTerms, k.terms, k.translate);
}
