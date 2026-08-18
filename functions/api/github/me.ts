import { openSession, readSessionCookie, type Env, type PagesGetHandler } from './_lib/session.js';

/**
 * 前端唯一會呼叫的身分端點。絕對不能回傳 token——整個線上編輯器 P2 的安全設計就是
 * 「token 不進瀏覽器 JS」，這裡一旦回傳 token，前面所有努力都白費。
 */
export async function handleMe(request: Request, env: Env): Promise<Response> {
  const sealed = readSessionCookie(request);
  const session = sealed ? await openSession(sealed, env.SESSION_SECRET) : null;
  if (!session) return new Response(null, { status: 401 });
  return new Response(JSON.stringify({ login: session.login }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

export const onRequestGet: PagesGetHandler = ({ request, env }) => handleMe(request, env);
