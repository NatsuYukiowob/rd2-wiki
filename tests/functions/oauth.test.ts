import { describe, it, expect } from 'vitest';
import { handleLogin } from '../../functions/api/github/login';
import { handleCallback } from '../../functions/api/github/callback';
import { handleMe } from '../../functions/api/github/me';
import { handleLogout } from '../../functions/api/github/logout';
import { openSession, sealSession } from '../../functions/api/github/_lib/session';

const env = {
  GITHUB_CLIENT_ID: 'test-client-id',
  GITHUB_CLIENT_SECRET: 'test-client-secret',
  SESSION_SECRET: 'test-session-secret',
  UPSTREAM_REPO: 'NatsuYukiowob/rd2-wiki',
};

describe('OAuth 流程', () => {
  it('login 導向 GitHub 授權頁，帶 client_id、scope 與 state', async () => {
    const res = await handleLogin(new Request('https://rd2-wiki.pages.dev/api/github/login'), env);
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get('location')!);
    expect(to.origin + to.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(to.searchParams.get('client_id')).toBe('test-client-id');
    expect(to.searchParams.get('scope')).toBe('public_repo');
    expect(to.searchParams.get('state')).toBeTruthy();
    // state 必須同時寫進短命 cookie，callback 才比對得出來（CSRF 防護）
    expect(res.headers.get('set-cookie')).toContain('rd2_oauth_state=');
  });

  it('callback 用授權碼換 token、查使用者、寫 session cookie 後導回 /edit', async () => {
    const fakeFetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('login/oauth/access_token')) {
        return new Response(JSON.stringify({ access_token: 'gho_fake' }), { headers: { 'content-type': 'application/json' } });
      }
      if (url.endsWith('/user')) {
        return new Response(JSON.stringify({ login: 'someplayer' }), { headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`未預期的請求: ${url}`);
    }) as typeof fetch;

    const req = new Request('https://rd2-wiki.pages.dev/api/github/callback?code=abc&state=s1', {
      headers: { cookie: 'rd2_oauth_state=s1' },
    });
    const res = await handleCallback(req, env, fakeFetch);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/edit');
    const setCookie = res.headers.get('set-cookie')!;
    expect(setCookie).toContain('rd2_session=');
    const sealed = /rd2_session=([^;]+)/.exec(setCookie)![1]!;
    expect(await openSession(sealed, env.SESSION_SECRET)).toMatchObject({ token: 'gho_fake', login: 'someplayer' });
  });

  it('callback 的 state 不符時拒絕（CSRF 防護）', async () => {
    const req = new Request('https://rd2-wiki.pages.dev/api/github/callback?code=abc&state=evil', {
      headers: { cookie: 'rd2_oauth_state=s1' },
    });
    const res = await handleCallback(req, env, (async () => { throw new Error('不該打出任何請求'); }) as typeof fetch);
    expect(res.status).toBe(400);
  });

  it('callback 換 token 失敗時導回 /edit?login=failed，不把 GitHub 原始錯誤丟給玩家', async () => {
    const fakeFetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('login/oauth/access_token')) {
        // GitHub 換 token 失敗時仍回 200，但 body 沒有 access_token（例如授權碼過期／重用）
        return new Response(JSON.stringify({ error: 'bad_verification_code' }), { headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`不該查使用者資料: ${url}`);
    }) as typeof fetch;

    const req = new Request('https://rd2-wiki.pages.dev/api/github/callback?code=abc&state=s1', {
      headers: { cookie: 'rd2_oauth_state=s1' },
    });
    const res = await handleCallback(req, env, fakeFetch);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/edit?login=failed');
  });

  it('me 未登入回 401、已登入只回 login 不回 token', async () => {
    expect((await handleMe(new Request('https://x/'), env)).status).toBe(401);
    // iat 用「現在」：這支測試驗的是已登入時的回應形狀，不是 session 有效期，
    // 用很久以前的時間戳記在加了伺服器端過期檢查後會被判定過期，變成意外的 401。
    const sealed = await sealSession({ token: 'gho_secret', login: 'someplayer', iat: Math.floor(Date.now() / 1000) }, env.SESSION_SECRET);
    const res = await handleMe(new Request('https://x/', { headers: { cookie: `rd2_session=${sealed}` } }), env);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ login: 'someplayer' });
    expect(body).not.toContain('gho_secret');
  });

  it('me 對過期的 session 回 401（openSession 的伺服器端過期檢查）', async () => {
    const longAgo = Math.floor(Date.now() / 1000) - 8 * 60 * 60 - 1;
    const sealed = await sealSession({ token: 'gho_secret', login: 'someplayer', iat: longAgo }, env.SESSION_SECRET);
    const res = await handleMe(new Request('https://x/', { headers: { cookie: `rd2_session=${sealed}` } }), env);
    expect(res.status).toBe(401);
  });

  it('logout 導回 /edit 並清掉 session cookie', async () => {
    const res = await handleLogout();
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/edit');
    const setCookie = res.headers.get('set-cookie')!;
    expect(setCookie).toContain('rd2_session=');
    expect(setCookie).toContain('Max-Age=0');
  });
});
