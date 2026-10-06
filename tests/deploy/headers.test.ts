import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * public/_headers 的內容守門。本機與 CI 的 E2E 都是 `serve dist`，不讀這份檔，
 * 刪掉或寫壞一行都不會有任何測試紅——這裡是 CI 上唯一看得到它的地方。
 * 生效與否由 deploy job 的 smoke check 對正式站 `curl -I` 驗。
 */
interface HeaderLine { pattern: string; name: string; value?: string }  // value 缺席＝`! Name`（拿掉標頭）

/** Cloudflare Pages 的 `_headers`：網址樣式一行、底下縮排的 `Name: value` 或 `! Name`；同一個樣式可以出現多段。 */
function parseHeaders(text: string): HeaderLine[] {
  const out: HeaderLine[] = [];
  let pattern: string | undefined;
  for (const raw of text.split('\n')) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(raw)) { pattern = raw.trim(); continue; }
    const set = raw.trim().match(/^([A-Za-z0-9-]+):\s*(.+)$/);
    const detach = raw.trim().match(/^!\s*([A-Za-z0-9-]+)$/);
    if (!pattern || (!set && !detach)) throw new Error(`看不懂的標頭行，或前面沒有網址樣式：${raw}`);
    out.push(set ? { pattern, name: set[1]!.toLowerCase(), value: set[2]!.trim() } : { pattern, name: detach![1]!.toLowerCase() });
  }
  return out;
}

/**
 * HSTS 與 X-Frame-Options 只能在 `/*` 定義一次、任何地方都不准拿掉：Cloudflare 會把所有符合的樣式合併，
 * 另一段再寫一次 X-Frame-Options 會變成 `DENY, SAMEORIGIN`（瀏覽器當成無效而忽略），`! X-Frame-Options` 直接拿掉。
 */
function issues(text: string): string[] {
  const lines = parseHeaders(text);
  const out: string[] = [];
  for (const name of ['strict-transport-security', 'x-frame-options']) {
    const mine = lines.filter(l => l.name === name);
    if (mine.length !== 1 || mine[0]!.pattern !== '/*' || mine[0]!.value === undefined) {
      out.push(`${name} 必須只在 /* 定義一次：${JSON.stringify(mine)}`);
    }
  }
  const all = (name: string) => lines.find(l => l.pattern === '/*' && l.name === name)?.value ?? '';
  const hsts = all('strict-transport-security');
  if (!(Number(hsts.match(/max-age=(\d+)/)?.[1]) >= 31536000)) out.push(`HSTS max-age 不到一年：${hsts}`);
  // preload 進了瀏覽器內建清單幾乎撤不回來，要加得先改這條測試並寫下理由。
  if (/preload|includeSubDomains/i.test(hsts)) out.push(`HSTS 不准帶 preload／includeSubDomains：${hsts}`);
  if (all('x-frame-options') !== 'DENY') out.push(`X-Frame-Options 必須是 DENY：${all('x-frame-options')}`);
  return out;
}

describe('public/_headers', () => {
  it('真實檔案：HSTS 至少一年且無 preload、X-Frame-Options: DENY，都只在 /* 定義一次', () => {
    expect(issues(readFileSync('public/_headers', 'utf8'))).toEqual([]);
  });

  describe('檢查本身', () => {
    const base = '/*\n  Strict-Transport-Security: max-age=31536000\n  X-Frame-Options: DENY\n';
    it('合法：同一個 /* 分兩段寫、另加別的標頭', () => {
      expect(issues(`${base}/*\n  Referrer-Policy: no-referrer\n`)).toEqual([]);
    });
    it('別的樣式再寫一次 X-Frame-Options（合併後變無效）', () => {
      expect(issues(`${base}/embed/*\n  X-Frame-Options: SAMEORIGIN\n`).join()).toMatch(/x-frame-options 必須只在/);
    });
    it('`! X-Frame-Options` 拿掉標頭', () => {
      expect(issues(`${base}/embed/*\n  ! X-Frame-Options\n`).join()).toMatch(/x-frame-options 必須只在/);
    });
    it('看不懂的行直接丟錯，不安靜跳過', () => {
      expect(() => issues(`${base}  這不是標頭\n`)).toThrow(/看不懂的標頭行/);
    });
  });
});
