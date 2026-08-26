import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addIcon, addBoardIcon, addRecordIcon } from '../../tools/add-icon';

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

describe('addRecordIcon', () => {
  /** 一份最小的 data/tactics.json 替身：兩筆，第一筆已經有圖、第二筆還沒。 */
  const setup = () => {
    const srcDir = mkdtempSync(join(tmpdir(), 'rd2-rec-src-'));
    const iconsDir = mkdtempSync(join(tmpdir(), 'rd2-rec-icons-'));
    const dataDir = mkdtempSync(join(tmpdir(), 'rd2-rec-data-'));
    const dataPath = join(dataDir, 'tactics.json');
    writeFileSync(dataPath, `${JSON.stringify([
      { id: '6', name: '召喚精英', icon: '000000000000' },
      { id: '69-1', name: '豐饒開始' },
    ], null, 2)}\n`);
    return { srcDir, iconsDir, dataPath };
  };

  it('把圖複製進目錄，並在同一次呼叫裡把那一筆的 icon 指過去', () => {
    const { srcDir, iconsDir, dataPath } = setup();
    const png = makeMinimalPng(176, 206);
    const src = join(srcDir, 'x.png');
    writeFileSync(src, png);
    const hash = createHash('sha256').update(png).digest('hex').slice(0, 12);

    const result = addRecordIcon(src, '69-1', { iconsDir, dataPath });

    expect(result.hash).toBe(hash);
    expect(existsSync(join(iconsDir, `${hash}.png`))).toBe(true);
    expect(JSON.parse(readFileSync(dataPath, 'utf8'))[1].icon).toBe(hash);
    // 先前沒填過，所以沒有舊雜湊可回報。
    expect(result.previousHash).toBeNull();
  });

  it('換圖時回報原本那筆的雜湊（舊檔可能就此變孤兒）', () => {
    const { srcDir, iconsDir, dataPath } = setup();
    const src = join(srcDir, 'x.png');
    writeFileSync(src, makeMinimalPng(176, 206));
    const result = addRecordIcon(src, '6', { iconsDir, dataPath });
    expect(result.previousHash).toBe('000000000000');
  });

  it('寫回時維持陣列原順序（順序就是畫面上的顯示順序，重排等於一份看不出改哪筆的 diff）', () => {
    const { srcDir, iconsDir, dataPath } = setup();
    const src = join(srcDir, 'x.png');
    writeFileSync(src, makeMinimalPng(176, 206));
    addRecordIcon(src, '69-1', { iconsDir, dataPath });
    const text = readFileSync(dataPath, 'utf8');
    expect(JSON.parse(text).map((r: { id: string }) => r.id)).toEqual(['6', '69-1']);
    expect(text.endsWith('}\n]\n')).toBe(true);
  });

  it('找不到那個 id 時直接拒絕，而且圖一個位元組都還沒被寫進目錄', () => {
    // ⚠️ 失敗順序是重點：先寫圖再找 id 的話，打錯編號會在目錄裡留下一張沒人引用的孤兒圖，
    // 而使用者只看到一句「找不到」，不會知道還要回頭刪檔。
    const { srcDir, iconsDir, dataPath } = setup();
    const png = makeMinimalPng(176, 206);
    const src = join(srcDir, 'x.png');
    writeFileSync(src, png);
    const hash = createHash('sha256').update(png).digest('hex').slice(0, 12);

    expect(() => addRecordIcon(src, '999', { iconsDir, dataPath })).toThrow(/沒有 id 為 "999" 的紀錄/);
    expect(existsSync(join(iconsDir, `${hash}.png`))).toBe(false);
  });

  it('沿用 addIcon 的圖檔檢查，來源不合格時資料檔不會被動到', () => {
    const { srcDir, iconsDir, dataPath } = setup();
    const src = join(srcDir, 'tiny.png');
    writeFileSync(src, makeMinimalPng(48, 48));
    const before = readFileSync(dataPath, 'utf8');
    expect(() => addRecordIcon(src, '69-1', { iconsDir, dataPath })).toThrow(/小於最低要求 96px/);
    expect(readFileSync(dataPath, 'utf8')).toBe(before);
  });
});
