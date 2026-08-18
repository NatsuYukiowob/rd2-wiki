import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validate } from '../../tools/validate';

const svg = readFileSync('data/dice-tree.svg', 'utf8');
const keywords: string[] = JSON.parse(readFileSync('data/keywords.json', 'utf8'));
const iconsDir = 'data/icons';
const dataDir = 'data';
const opts = { keywords, iconsDir, dataDir };

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
  it('現有資料為黃金樣本，errors 必須為零；warnings 允許有內容（例如 {n} 佔位符）', () => {
    const result = validate(svg, opts);
    expect(result.errors).toEqual([]);
    // 現況資料的所有圖示都存在、雜湊相符、尺寸合格、且都被引用，也沒有 data-wip 節點，
    // 所以真正會出現的 warnings 只可能來自規則 9 的 {n} 佔位符（上游資料問題，不擋 PR）。
    expect(result.warnings.every(w => /規則 9/.test(w))).toBe(true);
  });

  it('規則 2：重複 id 會被擋', () => {
    const broken = svg.replace('data-id="1002"', 'data-id="1001"');
    expect(validate(broken, opts).errors.some(e => /重複.*id/.test(e))).toBe(true);
  });

  it('規則 4：不合文法的成本會被擋', () => {
    const broken = svg.replace('data-cost="核心 5"', 'data-cost="免費"');
    expect(validate(broken, opts).errors.some(e => /成本/.test(e))).toBe(true);
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
    const result = validate(svg, { keywords, iconsDir, dataDir: tinyDir });
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
      '<g class="node" data-wip="1" transform="translate(300.00,300.00)" data-id="1099" data-type="骰子" data-name="測試骰子" data-cost="核心 5" data-description="測試">' +
      '<title>骰子｜測試骰子｜測試</title><rect x="-36" y="-28" width="72" height="56" stroke="#ef625e"/>' +
      '<image href="icons/000000000000.png" width="56" height="56"/><text>測試骰子</text></g></svg>');
    // 圖示內容檢查（規則 7b/7c）與這條測試的重點無關，所以用一個獨立的暫存目錄放假圖示，
    // 不動到真正的 data/icons；假圖示的雜湊／格式不會通過規則 7，但那是預期中的另一個
    // 錯誤，不影響本測試只關心的「不可達」斷言。
    const tmpIconsDir = mkdtempSync(join(tmpdir(), 'rd2-wiki-icons-'));
    writeFileSync(join(tmpIconsDir, '000000000000.png'), Buffer.from('not-a-real-png'));
    const result = validate(wip, { keywords, iconsDir: tmpIconsDir, dataDir });
    expect(result.errors.some(e => /不可達/.test(e))).toBe(false);
    expect(result.warnings.some(w => /規則 6\(c\)/.test(w) && w.includes('1099'))).toBe(true);
  });

  it('規則 8：# 標記比不到白名單會被擋', () => {
    const broken = svg.replace('#尖刺', '#不存在的關鍵字');
    expect(validate(broken, opts).errors.some(e => /白名單/.test(e))).toBe(true);
  });

  it('規則 1：title 與 data-name 不一致會被擋', () => {
    const broken = svg.replace('<title>骰子｜火骰子｜', '<title>骰子｜水骰子｜');
    expect(validate(broken, opts).errors.some(e => /title/.test(e))).toBe(true);
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
    const result = validate(svg, { keywords, iconsDir: tmpIconsDir, dataDir });
    expect(result.errors.some(e => /規則 7\(b\)/.test(e) && /sha256/.test(e))).toBe(true);
  });

  it('規則 7(c)：非 PNG 檔會被擋', () => {
    const tmpIconsDir = mkdtempSync(join(tmpdir(), 'rd2-wiki-icons-'));
    writeFileSync(join(tmpIconsDir, '222222222222.png'), Buffer.from('this is not a png file at all'));
    const result = validate(svg, { keywords, iconsDir: tmpIconsDir, dataDir });
    expect(result.errors.some(e => /規則 7\(c\)/.test(e) && /不是有效的 PNG/.test(e))).toBe(true);
  });

  it('規則 7(c)：PNG 尺寸過小（最長邊 < 96px）會被擋', () => {
    const tmpIconsDir = mkdtempSync(join(tmpdir(), 'rd2-wiki-icons-'));
    // 手刻一張 10x10 的最小合法 PNG（僅需通過 readPngSize 的簽章 + IHDR 解析，不需要完整像素資料）。
    const tinyPng = makeMinimalPng(10, 10);
    const tinyHash = createHash('sha256').update(tinyPng).digest('hex').slice(0, 12);
    writeFileSync(join(tmpIconsDir, `${tinyHash}.png`), tinyPng);
    const result = validate(svg, { keywords, iconsDir: tmpIconsDir, dataDir });
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
    const result = validate(svg, { keywords, iconsDir: tmpIconsDir, dataDir });
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
