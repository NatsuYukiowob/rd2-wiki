import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addIcon } from '../../tools/add-icon';

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
