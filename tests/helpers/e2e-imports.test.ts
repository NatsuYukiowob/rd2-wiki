import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const E2E_DIR = join(import.meta.dirname, '../e2e');

/** Playwright 的 testDir 是遞迴找 spec 的，這裡也要遞迴。路徑一律 posix 斜線。 */
const SPECS = (readdirSync(E2E_DIR, { recursive: true }) as string[])
  .map(f => f.replace(/\\/g, '/'))
  .filter(f => f.endsWith('.spec.ts'))
  .sort();
const read = (f: string) => readFileSync(join(E2E_DIR, ...f.split('/')), 'utf8');

describe('E2E spec 的 import', () => {
  it('掃得到 spec（正向控制）', () => {
    expect(SPECS.length).toBeGreaterThan(0);
  });

  it('每支 spec 的 test 都來自 tests/e2e/fixtures.ts（全域 pageerror 防線）', () => {
    // 直接從 '@playwright/test' 拿 test 的 spec 會安靜地繞過防線：頁面腳本丟例外也照樣綠。
    // 只拿型別（`import type …`）沒關係；`import * as pw` 這種整包拿的一樣擋。
    const offenders = SPECS.filter(f => {
      const src = read(f);
      const fromFixtures = /^import \{[^}]*\btest\b[^}]*\} from ['"](\.\.?\/)+fixtures['"];?$/m.test(src);
      const fromPlaywright = /^import (?!type\b)[^;]*\bfrom ['"]@playwright\/test['"]/m.test(src);
      return !fromFixtures || fromPlaywright;
    });
    expect(offenders, "改成 import { test, expect } from './fixtures'").toEqual([]);
  });

  it('自己開、而且有開 JS 的 browser context，要自己接 watchPageErrors()', () => {
    // 全域防線只看 test 的那個 context；`browser.newContext()` 開的不在裡面（fixtures.ts 開頭的說明）。
    // 關掉 JS 的 context 跑不了腳本，不會有 pageerror，不用接。
    const offenders = SPECS.filter(f => {
      const src = read(f);
      const jsContexts = [...src.matchAll(/browser\.newContext\(([^)]*)\)/g)]
        .filter(m => !/javaScriptEnabled:\s*false/.test(m[1]!));
      return jsContexts.length > 0 && !src.includes('watchPageErrors(');
    });
    expect(offenders, '在 newContext() 之後呼叫 watchPageErrors(context)，關掉前斷言它是空的').toEqual([]);
  });
});
