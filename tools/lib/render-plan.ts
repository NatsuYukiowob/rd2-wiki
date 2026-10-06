/**
 * 手工合成、不是 `render-nodes` 產的節點圖示：超越骰子 1501／2503 與符文 1601／2603（配方見
 * `data/CLAUDE.md`〈超越骰子〉）。重跑時保留正本原本指向的檔，不重渲染——原圖就算哪天收了這幾顆，
 * 扁平渲染也會把手工圖蓋掉。
 */
export const KEEP_ICON_IDS: ReadonlySet<string> = new Set(['1501', '1601', '2503', '2603']);

/**
 * 比對原圖與正本的節點集合，回傳要渲染的 id（原圖順序，扣掉保留的）。
 *
 * 對不上就丟例外——`render-nodes` 在動 `data/icons` 之前呼叫它，所以集合對不上時什麼都還沒改。
 * 保留清單裡的 id 不必出現在原圖；正本沒有的保留 id 不算錯（清單比正本先改也一樣跑得動）。
 */
export function planRender(
  drawingIds: readonly string[],
  canonicalIds: readonly string[],
  keep: ReadonlySet<string> = KEEP_ICON_IDS,
): string[] {
  const drawing = new Set(drawingIds);
  const canonical = new Set(canonicalIds);
  const missing = [...canonical].filter(id => !drawing.has(id) && !keep.has(id));
  const extra = [...drawing].filter(id => !canonical.has(id));
  const problems: string[] = [];
  if (missing.length > 0) problems.push(`原圖沒有正本的節點 ${missing.join('、')}`);
  if (extra.length > 0) problems.push(`原圖多出正本沒有的節點 ${extra.join('、')}`);
  if (problems.length > 0) {
    throw new Error(`${problems.join('；')}——正本與原圖的節點集合對不上，data/icons 沒有動`);
  }
  return [...drawing].filter(id => !keep.has(id));
}
