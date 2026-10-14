// 瀏覽器腳本讀建置產物的入口（/tree、/sim）。
// tree.json 跟著腳本一起到；tree-text.json（描述、覺醒、關鍵字解釋）用動態 import 另外載，
// 到了之後就地補進同一份 treeData。`treeTextReady` 兌現之前，節點的 description 是空字串、
// 沒有 awakening、meta.glossary 是空物件：要顯示這三樣的地方等它兌現再畫（或兌現後重畫一次）。
import raw from '../generated/tree.json';
import { applyTreeText, decodeTree } from './tree-wire.js';

export const treeData = decodeTree(raw);

/**
 * 文字包補進 treeData 之後兌現。**不會拒絕**：載不到（斷線、剛好跨在部署前後）時記一筆錯誤照樣兌現，
 * 呼叫端照常往下走，詳情卡片少了描述，但樹、搜尋名稱、計算都還能用。
 */
export const treeTextReady: Promise<void> = import('../generated/tree-text.json')
  .then(m => applyTreeText(treeData, m.default))
  .catch((e: unknown) => console.error('tree-text.json 載入失敗，詳情卡片不會有描述', e));
