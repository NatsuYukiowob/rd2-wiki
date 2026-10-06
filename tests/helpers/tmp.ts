// 測試用的暫存目錄。**測試裡一律用這支，不要直接呼叫 `mkdtempSync`**（tests/helpers/tmp.test.ts 守）。
//
// 直接 mkdtemp 不清的話，跑一次 `npm test` 會在 /tmp 留下幾十個目錄（有的是整套圖示的複本）；
// 這台的 /tmp 是有配額的 tmpfs，累積到滿之後 E2E 會大面積 `Page crashed`，看起來跟程式改壞一模一樣。
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished } from 'vitest';

/**
 * 建一個暫存目錄，**這條測試結束時（不論成敗）自動刪掉**。
 * 只能在 `it()` 本體（或它呼叫的函式）裡用——在 `describe` 層或 `beforeAll` 呼叫時，
 * vitest 的 `onTestFinished` 會直接丟例外。
 * ⚠️ 先登記清理、再建目錄：反過來的話，丟例外那一刻目錄已經建好了，每跑一次漏一個。
 */
export function tmpDir(prefix: string): string {
  let dir: string | undefined;
  onTestFinished(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  dir = mkdtempSync(join(tmpdir(), prefix));
  return dir;
}
