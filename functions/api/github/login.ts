import type { Env, PagesGetHandler } from './_lib/session.js';

const STATE_COOKIE = 'rd2_oauth_state';

/**
 * 導向 GitHub 授權頁。scope 只要 public_repo——這是「fork 一份、寫進自己的 fork、開 PR」
 * 的最小需求，不要求任何私有 repo 權限（授權畫面上玩家看得到，這是信任門檻的一部分）。
 */
export async function handleLogin(request: Request, env: Env): Promise<Response> {
  const state = crypto.randomUUID();
  const to = new URL('https://github.com/login/oauth/authorize');
  to.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  to.searchParams.set('scope', 'public_repo');
  to.searchParams.set('state', state);
  to.searchParams.set('redirect_uri', new URL('/api/github/callback', request.url).toString());
  return new Response(null, {
    status: 302,
    headers: {
      location: to.toString(),
      // 短命（10 分鐘）的 state cookie，callback 會比對。防的是別人誘導玩家連到偽造的
      // callback 網址、把玩家的 session 綁到攻擊者的授權碼上。
      'set-cookie': `${STATE_COOKIE}=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`,
    },
  });
}

export const onRequestGet: PagesGetHandler = ({ request, env }) => handleLogin(request, env);
