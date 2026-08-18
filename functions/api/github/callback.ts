import { sealSession, sessionCookie, type Env, type PagesGetHandler } from './_lib/session.js';

const STATE_COOKIE = 'rd2_oauth_state';

/** 讀某個 cookie 的值；沒有 cookie 標頭或該 cookie 不存在都回 null。 */
function readCookie(request: Request, name: string): string | null {
  const raw = request.headers.get('cookie');
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=') || null;
  }
  return null;
}

/** 失敗一律導回 /edit?login=failed，讓前端顯示可讀的錯誤——不把 GitHub 的原始錯誤丟給玩家。 */
function loginFailed(): Response {
  return new Response(null, { status: 302, headers: { location: '/edit?login=failed' } });
}

/**
 * 流程：讀 code／state → 與 rd2_oauth_state cookie 比對（不符回 400，這是 CSRF 防護，
 * 跟後面「換 token 失敗」是不同性質的錯誤，所以狀態碼不同）→ 用授權碼換 token →
 * 用 token 查使用者 login → sealSession → 302 回 /edit，同時寫 session cookie、
 * 清掉 state cookie（用過即棄，避免被重放）。
 *
 * fetchImpl 讓測試可以注入假的 fetch，驗完整流程而不真的打 GitHub。
 */
export async function handleCallback(request: Request, env: Env, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookieState = readCookie(request, STATE_COOKIE);

  // state 不符（或根本沒帶）才是真的 CSRF 疑慮，回 400。
  if (!state || !cookieState || state !== cookieState) {
    return new Response(null, { status: 400 });
  }
  // state 對得上但沒有 code：多半是玩家在 GitHub 授權頁按了取消，不是攻擊，
  // 走跟「換 token 失敗」一樣的 302 login=failed，而不是生硬的 400。
  if (!code) return loginFailed();

  try {
    const tokenRes = await fetchImpl('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: new URL('/api/github/callback', request.url).toString(),
      }),
    });
    if (!tokenRes.ok) return loginFailed();
    const tokenBody = (await tokenRes.json()) as { access_token?: string };
    if (!tokenBody.access_token) return loginFailed();

    const userRes = await fetchImpl('https://api.github.com/user', {
      headers: {
        authorization: `Bearer ${tokenBody.access_token}`,
        // GitHub API 要求所有請求都帶 User-Agent，沒有的話一律回 403。
        'user-agent': 'rd2-wiki-editor',
      },
    });
    if (!userRes.ok) return loginFailed();
    const userBody = (await userRes.json()) as { login?: string };
    if (!userBody.login) return loginFailed();

    const sealed = await sealSession(
      { token: tokenBody.access_token, login: userBody.login, iat: Math.floor(Date.now() / 1000) },
      env.SESSION_SECRET,
    );

    const headers = new Headers({ location: '/edit' });
    headers.append('set-cookie', sessionCookie(sealed));
    // 用過即棄：state cookie 只在這次交換有用，換完就清掉，避免授權碼被重放時還能沿用。
    headers.append('set-cookie', `${STATE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
    return new Response(null, { status: 302, headers });
  } catch {
    // 網路錯誤、GitHub 回傳格式不如預期等任何非預期例外，一律當成登入失敗處理，
    // 不讓例外冒到請求層變成 500。
    return loginFailed();
  }
}

export const onRequestGet: PagesGetHandler = ({ request, env }) => handleCallback(request, env);
