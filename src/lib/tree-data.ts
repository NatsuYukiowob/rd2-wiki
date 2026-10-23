// 建置期（.astro 的 frontmatter）讀建置產物的入口：兩個檔合起來還原成完整的 TreeData（見 tree-wire.ts）。
// ⚠️ 瀏覽器腳本不要 import 這個檔：它會把文字包整份打進首屏的 JS，等於沒拆。瀏覽器端走 tree-client.ts。
import raw from '../generated/tree.json';
import text from '../generated/tree-text.json';
import textVi from '../generated/tree-text-vi.json';
import { decodeTree } from './tree-wire.js';
import keywordsZh from '../../data/keywords.json';
import keywordsVi from '../../data/i18n/vi/keywords.json';
import { applyLocale, localizeKeywords, type LocaleKeywords, type TreeLocaleWire } from './tree-locale.js';
import type { Lang } from './i18n.js';
import type { GlossaryRecord, TreeData } from './types.js';

export const treeData = decodeTree(raw, text);

const LOCALE_TEXT: Partial<Record<Lang, TreeLocaleWire>> = { vi: textVi as TreeLocaleWire };
const cache = new Map<Lang, TreeData>();

/** 該語言的 TreeData：節點名稱、描述、覺醒與詞彙表換成譯本，其餘欄位跟 `treeData` 相同。 */
export function treeDataFor(lang: Lang): TreeData {
  const wire = LOCALE_TEXT[lang];
  if (!wire) return treeData;
  let data = cache.get(lang);
  if (!data) {
    data = decodeTree(raw, text);
    applyLocale(data, wire);
    cache.set(lang, data);
  }
  return data;
}

/** 頁面內嵌給瀏覽器腳本的名稱與標籤（畫布第一次畫就要用，不能等動態載入）。 */
export function localeLabelsFor(lang: Lang): Pick<TreeLocaleWire, 'name' | 'label'> | null {
  const wire = LOCALE_TEXT[lang];
  return wire ? { name: wire.name, label: wire.label } : null;
}

const LOCALE_KEYWORDS: Partial<Record<Lang, LocaleKeywords>> = { vi: keywordsVi };

/** 該語言的詞彙表，形狀同 `data/keywords.json`（靜態頁的 `buildGlossary()` 吃這個）。 */
export function keywordsFor(lang: Lang): Record<string, GlossaryRecord> {
  const source = keywordsZh as Record<string, GlossaryRecord>;
  const t = LOCALE_KEYWORDS[lang];
  return t ? localizeKeywords(source, t) : source;
}
