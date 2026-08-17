/**
 * 從描述文字中抽出遊戲關鍵字。
 *
 * 遊戲文案裡的 `#` 標記沒有結束符號，且中文沒有空格分詞，所以無法單純用正規表達式
 * 切出關鍵字（`#` 後面常常直接黏著整句話，例如「#冰凍狀態怪物造成的傷害增加20%」）。
 * 因此改用「白名單 + 最長優先比對」：對每個 `#`，從白名單裡找出能在該位置匹配、且最長的詞。
 * 若沒有任何白名單詞能匹配，代表白名單不完整，直接拋錯提示，而不是靜默略過。
 */
export function extractKeywords(description: string, whitelist: string[]): string[] {
  const sorted = [...whitelist].sort((a, b) => b.length - a.length);
  const found: string[] = [];
  for (let i = 0; i < description.length; i++) {
    if (description[i] !== '#') continue;
    const rest = description.slice(i + 1);
    const hit = sorted.find(w => rest.startsWith(w));
    if (!hit) throw new Error(`# 標記比不到白名單: ${JSON.stringify(rest.slice(0, 12))}`);
    if (!found.includes(hit)) found.push(hit);
  }
  return found;
}
