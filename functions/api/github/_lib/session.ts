export interface Session { token: string; login: string; iat: number; lastSubmitAt?: number }

export interface Env {
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  /** 形如 `NatsuYukiowob/rd2-wiki`，PR 要送進去的目標 repo。 */
  UPSTREAM_REPO: string;
}

/**
 * Cloudflare Pages 的 onRequestGet 處理函式簽章。故意不用 @cloudflare/workers-types 全域的
 * `PagesFunction<Env>`：那個型別只在 functions/tsconfig.json 的程式（有載入 workers-types）
 * 下解析得到。login.ts／callback.ts／me.ts／logout.ts 的 handleXxx 也會被
 * tests/functions/*.test.ts 直接 import，而測試走的是根 tsconfig 的程式——根 tsconfig
 * 刻意不載入 workers-types（見 functions/tsconfig.json 開頭的說明：避免跟 DOM lib 的全域型別
 * 衝突），所以 `onRequestGet` 若標成 `PagesFunction<Env>`，根 tsc 在把這些檔案透過 import
 * 拉進同一個程式時會回報「Cannot find name 'PagesFunction'」。這裡改用結構相容的最小簽章：
 * Cloudflare 實際呼叫時傳進來的 EventContext 除了 request／env 還有更多欄位，物件型別在函式
 * 參數位置上允許「實際傳入值有多餘欄位」，執行期沒有問題。
 */
export type PagesGetHandler = (context: { request: Request; env: Env }) => Response | Promise<Response>;

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

/**
 * 解不開（金鑰不符、被竄改、格式錯）一律回 null，讓呼叫端當作未登入處理，不要讓例外冒到請求層。
 *
 * 過期檢查也放在這裡而不是各呼叫端：cookie 的 Max-Age 只在瀏覽器端生效，如果密文本身以
 * 其他方式外洩（log 捕捉、磁碟存取），少了這道伺服器端檢查它會一直有效到 SESSION_SECRET
 * 輪替為止。放在 openSession 內部，讓每個呼叫端（包含未來 Task 20 的 submit 端點）自動獲得
 * 保護，不必依賴各自記得檢查。
 */
export async function openSession(sealed: string, secret: string): Promise<Session | null> {
  try {
    const [ivPart, ctPart] = sealed.split('.');
    if (!ivPart || !ctPart) return null;
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(ivPart) }, await keyFrom(secret), unb64(ctPart),
    );
    const session = JSON.parse(new TextDecoder().decode(pt)) as Session;
    if (Date.now() / 1000 - session.iat > SESSION_MAX_AGE_SECONDS) return null;
    return session;
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
