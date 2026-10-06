import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tmpDir } from './tmp';

const TESTS_ROOT = join(import.meta.dirname, '..');
const HELPER = 'helpers/tmp.ts';

function listTs(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === 'node_modules' ? [] : listTs(p);
    return p.endsWith('.ts') ? [p] : [];
  });
}

describe('測試用暫存目錄', () => {
  it('tests/ 底下只有 helpers/tmp.ts 可以直接 mkdtemp，其他一律走 tmpDir()', () => {
    // 直接 mkdtemp 的目錄沒人清：跑一次 npm test 會留下幾十個（有的是整套圖示的複本）。
    // 守的是寫法不是執行結果——vitest 平行跑、別的行程也在用 /tmp，數殘留目錄會時好時壞。
    const offenders = listTs(TESTS_ROOT)
      // posix 斜線：HELPER 的比對在 Windows 上也要對得上。
      .map(p => relative(TESTS_ROOT, p).split(sep).join('/'))
      .filter(rel => rel !== HELPER && /\bmkdtemp(Sync)?\s*\(/.test(readFileSync(join(TESTS_ROOT, ...rel.split('/')), 'utf8')));
    expect(offenders, '改用 tests/helpers/tmp.ts 的 tmpDir()').toEqual([]);
  });

  describe('測試結束就刪掉', () => {
    let made = '';
    it('建出來的目錄在測試裡可以用', () => {
      made = tmpDir('rd2-tmp-selftest-');
      expect(existsSync(made)).toBe(true);
    });
    it('上一條測試結束後目錄已經不在了', () => {
      expect(made).not.toBe('');
      expect(existsSync(made)).toBe(false);
    });
  });
});
