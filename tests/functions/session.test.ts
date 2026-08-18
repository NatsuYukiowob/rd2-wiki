import { describe, it, expect } from 'vitest';
import { sealSession, openSession, sessionCookie, readSessionCookie, SESSION_MAX_AGE_SECONDS } from '../../functions/api/github/_lib/session';

const SECRET = 'test-secret-do-not-use-in-production';

describe('session', () => {
  it('封裝後可以解回原本的內容', async () => {
    const s = { token: 'gho_abc123', login: 'someplayer', iat: 1_700_000_000 };
    const opened = await openSession(await sealSession(s, SECRET), SECRET);
    expect(opened).toEqual(s);
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
