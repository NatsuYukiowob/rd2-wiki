import { readPngSize } from './png.js';

/**
 * 內容 sha256 的前 12 碼，也就是 data/icons/ 的檔名規則（見 CONTRIBUTING.md §3）。
 * 用 Web Crypto 而不是 node:crypto，讓瀏覽器端的編輯器與 CI 共用同一份判定。
 */
export async function sha256Hex12(bytes: Uint8Array): Promise<string> {
  // 包一層 new Uint8Array(bytes) 是為了型別，不是為了資料：TS 5.7+ 把 TypedArray 的 buffer
  // 泛型化成 ArrayBufferLike（含 SharedArrayBuffer），但 DOM 的 BufferSource 只收 ArrayBuffer，
  // 兩者對不上。這裡穩定重建一份 ArrayBuffer-backed 的拷貝，內容不變，只是讓型別對得上。
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
}

export type IconCheck =
  | { ok: true; hash: string; width: number; height: number }
  | { ok: false; reason: string };

/** 一次做完 CI 規則 7(c) 的兩項檢查（合法 PNG、最長邊 ≥ 96px）並回傳雜湊，錯誤訊息與 CI 用語一致。 */
export async function checkIcon(bytes: Uint8Array): Promise<IconCheck> {
  const size = readPngSize(bytes);
  if (!size) return { ok: false, reason: '不是有效的 PNG' };
  const longest = Math.max(size.width, size.height);
  if (longest < 96) return { ok: false, reason: `圖示最長邊 ${longest}px，小於最低要求 96px` };
  return { ok: true, hash: await sha256Hex12(bytes), width: size.width, height: size.height };
}
