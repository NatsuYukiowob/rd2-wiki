// 遊戲文案的譯本（`data/i18n/<lang>/nodes.json`＋`keywords.json`）：建置期組成一包
// `src/generated/tree-text-<lang>.json`，站台在該語言的頁面上把它疊回 TreeData。
//
// 譯本裡的 `#標記` 用的是譯名（`#Bỏng`），不是原文詞；斷詞照樣走白名單＋最長優先
// （src/lib/markup.ts），白名單換成譯名清單。詞的顏色跟原文同一條（同色＝同一類機制）。
// 原文的別名（`#播種` → `#果實`）在譯本裡直接寫本尊的譯名，所以譯本詞彙表只收本尊。
import { extractKeywords } from './keywords.js';
import { textColor } from './glossary-groups.js';
import { isGlossaryAlias } from './types.js';
import type { GlossaryDisplay, GlossaryRecord, TreeData } from './types.js';

export interface LocaleNodeText {
  name: string;
  label?: string;
  description: string;
  awakening?: string;
  /** `data/unlock-exceptions.json` 的 `note` 譯文：正本有 note 的節點必填，其餘不准有。 */
  unlockNote?: string;
}
export interface LocaleKeyword { term: string; desc: string }
/** 原文節點 id → 譯文。 */
export type LocaleNodes = Record<string, LocaleNodeText>;
/** 原文詞（本尊）→ 譯名與解釋。 */
export type LocaleKeywords = Record<string, LocaleKeyword>;

/** 譯本建置產物。陣列與 tree.json 的 `nodes` 同序；`awakening` 只有骰子有，用 id 當鍵。 */
export interface TreeLocaleWire {
  name: string[];
  label: string[];
  description: string[];
  awakening: Record<string, string>;
  unlockNote: Record<string, string>;
  keywords: string[][];
  glossary: Record<string, GlossaryDisplay>;
}

const NUMBER = /\d+(?:\.\d+)?/g;
const numbers = (s: string) => (s.match(NUMBER) ?? []).sort();

export const MAX_LOCALE_LABEL_LENGTH = 20;

/** 頁面內嵌名稱與標籤的 `<script type="application/json">` 的 id（`TreeLocaleLabels.astro` 寫、tree-client.ts 讀）。 */
export const LOCALE_LABELS_ID = 'tree-locale-labels';

/**
 * 譯本與原文對不上的地方，一筆一句。空陣列＝可以建置。
 *
 * 數字逐一比對（排序後相同）：譯文語序會變，但值一個都不能少、不能多——描述裡的數字就是
 * 玩家來查的東西，譯錯一個比沒翻還糟。
 */
export function localeIssues(
  source: Record<string, { description: string; awakening?: string }>,
  nodes: LocaleNodes,
  sourceKeywords: Record<string, GlossaryRecord>,
  keywords: LocaleKeywords,
): string[] {
  const issues: string[] = [];
  for (const id of Object.keys(source)) if (!nodes[id]) issues.push(`節點 ${id} 沒有譯文`);
  for (const id of Object.keys(nodes)) if (!source[id]) issues.push(`譯文 ${id} 不是正本的節點`);

  const canon = Object.keys(sourceKeywords).filter(k => !isGlossaryAlias(sourceKeywords[k]!));
  for (const k of canon) if (!keywords[k]) issues.push(`詞 ${k} 沒有譯名`);
  for (const k of Object.keys(keywords)) if (!canon.includes(k)) issues.push(`譯名 ${k} 不是正本的本尊詞`);
  const terms = Object.values(keywords).map(k => k.term);
  for (const t of new Set(terms.filter((t, i) => terms.indexOf(t) !== i))) issues.push(`譯名 ${t} 重複`);

  const check = (where: string, text: string) => {
    try { extractKeywords(text, terms); } catch (e) { issues.push(`${where}：${(e as Error).message}`); }
  };
  for (const [k, v] of Object.entries(keywords)) {
    if (!v.term.trim() || !v.desc.trim()) issues.push(`詞 ${k} 的譯名或解釋是空的`);
    check(`詞 ${k} 的解釋`, v.desc);
  }

  for (const [id, src] of Object.entries(source)) {
    const t = nodes[id];
    if (!t) continue;
    if (!t.name.trim() || !t.description.trim()) issues.push(`節點 ${id} 的名稱或描述是空的`);
    const label = t.label ?? t.name;
    if ([...label].length > MAX_LOCALE_LABEL_LENGTH) issues.push(`節點 ${id} 的標籤超過 ${MAX_LOCALE_LABEL_LENGTH} 字：${label}`);
    if (t.label === t.name) issues.push(`節點 ${id} 的 label 跟 name 相同，省略即可`);
    if (Boolean(src.awakening) !== Boolean(t.awakening)) issues.push(`節點 ${id} 的覺醒有無跟正本不一致`);
    check(`節點 ${id} 的描述`, t.description);
    check(`節點 ${id} 的覺醒`, t.awakening ?? '');
    for (const [field, a, b] of [['描述', src.description, t.description], ['覺醒', src.awakening ?? '', t.awakening ?? '']] as const) {
      const [x, y] = [numbers(a), numbers(b)];
      if (x.join() !== y.join()) issues.push(`節點 ${id} 的${field}數字對不上：正本 [${x}]、譯文 [${y}]`);
    }
  }
  return issues;
}

/** 組出譯本建置產物。呼叫前先確認 `localeIssues()` 是空的。 */
export function buildLocaleText(
  data: TreeData,
  nodes: LocaleNodes,
  sourceKeywords: Record<string, GlossaryRecord>,
  keywords: LocaleKeywords,
): TreeLocaleWire {
  const byTerm = new Map(Object.entries(keywords).map(([k, v]) => [v.term, { source: k, ...v }]));
  const terms = [...byTerm.keys()];
  const text = data.nodes.map(n => {
    const t = nodes[n.id];
    if (!t) throw new Error(`節點 ${n.id} 沒有譯文`);
    if (Boolean(n.unlockNote) !== Boolean(t.unlockNote)) throw new Error(`節點 ${n.id} 的 unlockNote 有無跟 data/unlock-exceptions.json 不一致`);
    return t;
  });
  const glossary: Record<string, GlossaryDisplay> = {};
  const pending = [...new Set(text.flatMap(t => extractKeywords(t.description + (t.awakening ?? ''), terms)))];
  while (pending.length > 0) {
    const term = pending.pop()!;
    if (glossary[term]) continue;
    const k = byTerm.get(term)!;
    const record = sourceKeywords[k.source];
    if (!record || isGlossaryAlias(record)) throw new Error(`譯名 ${term} 對不到正本的本尊詞`);
    glossary[term] = { color: textColor(record.color), desc: k.desc };
    pending.push(...extractKeywords(k.desc, terms));
  }
  return {
    name: text.map(t => t.name),
    label: text.map(t => t.label ?? t.name),
    description: text.map(t => t.description),
    awakening: Object.fromEntries(data.nodes.flatMap((n, i) => (text[i]!.awakening ? [[n.id, text[i]!.awakening!]] : []))),
    unlockNote: Object.fromEntries(data.nodes.flatMap((n, i) => (text[i]!.unlockNote ? [[n.id, text[i]!.unlockNote!]] : []))),
    keywords: text.map(t => extractKeywords(t.description, terms)),
    glossary: Object.fromEntries(Object.keys(glossary).sort().map(k => [k, glossary[k]!])),
  };
}

/**
 * 靜態頁（/dice、/guide/keywords、節點清單）用的詞彙表：鍵換成譯名，`code`（錨點）與色碼沿用原文，
 * 別名不收（譯本只寫本尊）。形狀跟 `data/keywords.json` 一樣，直接餵 `buildGlossary()`。
 */
export function localizeKeywords(
  sourceKeywords: Record<string, GlossaryRecord>,
  keywords: LocaleKeywords,
): Record<string, GlossaryRecord> {
  const out: Record<string, GlossaryRecord> = {};
  for (const [k, record] of Object.entries(sourceKeywords)) {
    const t = keywords[k];
    if (isGlossaryAlias(record) || !t) continue;
    out[t.term] = { code: record.code, color: record.color, desc: t.desc };
  }
  return out;
}

/** 只換名稱與標籤（畫布一開始就要畫的那兩樣）。 */
export function applyLocaleLabels(data: TreeData, wire: Pick<TreeLocaleWire, 'name' | 'label'>): void {
  if (wire.name.length !== data.nodes.length) throw new Error('譯本的節點數跟 tree.json 不同，不是同一次建置的產物');
  data.nodes.forEach((n, i) => {
    n.name = wire.name[i]!;
    n.label = wire.label[i]!;
  });
}

/** 把譯本整包疊回 TreeData（就地修改）。 */
export function applyLocale(data: TreeData, wire: TreeLocaleWire): void {
  applyLocaleLabels(data, wire);
  data.nodes.forEach((n, i) => {
    n.description = wire.description[i]!;
    n.keywords = wire.keywords[i]!;
    const a = wire.awakening[n.id];
    if (a) n.awakening = a;
    else delete n.awakening;
    const note = wire.unlockNote[n.id];
    if (note) n.unlockNote = note;
  });
  data.meta.glossary = wire.glossary;
}
