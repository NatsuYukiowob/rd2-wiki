// 建置期（.astro 的 frontmatter）讀建置產物的入口：兩個檔合起來還原成完整的 TreeData（見 tree-wire.ts）。
// ⚠️ 瀏覽器腳本不要 import 這個檔：它會把文字包整份打進首屏的 JS，等於沒拆。瀏覽器端走 tree-client.ts。
import raw from '../generated/tree.json';
import text from '../generated/tree-text.json';
import { decodeTree } from './tree-wire.js';

export const treeData = decodeTree(raw, text);
