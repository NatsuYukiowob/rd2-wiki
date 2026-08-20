import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// PR #34（外部貢獻）：`import.meta.url === \`file://${process.argv[1]}\`` 在 Windows 上恆為 false，
// 於是六支 tools 腳本全都印完 banner 就 exit 0，什麼都沒做——包含 `npm run validate` 這道閘門。
// POSIX 上兩種寫法也不是等價的：`import.meta.url` 會 percent-encode，template literal 不會，
// 所以只要 checkout 路徑含空白或非 ASCII 字元（例如 ~/我的專案/），Linux 也會踩到同一個空跑。
// CI 沒抓到是因為 runner 的路徑剛好是純 ASCII。這支測試釘住正確寫法，防止有人複製舊形式回來。

const TOOLS_DIR = join(import.meta.dirname, '../../tools');
const GUARD = /^if \(import\.meta\.url === .+\) \{$/gm;
const CORRECT = "if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {";

const scripts = readdirSync(TOOLS_DIR)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => [f, readFileSync(join(TOOLS_DIR, f), 'utf8')] as const)
  .filter(([, src]) => GUARD.test((GUARD.lastIndex = 0, src)));

describe('tools 的 CLI entry guard', () => {
  it('找得到有 entry guard 的腳本（避免測試因為改名而空跑）', () => {
    expect(scripts.length).toBeGreaterThanOrEqual(6);
  });

  it.each(scripts.map(([name]) => name))('%s 用 pathToFileURL 比對，不是 template literal', (name) => {
    const src = readFileSync(join(TOOLS_DIR, name), 'utf8');
    expect(src.match(GUARD)).toEqual([CORRECT]);
    expect(src).toContain("from 'node:url'");
  });
});
