// 測試讀建置產物的唯一入口：tree.json 是傳輸形狀（label 去重、icon 是索引），文字另在
// tree-text.json，兩個檔合起來才還原成完整的 TreeData。
import { readFileSync } from 'node:fs';
import { decodeTree } from '../../src/lib/tree-wire';
import type { TreeData } from '../../src/lib/types';

export function readTree(): TreeData {
  const read = (name: string) => JSON.parse(readFileSync(new URL(`../../src/generated/${name}`, import.meta.url), 'utf8'));
  return decodeTree(read('tree.json'), read('tree-text.json'));
}
