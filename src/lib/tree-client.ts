// 瀏覽器腳本讀建置產物的入口（/tree、/sim）。
// tree.json 跟著腳本一起到；tree-text.json（描述、覺醒、關鍵字解釋）用動態 import 另外載，
// 到了之後就地補進同一份 treeData。`treeTextReady` 兌現之前，節點的 description 是空字串、
// 沒有 awakening、meta.glossary 是空物件：要顯示這三樣的地方等它兌現再畫（或兌現後重畫一次）。
//
// 非預設語言的頁面：名稱與標籤由頁面內嵌（`TreeLocaleLabels.astro`），模組一載入就換掉，畫布第一次
// 畫就是譯名；描述、覺醒與詞彙表改載 `tree-text-<lang>.json`，一樣在 `treeTextReady` 兌現時補上。
import raw from '../generated/tree.json';
import { applyTreeText, decodeTree } from './tree-wire.js';
import { LOCALE_LABELS_ID, applyLocale, applyLocaleLabels, type TreeLocaleWire } from './tree-locale.js';
import { documentLang } from './i18n.js';

export const treeData = decodeTree(raw);

const lang = documentLang();
const inline = typeof document === 'undefined' ? null : document.getElementById(LOCALE_LABELS_ID);
if (lang !== 'zh' && inline?.textContent) applyLocaleLabels(treeData, JSON.parse(inline.textContent));

/**
 * 文字包補進 treeData 之後兌現。**不會拒絕**：載不到（斷線、剛好跨在部署前後）時記一筆錯誤照樣兌現，
 * 呼叫端照常往下走，詳情卡片少了描述，但樹、搜尋名稱、計算都還能用。
 */
export const treeTextReady: Promise<void> = (lang === 'vi'
  ? import('../generated/tree-text-vi.json').then(m => applyLocale(treeData, m.default as TreeLocaleWire))
  : import('../generated/tree-text.json').then(m => applyTreeText(treeData, m.default)))
  .catch((e: unknown) => console.error('tree-text.json 載入失敗，詳情卡片不會有描述', e));
