import type { Branch, NodeType } from './types.js';

const BRANCH_DIGIT: Record<Branch, string> = {
  nature: '1', engineering: '2', magic: '3', order: '4', chaos: '5',
};

/**
 * 某分支 × 某類型可用的 2 碼字首。
 *
 * 符文回傳三個候選（次碼 2/3/4）而不是硬選一個：實測資料裡 1201、2403、5302 並存，
 * 次碼代表的是遊戲自己的符文子分類，沒有可以從「分支＋類型」推導出來的規則。
 * 由編輯器 UI 顯示各字首的使用狀況讓玩家挑，比在這裡猜一個安全。
 */
export function prefixesFor(branch: Branch, type: NodeType): string[] {
  const b = BRANCH_DIGIT[branch];
  if (type === 'dice') return [`${b}0`];
  if (type === 'rune') return [`${b}2`, `${b}3`, `${b}4`];
  return [`${b}1`]; // passive 與 support 共用次碼 1（見 src/lib/taxonomy.ts 的編碼說明）
}

/** 在指定字首下配出下一個未使用的 4 碼 id。 */
export function allocateId(existingIds: Iterable<string>, prefix: string): string {
  if (!/^[1-5][0-4]$/.test(prefix)) throw new Error(`不合法的 id 字首: ${prefix}`);
  const used = new Set(existingIds);
  for (let i = 1; i <= 99; i++) {
    const id = `${prefix}${String(i).padStart(2, '0')}`;
    if (!used.has(id)) return id;
  }
  throw new Error(`字首 ${prefix} 已無可用編號（01–99 全部用完）`);
}
