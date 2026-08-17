/** PNG 檔案簽章（固定 8 bytes，PNG 規格 §5.2）。 */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * 從檔案位元組解析 PNG 尺寸，純用 buffer 讀取 PNG 簽章與 IHDR chunk，不依賴外部影像函式庫。
 *
 * 只做結構性檢查（簽章 + 第一個 chunk 是否為 IHDR），足以擋下「根本不是 PNG」或
 * 「檔案損毀／截斷」的情況；不驗證 CRC 或後續 chunk，因為守門員只需要「有效性 + 尺寸」，
 * 不需要完整解碼像素——用 sharp 之類的函式庫做這件事反而是殺雞用牛刀，還會把整條驗證
 * 邏輯拖成非同步。
 *
 * @returns 有效 PNG 回傳寬高；不是 PNG 或結構異常回傳 null（呼叫端負責轉成錯誤訊息）
 */
export function readPngSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24) return null;
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  // PNG 的第一個 chunk 必為 IHDR：8 bytes 簽章後接 length(4) + type(4) + IHDR data。
  const chunkType = buf.subarray(12, 16).toString('ascii');
  if (chunkType !== 'IHDR') return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}
