import { describe, it, expect } from 'vitest';
import { sealSession, openSession, sessionCookie, readSessionCookie, SESSION_MAX_AGE_SECONDS } from '../../functions/api/github/_lib/session';

const SECRET = 'test-secret-do-not-use-in-production';

describe('session', () => {
  it('封裝後可以解回原本的內容', async () => {
    // iat 用「現在」：這支測試驗的是加解密的往返正確性，不是過期邏輯（過期邏輯見下方
    // 專屬測試）。寫死的舊時間戳記在加了伺服器端過期檢查後會被判定過期，讓這支測試變成
    // 意外失敗而不是真的驗到問題。
    const s = { token: 'gho_abc123', login: 'someplayer', iat: Math.floor(Date.now() / 1000) };
    const opened = await openSession(await sealSession(s, SECRET), SECRET);
    expect(opened).toEqual(s);
  });

  it('iat 超過 SESSION_MAX_AGE_SECONDS 就算過期，回傳 null（伺服器端過期檢查）', async () => {
    // 只靠 cookie 的 Max-Age 不夠：那只在瀏覽器端生效。密文本身若以其他方式外洩
    // （log、磁碟存取…），沒有這道檢查會一直有效到 SESSION_SECRET 輪替為止。
    const longAgo = Math.floor(Date.now() / 1000) - SESSION_MAX_AGE_SECONDS - 1;
    const sealed = await sealSession({ token: 'gho_abc123', login: 'p', iat: longAgo }, SECRET);
    expect(await openSession(sealed, SECRET)).toBeNull();
  });

  it('密文裡看不到明文 token', async () => {
    const sealed = await sealSession({ token: 'gho_abc123', login: 'p', iat: 1 }, SECRET);
    expect(sealed).not.toContain('gho_abc123');
  });

  it('換一把金鑰解不開，回傳 null 而不是拋錯', async () => {
    const sealed = await sealSession({ token: 'gho_abc123', login: 'p', iat: 1 }, SECRET);
    expect(await openSession(sealed, 'another-secret')).toBeNull();
  });

  it('密文被竄改時回傳 null（AES-GCM 的完整性保護）', async () => {
    const sealed = await sealSession({ token: 'gho_abc123', login: 'p', iat: 1 }, SECRET);
    const tampered = sealed.slice(0, -4) + 'AAAA';
    expect(await openSession(tampered, SECRET)).toBeNull();
  });

  it('cookie 帶 HttpOnly / Secure / SameSite=Lax 與有效期', () => {
    const c = sessionCookie('abc');
    expect(c).toContain('HttpOnly');
    expect(c).toContain('Secure');
    expect(c).toContain('SameSite=Lax');
    expect(c).toContain('Path=/');
    expect(c).toContain(`Max-Age=${SESSION_MAX_AGE_SECONDS}`);
  });

  it('讀得到請求裡的 cookie，沒有時回 null', () => {
    expect(readSessionCookie(new Request('https://x/', { headers: { cookie: 'a=1; rd2_session=xyz; b=2' } }))).toBe('xyz');
    expect(readSessionCookie(new Request('https://x/'))).toBeNull();
  });
});
