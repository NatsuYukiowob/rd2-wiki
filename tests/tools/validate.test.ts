import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validate } from '../../tools/validate';
import type { GlossaryEntry, MaxLevelOfficial, UpgradeCostTable } from '../../src/lib/types';

const svg = readFileSync('data/dice-tree.svg', 'utf8');
const nodeText: Record<string, Record<string, unknown>> = JSON.parse(readFileSync('data/nodes.json', 'utf8'));
const keywords: Record<string, GlossaryEntry> = JSON.parse(readFileSync('data/keywords.json', 'utf8'));
const upgradeCostTable: UpgradeCostTable = JSON.parse(readFileSync('data/upgrade-cost.json', 'utf8'));
const maxLevelOfficial: MaxLevelOfficial = JSON.parse(readFileSync('data/maxlevel-official.json', 'utf8'));
const unlockExceptions: Record<string, { unlockVia: string; note?: string }> =
  JSON.parse(readFileSync('data/unlock-exceptions.json', 'utf8'));
const iconsDir = 'data/icons';
const dataDir = 'data';
const opts = { keywords, nodeText, upgradeCostTable, maxLevelOfficial, unlockExceptions, iconsDir, dataDir };

/**
 * 產生一份「只改了某幾筆」的 nodes.json。文案搬進 JSON 之後，破壞文案的測試不再是對 SVG 字串
 * 做 replace，而是改這份物件——這正是 #21 要換到的東西：一筆改動就是一行 diff。
 *
 * 深拷貝而不是淺層展開：`{...nodeText, '1001': {...}}` 只換掉被指名的那幾筆，但測試若寫成
 * `patch({'1001': {...nodeText['1001'], name: 'x'}})` 之外的形式（例如直接 mutate），
 * 就會污染其他測試共用的 `nodeText`，而症狀是「單獨跑綠、全部一起跑紅」。
 */
const patch = (over: Record<string, unknown>) => ({
  ...opts,
  nodeText: { ...structuredClone(nodeText), ...over },
});

/**
 * 從正本裡把邊的 `d` 屬性全撈出來。規則 5／6 的測試要「挑一條真實存在的邊來破壞」，
 * 以前是把座標字面值寫死在測試裡——版面一改，replace 就變成 no-op，測試安靜地什麼都沒驗到
 * 卻仍然是綠的（這正是這次改版時被抓到的情形）。改成從資料當場取，版面再怎麼變都還是在驗
 * 「破壞一條真的邊會不會被擋下來」這件事。
 */
const edgeDs = [...svg.matchAll(/<path class="edge"[^>]*d="([^"]+)"/g)].map(m => m[1]!);

/** 一張真的 48x31 PNG（全透明），用來驗「解析度太低」這條規則——必須是合法 PNG，否則會先被
 *  「不是有效的 PNG」那條擋掉，測不到解析度檢查。 */
const TINY_PNG = (() => {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(48, 0);
  ihdr.writeUInt32BE(31, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc(31 * (1 + 48 * 4));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
})();

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c;
}

describe('validate', () => {
  it('現有資料為黃金樣本：errors 與 warnings 都必須為零', () => {
    const result = validate(svg, opts);
    expect(result.errors).toEqual([]);
    // 圖示都存在、雜湊相符、尺寸合格、且都被引用，沒有 data-wip 節點；2026-08-20 起
    // 描述裡也不再有 `{n}` 佔位符（改成遊戲內實際顯示的文字），所以警告應該一條都沒有。
    // ⚠️ 這裡刻意驗「等於空陣列」而不是「每一條都符合某個樣式」——後者在陣列為空時
    // 恆為真，等於什麼都沒驗。
    expect(result.warnings).toEqual([]);
  });

  it('規則 9：描述裡出現 {n} 佔位符會被列進 warnings（不擋 PR）', () => {
    // 真實資料現在一個佔位符都沒有，這條就是那個機制唯一的守門員——上游隨時可能再冒出
    // 新的 `{n}`，沒有它的話整段偵測邏輯被拿掉也不會有人發現。
    // （#21 之前這裡要同時改 data-description 與 <title> 兩處，因為舊的規則 1 要求兩者逐字
    // 相同；文案搬進 nodes.json 之後副本沒了，改一個欄位就是改一個欄位。）
    const result = validate(svg, patch({
      '5302': { ...nodeText['5302'], description: nodeText['5302']!.description!.toString().replace('#僵硬範圍增加30%', '#僵硬範圍增加30%(+{1}%)') },
    }));
    expect(result.errors).toEqual([]);                       // 佔位符只警告、不擋
    expect(result.warnings.some(w => /規則 9.*5302.*佔位符/.test(w))).toBe(true);
  });

  it('規則 2：重複 id 會被擋', () => {
    const broken = svg.replace('data-id="1002"', 'data-id="1001"');
    expect(validate(broken, opts).errors.some(e => /重複.*id/.test(e))).toBe(true);
  });

  it('規則 4：不合文法的成本會被擋', () => {
    expect(validate(svg, patch({ '1001': { ...nodeText['1001'], cost: '免費' } }))
      .errors.some(e => /成本/.test(e))).toBe(true);
  });

  it('規則 5：邊的端點沒對上節點中心會被擋', () => {
    // 把第一條邊的終點挪到 (7, 7)——畫布左上角的空白處，不可能是任何節點中心。
    const d = edgeDs[0]!;
    const broken = svg.replace(d, d.replace(/L [-\d.]+ [-\d.]+$/, 'L 7 7'));
    expect(broken).not.toBe(svg);
    expect(validate(broken, opts).errors.some(e => /端點/.test(e))).toBe(true);
  });

  it('規則 10：中央樞紐的放射線指向不存在的節點會被擋', () => {
    const broken = svg.replace(/(<g class="tree-center" data-links=")[^"]*"/, '$19999 2001 3001 4008 5002"');
    expect(broken).not.toBe(svg);
    expect(validate(broken, opts).errors.some(e => /規則 10.*9999/.test(e))).toBe(true);
  });

  it('規則 10：中央樞紐的圖檔不存在會被擋', () => {
    const broken = svg.replace('href="tree-center.png"', 'href="tree-center-not-here.png"');
    expect(broken).not.toBe(svg);
    expect(validate(broken, opts).errors.some(e => /規則 10.*不存在/.test(e))).toBe(true);
  });

  it('規則 10：樞紐的連線跟預期的根不一致時只警告、不擋 PR', () => {
    // 少接一條線不會讓資料變不合法，但幾乎一定是漏改——列進 warnings 讓 PR 摘要看得到。
    const broken = svg
      .replace(/(<g class="tree-center" data-links=")[^"]*"/, '$11001 2001 3001 4008"')
      .replace(/\n<path class="tree-center-link"[^>]*\/>(?=\n<image href="tree-center)/, '');
    expect(broken).not.toBe(svg);
    const result = validate(broken, opts);
    expect(result.errors).toEqual([]);
    expect(result.warnings.some(w => /規則 10.*5002/.test(w))).toBe(true);
  });

  it('規則 10：放射線的終點沒對上 data-links 指定的節點中心會被擋', () => {
    // 站台是拿 links 的 id 去查節點座標、自己重畫這五條線，所以正本畫歪了站台完全看不出來，
    // 只有 CI 擋得住——正本與線上版會安靜地長得不一樣。
    const d = /tree-center-link" d="([^"]+)"/.exec(svg)![1]!;
    const broken = svg.replace(d, d.replace(/L [-\d.]+ [-\d.]+$/, 'L 7.00 7.00'));
    expect(broken).not.toBe(svg);
    expect(validate(broken, opts).errors.some(e => /規則 10.*放射線.*沒對上/.test(e))).toBe(true);
  });

  it('規則 10：data-links 順序被調換會被擋（線與 id 對不上）', () => {
    const broken = svg.replace(/(<g class="tree-center" data-links=")[^"]*"/, '$12001 1001 3001 4008 5002"');
    expect(broken).not.toBe(svg);
    expect(validate(broken, opts).errors.some(e => /規則 10.*放射線/.test(e))).toBe(true);
  });

  it('規則 10：樞紐的圖解析度低於顯示尺寸兩倍會被擋', () => {
    const tinyDir = mkdtempSync(join(tmpdir(), 'rd2-center-'));
    for (const f of readdirSync(iconsDir)) writeFileSync(join(tinyDir, f), readFileSync(join(iconsDir, f)));
    // 48x31 的縮圖：建置期會把它放大四倍，成品是一團糊，過去什麼規則都沒擋
    writeFileSync(join(tinyDir, 'tree-center.png'), TINY_PNG);
    const result = validate(svg, { keywords, nodeText, upgradeCostTable, maxLevelOfficial, unlockExceptions, iconsDir, dataDir: tinyDir });
    expect(result.errors.some(e => /規則 10.*小於顯示尺寸的兩倍/.test(e))).toBe(true);
  });

  it('規則 7(e)：顯示尺寸相對圖示解析度過大會被擋', () => {
    // 顯示尺寸 2026-08-18 改成逐節點寫在正本裡（不再由類型推導），這條是它唯一的守門員：
    // 少了它，一個 width="500" 的節點會讓 sprite 為它開一個 500×500 分區、拿 104px 的來源
    // 拉上去，站台上是一塊糊掉的巨型貼圖，而 CI 全綠。
    const broken = svg.replace(
      /(<image href="icons\/[0-9a-f]{12}\.png" x="[-\d.]+" y="[-\d.]+" )width="[\d.]+" height="[\d.]+"/,
      '$1width="500" height="500"',
    );
    expect(broken).not.toBe(svg);
    expect(validate(broken, opts).errors.some(e => /規則 7\(e\)/.test(e))).toBe(true);
  });

  it('規則 5：邊少了 marker-end 會被擋', () => {
    const broken = svg.replace('<path class="edge" marker-end="url(#arrow)"', '<path class="edge"');
    expect(validate(broken, opts).errors.some(e => /marker-end/.test(e))).toBe(true);
  });

  it('規則 6：從根不可達的節點會被擋', () => {
    // 要讓某個節點真的變不可達，必須挑「終點只有這一條入邊」的邊來刪；隨便刪一條的話，
    // 多重前置的節點（實際資料有 14 個）還有別的爸爸，圖仍然連通，測試就變成偽陰性。
    const inDegree = new Map<string, number>();
    for (const d of edgeDs) {
      const to = d.slice(d.indexOf(' L ') + 3);
      inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
    }
    const soleParentEdge = edgeDs.find(d => inDegree.get(d.slice(d.indexOf(' L ') + 3)) === 1)!;
    expect(soleParentEdge).toBeDefined();
    const broken = svg.replace(new RegExp(`<path class="edge"[^>]*d="${soleParentEdge.replace(/[.]/g, '\\.')}"\\s*/>`), '');
    expect(broken).not.toBe(svg);
    expect(validate(broken, opts).errors.some(e => /不可達/.test(e))).toBe(true);
  });

  it('規則 6：帶 data-wip 的新節點不會被誤擋（偽陽性測試），且會被列入 warnings', () => {
    const wip = svg.replace('</svg>',
      '<g class="node" data-wip="1" transform="translate(300.00,300.00)" data-id="1099">' +
      '<rect x="-36" y="-28" width="72" height="56" stroke="#ef625e"/>' +
      '<image href="icons/000000000000.png" width="56" height="56"/></g></svg>');
    const wipText = {
      ...nodeText,
      '1099': { name: '測試骰子', label: '測試骰子', type: '骰子', gameId: 'D999', cost: '核心 5', maxLevel: 1, description: '測試', awakening: '測試覺醒' },
    };
    // 圖示內容檢查（規則 7b/7c）與這條測試的重點無關，所以用一個獨立的暫存目錄放假圖示，
    // 不動到真正的 data/icons；假圖示的雜湊／格式不會通過規則 7，但那是預期中的另一個
    // 錯誤，不影響本測試只關心的「不可達」斷言。
    const tmpIconsDir = mkdtempSync(join(tmpdir(), 'rd2-wiki-icons-'));
    writeFileSync(join(tmpIconsDir, '000000000000.png'), Buffer.from('not-a-real-png'));
    const result = validate(wip, { keywords, nodeText: wipText, upgradeCostTable, maxLevelOfficial, unlockExceptions, iconsDir: tmpIconsDir, dataDir });
    expect(result.errors.some(e => /不可達/.test(e))).toBe(false);
    expect(result.warnings.some(w => /規則 6\(c\)/.test(w) && w.includes('1099'))).toBe(true);
  });

  it('規則 8：# 標記比不到白名單會被擋', () => {
    expect(validate(svg, patch({ '1002': { ...nodeText['1002'], description: '於怪物移動路徑上，設置#不存在的關鍵字' } }))
      .errors.some(e => /白名單/.test(e))).toBe(true);
  });

  it('規則 8(b)：詞彙表缺 desc、色碼不合法、或解釋裡的 # 查不到，都會被擋', () => {
    const bad = (patch: Record<string, unknown>) =>
      validate(svg, { ...opts, keywords: { ...keywords, ...patch } as typeof keywords }).errors;

    expect(bad({ 冰凍: { code: 'FROZEN', color: '#9B6BFF', desc: '' } }).some(e => /缺少 desc/.test(e))).toBe(true);
    expect(bad({ 冰凍: { code: 'FROZEN', color: '藍色', desc: '移動速度減少' } }).some(e => /color/.test(e))).toBe(true);
    expect(bad({ 冰凍: { code: '', color: '#9B6BFF', desc: '移動速度減少' } }).some(e => /缺少 code/.test(e))).toBe(true);
    // 解釋文字會跟著節點一起顯示給玩家，裡面的 # 指到不存在的詞就是面板上一個查不到東西的標記，
    // 而逐節點的規則 8 只掃 data-description，永遠掃不到它。
    expect(bad({ 冰凍: { code: 'FROZEN', color: '#9B6BFF', desc: '對#根本沒這個詞 生效' } })
      .some(e => /8\(b\).*白名單/.test(e))).toBe(true);
    // 沒有動過的正本＋正本詞彙表不該有任何 8(b) 問題
    expect(validate(svg, opts).errors.filter(e => /8\(b\)/.test(e))).toEqual([]);
  });

  it('規則 14：骰子漏填覺醒、或非骰子多填覺醒，都會被擋', () => {
    const { awakening: _dropped, ...noAwakening } = nodeText['1001']!;
    expect(validate(svg, patch({ '1001': noAwakening })).errors.some(e => /規則 14.*缺少 awakening/.test(e))).toBe(true);

    // 把覺醒掛到一個符文節點上
    expect(validate(svg, patch({ '1201': { ...nodeText['1201'], awakening: '不該出現在這裡' } }))
      .errors.some(e => /規則 14.*不該有 awakening/.test(e))).toBe(true);

    // 覺醒文字裡的 # 一樣要在白名單裡
    expect(validate(svg, patch({ '1001': { ...nodeText['1001'], awakening: '賦予#根本沒這個詞' } }))
      .errors.some(e => /規則 14.*白名單/.test(e))).toBe(true);
  });

  it('規則 8(b)：別名只准指到有解釋的本尊，而且不准鏈', () => {
    const bad = (patch: Record<string, unknown>) =>
      validate(svg, { ...opts, keywords: { ...keywords, ...patch } as typeof keywords }).errors;
    expect(bad({ 播種: { aliasOf: '沒有這個詞' } }).some(e => /aliasOf 指向不存在/.test(e))).toBe(true);
    expect(bad({ 播種: { aliasOf: '傳送' } }).some(e => /指向另一個別名/.test(e))).toBe(true);
    expect(validate(svg, opts).errors.filter(e => /8\(b\)/.test(e))).toEqual([]);
  });

  it('規則 15：升級花費表的等級不連續、或 1 級金額與正本的解鎖金幣對不起來，都會被擋', () => {
    const withTable = (t: unknown) => validate(svg, { ...opts, upgradeCostTable: t as UpgradeCostTable }).errors;

    const gap = { ...upgradeCostTable, levels: upgradeCostTable.levels.filter(r => r.level !== 3) };
    expect(withTable(gap).some(e => /規則 15.*連續/.test(e))).toBe(true);

    // 這一條是兩份資料唯一的交點：表格說 1 級要 9,999 金幣，正本卻寫 2,000
    const drift = {
      ...upgradeCostTable,
      levels: upgradeCostTable.levels.map(r => (r.level === 1 ? { ...r, gold: 9999 } : r)),
    };
    const errs = withTable(drift);
    expect(errs.some(e => /規則 15.*解鎖金幣 2000 與升級花費表 1 級的 9999 不一致/.test(e))).toBe(true);
    expect(errs.filter(e => /規則 15/.test(e)).length).toBe(43);   // 43 個 50 級符文全部報

    expect(withTable({ ...upgradeCostTable, appliesTo: { type: 'rune', maxLevel: 49 } })
      .some(e => /規則 15.*表格長度/.test(e))).toBe(true);
    // 只驗金幣的話這條會漏：上游哪天讓符文解鎖也吃核心，表格 1 級仍寫 core: 0，
    // 面板那句「含解鎖那一次」就少報核心，而規則 15 全綠。
    const coreDrift = {
      ...upgradeCostTable,
      levels: upgradeCostTable.levels.map(r => (r.level === 1 ? { ...r, core: 7 } : r)),
    };
    expect(withTable(coreDrift).some(e => /規則 15.*解鎖核心 0 與升級花費表 1 級的 7 不一致/.test(e))).toBe(true);

    expect(withTable(null).filter(e => /規則 15/.test(e))).toEqual([]);
    expect(validate(svg, opts).errors.filter(e => /規則 15/.test(e))).toEqual([]);
  });

  it('規則 17：描述被解析成別的意思時，官方滿級值是唯一會說話的東西', () => {
    // 前提斷言：這四種破壞法全都是合法的 SVG／成本／關鍵字，規則 1–16 一條都不會報。
    // 少了這行，下面的主斷言可能只是在驗「別條規則擋下來了」，規則 17 其實從沒執行過。
    // 1201 與 3201 共用同一段描述，所以「改描述」一律兩顆一起改——照抄舊版對 SVG 做
    // replaceAll 的語意。
    const bothRunes = (desc: string) => patch({
      '1201': { ...nodeText['1201'], description: desc },
      '3201': { ...nodeText['3201'], description: desc },
    });
    const only17 = (o: ReturnType<typeof bothRunes>) => validate(svg, o).errors.filter(e => /規則 17/.test(e));
    const others = (o: ReturnType<typeof bothRunes>) => validate(svg, o).errors.filter(e => !/規則 17/.test(e));

    // (a) 描述漏寫「(+每級增量)」→ growth 變成 null，面板那行「1 級 X → 50 級 Y」整條消失，
    //     而正本看起來完全正常。1201 與 3201 共用同一段描述，所以兩顆都會報。
    const dropped = bothRunes('基本攻擊傷害增加20%');
    expect(others(dropped)).toEqual([]);
    expect(only17(dropped).some(e => /節點 1201（D0000）解析不出成長值/.test(e))).toBe(true);
    expect(only17(dropped)).toHaveLength(2);

    // (b) 每級增量抄錯一個數字 → 站台照樣算得出一個滿級值，只是那個值是錯的
    const wrongStep = bothRunes('基本攻擊傷害增加20%(+5%)');
    expect(others(wrongStep)).toEqual([]);
    expect(only17(wrongStep).some(e => /節點 1201（D0000）推算的 Lv\.50 滿級值 265 與官方資料表的 216 不一致/.test(e))).toBe(true);

    // (c) 這條規則的來由：正本原本寫「減少-0.5秒(+-0.2秒)」，站台算出「50 級 −10.3 秒」，
    //     一路上沒有任何檢查說話。把它改回舊寫法必須重新變紅，否則這條規則沒有守住它。
    const doubleNegative = patch({ '1204': { ...nodeText['1204'], description: '技能冷卻時間減少-0.5秒(+-0.2秒)' } });
    expect(others(doubleNegative)).toEqual([]);
    expect(only17(doubleNegative).some(e => /節點 1204（D0070）推算的 Lv\.50 滿級值 -10\.3 與官方資料表的 10\.3 不一致/.test(e))).toBe(true);

    // (d) 括號打成全形 → parseGrowth 的正則整段配不到，同樣安靜地退化成「沒有成長值」
    const fullWidth = bothRunes('基本攻擊傷害增加20%（+4%）');
    expect(others(fullWidth)).toEqual([]);
    expect(only17(fullWidth).some(e => /節點 1201（D0000）解析不出成長值/.test(e))).toBe(true);

    // 夾具指到不存在的管理 ID 也要擋：官方資料表換版時節點被砍掉，這是唯一會發現的地方
    const ghost = { ...maxLevelOfficial, values: { ...maxLevelOfficial.values, D9999: { level: 50, value: 1, unit: '%' as const } } };
    expect(validate(svg, { ...opts, maxLevelOfficial: ghost }).errors
      .some(e => /規則 17.*不存在的 gameId D9999/.test(e))).toBe(true);

    expect(validate(svg, { ...opts, maxLevelOfficial: null }).errors.filter(e => /規則 17/.test(e))).toEqual([]);
    expect(validate(svg, opts).errors.filter(e => /規則 17/.test(e))).toEqual([]);
  });

  it('規則 17：上游重新冒出 {n} 佔位符時只警告、不擋 PR（跟規則 9 的政策一致）', () => {
    // 規則 9 對佔位符的政策是「不擋 PR」，而 parseGrowth 對佔位符回的正是 growth: null。
    // 規則 17 若照 !growth 這一路報錯，下一次上游同步就會用「描述八成漏了 (+每級增量)」
    // 這句錯誤的診斷把 PR 擋死，同一份輸出裡規則 9 卻說「不擋 PR」——兩條規則自相矛盾。
    // 1203（D0060）在規則 17 的覆蓋範圍內，所以這是真的走到那條路徑。
    const result = validate(svg, patch({
      '1203': { ...nodeText['1203'], description: '#綻放傷害增加50%(+{1}%)' },
    }));
    expect(result.errors).toEqual([]);
    expect(result.warnings.some(w => /規則 9.*1203.*佔位符/.test(w))).toBe(true);
  });

  it('規則 17：夾具漏掉一顆等級上限大於 1 的符文＝單獨關掉它的檢查，要擋', () => {
    // 沒有這條下限，一個 PR 只要同時改壞成長值並把對應的鍵從夾具刪掉，CI 就全綠。
    const { D0060: _dropped, ...rest } = maxLevelOfficial.values;
    const holed = { ...maxLevelOfficial, values: rest };
    const errs = validate(svg, { ...opts, maxLevelOfficial: holed }).errors;
    expect(errs.some(e => /規則 17.*1203（D0060）.*沒有它的官方滿級值/.test(e))).toBe(true);
    // 前提斷言：真實夾具是滿的（44/44），否則上面那條只是在驗一個本來就缺的項目
    expect(validate(svg, opts).errors.filter(e => /規則 17/.test(e))).toEqual([]);
  });

  it('規則 18：解鎖例外表的 key／unlockVia／note 寫壞都會被擋', () => {
    const withExc = (e: unknown) =>
      validate(svg, { ...opts, unlockExceptions: e as typeof unlockExceptions }).errors.filter(x => /規則 18/.test(x));

    // (a) key 打錯 → 查不到節點，那顆骰子安靜地變回「要花核心買」，整條前置鏈成本跟著變
    expect(withExc({ ...unlockExceptions, '5O08': { unlockVia: 'achievement', note: '競技場 300 分獎勵' } })
      .some(e => /不存在的節點 "5O08"/.test(e))).toBe(true);

    // (b) unlockVia 打錯 → 仍然 !== 'cost'，成本照樣被排除，但面板會印出字面的 undefined
    expect(withExc({ ...unlockExceptions, '5008': { unlockVia: 'quests', note: 'x' } })
      .some(e => /unlockVia "quests" 不合法/.test(e))).toBe(true);

    // (c) 'cost' 是預設值，寫進例外表沒有作用，卻會讓人以為有
    expect(withExc({ ...unlockExceptions, '5008': { unlockVia: 'cost' } })
      .some(e => /unlockVia "cost" 不合法/.test(e))).toBe(true);

    // (d) note 空字串 → 面板 meta 列尾巴變成一段空白
    expect(withExc({ ...unlockExceptions, '5008': { unlockVia: 'achievement', note: '' } })
      .some(e => /note 長度 0 不合法/.test(e))).toBe(true);

    expect(withExc(null)).toEqual([]);
    expect(validate(svg, opts).errors.filter(e => /規則 18/.test(e))).toEqual([]);
  });

  it('規則 16：管理 ID 重複／格式錯／漏填，與細分類放錯位置，都會被擋', () => {
    const errs = (over: Record<string, unknown>) => validate(svg, patch(over)).errors;
    // 1101 是玩家被動、gameId S0200 且帶 category「系別屬性」；改它就能同時測到細分類那幾條。
    expect(nodeText['1101']!.category).toBe('系別屬性');

    expect(errs({ '1002': { ...nodeText['1002'], gameId: 'D000' } }).some(e => /規則 16.*重複/.test(e))).toBe(true);
    expect(errs({ '1001': { ...nodeText['1001'], gameId: '火骰子' } }).some(e => /規則 16.*不符合/.test(e))).toBe(true);

    // 漏填在 JSON 裡是「缺少必填欄位」，由規則 1 擋——而不是像以前那樣掉進規則 16 的格式檢查。
    const { gameId: _noGameId, ...withoutGameId } = nodeText['1001']!;
    expect(errs({ '1001': withoutGameId }).some(e => /規則 1.*缺少 gameId/.test(e))).toBe(true);

    const { category: _noCat, ...withoutCat } = nodeText['1101']!;
    expect(errs({ '1101': withoutCat }).some(e => /規則 16.*缺少 category/.test(e))).toBe(true);
    expect(errs({ '1101': { ...nodeText['1101'], category: '隨便寫' } }).some(e => /規則 16.*未知的 category/.test(e))).toBe(true);

    // 細分類只用在玩家被動上：掛到骰子身上要被擋
    expect(errs({ '1001': { ...nodeText['1001'], category: '系別屬性' } }).some(e => /規則 16.*不該有 category/.test(e))).toBe(true);
  });

  it('規則 16：管理 ID 的命名空間綁死節點型別，換成別種型別的合法編號照樣被擋', () => {
    // 這幾個都是「格式看起來很合理、也不撞號」的改法，寬鬆的 /^[DS]\d{3,4}$/ 全部放行——
    // 而 data-game-id 不進 tree.json，這條規則是它唯一的防線。
    const errs = (over: Record<string, unknown>) => validate(svg, patch(over)).errors;
    expect(errs({ '1201': { ...nodeText['1201'], gameId: 'D123' } })
      .some(e => /規則 16.*骰子符文.*D\\d\{4\}/.test(e))).toBe(true);
    expect(errs({ '1101': { ...nodeText['1101'], gameId: 'D0200' } })
      .some(e => /規則 16.*玩家被動.*S\\d\{4\}/.test(e))).toBe(true);
    expect(errs({ '1001': { ...nodeText['1001'], gameId: 'D0009' } })
      .some(e => /規則 16.*骰子.*D\\d\{3\}/.test(e))).toBe(true);
  });

  // 規則 1 在 #21（2026-08-22）之前是「`<title>` 必須與 `data-*` 全等」——`<title>` 存的是
  // name ＋ description 的完整副本，規則 1 的存在理由就是守那份副本。文案搬進 nodes.json
  // 之後副本沒了，規則 1 改成驗「這份唯一的文案結構完不完整」。
  it('規則 1：nodes.json 缺必填欄位、型別錯、選用欄位寫成空字串、多出未知欄位，都會被擋', () => {
    const errs = (over: Record<string, unknown>) => validate(svg, patch(over)).errors;
    const { name: _dropped, ...noName } = nodeText['1001']!;

    expect(errs({ '1001': noName }).some(e => /規則 1.*節點 1001 缺少 name/.test(e))).toBe(true);
    expect(errs({ '1001': { ...nodeText['1001'], name: '' } }).some(e => /規則 1.*name 不是非空字串/.test(e))).toBe(true);
    expect(errs({ '1001': { ...nodeText['1001'], maxLevel: '50' } }).some(e => /規則 1.*maxLevel 不是 ≥1 的整數/.test(e))).toBe(true);
    expect(errs({ '1001': { ...nodeText['1001'], maxLevel: 0 } }).some(e => /規則 1.*maxLevel 不是 ≥1 的整數/.test(e))).toBe(true);
    expect(errs({ '1001': '不是物件' }).some(e => /規則 1.*節點 1001 的內容不是物件/.test(e))).toBe(true);
    expect(errs({ '1001': { ...nodeText['1001'], 顏色: '紅' } }).some(e => /規則 1.*未知欄位.*顏色/.test(e))).toBe(true);

    // 選用欄位寫成 `""` 而不是整個省略：看起來像「有這個欄位、只是還沒填」，但規則 14／16
    // 的語意是「這種節點根本不該有這個欄位」。兩種寫法混用的話，`"awakening": ""` 會安靜地
    // 通過「非骰子不該有覺醒」那條——因為空字串是 falsy。
    expect(errs({ '1201': { ...nodeText['1201'], awakening: '' } })
      .some(e => /規則 1.*awakening 若要有值必須是非空字串/.test(e))).toBe(true);
  });

  // #21 PR2：標籤從正本 SVG 的 `<text>` 搬進 `label` 欄位之後，正本上再也看不到它——
  // review 一份幾何 PR 時，標籤被清空／被貼上整段描述都是看不出來的，只剩規則 1 會說話。
  it('規則 1：label 缺少、為空、超過 20 字都會被擋', () => {
    const errs = (over: Record<string, unknown>) => validate(svg, patch(over)).errors;
    const { label: _dropped, ...noLabel } = nodeText['1001']!;

    expect(errs({ '1001': noLabel }).some(e => /規則 1.*節點 1001 缺少 label/.test(e))).toBe(true);
    expect(errs({ '1001': { ...nodeText['1001'], label: '' } }).some(e => /規則 1.*label 不是非空字串/.test(e))).toBe(true);
    // 上限是 label 自己的（20），不是其他文字欄位共用的 500——把 description 貼進 label
    // 是最可能的手滑，而 21 個字在 500 的上限下完全合法。
    expect(errs({ '1001': { ...nodeText['1001'], label: '火'.repeat(21) } })
      .some(e => /規則 1.*label 長度 21 超過上限 20/.test(e))).toBe(true);
    expect(errs({ '1001': { ...nodeText['1001'], label: '火'.repeat(20) } })
      .some(e => /規則 1.*label/.test(e))).toBe(false);
  });

  // 規則 19 是文案與幾何拆成兩個檔之後，唯一會說「它們已經不同步」的地方。
  it('規則 19：SVG 的 id 集合與 nodes.json 的鍵集合必須雙射，兩邊的殘餘都要逐一列出', () => {
    // ⚠️ 這裡斷言的是「**只有**規則 19 會說話」，不是「規則 19 有說話」。
    // review 回饋（2026-08-22）：幾何規則（5／6／6(d)／10／13／18）原本跟文案規則吃同一份
    // 「兩邊都在才進得來」的過濾集合，於是漏一筆文案（幾何完好無缺）會產生 55 條錯誤——
    // 54 條是規則 5／6／10／18 在說「從根不可達」「邊端點未對齊」，全部指錯檔案，
    // 而唯一說對的規則 19 被埋在裡面。「忘了改另一個檔」正是兩檔正本下最容易犯的錯。
    const { '1001': _dropped, ...withoutOne } = nodeText;
    const missing = validate(svg, { ...opts, nodeText: withoutOne }).errors;
    expect(missing.some(e => /規則 19.*正本 SVG 有幾何.*沒有文案.*1001/.test(e))).toBe(true);
    expect(missing.filter(e => !/^規則 19/.test(e))).toEqual([]);

    expect(validate(svg, patch({ '9999': { ...nodeText['1001'] } })).errors
      .some(e => /規則 19.*找不到對應節點.*9999/.test(e))).toBe(true);

    // 整份檔案型別就錯掉時要有話說，而不是丟一個沒有規則編號的例外
    expect(validate(svg, { ...opts, nodeText: [] }).errors
      .some(e => /規則 1.*最外層必須是以 id 為鍵的物件/.test(e))).toBe(true);

    expect(validate(svg, opts).errors.filter(e => /規則 19/.test(e))).toEqual([]);
  });

  it('規則 7(a)：引用不存在的圖示會被擋', () => {
    const broken = svg.replace(/href="icons\/[0-9a-f]{12}\.png"/, 'href="icons/ffffffffffff.png"');
    expect(validate(broken, opts).errors.some(e => /圖示/.test(e))).toBe(true);
  });

  it('規則 7(b)：圖示內容 sha256 與檔名不符會被擋', () => {
    // 規則 7(b)/(c) 是掃過 iconsDir 內「實際存在的檔案」，跟哪個節點引用它無關，
    // 所以不需要碰 svg 內容，只要暫存目錄裡有一個「檔名跟內容對不上」的檔案即可。
    const tmpIconsDir = mkdtempSync(join(tmpdir(), 'rd2-wiki-icons-'));
    const realFile = readdirSync(iconsDir).find(f => f.endsWith('.png'))!;
    const realBuf = readFileSync(join(iconsDir, realFile));
    const wrongHash = realFile === '000000000000.png' ? '111111111111' : '000000000000';
    writeFileSync(join(tmpIconsDir, `${wrongHash}.png`), realBuf);
    const result = validate(svg, { keywords, nodeText, upgradeCostTable, maxLevelOfficial, unlockExceptions, iconsDir: tmpIconsDir, dataDir });
    expect(result.errors.some(e => /規則 7\(b\)/.test(e) && /sha256/.test(e))).toBe(true);
  });

  it('規則 7(c)：非 PNG 檔會被擋', () => {
    const tmpIconsDir = mkdtempSync(join(tmpdir(), 'rd2-wiki-icons-'));
    writeFileSync(join(tmpIconsDir, '222222222222.png'), Buffer.from('this is not a png file at all'));
    const result = validate(svg, { keywords, nodeText, upgradeCostTable, maxLevelOfficial, unlockExceptions, iconsDir: tmpIconsDir, dataDir });
    expect(result.errors.some(e => /規則 7\(c\)/.test(e) && /不是有效的 PNG/.test(e))).toBe(true);
  });

  it('規則 7(c)：PNG 尺寸過小（最長邊 < 96px）會被擋', () => {
    const tmpIconsDir = mkdtempSync(join(tmpdir(), 'rd2-wiki-icons-'));
    // 手刻一張 10x10 的最小合法 PNG（僅需通過 readPngSize 的簽章 + IHDR 解析，不需要完整像素資料）。
    const tinyPng = makeMinimalPng(10, 10);
    const tinyHash = createHash('sha256').update(tinyPng).digest('hex').slice(0, 12);
    writeFileSync(join(tmpIconsDir, `${tinyHash}.png`), tinyPng);
    const result = validate(svg, { keywords, nodeText, upgradeCostTable, maxLevelOfficial, unlockExceptions, iconsDir: tmpIconsDir, dataDir });
    expect(result.errors.some(e => /規則 7\(c\)/.test(e) && /小於最低要求 96px/.test(e))).toBe(true);
  });

  it('規則 7(d)：未被任何節點引用的圖示只會警告、不會擋 PR', () => {
    const tmpIconsDir = mkdtempSync(join(tmpdir(), 'rd2-wiki-icons-'));
    for (const f of readdirSync(iconsDir)) {
      writeFileSync(join(tmpIconsDir, f), readFileSync(join(iconsDir, f)));
    }
    const orphanBuf = makeMinimalPng(100, 100);
    const orphanHash = createHash('sha256').update(orphanBuf).digest('hex').slice(0, 12);
    writeFileSync(join(tmpIconsDir, `${orphanHash}.png`), orphanBuf);
    const result = validate(svg, { keywords, nodeText, upgradeCostTable, maxLevelOfficial, unlockExceptions, iconsDir: tmpIconsDir, dataDir });
    expect(result.errors).toEqual([]);
    expect(result.warnings.some(w => /規則 7\(d\)/.test(w) && w.includes(orphanHash))).toBe(true);
  });
});

/** 產生一張只有簽章 + IHDR chunk 的最小合法 PNG，足以通過 `readPngSize` 的結構性檢查。 */
function makeMinimalPng(width: number, height: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8); // bit depth
  ihdrData.writeUInt8(6, 9); // color type: RGBA
  ihdrData.writeUInt8(0, 10); // compression
  ihdrData.writeUInt8(0, 11); // filter
  ihdrData.writeUInt8(0, 12); // interlace
  const length = Buffer.alloc(4);
  length.writeUInt32BE(13, 0);
  const type = Buffer.from('IHDR', 'ascii');
  const crc = Buffer.alloc(4); // readPngSize 不驗證 CRC，填 0 即可
  return Buffer.concat([signature, length, type, ihdrData, crc]);
}

/**
 * 2026-08-19 review 報告 P2 補上的守門規則。
 *
 * 這一組的共通點是：**壞掉的資料在畫面上看不出來**。邊藏在 `<defs>` 裡、節點疊在一起、
 * wip 節點偷偷接線——打開 SVG 看到的畫面跟改動前一模一樣，而站台算出來的前置鏈與成本變了。
 * 每一條都配一個「照舊會過、現在會擋」的反例。
 */
describe('validate：邊與座標的守門（P2）', () => {
  it('規則 6(d)：wip 節點不准接線——而且在它之前，這件事沒有任何規則擋得住', () => {
    // 這是報告裡「幽靈根」那條攻擊的核心：data-wip="1" 讓節點豁免「非預期的根」與
    // 「從根不可達」兩項檢查，而那是圖結構唯一的守門員。豁免＋能接線＝可以把任意節點
    // 切下來再接到別的分支，成本跟著變，validate 全綠、節點數與邊數都不變。
    const broken = svg.replace('data-id="1002"', 'data-id="1002" data-wip="1"');
    expect(broken).not.toBe(svg);

    const { errors } = validate(broken, opts);
    expect(errors.some(e => /規則 6\(d\).*1002/.test(e))).toBe(true);
    // 這一行才是重點：整份規則裡只有 6(d) 攔得到它。拿掉 6(d) 這個測試就會變成「零錯誤」。
    expect(errors.every(e => /規則 6\(d\)/.test(e))).toBe(true);
  });

  it('規則 6(c)：真正沒接線的 wip 節點仍然只警告、不擋 PR', () => {
    // 6(d) 不能連「wip 的本意」一起擋掉：新增一顆完全沒接線的 wip 節點（＝先佔位、之後再接線
    // 這個功能本身），應該只有警告。這條是 6(d) 的正對照——沒有它，把 6(d) 寫成
    // 「只要有 wip 就報錯」也會全綠，而那等於把這個功能整個廢掉。
    const template = svg.split('\n').find(l => l.startsWith('<g class="node"'))!;
    const copiedId = /data-id="(\d+)"/.exec(template)![1]!;
    const placeholder = template
      .replace(/data-id="\d+"/, 'data-id="1099" data-wip="1"')
      .replace(/transform="translate\([-\d.]+,[-\d.]+\)"/, 'transform="translate(50.00,50.00)"');
    const withPlaceholder = svg.replace('</svg>', `${placeholder}\n</svg>`);
    expect(withPlaceholder).not.toBe(svg);

    // 幾何照抄範本，文案補一筆到 nodes.json——管理 ID 要換一個，規則 16 要求全檔唯一。
    const { errors, warnings } = validate(withPlaceholder, patch({
      '1099': { ...nodeText[copiedId], gameId: 'D999' },
    }));
    expect(errors).toEqual([]);
    expect(warnings.some(w => /規則 6\(c\).*1099/.test(w))).toBe(true);
  });

  it('規則 0：邊藏在 <defs> 裡會被擋（瀏覽器不畫，資料端照算）', () => {
    const line = svg.split('\n').find(l => l.startsWith('<path class="edge"'))!;
    const broken = svg.replace(line, `<defs>${line}</defs>`);
    expect(broken).not.toBe(svg);
    expect(validate(broken, opts).errors.some(e => /直屬子元素/.test(e))).toBe(true);
  });

  it('規則 0：邊帶 display="none" 會被擋', () => {
    const broken = svg.replace('<path class="edge"', '<path class="edge" display="none"');
    expect(broken).not.toBe(svg);
    expect(validate(broken, opts).errors.some(e => /display/.test(e))).toBe(true);
  });

  it('規則 0：邊的 opacity="0" 會被擋', () => {
    const broken = svg.replace('<path class="edge"', '<path class="edge" opacity="0"');
    expect(validate(broken, opts).errors.some(e => /opacity/.test(e))).toBe(true);
  });

  it('規則 0：marker-end 指向不存在的箭頭會被擋（畫面上沒有方向，資料端仍是有向邊）', () => {
    const broken = svg.replace('marker-end="url(#arrow)"', 'marker-end="url(#nope)"');
    expect(broken).not.toBe(svg);
    expect(validate(broken, opts).errors.some(e => /marker-end/.test(e))).toBe(true);
  });

  it('規則 0：邊不可帶 marker-start（畫面上像雙向，資料端只有單向）', () => {
    const broken = svg.replace('<path class="edge"', '<path class="edge" marker-start="url(#arrow)"');
    expect(validate(broken, opts).errors.some(e => /marker-start/.test(e))).toBe(true);
  });

  it('規則 0：座標寫成 1.2.3 會被擋，不再靜靜變成 NaN', () => {
    const t = /transform="translate\([-\d.]+,[-\d.]+\)"/.exec(svg)![0];
    const broken = svg.replace(t, 'transform="translate(1.2.3,700.00)"');
    expect(broken).not.toBe(svg);
    expect(validate(broken, opts).errors.some(e => /translate|normalize/.test(e))).toBe(true);
  });

  it('規則 0：viewBox 少一個數字會被擋，不再產出 NaN 畫布', () => {
    const broken = svg.replace('viewBox="0 0 2000 1700"', 'viewBox="0 0 2000"');
    expect(broken).not.toBe(svg);
    expect(validate(broken, opts).errors.some(e => /viewBox/.test(e))).toBe(true);
  });

  it('規則 13：viewBox 被改成別的尺寸會被擋', () => {
    const broken = svg.replace('viewBox="0 0 2000 1700"', 'viewBox="0 0 2000 1800"');
    expect(broken).not.toBe(svg);
    expect(validate(broken, opts).errors.some(e => /規則 13.*viewBox/.test(e))).toBe(true);
  });

  it('規則 13：節點被挪到畫布之外會被擋', () => {
    const t = /transform="translate\([-\d.]+,[-\d.]+\)"/.exec(svg)![0];
    const broken = svg.replace(t, 'transform="translate(5000.00,5000.00)"');
    expect(validate(broken, opts).errors.some(e => /規則 13.*畫布之外/.test(e))).toBe(true);
  });

  it('規則 13 ＋ 規則 5：兩顆節點疊在一起會被擋（邊會分不清接到誰）', () => {
    // 疊在一起時，邊接到哪一顆只取決於兩顆節點在檔案裡的先後順序——把其中一顆往上挪一行
    // 就能換掉整條前置鏈，而 diff 只有兩行位置對調。
    const transforms = [...svg.matchAll(/transform="translate\(([-\d.]+),([-\d.]+)\)"/g)];
    const [first, second] = [transforms[0]![0], transforms[1]![0]];
    const broken = svg.replace(second, first);
    expect(broken).not.toBe(svg);
    const { errors } = validate(broken, opts);
    expect(errors.some(e => /規則 13.*相距/.test(e))).toBe(true);
    expect(errors.some(e => /規則 5.*同時對上/.test(e))).toBe(true);
  });

  it('規則 1：超長的 name 會被擋', () => {
    expect(validate(svg, patch({ '1001': { ...nodeText['1001'], name: '火'.repeat(600) } }))
      .errors.some(e => /規則 1.*長度.*超過上限/.test(e))).toBe(true);
  });

  // 搬家前等級上限有兩個寫法：123 個骰子符文寫在 `data-cost` 第二行「最高 N 級」、40 個
  // 玩家被動寫在 `<title>` 最後一行「最高等級：N」。兩邊從不重疊，所以舊版那條「兩者不一致
  // 就報錯」的交叉檢查一次都沒觸發過。現在只有 `maxLevel` 一個位置，這條擋的是「等級行
  // 重新混進 cost」——沒有它，第二個位置會慢慢長回來，而 tree.json 一個位元組都不會變。
  it('規則 4：等級行混回 cost 會被擋（等級上限只能寫在 maxLevel 欄位）', () => {
    expect(validate(svg, patch({ '1201': { ...nodeText['1201'], cost: '金幣 2,000\n最高 50 級' } }))
      .errors.some(e => /規則 4.*不可換行.*maxLevel/.test(e))).toBe(true);
  });
});
