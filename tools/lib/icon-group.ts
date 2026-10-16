// 裂縫效果「同一組檔位」的判定，`validate.ts`（規則 27(g)）與 `add-icon.ts`（`--rift-shop`）共用。
//
// 客戶端只給 `*Low` 畫圖，`*Mid`／`*High` 在遊戲裡沿用同一張，所以一組＝`gameId` 去掉
// Low／Mid／High 尾巴。⚠️ 不用 `name` 分組：「掌握弱點I／II／III」三個檔位名字不同、圖卻是同一張
// （`ReduceBossHpLow`），用名字分組就得另外寫死 id 清單，而 add-icon 換圖時只會換到其中一筆。

/** 一筆裂縫效果所屬的檔位組；`gameId` 沒填時回 `undefined`（不跟任何一筆同組）。 */
export function riftIconGroup(rec: { gameId?: unknown }): string | undefined {
  return typeof rec.gameId === 'string' && rec.gameId !== '' ? rec.gameId.replace(/(Low|Mid|High)$/, '') : undefined;
}
