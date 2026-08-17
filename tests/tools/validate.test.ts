import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validate } from '../../tools/validate';

const svg = readFileSync('data/dice-tree.svg', 'utf8');
const keywords: string[] = JSON.parse(readFileSync('data/keywords.json', 'utf8'));
const iconsDir = 'data/icons';
const opts = { keywords, iconsDir };

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
    const broken = svg.replace('M 1700.00 1271.53 L 1506.53 1078.06', 'M 1700.00 1271.53 L 1506.53 1000.00');
    expect(validate(broken, opts).errors.some(e => /端點/.test(e))).toBe(true);
  });

  it('規則 5：邊少了 marker-end 會被擋', () => {
    const broken = svg.replace('<path class="edge" marker-end="url(#arrow)"', '<path class="edge"');
    expect(validate(broken, opts).errors.some(e => /marker-end/.test(e))).toBe(true);
  });

  it('規則 6：從根不可達的節點會被擋', () => {
    // 注意：實際資料的自閉合標籤是 `" />`（斜線前有空白），不是 `"/>`；
    // 正則需含 `\s*` 才能真的比對到並移除這條邊，否則 replace 是 no-op。
    const broken = svg.replace(/<path class="edge"[^>]*d="M 1700\.00 1271\.53 L 1619\.39 1271\.53"\s*\/>/, '');
    expect(validate(broken, opts).errors.some(e => /不可達/.test(e))).toBe(true);
  });

  it('規則 6：帶 data-wip 的新節點不會被誤擋（偽陽性測試），且會被列入 warnings', () => {
    const wip = svg.replace('</svg>',
      '<g class="node" data-wip="1" transform="translate(300.00,300.00)" data-id="1099" data-type="骰子" data-name="測試骰子" data-cost="核心 5" data-description="測試">' +
      '<title>骰子｜測試骰子｜測試</title><rect x="-36" y="-28" width="72" height="56" stroke="#ef625e"/>' +
      '<image href="icons/000000000000.png"/><text>測試骰子</text></g></svg>');
    // 圖示內容檢查（規則 7b/7c）與這條測試的重點無關，所以用一個獨立的暫存目錄放假圖示，
    // 不動到真正的 data/icons；假圖示的雜湊／格式不會通過規則 7，但那是預期中的另一個
    // 錯誤，不影響本測試只關心的「不可達」斷言。
    const tmpIconsDir = mkdtempSync(join(tmpdir(), 'rd2-wiki-icons-'));
    writeFileSync(join(tmpIconsDir, '000000000000.png'), Buffer.from('not-a-real-png'));
    const result = validate(wip, { keywords, iconsDir: tmpIconsDir });
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
    const result = validate(svg, { keywords, iconsDir: tmpIconsDir });
    expect(result.errors.some(e => /規則 7\(b\)/.test(e) && /sha256/.test(e))).toBe(true);
  });

  it('規則 7(c)：非 PNG 檔會被擋', () => {
    const tmpIconsDir = mkdtempSync(join(tmpdir(), 'rd2-wiki-icons-'));
    writeFileSync(join(tmpIconsDir, '222222222222.png'), Buffer.from('this is not a png file at all'));
    const result = validate(svg, { keywords, iconsDir: tmpIconsDir });
    expect(result.errors.some(e => /規則 7\(c\)/.test(e) && /不是有效的 PNG/.test(e))).toBe(true);
  });

  it('規則 7(c)：PNG 尺寸過小（最長邊 < 96px）會被擋', () => {
    const tmpIconsDir = mkdtempSync(join(tmpdir(), 'rd2-wiki-icons-'));
    // 手刻一張 10x10 的最小合法 PNG（僅需通過 readPngSize 的簽章 + IHDR 解析，不需要完整像素資料）。
    const tinyPng = makeMinimalPng(10, 10);
    const tinyHash = createHash('sha256').update(tinyPng).digest('hex').slice(0, 12);
    writeFileSync(join(tmpIconsDir, `${tinyHash}.png`), tinyPng);
    const result = validate(svg, { keywords, iconsDir: tmpIconsDir });
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
    const result = validate(svg, { keywords, iconsDir: tmpIconsDir });
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
