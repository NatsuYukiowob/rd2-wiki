export interface Session { token: string; login: string; iat: number; lastSubmitAt?: number }

export interface Env {
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  /** 形如 `NatsuYukiowob/rd2-wiki`，PR 要送進去的目標 repo。 */
  UPSTREAM_REPO: string;
}

const COOKIE_NAME = 'rd2_session';
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

async function keyFrom(secret: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

/**
 * 把 session 加密成一段可放進 cookie 的字串。
 *
 * 為什麼要加密而不是只簽章：cookie 裡裝的是玩家的 GitHub token，只做簽章的話 token 仍以明文
 * 存在瀏覽器的 cookie 儲存區，任何能讀到 cookie 檔的程式都拿得到。AES-GCM 同時給機密性與
 * 完整性，被竄改時解密會直接失敗。
 */
export async function sealSession(s: Session, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(s));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFrom(secret), data);
  return `${b64(iv)}.${b64(new Uint8Array(ct))}`;
}

/** 解不開（金鑰不符、被竄改、格式錯）一律回 null，讓呼叫端當作未登入處理，不要讓例外冒到請求層。 */
export async function openSession(sealed: string, secret: string): Promise<Session | null> {
  try {
    const [ivPart, ctPart] = sealed.split('.');
    if (!ivPart || !ctPart) return null;
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(ivPart) }, await keyFrom(secret), unb64(ctPart),
    );
    return JSON.parse(new TextDecoder().decode(pt)) as Session;
  } catch {
    return null;
  }
}

/** SameSite=Lax 足夠：OAuth callback 是從 GitHub 導回來的頂層導覽，Lax 會送出 cookie。 */
export function sessionCookie(sealed: string): string {
  return `${COOKIE_NAME}=${sealed}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export function readSessionCookie(request: Request): string | null {
  const raw = request.headers.get('cookie');
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE_NAME) return v.join('=') || null;
  }
  return null;
}
