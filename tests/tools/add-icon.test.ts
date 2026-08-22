import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addIcon, addBoardIcon } from '../../tools/add-icon';

/** 產生一張只有簽章 + IHDR chunk 的最小合法 PNG，足以通過 `readPngSize` 的結構性檢查。 */
function makeMinimalPng(width: number, height: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8);
  ihdrData.writeUInt8(6, 9);
  ihdrData.writeUInt8(0, 10);
  ihdrData.writeUInt8(0, 11);
  ihdrData.writeUInt8(0, 12);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(13, 0);
  const type = Buffer.from('IHDR', 'ascii');
  const crc = Buffer.alloc(4);
  return Buffer.concat([signature, length, type, ihdrData, crc]);
}

describe('addIcon', () => {
  it('依內容 sha256 前 12 碼命名，並複製進目標目錄', () => {
    const srcDir = mkdtempSync(join(tmpdir(), 'rd2-wiki-src-'));
    const destDir = mkdtempSync(join(tmpdir(), 'rd2-wiki-dest-'));
    const png = makeMinimalPng(100, 100);
    const srcPath = join(srcDir, 'my-icon.png');
    writeFileSync(srcPath, png);

    const expectedHash = createHash('sha256').update(png).digest('hex').slice(0, 12);
    const result = addIcon(srcPath, destDir);

    expect(result.hash).toBe(expectedHash);
    expect(result.fileName).toBe(`${expectedHash}.png`);
    expect(result.alreadyExists).toBe(false);
    expect(existsSync(result.destPath)).toBe(true);
    expect(readFileSync(result.destPath)).toEqual(png);
  });

  it('目的檔案已存在時不重複寫入，但仍回報正確的雜湊與路徑', () => {
    const srcDir = mkdtempSync(join(tmpdir(), 'rd2-wiki-src-'));
    const destDir = mkdtempSync(join(tmpdir(), 'rd2-wiki-dest-'));
    const png = makeMinimalPng(120, 96);
    const srcPath = join(srcDir, 'icon.png');
    writeFileSync(srcPath, png);

    const first = addIcon(srcPath, destDir);
    expect(first.alreadyExists).toBe(false);
    const second = addIcon(srcPath, destDir);
    expect(second.alreadyExists).toBe(true);
    expect(second.hash).toBe(first.hash);
  });

  it('拒絕非 PNG 檔', () => {
    const srcDir = mkdtempSync(join(tmpdir(), 'rd2-wiki-src-'));
    const destDir = mkdtempSync(join(tmpdir(), 'rd2-wiki-dest-'));
    const srcPath = join(srcDir, 'fake.png');
    writeFileSync(srcPath, Buffer.from('not a png'));

    expect(() => addIcon(srcPath, destDir)).toThrow(/不是有效的 PNG/);
  });

  it('拒絕最長邊小於 96px 的 PNG', () => {
    const srcDir = mkdtempSync(join(tmpdir(), 'rd2-wiki-src-'));
    const destDir = mkdtempSync(join(tmpdir(), 'rd2-wiki-dest-'));
    const srcPath = join(srcDir, 'tiny.png');
    writeFileSync(srcPath, makeMinimalPng(50, 95));

    expect(() => addIcon(srcPath, destDir)).toThrow(/96px/);
  });

  it('來源檔案不存在時報出明確錯誤', () => {
    const destDir = mkdtempSync(join(tmpdir(), 'rd2-wiki-dest-'));
    expect(() => addIcon('/tmp/rd2-wiki-does-not-exist.png', destDir)).toThrow(/找不到來源檔案/);
  });
});

describe('addBoardIcon', () => {
  /** 一組暫存的「data/board-icons/ ＋ data/board-icons.json」。 */
  const makeBoardDirs = (map: Record<string, string> = {}) => {
    const dir = mkdtempSync(join(tmpdir(), 'rd2-board-'));
    const mapPath = join(dir, 'board-icons.json');
    const iconsDir = join(dir, 'board-icons');
    mkdirSync(iconsDir);
    writeFileSync(mapPath, `${JSON.stringify(map, null, 2)}\n`);
    return { iconsDir, mapPath };
  };

  it('把圖複製進 board 目錄，並在同一次呼叫裡更新對應表那一筆', () => {
    // 這條是這支函式存在的理由：圖與對應表少更新任一邊，CI 的規則 21 就會紅
    // （漏對應＝21(a)，漏檔案＝21(f)），而過去沒有任何工具放得進 data/board-icons。
    const { iconsDir, mapPath } = makeBoardDirs({ '1001': 'aaaaaaaaaaaa' });
    const srcDir = mkdtempSync(join(tmpdir(), 'rd2-wiki-src-'));
    const png = makeMinimalPng(150, 175);
    const srcPath = join(srcDir, 'dice.png');
    writeFileSync(srcPath, png);

    const result = addBoardIcon(srcPath, '1002', { boardIconsDir: iconsDir, mapPath });

    const expectedHash = createHash('sha256').update(png).digest('hex').slice(0, 12);
    expect(result.hash).toBe(expectedHash);
    expect(result.previousHash).toBeNull();
    expect(existsSync(join(iconsDir, `${expectedHash}.png`))).toBe(true);
    expect(JSON.parse(readFileSync(mapPath, 'utf8'))).toEqual({ '1001': 'aaaaaaaaaaaa', '1002': expectedHash });
  });

  it('換圖時回報原本那筆的雜湊（舊檔可能就此變孤兒）', () => {
    const { iconsDir, mapPath } = makeBoardDirs({ '1002': 'bbbbbbbbbbbb' });
    const srcDir = mkdtempSync(join(tmpdir(), 'rd2-wiki-src-'));
    const srcPath = join(srcDir, 'dice.png');
    writeFileSync(srcPath, makeMinimalPng(150, 175));

    const result = addBoardIcon(srcPath, '1002', { boardIconsDir: iconsDir, mapPath });
    expect(result.previousHash).toBe('bbbbbbbbbbbb');
    expect(JSON.parse(readFileSync(mapPath, 'utf8'))['1002']).toBe(result.hash);
  });

  it('對應表寫回時維持 id 排序與 2 空格縮排 + 結尾換行', () => {
    // 順序或格式一漂，下一個人的 PR 就會夾帶一份整檔重排的 diff，真正改了哪一筆反而看不出來。
    const { iconsDir, mapPath } = makeBoardDirs({ '5009': 'cccccccccccc', '1001': 'aaaaaaaaaaaa' });
    const srcDir = mkdtempSync(join(tmpdir(), 'rd2-wiki-src-'));
    const srcPath = join(srcDir, 'dice.png');
    writeFileSync(srcPath, makeMinimalPng(150, 175));

    const { hash } = addBoardIcon(srcPath, '3001', { boardIconsDir: iconsDir, mapPath });
    expect(readFileSync(mapPath, 'utf8')).toBe(
      `{\n  "1001": "aaaaaaaaaaaa",\n  "3001": "${hash}",\n  "5009": "cccccccccccc"\n}\n`,
    );
  });

  it('節點 id 不符編碼規律時直接拒絕，對應表一個字都不動', () => {
    const { iconsDir, mapPath } = makeBoardDirs({ '1001': 'aaaaaaaaaaaa' });
    const srcDir = mkdtempSync(join(tmpdir(), 'rd2-wiki-src-'));
    const srcPath = join(srcDir, 'dice.png');
    writeFileSync(srcPath, makeMinimalPng(150, 175));

    expect(() => addBoardIcon(srcPath, '9999', { boardIconsDir: iconsDir, mapPath })).toThrow(/編碼規律/);
    expect(readFileSync(mapPath, 'utf8')).toBe('{\n  "1001": "aaaaaaaaaaaa"\n}\n');
  });

  it('沿用 addIcon 的圖檔檢查，來源不合格時對應表不會被動到', () => {
    // 檢查重用 addIcon（規則 7(c)／21(c) 同一個判準），而且它先跑——不然會留下一筆指向
    // 不存在檔案的對應，validate 反而多噴一條 21(f)。
    const { iconsDir, mapPath } = makeBoardDirs({ '1001': 'aaaaaaaaaaaa' });
    const srcDir = mkdtempSync(join(tmpdir(), 'rd2-wiki-src-'));
    const tiny = join(srcDir, 'tiny.png');
    writeFileSync(tiny, makeMinimalPng(50, 95));
    const notPng = join(srcDir, 'fake.png');
    writeFileSync(notPng, Buffer.from('not a png'));

    expect(() => addBoardIcon(tiny, '1002', { boardIconsDir: iconsDir, mapPath })).toThrow(/96px/);
    expect(() => addBoardIcon(notPng, '1002', { boardIconsDir: iconsDir, mapPath })).toThrow(/不是有效的 PNG/);
    expect(readFileSync(mapPath, 'utf8')).toBe('{\n  "1001": "aaaaaaaaaaaa"\n}\n');
  });
});
