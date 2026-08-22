import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { readPngSize } from './lib/png.js';

export interface AddIconResult {
  /** sha256 前 12 碼，同時也是不含副檔名的檔名。 */
  hash: string;
  /** 例如 `a1b2c3d4e5f6.png`。 */
  fileName: string;
  /** 完整目的路徑。 */
  destPath: string;
  /** 目的路徑先前就存在同名檔案（代表這張圖示先前已加過），此次呼叫不會覆寫。 */
  alreadyExists: boolean;
}

/**
 * 把來源圖片依內容雜湊命名、複製進 `iconsDir`，符合 CI 規則 7(b) 的「檔名＝內容 sha256 前 12 碼」要求。
 *
 * 貢獻者不需要自己手算雜湊、也不會因為手動命名而導致「改了內容卻沒改檔名」的快取污染問題
 * ——命名永遠由內容決定。驗證邏輯（有效 PNG + 最長邊 ≥ 96px）刻意與 `tools/validate.ts`
 * 規則 7(c) 共用同一支 `readPngSize`，避免兩處各自實作出不一致的判定。
 */
export function addIcon(srcPath: string, iconsDir: string): AddIconResult {
  if (!existsSync(srcPath)) throw new Error(`找不到來源檔案: ${srcPath}`);
  const buf = readFileSync(srcPath);

  const size = readPngSize(buf);
  if (!size) throw new Error(`來源檔案不是有效的 PNG: ${srcPath}`);
  const longest = Math.max(size.width, size.height);
  if (longest < 96) throw new Error(`圖示最長邊 ${longest}px，小於最低要求 96px: ${srcPath}`);

  const hash = createHash('sha256').update(buf).digest('hex').slice(0, 12);
  const fileName = `${hash}.png`;
  const destPath = join(iconsDir, fileName);
  const alreadyExists = existsSync(destPath);
  if (!alreadyExists) writeFileSync(destPath, buf);

  return { hash, fileName, destPath, alreadyExists };
}

/** `addBoardIcon()` 的結果：`addIcon()` 的全部欄位，外加對應表原本那筆的雜湊。 */
export interface AddBoardIconResult extends AddIconResult {
  /**
   * 這個節點原本在 `data/board-icons.json` 指向的雜湊；先前沒有這一筆時為 `null`。
   * 換圖時舊檔通常就此沒人引用——CLI 會提醒一句，validate 的規則 21(d) 也會警告（不擋 PR）。
   */
  previousHash: string | null;
}

/**
 * `/board` 骰盤編輯器的「純骰子圖」（不含底板）走的是跟節點圖示平行的一條資產路徑：
 * 圖放 `data/board-icons/`，而且 **`data/board-icons.json` 那一筆要一起更新**——少了任一邊，
 * CI 的規則 21 就會紅（漏對應＝21(a)，漏檔案＝21(f)）。
 *
 * 這支存在的理由就是那個「一起」：`npm run add-icon` 的目的地過去寫死成 `data/icons`，
 * 沒有任何工具放得進 `data/board-icons`，貢獻者只能自己算雜湊、自己改 JSON——而規則 21
 * 是 2026-08 才加的，指南裡一個字都沒提過這件事（2026-08-23 review F10）。
 *
 * 圖檔本身的檢查（有效 PNG、最長邊 ≥ 96px、依內容雜湊命名）直接重用 `addIcon()`，
 * 兩條資產路徑的判準因此不會各自漂移；**而且它先跑**，來源圖不合格時對應表不會被動到。
 *
 * ⚠️ 只驗 id 的**格式**，不驗「它是不是骰子」：那要讀正本兩個檔才知道，而 validate 的
 * 規則 21(a)／21(h) 本來就是幹這個的。這裡擋的是「手滑打錯一碼」這種當場就看得出來的錯。
 */
export function addBoardIcon(
  srcPath: string,
  nodeId: string,
  opts: { boardIconsDir: string; mapPath: string },
): AddBoardIconResult {
  // 跟 validate 規則 2 同一個編碼規律：首碼＝分支 1-5、次碼＝ 0-4，其後兩碼任意。
  if (!/^[1-5][0-4]\d\d$/.test(nodeId)) throw new Error(`節點 id 不符編碼規律: ${nodeId}`);

  const result = addIcon(srcPath, opts.boardIconsDir);

  const map: Record<string, string> = existsSync(opts.mapPath)
    ? JSON.parse(readFileSync(opts.mapPath, 'utf8'))
    : {};
  const previousHash = map[nodeId] ?? null;
  map[nodeId] = result.hash;
  // 依 id 排序後寫回：對應表是人在讀的，順序一亂，下一個人的 PR 就會夾帶一份整檔重排的
  // diff，真正改了哪一筆反而看不出來。縮排與結尾換行也照正本原樣（2 空格 + 換行）。
  const sorted = Object.fromEntries(Object.keys(map).sort().map(id => [id, map[id]!]));
  writeFileSync(opts.mapPath, `${JSON.stringify(sorted, null, 2)}\n`);

  return { ...result, previousHash };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const usage = [
    '用法:',
    '  npm run add-icon -- <圖片路徑>                     節點圖示 → data/icons/',
    '  npm run add-icon -- --board <節點 id> <圖片路徑>    /board 純骰子圖 → data/board-icons/，並更新 data/board-icons.json',
  ].join('\n');
  try {
    if (args[0] === '--board') {
      const [, nodeId, src] = args;
      if (!nodeId || !src) {
        console.error(usage);
        process.exit(1);
      }
      const result = addBoardIcon(src, nodeId, { boardIconsDir: 'data/board-icons', mapPath: 'data/board-icons.json' });
      console.log(result.alreadyExists
        ? `純骰子圖已存在，未重複寫入：board-icons/${result.fileName}`
        : `已新增純骰子圖：board-icons/${result.fileName}`);
      console.log(`已把 data/board-icons.json 的 ${nodeId} 指到 ${result.hash}`);
      if (result.previousHash && result.previousHash !== result.hash) {
        console.log(`⚠️  ${nodeId} 原本指向 ${result.previousHash}.png；若沒有別的節點在用，`
          + `data/board-icons/${result.previousHash}.png 就成了孤兒檔（npm run validate 會警告），確認後可以刪掉`);
      }
    } else {
      const src = args[0];
      if (!src) {
        console.error(usage);
        process.exit(1);
      }
      const result = addIcon(src, 'data/icons');
      if (result.alreadyExists) {
        console.log(`圖示已存在，未重複寫入：icons/${result.fileName}`);
      } else {
        console.log(`已新增圖示：icons/${result.fileName}`);
      }
      console.log(`請在 SVG 中使用：href="icons/${result.fileName}"`);
    }
  } catch (e) {
    console.error(`❌ ${(e as Error).message}`);
    process.exit(1);
  }
}
