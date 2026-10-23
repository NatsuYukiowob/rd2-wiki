/**
 * 介面語言。正體中文是預設語言、網址不帶前綴（`/tree/`）；其他語言掛在自己的前綴底下（`/vi/tree/`）。
 *
 * 每一頁只有一份 `.astro`：`src/pages/vi/` 底下是轉呼叫原頁面的薄殼，語言由網址決定
 * （`langFromPath(Astro.url.pathname)`），不從 props 傳——頁面裡的子元件與瀏覽器腳本
 * （讀 `<html lang>`）才拿得到同一個答案。
 *
 * ⚠️ 只翻介面文字。`data/` 的遊戲文案（節點名稱、描述、戰術、怪物…）仍是中文，
 * 翻譯資料是另一件事（validate 規則與 join key 都綁著中文名稱）。
 */
import { zh, type Messages } from './messages-zh';
import { vi } from './messages-vi';

export const LANGS = ['zh', 'vi'] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = 'zh';

export interface LangMeta {
  /** `<html lang>` 與 hreflang 的值。 */
  readonly tag: string;
  /** 語言選單裡的名稱，一律用該語言自己的寫法。 */
  readonly label: string;
  /** 導覽列上的短標。 */
  readonly short: string;
}

export const LANG_META: Record<Lang, LangMeta> = {
  zh: { tag: 'zh-Hant', label: '繁體中文', short: '中文' },
  vi: { tag: 'vi', label: 'Tiếng Việt', short: 'VI' },
};

/** 使用者選過的語言（語言選單寫入、`Base.astro` 的 head script 讀）。 */
export const LANG_STORAGE_KEY = 'rd2-wiki:lang';

const MESSAGES: Record<Lang, Messages> = { zh, vi };

export function messages(lang: Lang): Messages {
  return MESSAGES[lang];
}

const PREFIX = /^\/(vi)(?=\/|$)/;

export function langFromPath(pathname: string): Lang {
  const m = PREFIX.exec(pathname);
  return m ? (m[1] as Lang) : DEFAULT_LANG;
}

/** 拿掉語言前綴，回到預設語言的路徑：`/vi/tree/` → `/tree/`、`/vi` → `/`。 */
export function stripLang(pathname: string): string {
  const rest = pathname.replace(PREFIX, '');
  return rest === '' ? '/' : rest;
}

/**
 * 站內路徑換成某個語言的版本。輸入一律是預設語言的寫法（可帶 `?query`／`#hash`），
 * 已經帶前綴的路徑先剝掉再加，所以重複呼叫不會疊成 `/vi/vi/`。
 */
export function localizePath(path: string, lang: Lang): string {
  if (!path.startsWith('/')) return path;
  const base = stripLang(path);
  if (lang === DEFAULT_LANG) return base;
  return base === '/' ? `/${lang}/` : `/${lang}${base}`;
}

/** 綁定語言的 `localizePath`，頁面裡寫成 `href={link('/tree/')}`。 */
export function linker(lang: Lang): (path: string) => string {
  return path => localizePath(path, lang);
}
