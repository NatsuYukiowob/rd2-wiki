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
import type { Edge, GlossaryRecord, MaxLevelOfficial, UpgradeCostTable } from '../src/lib/types.js';

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
  unlockExceptions: Record<string, { unlockVia: string; note?: string }> | null;
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
    for (const [id, entry] of Object.entries(exceptions)) {
      if (!nodeIds.has(id)) push(`規則 18: 解鎖例外表指向不存在的節點 ${JSON.stringify(id)}`);
      // 'cost' 是預設值，寫進例外表沒有意義，而且會讓人以為它有作用
      if (!VALID_VIA.includes(entry?.unlockVia ?? '')) {
        push(`規則 18: 節點 ${id} 的 unlockVia ${JSON.stringify(entry?.unlockVia)} 不合法，必須是 ${VALID_VIA.join('／')}`);
      }
      if (entry?.note !== undefined && (entry.note.length === 0 || entry.note.length > MAX_TEXT_LENGTH)) {
        push(`規則 18: 節點 ${id} 的 note 長度 ${entry.note.length} 不合法（1..${MAX_TEXT_LENGTH}）`);
      }
    }
  }

  // 規則 7: 圖示。以 iconsDir 內實際檔案為準做一次全面掃描（而非逐節點重複讀檔／算雜湊），
  // 因為同一張圖示常被多個節點共用（實測有一張被 15 個節點共用），檔案層級的問題只需驗一次。
  const iconFileNames = readdirSync(opts.iconsDir).filter(f => f.endsWith('.png'));
  const iconHashSet = new Set(iconFileNames.map(f => f.slice(0, -'.png'.length)));
  const referencedIcons = new Set(nodes.map(n => n.icon));
  for (const fileName of iconFileNames) {
    const expectedHash = fileName.slice(0, -'.png'.length);
    const buf = readFileSync(join(opts.iconsDir, fileName));
    // 規則 7(b): 檔案內容的 sha256 前 12 碼必須等於檔名，防止「改了內容卻沒改檔名」造成快取污染。
    const actualHash = createHash('sha256').update(buf).digest('hex').slice(0, 12);
    if (actualHash !== expectedHash) push(`規則 7(b): 圖示 ${fileName} 的內容 sha256 前 12 碼為 ${actualHash}，與檔名不符`);
    // 規則 7(c): 必須是有效 PNG，且最長邊 ≥ 96px。
    const size = readPngSize(buf);
    if (!size) push(`規則 7(c): 圖示 ${fileName} 不是有效的 PNG`);
    else if (Math.max(size.width, size.height) < 96) push(`規則 7(c): 圖示 ${fileName} 最長邊 ${Math.max(size.width, size.height)}px，小於最低要求 96px`);
    // 規則 7(d): 未被任何節點引用的圖示，只警告不擋 PR。
    if (!referencedIcons.has(expectedHash)) warn(`規則 7(d): 圖示 ${fileName} 未被任何節點引用`);
  }
  // 規則 7(c) 的 96px 下限是「圖檔本身別太小」，跟「它會被放多大」無關。顯示尺寸自 2026-08-18
  // 改成逐節點寫在正本的 `<image width/height>`（不再由類型推導）之後，那個數字變成**完全沒有
  // 人守**：parseTree 只擋 ≤0／NaN，規則 7 只看檔案。一個 PR 把某個節點寫成 width="500"
  // height="500"，CI 全綠，sprite 會為它開一個 500×500 的分區、拿 104px 的來源拉上去，站台上
  // 就是一塊糊掉的巨型貼圖。這裡補上「顯示尺寸不得超過來源解析度的一半」——跟規則 10 對樞紐圖
  // 的要求同一個標準（來源至少要是顯示尺寸的兩倍，高 DPI 螢幕才不會糊）。
  const pngSizeByHash = new Map<string, { width: number; height: number }>();
  for (const fileName of iconFileNames) {
    const size = readPngSize(readFileSync(join(opts.iconsDir, fileName)));
    if (size) pngSizeByHash.set(fileName.slice(0, -'.png'.length), size);
  }
  for (const n of nodes) {
    // 規則 7(a): 節點引用的圖示必須存在於 iconsDir。
    if (!iconHashSet.has(n.icon)) { push(`規則 7(a): 節點 ${n.id} 引用的圖示 ${n.icon} 不存在`); continue; }
    // 規則 7(e): 顯示尺寸 × 2 不得超過圖檔解析度。
    const px = pngSizeByHash.get(n.icon);
    if (!px) continue; // 不是有效 PNG——規則 7(c) already 報過了，這裡不重複
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

  return { errors, warnings };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { errors, warnings } = validate(readFileSync('data/dice-tree.svg', 'utf8'), {
    keywords: JSON.parse(readFileSync('data/keywords.json', 'utf8')),
    upgradeCostTable: JSON.parse(readFileSync('data/upgrade-cost.json', 'utf8')),
    nodeText: JSON.parse(readFileSync('data/nodes.json', 'utf8')),
    maxLevelOfficial: JSON.parse(readFileSync('data/maxlevel-official.json', 'utf8')),
    unlockExceptions: JSON.parse(readFileSync('data/unlock-exceptions.json', 'utf8')),
    changelog: JSON.parse(readFileSync('data/changelog.json', 'utf8')),
    iconsDir: 'data/icons',
    dataDir: 'data',
  });
  warnings.forEach(w => console.warn(`⚠️  ${w}`));
  errors.forEach(e => console.error(e));
  console.log(errors.length === 0 ? '✅ 驗證通過' : `❌ ${errors.length} 個問題`);
  process.exit(errors.length === 0 ? 0 : 1);
}
