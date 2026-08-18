/** PNG 檔案簽章（固定 8 bytes，PNG 規格 §5.2）。 */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * 從檔案位元組解析 PNG 尺寸。（原本在 tools/lib/png.ts，為了讓線上編輯器也能用同一份
 * 判定而搬到 src/lib 並改吃 Uint8Array——Node 的 Buffer 是 Uint8Array 的子類，
 * CI 端呼叫方式完全不變。）
 *
 * 只做結構性檢查（簽章 + 第一個 chunk 是否為 IHDR），足以擋下「根本不是 PNG」或
 * 「檔案損毀／截斷」；不驗 CRC 或後續 chunk。
 */
export function readPngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_SIGNATURE[i]) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // PNG 的第一個 chunk 必為 IHDR：8 bytes 簽章後接 length(4) + type(4) + IHDR data。
  const chunkType = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
  if (chunkType !== 'IHDR') return null;
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}
