import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { sha256Hex12, checkIcon } from '../../src/lib/icon-hash';

const iconFiles = readdirSync('data/icons').filter(f => f.endsWith('.png'));

describe('icon-hash', () => {
  it('Web Crypto 算出的雜湊與 node:crypto 一致（抽 5 張真實圖示）', async () => {
    for (const f of iconFiles.slice(0, 5)) {
      const buf = readFileSync(`data/icons/${f}`);
      const expected = createHash('sha256').update(buf).digest('hex').slice(0, 12);
      expect(await sha256Hex12(buf)).toBe(expected);
      expect(await sha256Hex12(buf)).toBe(f.slice(0, -4)); // 檔名就是雜湊
    }
  });

  it('checkIcon 接受合法圖示並回傳尺寸', async () => {
    const f = iconFiles[0]!;
    const r = await checkIcon(readFileSync(`data/icons/${f}`));
    expect(r.ok).toBe(true);
    if (r.ok) expect(Math.max(r.width, r.height)).toBeGreaterThanOrEqual(96);
  });

  it('checkIcon 擋下非 PNG', async () => {
    const r = await checkIcon(new TextEncoder().encode('not a png at all, definitely not'));
    expect(r).toEqual({ ok: false, reason: '不是有效的 PNG' });
  });

  it('checkIcon 非 PNG 的錯誤訊息與 CI 規則 7(c) 用語一致（回歸測試：防止兩邊措辭漂移）', async () => {
    // 不把 CI 那句話抄一份寫死在這裡——寫死的話，CI 端改了措辭這支測試也不會發現，
    // 那正是這次審查抓到的問題（icon-hash.ts 曾多寫「檔案」兩字，跟 CI 對不上）。
    // 改成直接從 validate-rules.ts 的原始碼裡取出核心句，checkIcon 的 reason 要跟它一字不差。
    const validateSrc = readFileSync('src/lib/validate-rules.ts', 'utf8');
    const m = validateSrc.match(/if \(!size\) push\(`規則 7\(c\): 圖示 \$\{fileName\} ([^`]+)`\);/);
    if (!m) throw new Error('抓不到 src/lib/validate-rules.ts 規則 7(c) 的非 PNG 錯誤訊息，格式可能已變動');
    const ciCoreMessage = m[1]!;

    const r = await checkIcon(new TextEncoder().encode('not a png at all, definitely not'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(ciCoreMessage);
  });

  it('checkIcon 擋下最長邊小於 96px 的圖', async () => {
    // 32×32 的最小合法 PNG：只需簽章 + IHDR，readPngSize 不驗 CRC 與後續 chunk
    const bytes = new Uint8Array(24);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    bytes.set([0x49, 0x48, 0x44, 0x52], 12);
    new DataView(bytes.buffer).setUint32(16, 32);
    new DataView(bytes.buffer).setUint32(20, 32);
    const r = await checkIcon(bytes);
    expect(r).toEqual({ ok: false, reason: '圖示最長邊 32px，小於最低要求 96px' });
  });
});
