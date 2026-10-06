import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * public/_headers 的內容守門。本機與 CI 的 E2E 都是 `serve dist`，不讀這份檔，
 * 刪掉或寫壞一行都不會有任何測試紅——這裡是 CI 上唯一看得到它的地方。
 * 生效與否仍只能部署後對正式站 curl（CLAUDE.md〈部署〉）。
 */
function parseHeaders(text: string): Map<string, Map<string, string>> {
  const rules = new Map<string, Map<string, string>>();
  let current: Map<string, string> | undefined;
  for (const raw of text.split('\n')) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      current = new Map();
      rules.set(raw.trim(), current);
      continue;
    }
    const m = raw.trim().match(/^([A-Za-z-]+):\s*(.+)$/);
    if (!m || !current) throw new Error(`看不懂的標頭行，或前面沒有網址樣式：${raw}`);
    current.set(m[1]!.toLowerCase(), m[2]!.trim());
  }
  return rules;
}

describe('public/_headers', () => {
  const rules = parseHeaders(readFileSync('public/_headers', 'utf8'));
  const all = rules.get('/*');

  it('有一段套全站的 /*', () => {
    expect(all).toBeDefined();
  });

  it('HSTS 至少一年，而且不帶 preload／includeSubDomains', () => {
    const hsts = all?.get('strict-transport-security') ?? '';
    const maxAge = Number(hsts.match(/max-age=(\d+)/)?.[1]);
    expect(maxAge).toBeGreaterThanOrEqual(31536000);
    // preload 進了瀏覽器內建清單幾乎撤不回來，要加得先改這條測試並寫下理由。
    expect(hsts).not.toMatch(/preload|includeSubDomains/i);
  });

  it('不准被別的網站 iframe 嵌入', () => {
    expect(all?.get('x-frame-options')).toBe('DENY');
  });
});
