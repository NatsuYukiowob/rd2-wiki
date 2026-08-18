/**
 * Node 端的 parseTree：注入 linkedom 版 DOM 之後轉呼叫 src/lib/svg-parse.ts 的共用實作。
 * 簽章刻意維持 1 個參數不變，既有呼叫端（build-data、validate、既有測試）都不必改。
 */
import { loadSvg } from './dom.js';
import { parseTreeWith } from '../../src/lib/svg-parse.js';

export {
  parseTranslate,
  parseEdgePath,
  type RawNode,
  type RawEdge,
  type RawMeta,
} from '../../src/lib/svg-parse.js';

export function parseTree(svgText: string) {
  return parseTreeWith(svgText, loadSvg);
}
