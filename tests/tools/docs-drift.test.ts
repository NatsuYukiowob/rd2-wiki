import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (p: string) => readFileSync(p, 'utf8');

describe('README／CONTRIBUTING 不會跟著資料漂掉', () => {
  it('不寫節點數、圖示張數、連線數這類會隨資料改動漂移的數字', () => {
    for (const file of ['README.md', 'CONTRIBUTING.md']) {
      const hits = read(file).split('\n').filter(l => /\d+ ?(個節點|張(圖示|PNG)|條連線|顆骰子)/.test(l)
        // 「再加 40～50 個節點就會超標」是預算的估算，不是現況計數。
        && !/再加 [\d～]+ 個節點/.test(l));
      expect(hits, `${file} 寫了會漂的計數`).toEqual([]);
    }
  });

  it('CONTRIBUTING 第 5 節提到 validate 檢查的每一條規則', () => {
    const rules = new Set([...read('tools/validate.ts').matchAll(/規則 (\d+)/g)].map(m => Number(m[1])));
    const doc = read('CONTRIBUTING.md');
    const missing = [...rules].filter(n =>
      !new RegExp(`規則 ${n}(?!\\d)`).test(doc) && !new RegExp(`^${n}\\. \\*\\*`, 'm').test(doc));
    expect(rules.size, '前提：抓得到 validate.ts 的規則編號').toBeGreaterThan(20);
    expect(missing, 'CONTRIBUTING.md 漏寫的規則（它也是 /about 的內容）').toEqual([]);
  });
});
