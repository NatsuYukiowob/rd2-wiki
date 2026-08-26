import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { parseTree, COORD_TOLERANCE } from './lib/svg-parse.js';
import { MAX_TEXT_LENGTH, checkNodeTextRecord, mergeNodes, type NodeTextMap, type RawNode } from './lib/node-text.js';
import { parseCost } from '../src/lib/cost.js';
import { maxLevelValue, parseGrowth } from '../src/lib/growth.js';
import { extractKeywords } from '../src/lib/keywords.js';
import { checkChangelog } from '../src/lib/changelog.js';
import { groupOfColor } from '../src/lib/glossary-groups.js';
import { branchOfId, categoryOfZh, elementOfStroke, typeOfZh } from '../src/lib/taxonomy.js';
import { buildAdjacency, detectCycle, findRoots, unreachableFrom } from '../src/lib/graph.js';
import { readPngSize } from './lib/png.js';
import { isGlossaryAlias } from '../src/lib/types.js';
import { expandTier } from '../src/lib/upgrade-tiers.js';
import type { Edge, GlossaryRecord, MaxLevelOfficial, UpgradeCostTable, UpgradeTier } from '../src/lib/types.js';

/**
 * 資料樹的預期根節點（各分支的第一個骰子）。
 * 若真實資料的根集合與此不同，代表結構被改壞或有節點斷線，必須人工確認再更新此常數。
 */
const EXPECTED_ROOTS = ['1001', '2001', '3001', '4008', '5002'];

/**
 * 畫布尺寸。改這個數字＝改整張圖的座標系，`src/scripts/tree-canvas.ts` 的縮放推算、
 * `tests/e2e` 的幾何斷言、以及 CLAUDE.md 記的那組不變量都跟著它——所以它是常數不是變數。
 * 遊戲改版真的需要換畫布時，是連同上面那些一起改，不是讓 CI 默默放行。
 */
const EXPECTED_VIEWBOX: [number, number, number, number] = [0, 0, 2000, 1700];

/**
 * 兩顆節點中心至少要離這麼遠。
 *
 * 規則 5 是用「離這個座標最近、容差 0.5 以內」的節點來決定邊接到誰的。兩顆節點疊在一起時，
 * 同一個端點會同時對上兩顆，`find()` 取到哪一顆只看它們在 SVG 裡的先後順序——把重複的那顆
 * 往上挪一行，整條前置鏈就換人了，而 diff 只有兩行位置對調。實測正本最近的一對相距 40。
 */
const MIN_NODE_DISTANCE = 5;

/**
 * 遊戲資料表的管理 ID，**格式綁死節點型別**：骰子 `D000`、骰子技能 `D0000`、共通節點 `S0200`。
 *
 * 不寫成一個寬鬆的 `/^[DS]\d{3,4}$/`：那樣把符文的 `D0000` 改成 `D123`、或把玩家被動的
 * `S0201` 改成 `D0201`，只要不撞號就照樣過關——而 `gameId` 刻意不進 tree.json，
 * 這條規則是它唯一的防線，寬鬆等於沒有。（實測 239 個節點完全符合這組對應。）
 */
const GAME_ID_BY_TYPE: Record<string, RegExp> = {
  '骰子': /^D\d{3}$/,
  '骰子符文': /^D\d{4}$/,
  '玩家被動': /^S\d{4}$/,
  '支援': /^S\d{4}$/,
};

/**
 * 圖示來源檔的最低解析度（最長邊）。`data/icons/` 與 `data/board-icons/` 共用同一個下限，
 * 因為兩邊的入口都是 `addIcon()`（`tools/add-icon.ts`），那支工具擋的就是這個數字——
 * 工具擋得比閘門鬆或緊，都會變成「加得進來、CI 卻不收」或反過來。
 */
const MIN_ICON_LONGEST_EDGE = 96;

/** `checkHashNamedIconDir()` 的結果。錯誤與警告由呼叫端自己併進 errors／warnings。 */
interface HashNamedIconDirScan {
  /** 目錄裡實際存在的 `.png` 檔名（去掉副檔名）＝可被引用的雜湊集合。 */
  hashes: Set<string>;
  /** 雜湊 → PNG 尺寸。**不是有效 PNG 的不會進來**，呼叫端用「查不到」代表「(c) 已經報過了」。 */
  sizes: Map<string, { width: number; height: number }>;
  errors: string[];
  warnings: string[];
}

/**
 * 掃一個「檔名＝內容 sha256 前 12 碼」的圖示目錄：檔名與內容相符、是有效且夠大的 PNG、
 * 沒有孤兒檔、沒有站台根本不會用到的雜檔。
 *
 * 規則 7（`data/icons/`）與規則 21（`data/board-icons/`）掃的是同一種目錄，2026-08-23 以前
 * 是兩份相隔 200 行的複製實作——而且**已經漂移**：規則 21 那份不驗 PNG 結構與解析度（放一張
 * 用 sha256 命名的純文字檔進去，validate 一個字都不說，直到 `npm run build` 由 sharp 噴出
 * 一句不含任何節點 id 的 `unsupported image format`）、逐 entry 讀檔算雜湊（同一張圖被 k 個
 * id 共用就噴 k 條一模一樣的錯、同一個檔案讀 k 次）、孤兒檔的嚴重度還跟規則 7 相反。
 * 所以這裡只留一份，兩邊的差別只剩呼叫端傳進來的規則編號與解析度下限。
 *
 * 子規則編號在兩條規則之間**刻意對齊**：(b) 檔名≠內容雜湊、(c) PNG 結構與解析度、
 * (d) 孤兒檔（只警告）。同一件事在兩條規則裡是同一個字母。
 *
 * ⚠️ **目錄讀不到時回傳一條錯誤，不拋例外。** 驗證器是 CI 的閘門，任何一個檔案系統入口
 * 拋出去都會把前面累積的錯誤一起丟掉，CLI 印出來的會是 stack trace 而不是「❌ N 個問題」
 * （實測：`mv data/board-icons` 之後 `npm run validate` 噴原始 ENOENT，其餘規則一條都沒跑）。
 *
 * @param referenced 「有人引用到」的雜湊集合；不在裡面的檔案就是孤兒檔。
 */
function checkHashNamedIconDir(
  dir: string,
  referenced: ReadonlySet<string>,
  opts: { rule: string; minLongestEdge: number },
): HashNamedIconDirScan {
  const scan: HashNamedIconDirScan = { hashes: new Set(), sizes: new Map(), errors: [], warnings: [] };
  let fileNames: string[];
  try {
    fileNames = readdirSync(dir);
  } catch (e) {
    scan.errors.push(`${opts.rule}: 讀不到圖示目錄 ${dir}（${(e as Error).message}）`);
    return scan;
  }
  for (const fileName of fileNames) {
    const filePath = join(dir, fileName);
    // 只掃小寫 `.png` 會讓 `abc.PNG`／`old.webp`／`.DS_Store` 在下面每一條檢查裡完全隱形：
    // 把一個雜湊對不上的檔案改名成 `.PNG` 就直接繞過 (b) 的比對，而站台端只認小寫 `.png`
    // ——那個檔案是死的。所以不當作不存在，至少警告一條。
    if (!fileName.endsWith('.png')) {
      scan.warnings.push(`${opts.rule}: ${filePath} 不是小寫 .png 檔，站台不會使用它（檔名一律是內容 sha256 前 12 碼 ＋ .png）`);
      continue;
    }
    const expectedHash = fileName.slice(0, -'.png'.length);
    scan.hashes.add(expectedHash);
    const buf = readFileSync(filePath);
    // (b): 檔案內容的 sha256 前 12 碼必須等於檔名，防止「改了內容卻沒改檔名」造成快取污染。
    const actualHash = createHash('sha256').update(buf).digest('hex').slice(0, 12);
    if (actualHash !== expectedHash) scan.errors.push(`${opts.rule}(b): 圖示 ${filePath} 的內容 sha256 前 12 碼為 ${actualHash}，與檔名不符`);
    // (c): 必須是有效 PNG，且最長邊 ≥ 下限。
    const size = readPngSize(buf);
    if (!size) {
      scan.errors.push(`${opts.rule}(c): 圖示 ${filePath} 不是有效的 PNG`);
    } else if (Math.max(size.width, size.height) < opts.minLongestEdge) {
      scan.errors.push(`${opts.rule}(c): 圖示 ${filePath} 最長邊 ${Math.max(size.width, size.height)}px，小於最低要求 ${opts.minLongestEdge}px`);
    } else {
      scan.sizes.set(expectedHash, size);
    }
    // (d): 沒有人引用的圖示，只警告不擋 PR——那只是 repo 裡多一個沒人用的 PNG，而擋下來
    // 會連「換圖忘了刪舊檔」這種無害的 PR 一起擋掉。
    if (!referenced.has(expectedHash)) scan.warnings.push(`${opts.rule}(d): 圖示 ${filePath} 未被任何節點引用`);
  }
  return scan;
}
/**
 * 掃一份「一筆一個 id、每筆自帶一張圖示雜湊」的資料檔——`data/tactics.json` 與
 * `data/boss.json` 共用（規則 24 與規則 25）。
 *
 * 這兩份是**第三、第四條資產路徑**：正本管線（規則 7）只處理 SVG 引用到的圖示，`/board`
 * 的純骰子圖（規則 21）另立一條，而戰術與 Boss 根本不是骰子樹的節點——它們不花錢解鎖、
 * 沒有前置、不進成本計算，所以連 `nodes.json` 那一側都沒有。少了這條規則，「漏一欄」
 * 「圖檔不存在」「兩條戰術指到同一張圖」「id 撞號」「`#標記` 打錯字」全部會安靜地通過 CI。
 *
 * ⚠️ **`data/board-icons.json` 是 `{id: hash}` 的對應表，這兩份不是**：戰術與 Boss 的資料
 * 本來就是我們自己的，沒有「要對到 SVG 裡的節點 id」這個約束，所以雜湊直接寫進紀錄的
 * `icon` 欄，一筆一個地方改，不必兩個檔案一起維護。
 *
 * 子規則編號跟規則 7／21 **刻意對齊**：(b) 檔名≠內容雜湊、(c) PNG 結構與解析度、
 * (d) 孤兒檔（只警告）——那三條由 `checkHashNamedIconDir()` 產生，同一件事在四條規則裡是
 * 同一個字母。這裡自己產的是 (a) 最外層形狀、(e) 每筆的欄位、(f) 指向的圖不存在、
 * (g) 兩筆共用同一張圖、(h) id 格式與撞號、(k) `#標記` 不在白名單。
 *
 * 回傳 `records` 給呼叫端做各自的語意檢查（規則 24 的階段／模式），**只含通過 (e) 的那些**
 * ——把結構壞掉的也交出去，呼叫端每一條語意檢查都得再判一次 `typeof`，而那正是漂移的起點。
 */
function checkIconedRecordList(
  raw: unknown,
  opts: {
    rule: string;
    file: string;
    iconsDir: string;
    idPattern: RegExp;
    /** 每一筆允許出現的欄位（含選填）；不在裡面的就是未知欄位。 */
    knownKeys: readonly string[];
    /** 每一筆都必須是非空字串的欄位。 */
    requiredText: readonly string[];
    /**
     * 選填、但**只要出現就必須是非空字串**的欄位。
     *
     * ⚠️ 這不是潔癖，是 2026-08-26 code review 抓到的真漏洞：`coop` 原本只擋空字串，
     * 寫成 `null`／`123`／`["x"]` 全部零錯誤通過——而頁面端 `t.coop ? '1' : undefined`
     * 對 `null` 是 falsy，那條戰術在合作模式下**整條消失**，正是 (j) 號稱要擋的失敗。
     * 同 `unlock-exceptions.json` 需要規則 18 驗 `unlockPaid` 型別的理由。
     */
    optionalText?: readonly string[];
    /** 要掃 `#關鍵字` 標記的欄位（選填欄位缺席時跳過）。 */
    markupKeys: readonly string[];
    /** `data/keywords.json` 的全部鍵，同規則 8 的白名單。 */
    whitelist: string[];
  },
): { records: Record<string, unknown>[]; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const push = (m: string) => errors.push(m);

  // (a) 最外層。跟規則 21 驗 board-icons.json 的最外層同一個理由：整份被寫成物件或字串時，
  // 底下每一條檢查都會拿到空集合而「安靜地全過」。
  if (!Array.isArray(raw)) {
    push(`${opts.rule}(a): ${opts.file} 的最外層必須是陣列`);
    return { records: [], errors, warnings };
  }
  if (raw.length === 0) {
    push(`${opts.rule}(a): ${opts.file} 是空陣列`);
    return { records: [], errors, warnings };
  }

  // (e) 每一筆的結構與欄位型別。這份檔案是社群 PR 直接改的，而頁面讀它時只有一個 `as`
  // ＝執行期零檢查（規則 18／21(e)／23 都是為了同一個理由才存在）。
  const known = new Set(opts.knownKeys);
  const records: Record<string, unknown>[] = [];
  for (let i = 0; i < raw.length; i++) {
    const rec = raw[i];
    // 訊息一律指得出「第幾筆」——這份檔案沒有鍵，只說「某一筆壞了」等於要人自己數。
    const at = `${opts.file} 第 ${i + 1} 筆`;
    if (!isPlainObject(rec)) { push(`${opts.rule}(e): ${at}必須是物件`); continue; }
    const label = typeof rec.id === 'string' && rec.id.length > 0 ? `${at}（id ${rec.id}）` : at;
    let ok = true;
    for (const key of opts.requiredText) {
      if (typeof rec[key] !== 'string' || (rec[key] as string).length === 0) {
        push(`${opts.rule}(e): ${label} 的 ${key} 必須是非空字串`);
        ok = false;
      } else if ((rec[key] as string).length > MAX_TEXT_LENGTH) {
        push(`${opts.rule}(e): ${label} 的 ${key} 超過 ${MAX_TEXT_LENGTH} 字`);
        ok = false;
      }
    }
    for (const key of opts.optionalText ?? []) {
      if (rec[key] === undefined) continue;
      if (typeof rec[key] !== 'string' || (rec[key] as string).length === 0) {
        push(`${opts.rule}(e): ${label} 的 ${key} 若存在就必須是非空字串（不用時整個欄位省略），目前是 ${JSON.stringify(rec[key])}`);
        ok = false;
      } else if ((rec[key] as string).length > MAX_TEXT_LENGTH) {
        push(`${opts.rule}(e): ${label} 的 ${key} 超過 ${MAX_TEXT_LENGTH} 字`);
        ok = false;
      }
    }
    for (const key of Object.keys(rec)) {
      // 未知欄位是錯不是潔癖：把 `coop` 打成 `co-op` 時，(e) 的必填檢查完全沉默
      // （它是選填的），畫面上「這條戰術合作模式沒有另一種效果」跟真的沒有一模一樣。
      if (!known.has(key)) { push(`${opts.rule}(e): ${label} 有未知欄位 ${JSON.stringify(key)}`); ok = false; }
    }
    // icon 的值必須是 12 碼小寫 hex。少了這條，值會被原封不動拿去組路徑（規則 21(e) 的
    // 實測：`{"icon": {"hash":"x"}}` 讓路徑變成 `[object Object].webp`）。
    if (typeof rec.icon !== 'string' || !/^[0-9a-f]{12}$/.test(rec.icon)) {
      push(`${opts.rule}(e): ${label} 的 icon ${JSON.stringify(rec.icon)} 不是 12 碼小寫 hex 的圖示雜湊`);
      ok = false;
    }
    if (ok) records.push(rec);
  }

  // (h) id 的格式與撞號。撞號時後面每一條檢查看起來都正常（兩筆都在、圖都在），
  // 畫面上是同一個編號出現兩次。
  const seen = new Map<string, number>();
  for (let i = 0; i < records.length; i++) {
    const id = records[i]!.id as string;
    if (!opts.idPattern.test(id)) push(`${opts.rule}(h): ${opts.file} 的 id ${JSON.stringify(id)} 不符 ${opts.idPattern.source}`);
    const first = seen.get(id);
    if (first !== undefined) push(`${opts.rule}(h): ${opts.file} 的 id ${id} 重複（第 ${first + 1} 筆與第 ${i + 1} 筆）`);
    else seen.set(id, i);
  }

  // (b)(c)(d) 目錄本身，與規則 7／21 共用（見 checkHashNamedIconDir 的說明）。
  const scan = checkHashNamedIconDir(opts.iconsDir, new Set(records.map(r => r.icon as string)), {
    rule: opts.rule,
    minLongestEdge: MIN_ICON_LONGEST_EDGE,
  });
  scan.errors.forEach(push);
  scan.warnings.forEach(m => warnings.push(m));

  // (f) 每一筆指向的圖都要真的在目錄裡。訊息印**實際讀取的路徑**而不是寫死的常數
  // ——測試會把圖複製到暫存目錄再驗，寫死等於指著一個好端端在那裡的檔案說它不存在
  // （規則 21(f) 記過同一件事，而且當時測試還一邊傳 tmpDir 一邊斷言寫死路徑）。
  for (const rec of records) {
    const hash = rec.icon as string;
    if (!scan.hashes.has(hash)) push(`${opts.rule}(f): ${opts.file} 的 ${rec.id} 指向的圖 ${join(opts.iconsDir, `${hash}.png`)} 不存在`);
  }

  // (g) 兩筆不准指向同一張圖。最常見的成因是「複製上一筆、忘了換成新加進來的那張」，
  // 而那時 (d)(f) 全部沉默：檔案存在、目錄裡也沒有多出來的孤兒檔（新圖從頭到尾沒被加
  // 進去過），畫面上就是兩條長得一模一樣的卡片。
  const idsByHash = new Map<string, string[]>();
  for (const rec of records) {
    const hash = rec.icon as string;
    idsByHash.set(hash, [...(idsByHash.get(hash) ?? []), rec.id as string]);
  }
  for (const [hash, ids] of idsByHash) {
    if (ids.length > 1) push(`${opts.rule}(g): ${opts.file} 的 ${ids.join('、')} 指向同一張圖 ${hash}.png`);
  }

  // (k) 效果文字裡的 `#標記` 必須落在 data/keywords.json 的白名單內——跟規則 8 對節點文案
  // 做的是同一件事。⚠️ 這條不是可有可無的：`renderStaticText()` 對比不到白名單的標記會
  // 原樣吐出一個裸的 `#`，而那在畫面上跟「上游漏填的佔位符」長得一模一樣（Boss 蛇王的
  // `召喚#一般怪物` 就一度被當成佔位符）。
  for (const rec of records) {
    for (const key of opts.markupKeys) {
      const text = rec[key];
      if (typeof text !== 'string') continue;
      try { extractKeywords(text, opts.whitelist); }
      catch (e) { push(`${opts.rule}(k): ${opts.file} 的 ${rec.id} 的 ${key} ${(e as Error).message}`); }
    }
  }

  return { records, errors, warnings };
}

export interface ValidateOpts {
  /**
   * `data/keywords.json` 的內容。key ＝不含 `#` 的詞（規則 8 的白名單），值是玩家看得到的解釋。
   * 兩個角色刻意共用一份檔案：分開放的話，白名單加了詞卻忘了寫解釋，兩邊都不會有人報錯。
   */
  keywords: Record<string, GlossaryRecord>;
  /**
   * `data/nodes.json` 的內容：以節點 id 為鍵的全部文案（2026-08-22 起正本 SVG 只剩幾何）。
   *
   * 型別刻意用 `unknown` 而不是 `NodeTextMap`：這份檔案是社群 PR 直接改的，validate 的職責
   * 之一就是驗它的結構（規則 1）。宣告成已驗過的型別，等於在型別層面假設「它一定合法」，
   * 而規則 1 要擋的正是不合法的那些。
   */
  nodeText: unknown;
  /**
   * `data/upgrade-cost.json`；沒有這份資料時傳 `null`。
   *
   * 刻意做成必填而不是可選：可選的話，哪天有人重構掉這個參數，規則 15 會安靜地不再執行，
   * 而所有測試照樣全綠。要跳過就得自己寫一個 `null` 出來，那是看得見的決定。
   */
  upgradeCostTable: UpgradeCostTable | null;
  /**
   * `data/maxlevel-official.json`；沒有這份資料時傳 `null`。
   *
   * 跟 `upgradeCostTable` 一樣刻意必填：規則 17 是描述文字被解析錯時唯一會說話的東西，
   * 讓它變成可選就等於讓它可以被安靜地關掉。
   */
  maxLevelOfficial: MaxLevelOfficial | null;
  /**
   * `data/unlock-exceptions.json`；沒有這份資料時傳 `null`。
   *
   * 一樣刻意必填。這個檔案在 2026-08-21 之前只有 2 筆、沒有任何顯示用途，所以沒人守它；
   * 現在它有 9 筆而且 `note` 會直接印在面板上，規則 18 就是它唯一的防線（見那條的說明）。
   */
  unlockExceptions: Record<string, { unlockVia: string; note?: string; unlockPaid?: unknown; bypassPrereq?: unknown }> | null;
  /**
   * `data/changelog.json`；沒有這份資料時傳 `null`。
   *
   * 跟其他資料檔一樣刻意必填。更新日誌是全站唯一**沒有自動來源**的內容，而「忘了寫」
   * 在畫面上跟「這次沒更新」長得一模一樣——規則 20 是它唯一的防線，可選就等於可以被
   * 安靜地關掉。
   */
  changelog: unknown;
  /** 圖示所在目錄；驗證器會實際讀取此目錄下的檔案內容做 sha256／PNG 結構檢查，並列出孤兒圖示。 */
  iconsDir: string;
  /**
   * 資料正本所在目錄，用來解析 SVG 裡的相對圖檔路徑（目前只有中央樞紐的 `tree-center.png`）。
   * 刻意跟 iconsDir 分開、也刻意不預設成 `dirname(iconsDir)`：測試會把圖示複製到暫存目錄再驗，
   * 那時 iconsDir 的上層根本不是資料目錄，靠推導只會去錯的地方找檔案然後報一個假的錯。
   */
  dataDir: string;
  /**
   * `data/board-icons.json`；沒有這份資料時傳 `null`。
   *
   * `/board` 骰盤編輯器用的是「純骰子圖」（不含底板），跟正本 SVG 引用的節點圖示是兩條
   * 平行的資產路徑——正本管線只處理 SVG 引用到的圖示，這批圖完全不在正本裡，所以沒有任何
   * 既有規則守得到它。跟其他資料檔一樣刻意必填：可選就等於可以被安靜地關掉。
   *
   * 型別刻意用 `unknown` 而不是 `Record<string, string>`（跟 `nodeText` 同一個理由）：
   * 這份檔案是社群 PR 直接改的，`build-data.ts` 讀它時也只有一個 `as`＝執行期零檢查。
   * 宣告成已驗過的型別，等於在型別層面假設「它一定合法」，而規則 21(e) 要擋的正是不合法的
   * 那些——`{"1001": {"hash":"x"}}` 在改成 `unknown` 之前會被直接 `join()` 成
   * `[object Object].png`，`{"1001": "../../data/nodes"}` 更是讓閘門去讀目錄外的檔案。
   */
  boardIcons: unknown;
  /**
   * `data/board-icons/` 所在目錄；規則 21 讀取此目錄下的檔案內容做 sha256 比對，並列出孤兒檔案。
   * 跟 iconsDir 一樣刻意分開傳入（不推導自 dataDir）：測試會把圖示複製到暫存目錄再驗。
   */
  boardIconsDir: string;
  /**
   * `data/passive-upgrade-cost.json`；沒有這份資料時傳 `null`。
   *
   * 型別刻意用 `unknown`（同 `boardIcons`／`nodeText`）：這份檔案是社群 PR 直接改的，
   * `/sim` 讀它時也只有一個 `as`。宣告成已驗過的型別，等於在型別層面假設它一定合法。
   *
   * 跟其他資料檔一樣刻意必填。這份資料**不進 `tree.json`**（tier 是
   * `(maxLevel, unlockCost.gold)` 的純函數），代價是「表與節點對不上」在產物層面完全沒有
   * 痕跡：一顆節點對不到 tier，`/sim` 只會安靜地不讓它升級——跟「這顆本來就不能升級」在
   * 畫面上一模一樣。規則 22 是它唯一的防線。
   */
  passiveUpgradeCost: unknown;
  /**
   * `data/dice-stats.json`：41 顆骰子的基本能力值與強化數據（官方資料表的兩個分頁併成一份）。
   *
   * 型別刻意用 `unknown`（同 `boardIcons`／`passiveUpgradeCost`）：這份檔案是社群 PR 直接改的，
   * 宣告成已驗過的型別等於在型別層面假設它一定合法，而規則 23 要擋的正是不合法的那些。
   * 沒有這份資料時傳 `null`，規則 23 只警告——`/dice` 的數值區跟著整塊不顯示，站台照常運作。
   */
  diceStats: unknown;

  /**
   * `data/tactics.json` 的內容。型別刻意用 `unknown`（同 `boardIcons`／`diceStats`）：
   * 這份是社群 PR 直接改的，宣告成已驗過的型別等於在型別層面假設它一定合法，
   * 而規則 24 要擋的正是不合法的那些。沒有這份資料時傳 `null`，規則 24 只警告
   * ——`/tactic` 那一頁跟著整頁不建，站台其餘部分照常運作。
   */
  tactics: unknown;
  /** `data/tactic-icons/` 所在目錄；規則 24 讀此目錄比對雜湊並列出孤兒檔。 */
  tacticIconsDir: string;
  /** `data/boss.json` 的內容。同 `tactics`，沒有時傳 `null`。 */
  boss: unknown;
  /** `data/boss-icons/` 所在目錄。 */
  bossIconsDir: string;
}

export interface ValidateResult {
  /** 會擋下 PR 的問題；空陣列代表通過。 */
  errors: string[];
  /** 不擋 PR，但值得在 PR 摘要中提醒貢獻者／審閱者的事項（待接線節點、佔位符、孤兒圖示）。 */
  warnings: string[];
}

/**
 * CI 資料守門員：對 `data/dice-tree.svg` 做語意驗證。
 *
 * 這是社群 PR 唯一的自動化防線——SVG 的 diff 沒辦法逐行 review，所以每條規則的錯誤訊息
 * 都必須帶上足以定位問題的資訊（節點 id 或邊的座標／d 值），並在可行時保留既有工具
 * （svg-parse／cost／growth／keywords）拋出的引導語（例如「請先執行 npm run normalize」）。
 */
/** `typeOfZh` 的反向查表；只有規則 15 需要（它拿到的是英文型別，正本寫的是中文）。 */
/** 規則 22 與 23 共用：社群改得到的 JSON 拿進來時，第一件事都是問「它是不是一個普通物件」。 */
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const ZH_BY_TYPE: Record<string, string> = { dice: '骰子', rune: '骰子符文', passive: '玩家被動', support: '支援' };
const zhOfType = (t: string | undefined) => (t ? ZH_BY_TYPE[t] : undefined);
const typeOfZhSafe = (t: string | undefined) => (t ? ZH_BY_TYPE[t] !== undefined : false);

export function validate(svgText: string, opts: ValidateOpts): ValidateResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const push = (m: string) => errors.push(m);
  const warn = (m: string) => warnings.push(m);

  let parsed;
  try {
    parsed = parseTree(svgText);
  } catch (e) {
    // parseTree 本身已涵蓋「SVG 子集」規則（絕對 transform／絕對邊指令／直屬子元素／
    // 形狀元素／stroke／marker-end），一旦失敗代表資料連結構都不合法，其餘規則無從檢查起。
    return { errors: [`規則 0（SVG 子集）: ${(e as Error).message}`], warnings: [] };
  }
  const { nodes, edges } = parsed;
  const whitelist = Object.keys(opts.keywords);

  // 規則 1（先驗最外層）：整份檔案被寫成陣列或字串時，底下每一條規則都會拿到空集合而
  // 「安靜地全過」。這裡先給它一個有規則編號、看得懂該改哪個檔的錯誤，再往下走。
  let nodeText: Record<string, unknown> = {};
  if (typeof opts.nodeText === 'object' && opts.nodeText !== null && !Array.isArray(opts.nodeText)) {
    nodeText = opts.nodeText as Record<string, unknown>;
  } else {
    push('規則 1: data/nodes.json 的最外層必須是以 id 為鍵的物件');
  }

  // 規則 19: 正本 SVG 的 id 集合 ≡ data/nodes.json 的鍵集合（雙射，兩邊零殘餘）。
  //
  // 文案與幾何拆成兩個檔之後，這是唯一會說「它們已經不同步」的地方。少了這條，SVG 少一個
  // 節點只會讓 JSON 多一筆沒人引用的孤兒（畫面上安靜地少一顆），JSON 少一筆則會讓合併時
  // 丟出一個沒有規則編號、看不出該改哪個檔的例外。兩種殘餘都要**逐一列出 id**——239 個節點，
  // 只說「數量對不上」等於沒說。
  const textIds = new Set(Object.keys(nodeText));
  const geomIds = new Set(nodes.map(n => n.id));
  const missingText = [...geomIds].filter(id => !textIds.has(id));
  const orphanText = [...textIds].filter(id => !geomIds.has(id));
  if (missingText.length > 0) push(`規則 19: 這些節點在正本 SVG 有幾何、但 data/nodes.json 沒有文案：${missingText.join('、')}`);
  if (orphanText.length > 0) push(`規則 19: data/nodes.json 這些鍵在正本 SVG 找不到對應節點：${orphanText.join('、')}`);

  // 規則 1: data/nodes.json 的結構（欄位齊全、型別、長度、選用欄位不得寫成空字串）。
  //
  // 這條規則以前是「`<title>` 必須與 `data-*` 全等」——`<title>` 是 name ＋ description 的
  // 完整副本（23.5 KB），規則 1 的存在理由就是守那份副本。副本沒了，規則 1 就不再是「比對兩份
  // 文案」，而是「這份唯一的文案結構完不完整」。
  const structurallyBad = new Set<string>();
  for (const [id, rec] of Object.entries(nodeText)) {
    const msgs = checkNodeTextRecord(id, rec, MAX_TEXT_LENGTH);
    if (msgs.length > 0) structurallyBad.add(id);
    for (const m of msgs) push(`規則 1: ${m}`);
  }

  // 只有「兩邊都在、而且結構合法」的節點進得了 `withText`。硬合併壞掉的那幾筆只會再噴一輪
  // 「缺少 name」這種看起來無關、實際上是同一個問題的錯誤，把真正的原因埋掉。
  //
  // ⚠️ **這個過濾集合只給需要文案的規則用**（1／3／4／8／9／14／15／16／17）。幾何規則
  // （2／5／6／7／10／13／18／19）一律走完整的 `nodes`——它們跟文案無關，餵過濾後的集合
  // 等於「`nodes.json` 漏一筆」會被翻譯成幾十條指向 SVG 的假錯誤。實測刪掉 `1001` 一筆
  // 文案（幾何完好無缺）會產生 55 條錯誤，其中 54 條是規則 5／6／10／18 在說「從根不可達」
  // 「邊端點未對齊」——全都指錯檔案，而唯一說對的規則 19 被埋在裡面。而「忘了改另一個檔」
  // 正是兩檔正本之下最容易犯的錯。
  const withText: RawNode[] = mergeNodes(
    nodes.filter(n => textIds.has(n.id) && !structurallyBad.has(n.id)),
    Object.fromEntries(Object.entries(nodeText).filter(([id]) => geomIds.has(id) && !structurallyBad.has(id))) as NodeTextMap,
  );
  const gameIdSeen = new Map<string, string>();

  // 規則 2: id 唯一與編碼規律（首碼＝分支 1-5，次碼＝ 0-4，其後兩碼任意）
  const seen = new Set<string>();
  for (const n of nodes) {
    if (seen.has(n.id)) push(`規則 2: 重複的 id ${n.id}`);
    seen.add(n.id);
    if (!/^[1-5][0-4]\d\d$/.test(n.id)) push(`規則 2: id 不符編碼規律 ${n.id}`);
  }

  for (const n of withText) {
    // 規則 3: type 與 stroke（元素）對應——支援節點的 stroke 必須是 support 色，反之亦然
    try {
      const t = typeOfZh(n.typeZh);
      const el = elementOfStroke(n.stroke);
      branchOfId(n.id);
      if ((el === 'support') !== (t === 'support')) push(`規則 3: 節點 ${n.id} 的 stroke 與 type 不對應`);
    } catch (e) { push(`規則 3: 節點 ${n.id} ${(e as Error).message}`); }

    // 規則 4: 成本文法。`cost` 只寫錢，等級上限一律走 `maxLevel` 欄位。
    //
    // 搬家前等級上限有兩個寫法：123 個骰子符文寫在 `data-cost` 的第二行「最高 N 級」，
    // 40 個玩家被動寫在 `<title>` 最後一行「最高等級：N」。同一件事兩個位置，而且兩邊
    // **從不重疊**——所以舊版那條「兩者不一致就報錯」的交叉檢查其實一次都沒觸發過。
    // 現在只有一個位置，`parseCost` 直接拒絕第二行，不讓那個位置長回來。判斷寫在
    // `parseCost` 裡而不是這裡，是為了讓 build-data 與 validate 對同一份輸入給同一個答案。
    try { parseCost(n.costRaw); } catch (e) { push(`規則 4: 節點 ${n.id} 成本 ${(e as Error).message}`); }

    // 規則 8: 關鍵字白名單（# 標記必須能比對到白名單詞）
    try { extractKeywords(n.description, whitelist); } catch (e) { push(`規則 8: 節點 ${n.id} ${(e as Error).message}`); }

    // 規則 14: 骰子覺醒（nodes.json 的 `awakening`）。只有骰子有、而且每顆骰子都要有——
    // 「可有可無」的欄位在這裡是最糟的設計：漏填 40 顆只會讓面板少一段字，validate 全綠、
    // 節點數也沒變。長度上限由規則 1 一併把關（選用欄位也算在 MAX_TEXT_LENGTH 內）。
    if (n.typeZh === '骰子') {
      if (!n.awakening) push(`規則 14: 骰子 ${n.id} 缺少 awakening（每顆骰子都有 7 骰點覺醒效果）`);
      // 覺醒文字跟描述一樣會顯示給玩家、也帶 `#` 標記，同一套白名單規則
      try { extractKeywords(n.awakening, whitelist); } catch (e) { push(`規則 14: 節點 ${n.id} 的覺醒 ${(e as Error).message}`); }
    } else if (n.awakening) {
      push(`規則 14: 節點 ${n.id}（${n.typeZh}）不該有 awakening——覺醒是骰子專屬的`);
    }

    // 規則 16: 管理 ID 與細分類。管理 ID 是這份正本與遊戲資料表唯一對得起來的鍵，
    // 重複或漏填會讓「拿新版資源包來對」這件事失去依據，而站台完全不受影響——正因為
    // 站台不顯示它（不進 tree.json），這條規則是它唯一的防線。
    const gameIdPattern = GAME_ID_BY_TYPE[n.typeZh];
    // 型別本身不合法是規則 3 的事；這裡沒有對應樣式就跳過，不重複報一個看起來像別的問題的錯
    if (gameIdPattern && !gameIdPattern.test(n.gameId)) push(`規則 16: 節點 ${n.id}（${n.typeZh}）的 gameId ${JSON.stringify(n.gameId)} 不符合 ${gameIdPattern.source}`);
    else if (gameIdSeen.has(n.gameId)) push(`規則 16: gameId ${n.gameId} 重複（節點 ${gameIdSeen.get(n.gameId)} 與 ${n.id}）`);
    else gameIdSeen.set(n.gameId, n.id);
    if (n.typeZh === '玩家被動') {
      if (!n.categoryZh) push(`規則 16: 玩家被動 ${n.id} 缺少 category`);
      else { try { categoryOfZh(n.categoryZh); } catch (e) { push(`規則 16: 節點 ${n.id} ${(e as Error).message}`); } }
    } else if (n.categoryZh) {
      push(`規則 16: 節點 ${n.id}（${n.typeZh}）不該有 category——細分類只用在玩家被動上`);
    }

    // 規則 9: 成長值單位一致性；`{n}` 佔位符是上游資料問題，只警告不擋 PR
    try {
      const g = parseGrowth(n.description);
      if (g.dataIssue === 'placeholder') warn(`規則 9: 節點 ${n.id} 的成長值含 {n} 佔位符（上游資料尚未填值），不擋 PR`);
    } catch (e) { push(`規則 9: 節點 ${n.id} ${(e as Error).message}`); }
  }

  // 規則 8(b): 詞彙表自身。每個詞條的三個欄位都要有值，解釋文字裡的 `#` 標記也要查得到——
  // 那些解釋會跟著節點一起顯示給玩家（見 build-data 的傳遞閉包），解釋裡指到一個不存在的詞，
  // 面板上就是一個查不到東西的 `#`，而逐節點的規則 8 永遠掃不到它。
  const codeSeen = new Map<string, string>();
  for (const [term, record] of Object.entries(opts.keywords)) {
    if (term.length === 0 || term.length > MAX_TEXT_LENGTH) push(`規則 8(b): 詞彙 ${JSON.stringify(term)} 的長度不合法`);
    if (term.startsWith('#')) push(`規則 8(b): 詞彙 ${JSON.stringify(term)} 不應包含開頭的 #`);
    if (record && isGlossaryAlias(record)) {
      // 別名只准指向有解釋的本尊，而且只准跳一層——允許鏈狀別名的話，展開時要防環，
      // 而防環的程式碼會比「不准鏈」本身複雜得多，換來的只是一個沒有人需要的自由度。
      const target = opts.keywords[record.aliasOf];
      if (!target) push(`規則 8(b): 詞彙 ${term} 的 aliasOf 指向不存在的詞 ${JSON.stringify(record.aliasOf)}`);
      else if (isGlossaryAlias(target)) push(`規則 8(b): 詞彙 ${term} 的 aliasOf 指向另一個別名 ${record.aliasOf}，不允許鏈狀別名`);
      continue;
    }
    const entry = record;
    if (!entry?.code) push(`規則 8(b): 詞彙 ${term} 缺少 code`);
    else {
      // code 從 2026-08-22 起不只是個標識字串，它就是 /dice 與 /guide/* 上那個詞條的
      // **HTML id 與網址錨點**（`/guide/status#FROZEN`）。兩件事因此變成硬性要求：
      // 撞號會讓同一頁出現兩個相同的 id（瀏覽器只跳得到第一個，另一個詞從此連不到），
      // 含非 ASCII 或空白則會讓錨點在網址列被編碼成一長串轉義字元。
      if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(entry.code)) {
        push(`規則 8(b): 詞彙 ${term} 的 code ${JSON.stringify(entry.code)} 不是合法的錨點（須為英文字母開頭的 ASCII 識別字）`);
      }
      const owner = codeSeen.get(entry.code);
      if (owner) push(`規則 8(b): code ${entry.code} 重複（詞彙 ${owner} 與 ${term}）——它是詞條頁的 HTML id，不能撞號`);
      else codeSeen.set(entry.code, term);
    }
    if (!/^#[0-9A-Fa-f]{6}$/.test(entry?.color ?? '')) push(`規則 8(b): 詞彙 ${term} 的 color 不是 #RRGGBB：${JSON.stringify(entry?.color)}`);
    // 色碼不只是顏色，它決定這個詞印在 /guide 的哪一頁（src/lib/glossary-groups.ts 的 GROUPS）。
    // 出現沒見過的顏色時，那個詞會從每一頁消失，而所有引用它的 `#關鍵字` 會連到一個不存在的
    // 錨點——兩件事在畫面上都不報錯。buildGlossary() 也會對同一件事丟例外（建置當場失敗），
    // 這裡是資料閘門那一側的同一道防線，讓 `npm run validate` 就先說話。
    else if (!groupOfColor(entry!.color)) push(`規則 8(b): 詞彙 ${term} 的 color ${entry!.color} 不屬於已知的關鍵字分組；請在 src/lib/glossary-groups.ts 的 GROUPS 補上這一組，並決定它印在 GUIDE_PAGES 的哪一頁`);
    if (!entry?.desc) push(`規則 8(b): 詞彙 ${term} 缺少 desc`);
    else if (entry.desc.length > MAX_TEXT_LENGTH) push(`規則 8(b): 詞彙 ${term} 的 desc 超過 ${MAX_TEXT_LENGTH} 字`);
    try { if (entry?.desc) extractKeywords(entry.desc, whitelist); }
    catch (e) { push(`規則 8(b): 詞彙 ${term} 的解釋 ${(e as Error).message}`); }
  }

  // 規則 15: 技能升級花費表。等級必須是 1..N 連續整數、金額非負，而且——最要緊的——
  // 第 1 級的金幣必須等於它所適用的節點在正本裡寫的解鎖金幣。那是兩份資料唯一的交點：
  // 對不起來就代表其中一份是舊的，而兩邊各自看都完全合法。
  const table = opts.upgradeCostTable;
  if (table) {
    const levels = table.levels ?? [];
    if (!typeOfZhSafe(table.appliesTo?.type)) push(`規則 15: appliesTo.type ${JSON.stringify(table.appliesTo?.type)} 不是合法的節點型別`);
    if (levels.length === 0) push('規則 15: 升級花費表是空的');
    levels.forEach((r, i) => {
      if (r.level !== i + 1) push(`規則 15: 第 ${i + 1} 列的 level 是 ${r.level}，等級必須是 1..N 連續`);
      if (!Number.isInteger(r.gold) || r.gold < 0) push(`規則 15: ${r.level} 級的 gold 不是非負整數：${r.gold}`);
      if (!Number.isInteger(r.core) || r.core < 0) push(`規則 15: ${r.level} 級的 core 不是非負整數：${r.core}`);
    });
    if (table.appliesTo?.maxLevel !== levels.length) {
      push(`規則 15: appliesTo.maxLevel（${table.appliesTo?.maxLevel}）與表格長度（${levels.length}）不一致`);
    }
    const firstGold = levels[0]?.gold;
    const firstCore = levels[0]?.core;
    for (const n of withText) {
      if (n.typeZh !== zhOfType(table.appliesTo?.type)) continue;
      let unlockGold: number | null = null;
      let unlockCore: number | null = null;
      try {
        const pc = parseCost(n.costRaw);
        unlockGold = pc.cost.gold;
        unlockCore = pc.cost.core;
      } catch { continue; }   // 成本格式本身壞掉是規則 4 的事，這裡不重複報
      // 等級上限以前是從 `data-cost` 第二行剖出來的；2026-08-22 起改讀 data/nodes.json 的
      // `maxLevel` 欄位。這一行漏改的話條件永遠不成立、整條規則 15 對所有節點靜默跳過。
      if (n.maxLevel !== table.appliesTo?.maxLevel) continue;
      if (unlockGold !== firstGold) {
        push(`規則 15: 節點 ${n.id} 的解鎖金幣 ${unlockGold} 與升級花費表 1 級的 ${firstGold} 不一致`);
      }
      // 核心也要對。只驗金幣的話，上游哪天讓符文解鎖也要核心，表格的 1 級仍寫 core: 0、
      // 規則 15 照樣全綠，而面板那句「練滿 N 級累計…含解鎖那一次」會少報核心。
      if (unlockCore !== firstCore) {
        push(`規則 15: 節點 ${n.id} 的解鎖核心 ${unlockCore} 與升級花費表 1 級的 ${firstCore} 不一致`);
      }
    }
  }

  // 規則 17: 官方滿級數值反向驗算。
  //
  // `growth` 是用正則從一段中文描述裡挖出來的，而挖錯不會有任何一條既有規則說話：
  // 少寫一個 `(+4%)` 只會讓 growth 變成 null（面板那行「1 級 X → 50 級 Y」整條不見）、
  // 多一個負號會算出「50 級 −10.3 秒」、括號寫成全形則整段配不到。三種都是合法的 SVG、
  // 合法的成本、合法的關鍵字，規則 1–16 全部放行。
  //
  // 這條規則拿官方資料表自己算好的滿級值來對推導結果，是唯一從外部指得出「這段描述被解析
  // 成別的意思」的東西。⚠️ 因此它必須**用 data-game-id 當鍵**，不能用節點 id：管理 ID 是
  // 正本與官方資料表唯一對得起來的鍵（規則 16），拿座標或名稱配對會在同名節點上配錯
  // （光是「所有骰子傷害」就有 15 個）。
  const official = opts.maxLevelOfficial;
  if (official) {
    const byGameId = new Map(withText.map(n => [n.gameId, n]));

    // ⚠️ 覆蓋率下限。這個迴圈只走 `official.values` 裡有的項目，所以「把某個節點從夾具裡
    // 刪掉」就等於單獨關掉它的檢查，而且一聲不吭——一個 PR 只要同時改壞 1203 的成長值並
    // 刪掉 `D0060` 這個鍵，CI 全綠。夾具跟資料是分開的兩個檔，這種漏法不需要惡意也會發生。
    // 判準用「maxLevel > 1 的骰子符文」：官方資料表就是對這一類標滿級值的，實測 44/44 全中。
    // （玩家被動沒有官方滿級值可對，不列入——那 40 個要靠規則 9 與人工。）
    const needsOfficial = withText.filter(n => {
      if (n.typeZh !== '骰子符文') return false;
      return n.maxLevel > 1;
    });
    for (const n of needsOfficial) {
      if (!(n.gameId in (official.values ?? {}))) {
        push(`規則 17: 骰子符文 ${n.id}（${n.gameId}）等級上限大於 1，但 maxlevel-official.json 沒有它的官方滿級值——夾具漏了一項就等於單獨關掉這顆節點的檢查`);
      }
    }

    for (const [gameId, expect] of Object.entries(official.values ?? {})) {
      const n = byGameId.get(gameId);
      if (!n) { push(`規則 17: 官方滿級值指向不存在的 gameId ${gameId}`); continue; }
      const level = n.maxLevel;
      if (level !== expect.level) {
        push(`規則 17: 節點 ${n.id}（${gameId}）的等級上限 ${level} 與官方資料表的 ${expect.level} 不一致`);
        continue;
      }
      let parsedGrowth;
      try { parsedGrowth = parseGrowth(n.description); }
      catch { continue; }   // 成長值格式壞掉是規則 9 的事
      // ⚠️ 上游資源包重新冒出 `{n}` 佔位符時，這裡**不能報錯**：規則 9 對佔位符的政策是
      // 「只警告、不擋 PR」（CLAUDE.md 也記著那個機制要留著），而 parseGrowth 對佔位符
      // 回的正是 growth: null。少了這一段，下一次上游同步只要在這 44 顆裡放回一個佔位符，
      // CI 就會用「描述八成漏了 (+每級增量)」這句錯誤的診斷把 PR 擋死，而規則 9 在同一份
      // 輸出裡說「不擋 PR」——兩條規則自相矛盾。
      if (parsedGrowth.dataIssue === 'placeholder') continue;
      const growth = parsedGrowth.growth;
      if (!growth) {
        push(`規則 17: 節點 ${n.id}（${gameId}）解析不出成長值，但官方資料表寫得出 Lv.${expect.level} 的滿級值 ${expect.value}${expect.unit}——描述八成漏了「(+每級增量)」那一段`);
        continue;
      }
      const actual = maxLevelValue(growth, level);
      if (actual !== expect.value) {
        push(`規則 17: 節點 ${n.id}（${gameId}）推算的 Lv.${level} 滿級值 ${actual} 與官方資料表的 ${expect.value} 不一致（growth: 基礎 ${growth.base}／每級 ${growth.perLevel}）`);
      } else if (growth.unit !== expect.unit) {
        push(`規則 17: 節點 ${n.id}（${gameId}）的成長值單位 ${JSON.stringify(growth.unit)} 與官方資料表的 ${JSON.stringify(expect.unit)} 不一致`);
      }
    }
  }

  // 規則 18: 解鎖例外表（`data/unlock-exceptions.json`）。
  //
  // 這個檔案不是 SVG 的一部分，`build-data` 讀它時只有一個 `as` 型別斷言——也就是**執行期
  // 零檢查**。它決定哪些節點不列入成本計算，而且 `note` 會直接印在面板與 aria-label 上。
  // 三種寫壞的方式，在這條規則之前全部都是 CI 全綠：
  //
  // 1. **key 打錯**（`"5O08"`）→ 查不到任何節點，那顆骰子安靜地變回「要花核心買」，
  //    整條前置鏈的成本跟著變，而 diff 摘要看不出有動到資料檔。
  // 2. **`unlockVia` 打錯**（`"quests"`）→ 它仍然 `!== 'cost'`，所以成本照樣被排除，
  //    但 `formatUnlockVia` 查不到對應中文，面板會印出字面的 `undefined`。
  // 3. **`note` 空字串或超長** → 面板顯示一段空白或被撐爆的 meta 列。
  const exceptions = opts.unlockExceptions;
  if (exceptions) {
    const nodeIds = new Set(nodes.map(n => n.id));
    const VALID_VIA = ['quest', 'default', 'achievement'];
    const VALID_KEYS = ['unlockVia', 'note', 'unlockPaid', 'bypassPrereq'];
    for (const [id, entry] of Object.entries(exceptions)) {
      if (!nodeIds.has(id)) push(`規則 18: 解鎖例外表指向不存在的節點 ${JSON.stringify(id)}`);
      // 'cost' 是預設值，寫進例外表沒有意義，而且會讓人以為它有作用
      if (!VALID_VIA.includes(entry?.unlockVia ?? '')) {
        push(`規則 18: 節點 ${id} 的 unlockVia ${JSON.stringify(entry?.unlockVia)} 不合法，必須是 ${VALID_VIA.join('／')}`);
      }
      if (entry?.note !== undefined && (entry.note.length === 0 || entry.note.length > MAX_TEXT_LENGTH)) {
        push(`規則 18: 節點 ${id} 的 note 長度 ${entry.note.length} 不合法（1..${MAX_TEXT_LENGTH}）`);
      }
      // 4. **`unlockPaid`／`bypassPrereq` 寫成非布林**（`"false"`）→ `build-data` 判斷的是
      //    truthiness，非空字串一律為真，於是「我明明寫了 false」變成「已啟用」。
      //    前者決定那筆核心算不算進前置鏈成本、後者決定要不要往上追祖先，兩個都是靜默生效。
      for (const flag of ['unlockPaid', 'bypassPrereq'] as const) {
        const v = (entry as Record<string, unknown> | undefined)?.[flag];
        if (v !== undefined && typeof v !== 'boolean') {
          push(`規則 18: 節點 ${id} 的 ${flag} ${JSON.stringify(v)} 不合法，必須是布林值`);
        }
      }
      // 5. **欄位名打錯**（`bypassPrereqs` 多一個 s）→ 上面那條看不到它（它只認得正確的鍵），
      //    而 `build-data` 讀的也是正確的鍵，於是旗標安靜地變成 undefined。這是第 4 種的鏡像：
      //    第 4 種擋「寫了 false 卻生效」，這條擋「寫了 true 卻沒生效」。
      //    白名單而不是逐個猜錯字——`nodes.json` 的規則 1 也是這樣擋未知欄位的。
      for (const key of Object.keys(entry ?? {})) {
        if (!VALID_KEYS.includes(key)) {
          push(`規則 18: 節點 ${id} 有未知欄位 ${JSON.stringify(key)}，合法欄位只有 ${VALID_KEYS.join('／')}`);
        }
      }
    }
  }

  // 規則 7: 圖示。以 iconsDir 內實際檔案為準做一次全面掃描（而非逐節點重複讀檔／算雜湊），
  // 因為同一張圖示常被多個節點共用（實測有一張被 15 個節點共用），檔案層級的問題只需驗一次。
  // (b)(c)(d) 由 checkHashNamedIconDir() 與規則 21 共用，見該函式說明。
  const referencedIcons = new Set(nodes.map(n => n.icon));
  const iconScan = checkHashNamedIconDir(opts.iconsDir, referencedIcons, { rule: '規則 7', minLongestEdge: MIN_ICON_LONGEST_EDGE });
  iconScan.errors.forEach(push);
  iconScan.warnings.forEach(warn);
  // 規則 7(c) 的 96px 下限是「圖檔本身別太小」，跟「它會被放多大」無關。顯示尺寸自 2026-08-18
  // 改成逐節點寫在正本的 `<image width/height>`（不再由類型推導）之後，那個數字變成**完全沒有
  // 人守**：parseTree 只擋 ≤0／NaN，規則 7 只看檔案。一個 PR 把某個節點寫成 width="500"
  // height="500"，CI 全綠，sprite 會為它開一個 500×500 的分區、拿 104px 的來源拉上去，站台上
  // 就是一塊糊掉的巨型貼圖。這裡補上「顯示尺寸不得超過來源解析度的一半」——跟規則 10 對樞紐圖
  // 的要求同一個標準（來源至少要是顯示尺寸的兩倍，高 DPI 螢幕才不會糊）。
  for (const n of nodes) {
    // 規則 7(a): 節點引用的圖示必須存在於 iconsDir。
    if (!iconScan.hashes.has(n.icon)) { push(`規則 7(a): 節點 ${n.id} 引用的圖示 ${n.icon} 不存在`); continue; }
    // 規則 7(e): 顯示尺寸 × 2 不得超過圖檔解析度。
    const px = iconScan.sizes.get(n.icon);
    if (!px) continue; // 不是有效 PNG／解析度不足——規則 7(c) 已經報過了，這裡不重複
    const [w, h] = n.size;
    if (w * 2 > px.width || h * 2 > px.height) {
      push(
        `規則 7(e): 節點 ${n.id} 的顯示尺寸 ${w}x${h} 相對圖示 ${n.icon} 的解析度 ${px.width}x${px.height} 過大` +
          `（顯示尺寸的兩倍不得超過圖檔解析度，否則高 DPI 螢幕上會糊）`,
      );
    }
  }

  // 規則 10: 中央樞紐。整組是選用的（正本沒有 g.tree-center 時 parseTree 回傳 null），但只要有，
  // 就必須真的畫得出來：圖檔存在且是有效 PNG、放射線接到真實存在的節點。少了任何一項，站台端
  // 只會安靜地畫出破圖或斷腳的樞紐，不會有錯誤訊息——這正是 CI 該擋下來的那種「沉默的壞掉」。
  const center = parsed.meta.center;
  if (center) {
    const centerPath = join(opts.dataDir, center.image);
    let centerBuf: Buffer | null = null;
    try {
      centerBuf = readFileSync(centerPath);
    } catch {
      push(`規則 10: 中央樞紐的圖 ${center.image} 不存在（找不到 ${centerPath}）`);
    }
    if (centerBuf && !readPngSize(centerBuf)) push(`規則 10: 中央樞紐的圖 ${center.image} 不是有效的 PNG`);

    if (centerBuf) {
      // 最低解析度：樞紐圖會被建置期放大到顯示尺寸的兩倍（高 DPI），來源比那還小就只是被
      // 拉糊。節點圖示有規則 7(c) 的 96px 下限守著，樞紐這張過去什麼都沒守。
      const size = readPngSize(centerBuf);
      const [needW, needH] = [center.size[0] * 2, center.size[1] * 2];
      if (size && (size.width < needW || size.height < needH)) {
        push(`規則 10: 中央樞紐的圖 ${center.image} 只有 ${size.width}x${size.height}，小於顯示尺寸的兩倍（${needW}x${needH}）`);
      }
    }

    const byId = new Map(nodes.map(n => [n.id, n]));
    for (const [i, id] of center.links.entries()) {
      const n = byId.get(id);
      if (!n) { push(`規則 10: 中央樞紐的 data-links 指向不存在的節點 ${id}`); continue; }
      // 放射線的終點必須真的落在該節點中心，順序也要跟 data-links 對上——這是規則 5 對一般
      // 邊做的同一件事。站台端是拿 links 的 id 去查節點座標、自己重畫這五條線的，所以正本
      // 這邊畫歪了或把 data-links 順序調換了，站台完全看不出來：正本與線上版會安靜地長得
      // 不一樣，而這份 SVG 正是貢獻者用來確認自己改了什麼的東西。
      const [ex, ey] = center.linkEnds[i]!;
      if (Math.abs(ex - n.x) >= 0.5 || Math.abs(ey - n.y) >= 0.5) {
        push(`規則 10: 中央樞紐第 ${i + 1} 條放射線的終點 (${ex}, ${ey}) 沒對上 data-links 指定的節點 ${id} 的中心 (${n.x}, ${n.y})`);
      }
    }
    // 樞紐畫的是「五顆起手骰從樹心長出來」，所以連線集合本來就該等於根集合。日後資料改版多一個
    // 分支時，這裡會先亮黃燈提醒一併更新樞紐，而不是讓新分支的根悄悄少一條線。
    const linkSet = new Set(center.links);
    const rootDiff = [
      ...EXPECTED_ROOTS.filter(r => !linkSet.has(r)),
      ...center.links.filter(id => !EXPECTED_ROOTS.includes(id)),
    ];
    if (rootDiff.length > 0) warn(`規則 10: 中央樞紐的連線與預期的根不一致（差異：${rootDiff.join('、')}）`);
  }

  // 規則 5: 邊端點對齊（marker-end 已由 parseTree 在解析階段強制檢查並提早失敗，
  // 走到這裡代表所有邊都已經有 marker-end，此處不需要也不可能再測到缺失的情況）。
  // 回傳「這個座標對上的所有節點」而不是第一個：對上兩顆代表有節點疊在一起，
  // 這條邊接到誰完全取決於它們在檔案裡的先後順序（見 MIN_NODE_DISTANCE 的說明）。
  const at = (x: number, y: number) =>
    nodes.filter(n => Math.abs(n.x - x) < COORD_TOLERANCE && Math.abs(n.y - y) < COORD_TOLERANCE);
  const idEdges: Edge[] = [];
  for (const e of edges) {
    const [a, b] = [at(e.from[0], e.from[1]), at(e.to[0], e.to[1])];
    let ambiguous = false;
    for (const [end, hits] of [['起點', a], ['終點', b]] as const) {
      if (hits.length > 1) {
        push(`規則 5: 邊的${end} ${JSON.stringify(e)} 同時對上 ${hits.length} 顆節點（${hits.map(n => n.id).join('、')}），無法判定接到誰`);
        ambiguous = true;
      }
    }
    if (ambiguous) continue;
    if (a.length === 0 || b.length === 0) { push(`規則 5: 邊端點未對齊任何節點中心 ${JSON.stringify(e)}`); continue; }
    idEdges.push([a[0]!.id, b[0]!.id]);
  }

  // 規則 6: 無環 + 可達性（data-wip="1" 的節點豁免可達性檢查，讓貢獻者可以先接資料再接線；
  // 這些節點改為列入 warnings，供 PR 摘要顯示「待接線節點」）
  const wip = new Set(nodes.filter(n => n.wip).map(n => n.id));
  for (const id of wip) warn(`規則 6(c): 節點 ${id} 為待接線節點（data-wip="1"），尚未加入圖遍歷，請於 PR 摘要留意`);

  // 規則 6(d): 待接線節點不得出現在任何邊上。
  //
  // ⚠️ 這條是整份規則裡最要緊的一道。`data-wip="1"` 的語意就是「還沒接線」，而規則 6 為它
  // 豁免了「非預期的根」與「從根不可達」兩項檢查——那正是圖結構唯一的守門員。少了這條，
  // 一個 PR 可以：把某顆現有節點標成 wip（於是它斷開上游也不會被抓），再拉一條邊從它接到
  // 別的分支去。結果是 validate 全綠、節點數與邊數都不變、四個不變量都對，而某條前置鏈的
  // 成本被改掉了（review 報告實測：5201 鏈從 66 核心變成 86；那份報告的 66 是 2026-08-21
  // 解鎖例外表擴充前的基準，現在的基準是 42，但這條規則要擋的事情沒變）。
  // 既然 wip 的意思是「沒接線」，那就真的不准它接線——豁免與能力二選一。
  for (const [from, to] of idEdges) {
    if (wip.has(from)) push(`規則 6(d): 節點 ${from} 標了 data-wip="1"（待接線）卻有一條出邊接到 ${to}；wip 節點必須完全不接線`);
    if (wip.has(to)) push(`規則 6(d): 節點 ${to} 標了 data-wip="1"（待接線）卻有一條入邊來自 ${from}；wip 節點必須完全不接線`);
  }
  const ids = nodes.map(n => n.id);
  const { parents, children } = buildAdjacency(idEdges);
  const cycle = detectCycle(ids, children);
  if (cycle) push(`規則 6: 偵測到環 ${cycle.join(' → ')}`);
  const roots = findRoots(ids, parents).filter(id => !wip.has(id));
  const missing = EXPECTED_ROOTS.filter(r => !roots.includes(r));
  const extra = roots.filter(r => !EXPECTED_ROOTS.includes(r));
  if (missing.length > 0) push(`規則 6: 缺少預期的根 ${missing.join(', ')}`);
  if (extra.length > 0) push(`規則 6: 出現非預期的根（可能是斷線節點）${extra.join(', ')}`);
  if (!cycle) {
    for (const id of unreachableFrom(EXPECTED_ROOTS, ids, children)) {
      if (!wip.has(id)) push(`規則 6: 節點 ${id} 從根不可達`);
    }
  }

  // 規則 13: 幾何健全性（畫布尺寸、座標範圍、節點不得重疊）。
  //
  // 這一組守的是「打開 SVG 看到的東西」與「站台算出來的東西」是同一件事。畫布或座標被改壞時
  // 站台只會安靜地把節點畫到視野外或糊成一團，沒有任何一步會說話。
  const vb = parsed.meta.viewBox;
  if (vb.join(' ') !== EXPECTED_VIEWBOX.join(' ')) {
    push(`規則 13: viewBox 必須是 "${EXPECTED_VIEWBOX.join(' ')}"，實際為 "${vb.join(' ')}"（改畫布要連同 CLAUDE.md 的不變量與 E2E 幾何斷言一起改）`);
  }
  const [vx, vy, vw, vh] = EXPECTED_VIEWBOX;
  const inside = (x: number, y: number) => x >= vx && x <= vx + vw && y >= vy && y <= vy + vh;
  for (const n of nodes) {
    if (!inside(n.x, n.y)) push(`規則 13: 節點 ${n.id} 的座標 (${n.x}, ${n.y}) 落在畫布之外`);
  }
  for (const e of edges) {
    if (!inside(e.from[0], e.from[1]) || !inside(e.to[0], e.to[1])) {
      push(`規則 13: 邊的端點落在畫布之外 ${JSON.stringify(e)}`);
    }
  }
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const [a, b] = [nodes[i]!, nodes[j]!];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < MIN_NODE_DISTANCE) {
        push(`規則 13: 節點 ${a.id} 與 ${b.id} 的中心只相距 ${d.toFixed(2)}（至少要 ${MIN_NODE_DISTANCE}），邊會分不清接到哪一顆`);
      }
    }
  }

  // 規則 20: 更新日誌與資料正本的版本欄位一致。
  //
  // 這條擋的不是「日誌寫錯」，是「資料改了、日誌沒改」。那件事沒有任何其他規則看得到：
  // 版本號、節點數、圖示全部是從正本推出來的，只有這份是人手寫的，而漏寫在畫面上跟
  // 「這次沒更新」長得一模一樣。綁法跟規則 17 同一個手法——讓兩份資料互為對方的答案。
  if (opts.changelog === null) {
    warn('規則 20: 沒有提供 data/changelog.json，更新日誌與資料版本的一致性未檢查');
  } else {
    for (const m of checkChangelog(opts.changelog, parsed.meta)) push(`規則 20: ${m}`);
  }

  // 規則 21：/board 骰盤編輯器的純骰子圖（`data/board-icons.json` ＋ `data/board-icons/`）。
  //
  // 這是跟 data/icons/ 平行的一條資產路徑——正本管線（規則 7）只處理 SVG 引用到的圖示，
  // 純骰子圖完全不在正本裡，換掉節點圖示的那條規則對它視而不見。少了這條規則，「漏了一顆
  // 骰子沒配圖」「配到的檔案不存在」「檔名被手動改過跟內容對不上」「放進去的根本不是 PNG
  // 或小到會糊」「留著沒人引用的孤兒檔」「兩顆骰子指到同一張圖」「對應表裡留著早就不是骰子
  // 的 id」全部會安靜地通過 CI，直到有人真的打開 /board 才看得到破圖、缺圖或兩顆一樣的骰子。
  //
  // 子規則：(a) 骰子漏一筆對應／(b)(c)(d) 目錄本身，與規則 7 共用 checkHashNamedIconDir()
  // 且字母刻意對齊（檔名≠內容雜湊／PNG 結構與解析度／孤兒檔只警告）／(e) 對應表的值格式／
  // (f) 指向的圖不存在／(g) 兩筆指向同一張圖／(h) 對應表自己的孤兒 entry。
  const boardIcons = opts.boardIcons;
  if (boardIcons === null) {
    warn('規則 21: 沒有提供 data/board-icons.json，/board 純骰子圖的對應未檢查');
  } else if (typeof boardIcons !== 'object' || Array.isArray(boardIcons)) {
    // 跟規則 1 驗 nodes.json 的最外層同一個理由：整份被寫成陣列或字串時，底下每一條檢查都會
    // 拿到空集合而「安靜地全過」。
    push('規則 21: data/board-icons.json 的最外層必須是以節點 id 為鍵的物件');
  } else {
    const entries = Object.entries(boardIcons as Record<string, unknown>);
    // 「哪些是骰子」只算一次，(a) 與 (h) 共用同一個定義。各算各的話，日後型別名稱一改而只
    // 改到其中一處，就會同時冒出「(a) 要求它要有圖」與「(h) 說這筆是孤兒」兩條互相矛盾的錯誤。
    //
    // ⚠️ 判斷「是不是骰子」只能用 `withText`（type 在文案那一側），而 `withText` 會把
    // 「兩邊沒對齊」與「結構壞掉」的節點濾掉——那兩件事各自有規則 19 與規則 1 在說話，
    // 所以 (h) 要先替它們讓路（見下面）。
    const diceIds = new Set(withText.filter(n => n.typeZh === '骰子').map(n => n.id));

    // (e) 值必須是 12 碼小寫 hex，也就是「一個圖示雜湊」。這份檔案跟 unlock-exceptions.json
    // 一樣是社群 PR 直接改的，而 `build-data.ts` 讀它時只有一個 `as`＝執行期零檢查（規則 18
    // 就是為了同一個理由才存在）。少了這條，值會被原封不動拿去組路徑：`{"1001": {"hash":"x"}}`
    // 變成 `[object Object].png`，`{"1001": "../../data/nodes"}` 讓閘門去讀 board-icons 目錄
    // 外面的檔案（兩者實測都成立）。先過濾一次，後面每條檢查才拿得到乾淨的輸入。
    const iconOf = new Map<string, string>();
    for (const [id, hash] of entries) {
      if (typeof hash === 'string' && /^[0-9a-f]{12}$/.test(hash)) iconOf.set(id, hash);
      else push(`規則 21(e): data/board-icons.json 的 ${id} 對應到 ${JSON.stringify(hash)}，不是 12 碼小寫 hex 的圖示雜湊`);
    }

    // (a) 每一顆骰子節點都要在對應表裡有一筆。
    const entryIds = new Set(entries.map(([id]) => id));
    for (const id of diceIds) {
      if (!entryIds.has(id)) push(`規則 21(a): 骰子 ${id} 在 data/board-icons.json 沒有對應的圖`);
    }

    // (b)(c)(d) 目錄本身：檔名＝內容雜湊、是有效且夠大的 PNG、沒有孤兒檔或非 .png 雜檔。
    // 以目錄實際檔案為準掃一次，而不是逐 entry 讀檔算雜湊——同一張圖被 k 個 id 共用時，
    // 後者會把同一個檔案讀 k 次、噴 k 條一模一樣的錯（規則 7 的註解早就寫了這件事）。
    const boardScan = checkHashNamedIconDir(opts.boardIconsDir, new Set(iconOf.values()), {
      rule: '規則 21',
      minLongestEdge: MIN_ICON_LONGEST_EDGE,
    });
    boardScan.errors.forEach(push);
    boardScan.warnings.forEach(warn);

    // (f) 每一筆指向的圖都要真的在目錄裡。
    //
    // 訊息印的是**實際讀取的路徑**（`opts.boardIconsDir`），不是寫死的 `data/board-icons/`：
    // 測試會把圖示複製到暫存目錄再驗，寫死等於指著一個檔案好端端在那裡的路徑說它不存在
    // （規則 10 的對應訊息印的也是真正的 centerPath）。稱呼也不寫「骰子 ${id}」——對應表裡
    // 的 id 不保證還是骰子，那是 (h) 的事。
    for (const [id, hash] of iconOf) {
      const filePath = join(opts.boardIconsDir, `${hash}.png`);
      if (!boardScan.hashes.has(hash)) push(`規則 21(f): data/board-icons.json 的 ${id} 指向的圖 ${filePath} 不存在`);
    }

    // (g) 兩筆不准指向同一張圖。最常見的成因是「複製上一筆、忘了換成新加進來的那張」，
    // 而那時 (a)(d)(f) 全部沉默：每顆骰子都有對應、檔案存在、目錄裡也沒有多出來的孤兒檔
    // （新圖從頭到尾沒被加進去過），/board 上就是兩顆長得一模一樣的骰子。
    const idsByHash = new Map<string, string[]>();
    for (const [id, hash] of iconOf) idsByHash.set(hash, [...(idsByHash.get(hash) ?? []), id]);
    for (const [hash, ids] of idsByHash) {
      if (ids.length > 1) push(`規則 21(g): 節點 ${ids.join('、')} 指向同一張純骰子圖 ${hash}.png，每顆骰子要有自己的圖`);
    }

    // (h) 反方向：對應表自己不准有孤兒 entry。
    //
    // (a) 從骰子出發問「有沒有一筆」、(d) 從目錄出發問「有沒有被引用」，兩條都沒有人從
    // Object.keys(boardIcons) 出發問「這個 id 還在嗎、還是骰子嗎」。少了 (h)，「某顆骰子從
    // 正本移除，nodes.json 與 SVG 都改了、board-icons.json 忘了刪那筆」是零錯誤的——只要
    // 那筆指向的是一張仍被別人引用的既有圖，(d) 與 (f) 都不會說話（2026-08-23 review F21-1
    // 實測：塞一筆 "9999" 指向既有雜湊，validate 完全通過）。規則 19 抓得到 SVG↔nodes 的
    // 殘餘，規則 21 得自己抓自己的。
    //
    // ⚠️ 這裡要先跳過不屬於這條規則的 id：`withText` 濾掉的那些各自有規則 19 與規則 1 在
    // 說話，照樣報下去的話，`nodes.json` 漏一筆文案就會多出一條指向 board-icons.json 的假
    // 錯誤（實測：刪掉 1001 的文案 → 多一條「1001 不是骰子節點」）。只留下「兩邊都在、結構
    // 也合法，但它就不是骰子」與「兩邊都找不到」。
    for (const id of entryIds) {
      if (diceIds.has(id)) continue;
      if (textIds.has(id) !== geomIds.has(id)) continue; // 規則 19 的地盤
      if (structurallyBad.has(id)) continue; // 規則 1 的地盤
      push(`規則 21(h): data/board-icons.json 的 ${id} 不是（或已不是）骰子節點，這筆對應是孤兒`);
    }
  }

  // 規則 22：玩家被動／支援的升級費用表（`data/passive-upgrade-cost.json`）。
  //
  // 官方表格把共通節點分成 6 個升級類型，而識別一個類型的就是「等級上限」與「解鎖金幣」
  // 這兩個值——那兩個欄位 tree.json 本來就有，所以這份資料刻意不進產物（見 ValidateOpts）。
  // 這條規則守的是那個推導：**每顆可升級的共通節點都要對得到一個 tier，每個 tier 也都要
  // 對得到節點**。少了任一邊，畫面上都不會有東西說話。
  const pu = opts.passiveUpgradeCost;
  if (pu === null || pu === undefined) {
    warn('規則 22: 沒有提供 data/passive-upgrade-cost.json，玩家被動的升級費用未檢查');
  } else if (typeof pu !== 'object' || Array.isArray(pu)) {
    push('規則 22: data/passive-upgrade-cost.json 的最外層必須是物件（含 tiers 與 special 兩個欄位）');
  } else {
    const { tiers: rawTiers, special: rawSpecial } = pu as { tiers?: unknown; special?: unknown };
    if (!isPlainObject(rawTiers)) push('規則 22: data/passive-upgrade-cost.json 的 tiers 必須是以升級類型代號為鍵的物件');
    if (!isPlainObject(rawSpecial)) push('規則 22: data/passive-upgrade-cost.json 的 special 必須是以節點 id 為鍵的物件');

    /** 通過形狀檢查、可以拿去比對節點的 tier。形狀壞掉的那幾筆不進來，免得再噴一輪「對不到 tier」。 */
    const goodTiers = new Map<string, UpgradeTier>();
    for (const [key, raw] of Object.entries(isPlainObject(rawTiers) ? rawTiers : {})) {
      if (!isPlainObject(raw)) { push(`規則 22: 升級類型 ${key} 必須是物件`); continue; }
      const { maxLevel, unlockGold, bands } = raw as { maxLevel?: unknown; unlockGold?: unknown; bands?: unknown };
      let ok = true;
      if (!Number.isInteger(maxLevel) || (maxLevel as number) < 2) {
        push(`規則 22: 升級類型 ${key} 的 maxLevel 必須是 ≥2 的整數，實際是 ${JSON.stringify(maxLevel)}`);
        ok = false;
      }
      if (!Number.isInteger(unlockGold) || (unlockGold as number) < 0) {
        push(`規則 22: 升級類型 ${key} 的 unlockGold 必須是非負整數，實際是 ${JSON.stringify(unlockGold)}`);
        ok = false;
      }
      if (!Array.isArray(bands) || bands.length === 0) {
        push(`規則 22: 升級類型 ${key} 的 bands 必須是非空陣列`);
        ok = false;
      } else {
        for (const b of bands) {
          if (!isPlainObject(b) || !(['from', 'to', 'gold', 'core'] as const).every(
            f => Number.isInteger(b[f]) && (b[f] as number) >= 0)) {
            push(`規則 22: 升級類型 ${key} 有一段區間不是 {from,to,gold,core} 四個非負整數：${JSON.stringify(b)}`);
            ok = false;
          }
        }
      }
      if (!ok) continue;
      const tier = raw as unknown as UpgradeTier;
      // 連續性交給 expandTier——`/sim` 算費用時走的就是它，兩邊各寫一份判斷就會漂移。
      try { expandTier(tier); } catch (e) { push(`規則 22: 升級類型 ${key} 的${(e as Error).message}`); continue; }
      goodTiers.set(key, tier);
    }

    // tier 是用 `(maxLevel, unlockGold)` 線性搜尋出來的，兩個 tier 撞號時哪一個贏完全取決於
    // JSON 的鍵順序——那是「改一行縮排就換一張費用表」等級的脆弱。
    const byKeyPair = new Map<string, string>();
    for (const [key, t] of goodTiers) {
      const pair = `${t.maxLevel}:${t.unlockGold}`;
      const prev = byKeyPair.get(pair);
      if (prev !== undefined) push(`規則 22: 升級類型 ${prev} 與 ${key} 的 (maxLevel, unlockGold) 撞號（都是 ${pair}），查表結果會取決於 JSON 的鍵順序`);
      else byKeyPair.set(pair, key);
    }

    // 節點端：哪些節點該對得到 tier。走 withText（要 maxLevel 與 cost，是文案的地盤）。
    const tierUsed = new Set<string>();
    const uncovered: string[] = [];
    const tierOfNode = new Map<string, string>();
    // ⚠️ `special` 的定義就是「套不進任何 tier 的節點」，所以它們不參與涵蓋率檢查。
    // 不排除的話，一顆放進 special 的玩家被動不是被判「對不到任何升級類型」，就是被判
    // 「一顆節點兩張表」，兩條路都紅，而那份資料是合法的（`levelTableFor()` 執行期也是
    // special 優先）。目前唯一的 special 是 4303（骰子符文，被下面的型別過濾掉），
    // 所以這件事現在不會爆——它擋的是「哪天有一顆被動需要單獨列表」。
    const specialIds = new Set(Object.keys(isPlainObject(rawSpecial) ? rawSpecial : {}));
    for (const n of withText) {
      if (n.typeZh !== '玩家被動' && n.typeZh !== '支援') continue;
      if (n.maxLevel <= 1) continue;
      if (specialIds.has(n.id)) continue;
      // 表格的解鎖那一格就是玩家付的那筆錢；預設／任務解鎖的節點根本沒付過，拿它的解鎖金幣
      // 當 key 在語意上就不成立（同 sumUnlockCost 與 upgradeTableApplies 的排除判準）。
      const exc = opts.unlockExceptions?.[n.id];
      if (exc && exc.unlockVia !== 'cost' && exc.unlockPaid !== true) continue;
      let unlockGold: number;
      try { unlockGold = parseCost(n.costRaw).cost.gold; } catch { continue; }  // 成本格式壞掉是規則 4 的事
      const key = byKeyPair.get(`${n.maxLevel}:${unlockGold}`);
      if (key === undefined) uncovered.push(n.id);
      else { tierUsed.add(key); tierOfNode.set(n.id, key); }
    }
    if (uncovered.length > 0) {
      push(`規則 22: 這些可升級的共通節點對不到任何升級類型（(maxLevel, 解鎖金幣) 查不到表）：${uncovered.join('、')}`);
    }
    for (const key of goodTiers.keys()) {
      if (!tierUsed.has(key)) push(`規則 22: 升級類型 ${key} 沒有任何節點用得到，這一筆是孤兒`);
    }

    // special：官方單獨列出來、套不進任何 tier 的節點（目前只有 4303）。
    const byIdText = new Map(withText.map(n => [n.id, n]));
    for (const [id, raw] of Object.entries(isPlainObject(rawSpecial) ? rawSpecial : {})) {
      if (!isPlainObject(raw)) { push(`規則 22: special 的 ${id} 必須是物件`); continue; }
      const node = byIdText.get(id);
      if (!node) {
        // 規則 19／規則 1 的地盤不重複報（同規則 21(h) 的判準）。
        if (textIds.has(id) !== geomIds.has(id) || structurallyBad.has(id)) continue;
        push(`規則 22: special 的 ${id} 不是（或已不是）節點 id，這筆對應是孤兒`);
        continue;
      }
      const { maxLevel, levels } = raw as { maxLevel?: unknown; levels?: unknown };
      if (maxLevel !== node.maxLevel) {
        push(`規則 22: special 的 ${id} 寫 maxLevel ${JSON.stringify(maxLevel)}，但節點 ${id} 的 maxLevel 是 ${node.maxLevel}`);
        continue;
      }
      if (!Array.isArray(levels)) { push(`規則 22: special 的 ${id} 的 levels 必須是陣列`); continue; }
      // 表格從 Lv.2 起（Lv.1 是解鎖，那是節點自己的 cost），所以第 i 列的 level 必須是 i+2。
      let contiguous = levels.length === node.maxLevel - 1;
      levels.forEach((r, i) => {
        if (!isPlainObject(r) || r['level'] !== i + 2) contiguous = false;
        else if (!(['gold', 'core'] as const).every(f => Number.isInteger(r[f]) && (r[f] as number) >= 0)) {
          push(`規則 22: special 的 ${id} 的 Lv.${i + 2} 的 gold／core 不是非負整數：${JSON.stringify(r)}`);
        }
      });
      if (!contiguous) {
        push(`規則 22: special 的 ${id} 的 levels 必須是 Lv.2 到 Lv.${node.maxLevel} 連續，實際有 ${levels.length} 列`);
      }
      // 兩張表同時對得到不是錯——`levelTableFor()` 明確讓 special 優先，語意是確定的。
      // 但很可能其中一張已經過時，所以留一條警告讓它在 PR 摘要上看得見。
      // ⚠️ 這裡查的是「拿掉 special 之後它會落到哪個 tier」，而上面的節點端迴圈已經跳過
      // special 節點，所以 tierOfNode 對它一定是空的——要自己再查一次。
      let unlockGold: number | null = null;
      try { unlockGold = parseCost(node.costRaw).cost.gold; } catch { /* 規則 4 的地盤 */ }
      const clash = unlockGold === null ? undefined : byKeyPair.get(`${node.maxLevel}:${unlockGold}`);
      if (clash !== undefined) {
        warn(`規則 22: 節點 ${id} 同時對得到升級類型 ${clash} 與 special 表；執行期會用 special，但其中一張可能已經過時`);
      }
    }
  }

  // 規則 23：骰子基本能力值與強化數據（`data/dice-stats.json`）。
  //
  // 跟規則 22 那份資料一樣不進 tree.json——`/dice` 是靜態頁，建置期直接讀 `data/`，不吃
  // tree.json 那個只剩不到 1.5KB 的 gzip 預算。代價同樣是「表與節點對不上」在產物層面零痕跡：
  // 漏一顆骰子，那張卡片就是少一塊數值區，跟「官方沒給這顆數值」長得一模一樣；多一筆孤兒
  // 則永遠不會有人看到。所以這條規則是雙向的。
  //
  // ⚠️ 它以 **gameId** 為鍵，不是節點 id——這份資料是拿官方資料表對出來的，而任何跟官方表
  // 的對帳一律用 gameId（239 筆雙射，用名稱會配錯）。規則 19 抓的是 SVG↔nodes 的殘餘，
  // 對這張表的殘餘視而不見。
  //
  // 子規則：(a) 骰子漏一筆／(b) 表自己的孤兒 entry／(c) name 與節點不符／(d) entry 結構／
  // (e) stat 欄位型別／(f) 同一顆骰子的 label 撞號／(g) 四檔值要嘛全有要嘛全無。
  const diceStats = opts.diceStats;
  if (diceStats === null || diceStats === undefined) {
    warn('規則 23: 沒有提供 data/dice-stats.json，骰子基本能力值未檢查');
  } else if (typeof diceStats !== 'object' || Array.isArray(diceStats)) {
    push('規則 23: data/dice-stats.json 的最外層必須是以 gameId 為鍵的物件');
  } else {
    const entries = Object.entries(diceStats as Record<string, unknown>);
    const entryIds = new Set(entries.map(([g]) => g));
    // 判斷「是不是骰子」跟規則 21 用同一個定義（見那裡的說明：type 在文案那一側，
    // 所以只能走 withText，而 withText 濾掉的那些各自有規則 19 與規則 1 在說話）。
    const diceNodes = withText.filter(n => n.typeZh === '骰子');

    // (a) 每一顆骰子節點的 gameId 都要在表裡有一筆。訊息同時印 gameId 與節點 id：
    // 貢獻者手上是官方資料表（只有 gameId），維護者手上是正本（只有節點 id）。
    for (const n of diceNodes) {
      if (!entryIds.has(n.gameId)) push(`規則 23(a): 骰子 ${n.gameId}（節點 ${n.id} ${n.name}）在 data/dice-stats.json 沒有對應的數值`);
    }

    // (b) 反方向。跟規則 21(h) 一樣要先替規則 19 與規則 1 讓路：那兩者濾掉的節點在
    // `diceNodes` 裡不存在，照樣報下去的話「nodes.json 漏一筆文案」就會多出一條指向這份表的
    // 假錯誤，把真正的原因埋掉。所以只認「這個 gameId 在整份正本裡完全找不到」。
    const gameIdEverywhere = new Set(Object.values(nodeText as Record<string, { gameId?: unknown }>)
      .map(v => v?.gameId).filter((g): g is string => typeof g === 'string'));
    const diceGameIds = new Set(diceNodes.map(n => n.gameId));
    //
    // ⚠️ 「在正本裡完全找不到」這一半要先確認規則 19 與規則 1 沒話說。這份表以 gameId 為鍵，
    // 而 gameId 住在 nodes.json 裡——nodes.json 漏一筆文案時，那顆骰子的 gameId 會跟著從整份
    // 正本消失，於是那一筆變成「找不到對應的節點」。實測：刪掉 1001 的文案 → 規則 23 多噴
    // 一條指著 D000 的假錯誤，把規則 19 那句真正的原因埋掉。
    const yielded = structurallyBad.size > 0
      || [...geomIds].some(id => !textIds.has(id))
      || [...textIds].some(id => !geomIds.has(id));
    for (const g of entryIds) {
      if (diceGameIds.has(g)) continue;
      if (gameIdEverywhere.has(g)) {
        push(`規則 23(b): data/dice-stats.json 的 ${g} 不是（或已不是）骰子節點，這筆數值是孤兒`);
      } else if (!yielded) {
        push(`規則 23(b): data/dice-stats.json 的 ${g} 在正本裡找不到對應的節點，這筆數值是孤兒`);
      }
    }

    const nodeByGameId = new Map(diceNodes.map(n => [n.gameId, n]));
    for (const [gameId, raw] of entries) {
      if (!isPlainObject(raw)) { push(`規則 23(d): data/dice-stats.json 的 ${gameId} 必須是物件`); continue; }
      const e = raw as { name?: unknown; note?: unknown; stats?: unknown };

      // (c) gameId 對得上但名字不一樣＝有人改了節點名沒同步這份表，或這一列根本抄錯行。
      // 兩者都會讓玩家在卡片上看到別顆骰子的數值，而 gameId 對得上所以 (a)(b) 全程沉默。
      const node = nodeByGameId.get(gameId);
      if (node && e.name !== node.name) {
        push(`規則 23(c): data/dice-stats.json 的 ${gameId} 寫的名稱是 ${JSON.stringify(e.name)}，正本節點 ${node.id} 叫 ${JSON.stringify(node.name)}`);
      }

      // (h) entry 的未知欄位。理由同下面 stat 那一層：這份表是社群 PR 直接改的，而多寫一個
      // 欄位的後果是「我明明填了，畫面上就是沒有」——寫錯的那個名字沒有任何東西會提起它。
      for (const k of Object.keys(e)) {
        if (k !== 'name' && k !== 'note' && k !== 'stats') push(`規則 23(h): ${gameId} 有未知欄位 ${JSON.stringify(k)}`);
      }
      if (e.note !== undefined && (typeof e.note !== 'string' || e.note.length === 0)) {
        // 空字串是 falsy，會安靜地通過「有沒有備註」那種判斷——同 nodes.json 選用欄位的規矩：
        // 不用時整個省略，不可寫 ""。
        push(`規則 23(d): ${gameId} 的 note 若存在就必須是非空字串（不用時整個省略）`);
      }
      if (!Array.isArray(e.stats) || e.stats.length === 0) { push(`規則 23(d): ${gameId} 的 stats 必須是非空陣列`); continue; }

      const labelSeen = new Set<string>();
      for (const [i, s] of (e.stats as unknown[]).entries()) {
        if (!isPlainObject(s)) { push(`規則 23(e): ${gameId} 的第 ${i + 1} 項數值必須是物件`); continue; }
        const st = s as Record<string, unknown>;
        for (const k of ['label', 'base'] as const) {
          if (typeof st[k] !== 'string' || (st[k] as string).length === 0) push(`規則 23(e): ${gameId} 的第 ${i + 1} 項數值的 ${k} 必須是非空字串`);
        }
        // (f) 同一顆骰子兩個同名項目：畫面上是兩顆一模一樣的 pill，而查值查到哪一個
        // 完全取決於陣列順序。
        const label = st['label'];
        if (typeof label === 'string') {
          if (labelSeen.has(label)) push(`規則 23(f): ${gameId} 有兩項數值都叫 ${JSON.stringify(label)}`);
          labelSeen.add(label);
        }
        // (g) 官方的「骰子強化數據」分頁要嘛收錄了這一項（四個檔位的值都有），要嘛完全沒收錄
        // （＝固定值）。中間狀態代表落地時漏了一欄，而**畫面上看不出來**：statValue() 對缺少
        // 的檔位刻意退回基礎值（固定項目必須這樣才不會留下空白的 pill），所以「漏一檔」看起來
        // 就只是「這一檔剛好沒變」。渲染端必須寬容，閘門就不能寬容。
        const MODES = ['dice7', 'lv15', 'lv15dice7'] as const;
        const have = MODES.filter(k => st[k] !== undefined);
        if (have.length > 0 && have.length < MODES.length) {
          push(`規則 23(g): ${gameId} 的 ${JSON.stringify(label)} 只有 ${have.join('、')}，四個檔位的值要嘛全有要嘛全無`);
        }
        // 三個檔位 ＋ 兩條官方成長規則原文，都是「有就必須是非空字串」。
        // ⚠️ 成長規則不可以放過空字串：`growthNote()` 用的是 `??`，`""` 不會被換成「—」，
        // pill 的 title 會變成「骰點：／強化：無變化」，而 CI 全綠（同 (d) 對 note 的判準）。
        for (const k of [...MODES, 'diceGrowth', 'spGrowth'] as const) {
          if (st[k] !== undefined && (typeof st[k] !== 'string' || (st[k] as string).length === 0)) {
            push(`規則 23(e): ${gameId} 的 ${JSON.stringify(label)} 的 ${k} 必須是非空字串`);
          }
        }
        // (h) 未知欄位。這條是 (g) 的補完，不是潔癖：(g) 抓的是「三個檔位鍵只對了一部分」，
        // **三個全部打錯**時 `have.length` 是 0，(g) 完全沉默，那一項會被 `isFixed()` 判成
        // 固定值——正是 (g) 說閘門不可以寬容的那種「畫面上跟『它本來就不會變』一模一樣」。
        const KNOWN = new Set(['label', 'base', ...MODES, 'diceGrowth', 'spGrowth']);
        for (const k of Object.keys(st)) {
          if (!KNOWN.has(k)) push(`規則 23(h): ${gameId} 的 ${JSON.stringify(label)} 有未知欄位 ${JSON.stringify(k)}`);
        }
      }
    }
  }

  // 規則 24：戰術（`data/tactics.json` ＋ `data/tactic-icons/`）。
  //
  // 58 條「已啟用」的戰術。⚠️ 官方資料表有 74 條，另外 16 條標「未啟用」（資料表有、遊戲
  // 沒開）刻意不落地——Yuki 2026-08-26 裁決。因此「`mode === '對戰'` ⟺ 沒有 `coop`」在
  // 這份檔案裡是一條真的不變量（(j) 守它）；把未啟用那批加回來會同時打破它。
  //
  // 子規則：(a)(e)(f)(g)(h)(k) 與 (b)(c)(d) 見 checkIconedRecordList()；
  // 這裡自己加的是 (i) 子選項語意與 (j) 模式與合作效果的等價。
  if (opts.tactics === null) {
    warn('規則 24: 沒有提供 data/tactics.json，戰術未檢查');
  } else {
    const scan = checkIconedRecordList(opts.tactics, {
      rule: '規則 24',
      file: 'data/tactics.json',
      iconsDir: opts.tacticIconsDir,
      // 子選項是 `69-1`；母編號本身不帶前導零，`06` 這種寫法在畫面上會排在錯的位置。
      idPattern: /^[1-9]\d*(-[1-9]\d*)?$/,
      knownKeys: ['id', 'name', 'stage', 'mode', 'versus', 'coop', 'gameId', 'icon', 'dataIssue'],
      requiredText: ['id', 'name', 'stage', 'mode', 'versus', 'gameId'],
      optionalText: ['coop'],
      markupKeys: ['versus', 'coop'],
      whitelist,
    });
    scan.errors.forEach(push);
    scan.warnings.forEach(warn);

    const STAGES = new Set(['前期', '中期', '後期', '選項']);
    const MODES = new Set(['對戰', '對戰／合作']);
    const ids = new Set(scan.records.map(r => r.id as string));
    for (const rec of scan.records) {
      const id = rec.id as string;
      const stage = rec.stage as string;
      const mode = rec.mode as string;
      if (!STAGES.has(stage)) push(`規則 24(e): data/tactics.json 的 ${id} 的 stage ${JSON.stringify(stage)} 不是四個階段之一`);
      // ⚠️ `未啟用` 要指名道姓地擋。它是官方資料表真有的第三個值，複製一筆未啟用的資料
      // 進來時「不是合法模式」這種泛用訊息會讓人以為是打錯字，而真正的答案是「這一批
      // 刻意不收」——那件事只寫在註解與 CLAUDE.md 裡，錯誤訊息得自己說出來。
      else if (mode === '未啟用') push(`規則 24(e): data/tactics.json 的 ${id} 的 mode 是「未啟用」——未啟用的戰術刻意不落地（Yuki 2026-08-26 裁決），整筆移除，不要改成別的模式`);
      else if (!MODES.has(mode)) push(`規則 24(e): data/tactics.json 的 ${id} 的 mode ${JSON.stringify(mode)} 不是合法的適用模式`);

      // (i) 子選項語意：id 含 `-` ⟺ stage 是「選項」，而且母條目要在。
      // 兩邊各自看都很正常——一條 stage 寫成「前期」的 `69-2` 會被排到前期那一群裡，
      // 跟它的母條目「選擇由我決定」分家，而畫面上那只是「多一條前期戰術」。
      const dash = id.includes('-');
      if (dash !== (stage === '選項')) {
        push(dash
          ? `規則 24(i): data/tactics.json 的 ${id} 是子選項（id 含 -），stage 必須是「選項」，目前是 ${JSON.stringify(stage)}`
          : `規則 24(i): data/tactics.json 的 ${id} 的 stage 是「選項」，但 id 不是「母編號-序號」的子選項形式`);
      }
      if (dash) {
        const parent = id.slice(0, id.indexOf('-'));
        if (!ids.has(parent)) push(`規則 24(i): data/tactics.json 的子選項 ${id} 找不到母條目 ${parent}`);
      }

      // (j) 「純對戰」與「有合作效果」必須互為表裡。⚠️ 兩個方向都要問：漏抓「對戰卻有
      // coop」的話，那條戰術在合作模式下會冒出一段官方沒有的文字；漏抓「對戰／合作卻沒
      // coop」的話，它在合作模式下整條消失，而畫面上跟「這條本來就只有對戰」一模一樣。
      // ⚠️ 用 `!== undefined` 而不是 truthiness：`coop: null`／`coop: 0` 這種值在
      // (e) 已經被 optionalText 擋掉了，但這裡若寫成 `if (rec.coop)`，(e) 哪天放寬時
      // 這條會跟著默默失效——兩條規則不要互相依賴對方的嚴格度。
      const hasCoop = rec.coop !== undefined;
      if (mode === '對戰' && hasCoop) push(`規則 24(j): data/tactics.json 的 ${id} 的 mode 是「對戰」卻有 coop`);
      if (mode === '對戰／合作' && !hasCoop) push(`規則 24(j): data/tactics.json 的 ${id} 的 mode 是「對戰／合作」卻沒有 coop`);

      if (rec.dataIssue !== undefined && rec.dataIssue !== 'upstream-icon') {
        push(`規則 24(e): data/tactics.json 的 ${id} 的 dataIssue ${JSON.stringify(rec.dataIssue)} 不是已知的標記`);
      }
    }
  }

  // 規則 25：Boss（`data/boss.json` ＋ `data/boss-icons/`）。
  //
  // 跟規則 24 是同一種資料檔，差別只有欄位與 id 形狀，所以檢查全部走
  // checkIconedRecordList()——這裡刻意不再多寫任何一條，複製第二份出去就一定漂移
  // （規則 7 與 21 曾經是兩份，漂移的結果寫在 checkHashNamedIconDir() 的說明裡）。
  if (opts.boss === null) {
    warn('規則 25: 沒有提供 data/boss.json，Boss 未檢查');
  } else {
    const scan = checkIconedRecordList(opts.boss, {
      rule: '規則 25',
      file: 'data/boss.json',
      iconsDir: opts.bossIconsDir,
      idPattern: /^[1-9]\d*$/,
      knownKeys: ['id', 'name', 'effect', 'gameId', 'icon'],
      requiredText: ['id', 'name', 'effect', 'gameId'],
      markupKeys: ['effect'],
      whitelist,
    });
    scan.errors.forEach(push);
    scan.warnings.forEach(warn);
  }

  return { errors, warnings };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  // 讀資料檔本身也是閘門的一部分：每一個 readFileSync／JSON.parse 都是一個未捕捉例外的入口，
  // 檔案被刪或 JSON 少一個逗號時，`npm run validate` 印出來的是 stack trace 而不是
  // 「❌ N 個問題」，一條規則都沒跑。所以讀檔一律走這支，讀不到就變成指得出檔名的錯誤。
  //
  // 「檔案不存在」與「檔案壞掉」刻意分開：`ValidateOpts` 有幾份資料檔本來就備好了一條
  // 「傳 null ＝沒有這份資料，該規則只警告」的路（upgrade-cost／maxlevel-official／
  // unlock-exceptions／changelog／board-icons），CLI 過去走不到它。解析失敗則一律是錯——
  // 那是「有這份資料，但它壞了」，不是「沒有」。
  const fileErrors: string[] = [];
  const readDataFile = (path: string, optional: boolean): unknown => {
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (optional && err.code === 'ENOENT') return null;
      fileErrors.push(`資料檔 ${path} 讀不到：${err.message}`);
      return null;
    }
    try {
      return JSON.parse(text);
    } catch (e) {
      fileErrors.push(`資料檔 ${path} 不是合法的 JSON：${(e as Error).message}`);
      return null;
    }
  };

  let svgText = '';
  try {
    svgText = readFileSync('data/dice-tree.svg', 'utf8');
  } catch (e) {
    fileErrors.push(`資料正本 data/dice-tree.svg 讀不到：${(e as Error).message}`);
  }
  const opts: ValidateOpts = {
    keywords: (readDataFile('data/keywords.json', false) ?? {}) as Record<string, GlossaryRecord>,
    upgradeCostTable: readDataFile('data/upgrade-cost.json', true) as UpgradeCostTable | null,
    nodeText: readDataFile('data/nodes.json', false),
    maxLevelOfficial: readDataFile('data/maxlevel-official.json', true) as MaxLevelOfficial | null,
    unlockExceptions: readDataFile('data/unlock-exceptions.json', true) as Record<string, { unlockVia: string; note?: string; unlockPaid?: unknown; bypassPrereq?: unknown }> | null,
    changelog: readDataFile('data/changelog.json', true),
    iconsDir: 'data/icons',
    dataDir: 'data',
    boardIcons: readDataFile('data/board-icons.json', true),
    boardIconsDir: 'data/board-icons',
    passiveUpgradeCost: readDataFile('data/passive-upgrade-cost.json', true),
    diceStats: readDataFile('data/dice-stats.json', true),
    tactics: readDataFile('data/tactics.json', true),
    tacticIconsDir: 'data/tactic-icons',
    boss: readDataFile('data/boss.json', true),
    bossIconsDir: 'data/boss-icons',
  };

  // 有資料檔讀不到時就停在這裡：接下來每一條規則都會拿著一份空殼在猜，噴出來的幾百條錯誤
  // 只會把真正的原因埋掉（跟「幾何規則不吃 withText」同一個判準）。
  if (fileErrors.length > 0) {
    fileErrors.forEach(m => console.error(`❌ ${m}`));
    console.log(`❌ ${fileErrors.length} 個資料檔讀不到或不是合法的 JSON，其餘規則未執行`);
    process.exit(1);
  }

  const { errors, warnings } = validate(svgText, opts);
  warnings.forEach(w => console.warn(`⚠️  ${w}`));
  errors.forEach(e => console.error(e));
  console.log(errors.length === 0 ? '✅ 驗證通過' : `❌ ${errors.length} 個問題`);
  process.exit(errors.length === 0 ? 0 : 1);
}
