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

/**
 * 做一次替換，並確認它真的發生了。
 *
 * `String.replace` 比對不到時會**原樣回傳**，不會報錯——所以「跑完沒爆」跟「改好了」是兩件事。
 * 這裡的正則都依賴屬性順序與元素形狀（例如 `href x y width height`），
 * 日後任何一次 normalize 調整屬性順序都會讓它們默默失效：
 * 圖示雜湊留在正本裡指向整批換掉後已經不存在的檔案，validate 才會爆出一整片規則
 * 7(a) 錯誤，而且完全看不出是哪一步說了謊。render-nodes 的樞紐改寫已經用旗標確認過，節點這邊當時
 * 只數了區塊數（每個區塊必定 +1，等於什麼都沒驗），code review 抓到後改成一致的做法。
 */
export function mustReplace(text: string, re: RegExp, to: string, what: string, id: string): string {
  let hit = false;
  const out = text.replace(re, (...args) => {
    hit = true;
    // 沒有捕捉群組時 args[1] 是比對位置（數字），`$1` 會被換成它而安靜寫壞正本。
    if (to.includes('$1') && typeof args[1] !== 'string') throw new Error(`${what}的替換字串用了 $1，但 ${re} 沒有捕捉群組`);
    return to.replace(/\$1/, String(args[1] ?? ''));
  });
  if (!hit) throw new Error(`節點 ${id} 的${what}沒有被改到——正本的格式可能變了，${re}`);
  return out;
}
