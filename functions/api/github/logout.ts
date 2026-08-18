import { clearSessionCookie, type PagesGetHandler } from './_lib/session.js';

export async function handleLogout(): Promise<Response> {
  return new Response(null, {
    status: 302,
    headers: { location: '/edit', 'set-cookie': clearSessionCookie() },
  });
}

export const onRequestGet: PagesGetHandler = () => handleLogout();
