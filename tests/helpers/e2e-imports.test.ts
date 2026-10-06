import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const E2E_DIR = join(import.meta.dirname, '../e2e');

describe('E2E spec 的 import', () => {
  it('每支 spec 的 test 都來自 tests/e2e/fixtures.ts（全域 pageerror 防線）', () => {
    // 直接從 '@playwright/test' 拿 test 的 spec 會安靜地繞過防線：頁面腳本丟例外也照樣綠。
    // 只拿型別（`import type …`）沒關係。
    const specs = readdirSync(E2E_DIR).filter(f => f.endsWith('.spec.ts'));
    expect(specs.length).toBeGreaterThan(0);
    const offenders = specs.filter(f => {
      const src = readFileSync(join(E2E_DIR, f), 'utf8');
      const fromFixtures = /^import \{[^}]*\btest\b[^}]*\} from '\.\/fixtures';$/m.test(src);
      const fromPlaywright = /^import \{[^}]*\btest\b[^}]*\} from '@playwright\/test';$/m.test(src);
      return !fromFixtures || fromPlaywright;
    });
    expect(offenders, "改成 import { test, expect } from './fixtures'").toEqual([]);
  });
});
