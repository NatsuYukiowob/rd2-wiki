// 測試讀建置產物的唯一入口：tree.json 是傳輸形狀（label 去重、icon 是索引），要先還原成 TreeData。
import { readFileSync } from 'node:fs';
import { decodeTree } from '../../src/lib/tree-wire';
import type { TreeData } from '../../src/lib/types';

export function readTree(): TreeData {
  return decodeTree(JSON.parse(readFileSync(new URL('../../src/generated/tree.json', import.meta.url), 'utf8')));
}
