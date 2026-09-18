// 站台端讀 tree.json 的唯一入口：傳輸形狀在這裡還原成 TreeData（見 tree-wire.ts）。
import raw from '../generated/tree.json';
import { decodeTree } from './tree-wire.js';

export const treeData = decodeTree(raw);
