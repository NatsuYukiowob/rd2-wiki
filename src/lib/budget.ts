/** 與 tools/build-data.ts 的 CLI 區塊同一組數字（spec §11 效能預算），改動要兩邊一起改。 */
export const GZIP_BUDGET_BYTES = 20 * 1024;
export const SPRITE_BUDGET_BYTES = 400 * 1024;

/**
 * 估算文字 gzip 後的位元組數。用 CompressionStream（瀏覽器與 Node 24 都內建），
 * 讓編輯器在送出前就能提醒玩家「這批改動會不會撞上 tree.json 的 20 KB 預算」——
 * 這條餘裕實測只剩不到 3 KB，遊戲改版加一整個分支很容易吃光。
 *
 * 只估 tree.json 這條。sprite.webp 那條估不準（新圖示要重新 pack，瀏覽器沒有 sharp），
 * 編輯器只在有新增圖示時提示「實際體積以 CI 為準」。
 */
export async function estimateGzipBytes(text: string): Promise<number> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  return buf.byteLength;
}
