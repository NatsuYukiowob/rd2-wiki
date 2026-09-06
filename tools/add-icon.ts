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
  // 跟 validate 規則 2 同一個編碼規律：首碼＝分支 1-5、次碼＝ 0-6，其後兩碼任意。
  if (!/^[1-5][0-6]\d\d$/.test(nodeId)) throw new Error(`節點 id 不符編碼規律: ${nodeId}`);

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

/** `addRecordIcon()` 的結果：`addIcon()` 的全部欄位，外加那一筆原本的雜湊。 */
export interface AddRecordIconResult extends AddIconResult {
  /** 這一筆原本的 `icon`；先前沒填過時為 `null`。換圖時舊檔通常就此沒人引用（規則 24(d)／25(d) 會警告，不擋 PR）。 */
  previousHash: string | null;
}

/**
 * 把一張圖加進「一筆一個 id、雜湊寫在紀錄 `icon` 欄」的資料檔——`data/tactics.json`（戰術）、
 * `data/boss.json`（Boss）與 `data/rift-shop.json`（裂縫效果）共用。
 *
 * 存在的理由跟 `addBoardIcon()` 一模一樣：規則 24／25／27 擋下「新增一條戰術／一個 Boss／
 * 一條裂縫效果」這個動作，但**沒有工具放得進那三個 `data/*-icons`**的話，貢獻者只能自己算
 * 雜湊、自己改 JSON——2026-08-23 規則 21 就是這樣把人卡在一條他讀不到的規則上（review F10）。
 *
 * ⚠️ **只更新既有那一筆的 `icon`，不新增紀錄**：一條新戰術要填的是名稱、階段、模式、效果
 * 全文與內部ID，那些只有看著官方資料表的人知道，這支工具猜不出來——猜出一筆半空的紀錄反而
 * 會通過 (e) 以外的每一條檢查。找不到 id 就直接失敗，並且**在圖被寫進目錄之前**失敗。
 */
export function addRecordIcon(
  srcPath: string,
  id: string,
  opts: { iconsDir: string; dataPath: string },
): AddRecordIconResult {
  if (!existsSync(opts.dataPath)) throw new Error(`找不到資料檔: ${opts.dataPath}`);
  const records: { id?: unknown; icon?: unknown }[] = JSON.parse(readFileSync(opts.dataPath, 'utf8'));
  if (!Array.isArray(records)) throw new Error(`${opts.dataPath} 的最外層不是陣列`);
  const index = records.findIndex(r => r.id === id);
  // 先找到那一筆再動檔案系統：找不到就失敗時，目錄裡不該留下一張沒人引用的孤兒圖。
  if (index < 0) throw new Error(`${opts.dataPath} 裡沒有 id 為 ${JSON.stringify(id)} 的紀錄；請先把那一筆的其餘欄位補進資料檔`);

  const result = addIcon(srcPath, opts.iconsDir);
  const record = records[index]!;
  const previousHash = typeof record.icon === 'string' ? record.icon : null;
  record.icon = result.hash;
  // 縮排與結尾換行照正本原樣（2 空格 + 換行）。⚠️ **不重新排序**：這兩份檔案的陣列順序
  // 就是畫面上的顯示順序（官方編號序，子選項跟在母條目後面），排一次就是一份看不出改了
  // 哪一筆的整檔 diff。
  writeFileSync(opts.dataPath, `${JSON.stringify(records, null, 2)}\n`);

  return { ...result, previousHash };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const usage = [
    '用法:',
    '  npm run add-icon -- <圖片路徑>                     節點圖示 → data/icons/',
    '  npm run add-icon -- --board <節點 id> <圖片路徑>    /board 純骰子圖 → data/board-icons/，並更新 data/board-icons.json',
    '  npm run add-icon -- --tactic <戰術編號> <圖片路徑>  戰術圖 → data/tactic-icons/，並更新 data/tactics.json 那一筆的 icon',
    '  npm run add-icon -- --boss <Boss 編號> <圖片路徑>   Boss 圖 → data/boss-icons/，並更新 data/boss.json 那一筆的 icon',
    '  npm run add-icon -- --rift-shop <效果編號> <圖片路徑>  裂縫效果圖 → data/rift-shop-icons/，並更新 data/rift-shop.json 那一筆的 icon',
  ].join('\n');
  try {
    // 戰術、Boss 與裂縫效果走同一條分支：三者的資料檔形狀相同（陣列 ＋ 每筆自帶 icon），
    // 差別只有目錄與檔名。分成三段 if 只會讓三邊的提示訊息各自漂移。
    //
    // ⚠️ 裂縫效果是 **35 張圖對 55 筆**（同名的三個檔位共用一張）：換掉其中一個檔位的圖
    // 之後，同名的另外兩筆仍然指著舊雜湊——所以底下那句孤兒檔提醒的「若沒有別筆在用」
    // 對這份檔案是常態而不是例外，看到它先確認同名的兄弟要不要一起換。
    const RECORD_KINDS = {
      '--tactic': { label: '戰術', iconsDir: 'data/tactic-icons', dataPath: 'data/tactics.json' },
      '--boss': { label: 'Boss', iconsDir: 'data/boss-icons', dataPath: 'data/boss.json' },
      '--rift-shop': { label: '裂縫效果', iconsDir: 'data/rift-shop-icons', dataPath: 'data/rift-shop.json' },
    } as const;
    const kind = RECORD_KINDS[args[0] as keyof typeof RECORD_KINDS];
    if (kind) {
      const [, id, src] = args;
      if (!id || !src) {
        console.error(usage);
        process.exit(1);
      }
      const result = addRecordIcon(src, id, kind);
      console.log(result.alreadyExists
        ? `${kind.label}圖已存在，未重複寫入：${result.fileName}`
        : `已新增${kind.label}圖：${result.fileName}`);
      console.log(`已把 ${kind.dataPath} 的 ${id} 指到 ${result.hash}`);
      if (result.previousHash && result.previousHash !== result.hash) {
        console.log(`⚠️  ${id} 原本指向 ${result.previousHash}.png；若沒有別筆在用，`
          + `${kind.iconsDir}/${result.previousHash}.png 就成了孤兒檔（npm run validate 會警告），確認後可以刪掉`);
      }
    } else if (args[0] === '--board') {
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
