import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { parseTree } from './lib/svg-parse.js';
import { parseCost } from '../src/lib/cost.js';
import { parseGrowth } from '../src/lib/growth.js';
import { extractKeywords } from '../src/lib/keywords.js';
import { branchOfId, elementOfStroke, typeOfZh } from '../src/lib/taxonomy.js';
import { buildAdjacency, detectCycle, findRoots, unreachableFrom } from '../src/lib/graph.js';
import { loadSvg } from './lib/dom.js';
import { readPngSize } from './lib/png.js';
import type { Edge } from '../src/lib/types.js';

/**
 * 資料樹的預期根節點（各分支的第一個骰子）。
 * 若真實資料的根集合與此不同，代表結構被改壞或有節點斷線，必須人工確認再更新此常數。
 */
const EXPECTED_ROOTS = ['1001', '2001', '3001', '4008', '5002'];

export interface ValidateOpts {
  keywords: string[];
  /** 圖示所在目錄；驗證器會實際讀取此目錄下的檔案內容做 sha256／PNG 結構檢查，並列出孤兒圖示。 */
  iconsDir: string;
  /**
   * 資料正本所在目錄，用來解析 SVG 裡的相對圖檔路徑（目前只有中央樞紐的 `tree-center.png`）。
   * 刻意跟 iconsDir 分開、也刻意不預設成 `dirname(iconsDir)`：測試會把圖示複製到暫存目錄再驗，
   * 那時 iconsDir 的上層根本不是資料目錄，靠推導只會去錯的地方找檔案然後報一個假的錯。
   */
  dataDir: string;
}

export interface ValidateResult {
  /** 會擋下 PR 的問題；空陣列代表通過。 */
  errors: string[];
  /** 不擋 PR，但值得在 PR 摘要中提醒貢獻者／審閱者的事項（待接線節點、佔位符、孤兒圖示）。 */
  warnings: string[];
}

/**
 * CI 資料守門員：對 `data/dice-tree.svg` 做語意驗證。
 *
 * 這是社群 PR 唯一的自動化防線——SVG 的 diff 沒辦法逐行 review，所以每條規則的錯誤訊息
 * 都必須帶上足以定位問題的資訊（節點 id 或邊的座標／d 值），並在可行時保留既有工具
 * （svg-parse／cost／growth／keywords）拋出的引導語（例如「請先執行 npm run normalize」）。
 */
export function validate(svgText: string, opts: ValidateOpts): ValidateResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const push = (m: string) => errors.push(m);
  const warn = (m: string) => warnings.push(m);

  let parsed;
  try {
    parsed = parseTree(svgText);
  } catch (e) {
    // parseTree 本身已涵蓋「SVG 子集」規則（絕對 transform／絕對邊指令／直屬子元素／
    // 形狀元素／stroke／marker-end），一旦失敗代表資料連結構都不合法，其餘規則無從檢查起。
    return { errors: [`規則 0（SVG 子集）: ${(e as Error).message}`], warnings: [] };
  }
  const { nodes, edges } = parsed;

  // 規則 2: id 唯一與編碼規律（首碼＝分支 1-5，次碼＝ 0-4，其後兩碼任意）
  const seen = new Set<string>();
  for (const n of nodes) {
    if (seen.has(n.id)) push(`規則 2: 重複的 id ${n.id}`);
    seen.add(n.id);
    if (!/^[1-5][0-4]\d\d$/.test(n.id)) push(`規則 2: id 不符編碼規律 ${n.id}`);
  }

  const doc = loadSvg(svgText);
  const nodeElById = new Map<string, Element>();
  for (const g of doc.querySelectorAll('g.node')) {
    const id = g.getAttribute('data-id');
    if (id) nodeElById.set(id, g);
  }

  for (const n of nodes) {
    // 規則 1: 欄位齊全與 title 一致性
    for (const [k, v] of Object.entries({ id: n.id, type: n.typeZh, name: n.name, cost: n.costRaw, description: n.description })) {
      if (!v) push(`規則 1: 節點 ${n.id} 缺少 data-${k}`);
    }
    // title 與 data-* 必須「全等」一致，不能只是字串包含關係——包含關係無法抓出
    // 例如 title 被改成別的節點內容、卻剛好是另一段文字子字串的情況。
    // 注意：data-description 本身可能內嵌換行（多行技能敘述），title 會原封不動帶著這些
    // 換行，所以不能無條件砍掉 title 的第二行——只有「最後一行剛好是『最高等級：N』」
    // 這種玩家被動專屬的附加行才要剝掉，其餘情況一律整段全等比對。
    const titleEl = nodeElById.get(n.id)?.querySelector('title');
    const titleText = titleEl?.textContent ?? '';
    const titleLines = titleText.split('\n');
    const lastLine = titleLines[titleLines.length - 1] ?? '';
    const hasLevelSuffix = titleLines.length > 1 && /^最高等級：\d+$/.test(lastLine);
    const contentTitle = hasLevelSuffix ? titleLines.slice(0, -1).join('\n') : titleText;
    const expectTitle = `${n.typeZh}｜${n.name}｜${n.description}`;
    if (contentTitle !== expectTitle) push(`規則 1: 節點 ${n.id} 的 title 與 data-* 不一致（title: ${JSON.stringify(contentTitle)}，預期: ${JSON.stringify(expectTitle)}）`);

    // 規則 3: type 與 stroke（元素）對應——支援節點的 stroke 必須是 support 色，反之亦然
    try {
      const t = typeOfZh(n.typeZh);
      const el = elementOfStroke(n.stroke);
      branchOfId(n.id);
      if ((el === 'support') !== (t === 'support')) push(`規則 3: 節點 ${n.id} 的 stroke 與 type 不對應`);
    } catch (e) { push(`規則 3: 節點 ${n.id} ${(e as Error).message}`); }

    // 規則 4: 成本文法
    try { parseCost(n.costRaw); } catch (e) { push(`規則 4: 節點 ${n.id} 成本 ${(e as Error).message}`); }

    // 規則 8: 關鍵字白名單（# 標記必須能比對到白名單詞）
    try { extractKeywords(n.description, opts.keywords); } catch (e) { push(`規則 8: 節點 ${n.id} ${(e as Error).message}`); }

    // 規則 9: 成長值單位一致性；`{n}` 佔位符是上游資料問題，只警告不擋 PR
    try {
      const g = parseGrowth(n.description);
      if (g.dataIssue === 'placeholder') warn(`規則 9: 節點 ${n.id} 的成長值含 {n} 佔位符（上游資料尚未填值），不擋 PR`);
    } catch (e) { push(`規則 9: 節點 ${n.id} ${(e as Error).message}`); }
  }

  // 規則 7: 圖示。以 iconsDir 內實際檔案為準做一次全面掃描（而非逐節點重複讀檔／算雜湊），
  // 因為同一張圖示常被多個節點共用（實測有一張被 15 個節點共用），檔案層級的問題只需驗一次。
  const iconFileNames = readdirSync(opts.iconsDir).filter(f => f.endsWith('.png'));
  const iconHashSet = new Set(iconFileNames.map(f => f.slice(0, -'.png'.length)));
  const referencedIcons = new Set(nodes.map(n => n.icon));
  for (const fileName of iconFileNames) {
    const expectedHash = fileName.slice(0, -'.png'.length);
    const buf = readFileSync(join(opts.iconsDir, fileName));
    // 規則 7(b): 檔案內容的 sha256 前 12 碼必須等於檔名，防止「改了內容卻沒改檔名」造成快取污染。
    const actualHash = createHash('sha256').update(buf).digest('hex').slice(0, 12);
    if (actualHash !== expectedHash) push(`規則 7(b): 圖示 ${fileName} 的內容 sha256 前 12 碼為 ${actualHash}，與檔名不符`);
    // 規則 7(c): 必須是有效 PNG，且最長邊 ≥ 96px。
    const size = readPngSize(buf);
    if (!size) push(`規則 7(c): 圖示 ${fileName} 不是有效的 PNG`);
    else if (Math.max(size.width, size.height) < 96) push(`規則 7(c): 圖示 ${fileName} 最長邊 ${Math.max(size.width, size.height)}px，小於最低要求 96px`);
    // 規則 7(d): 未被任何節點引用的圖示，只警告不擋 PR。
    if (!referencedIcons.has(expectedHash)) warn(`規則 7(d): 圖示 ${fileName} 未被任何節點引用`);
  }
  // 規則 7(c) 的 96px 下限是「圖檔本身別太小」，跟「它會被放多大」無關。顯示尺寸自 2026-08-18
  // 改成逐節點寫在正本的 `<image width/height>`（不再由類型推導）之後，那個數字變成**完全沒有
  // 人守**：parseTree 只擋 ≤0／NaN，規則 7 只看檔案。一個 PR 把某個節點寫成 width="500"
  // height="500"，CI 全綠，sprite 會為它開一個 500×500 的分區、拿 104px 的來源拉上去，站台上
  // 就是一塊糊掉的巨型貼圖。這裡補上「顯示尺寸不得超過來源解析度的一半」——跟規則 10 對樞紐圖
  // 的要求同一個標準（來源至少要是顯示尺寸的兩倍，高 DPI 螢幕才不會糊）。
  const pngSizeByHash = new Map<string, { width: number; height: number }>();
  for (const fileName of iconFileNames) {
    const size = readPngSize(readFileSync(join(opts.iconsDir, fileName)));
    if (size) pngSizeByHash.set(fileName.slice(0, -'.png'.length), size);
  }
  for (const n of nodes) {
    // 規則 7(a): 節點引用的圖示必須存在於 iconsDir。
    if (!iconHashSet.has(n.icon)) { push(`規則 7(a): 節點 ${n.id} 引用的圖示 ${n.icon} 不存在`); continue; }
    // 規則 7(e): 顯示尺寸 × 2 不得超過圖檔解析度。
    const px = pngSizeByHash.get(n.icon);
    if (!px) continue; // 不是有效 PNG——規則 7(c) already 報過了，這裡不重複
    const [w, h] = n.size;
    if (w * 2 > px.width || h * 2 > px.height) {
      push(
        `規則 7(e): 節點 ${n.id} 的顯示尺寸 ${w}x${h} 相對圖示 ${n.icon} 的解析度 ${px.width}x${px.height} 過大` +
          `（顯示尺寸的兩倍不得超過圖檔解析度，否則高 DPI 螢幕上會糊）`,
      );
    }
  }

  // 規則 10: 中央樞紐。整組是選用的（正本沒有 g.tree-center 時 parseTree 回傳 null），但只要有，
  // 就必須真的畫得出來：圖檔存在且是有效 PNG、放射線接到真實存在的節點。少了任何一項，站台端
  // 只會安靜地畫出破圖或斷腳的樞紐，不會有錯誤訊息——這正是 CI 該擋下來的那種「沉默的壞掉」。
  const center = parsed.meta.center;
  if (center) {
    const centerPath = join(opts.dataDir, center.image);
    let centerBuf: Buffer | null = null;
    try {
      centerBuf = readFileSync(centerPath);
    } catch {
      push(`規則 10: 中央樞紐的圖 ${center.image} 不存在（找不到 ${centerPath}）`);
    }
    if (centerBuf && !readPngSize(centerBuf)) push(`規則 10: 中央樞紐的圖 ${center.image} 不是有效的 PNG`);

    if (centerBuf) {
      // 最低解析度：樞紐圖會被建置期放大到顯示尺寸的兩倍（高 DPI），來源比那還小就只是被
      // 拉糊。節點圖示有規則 7(c) 的 96px 下限守著，樞紐這張過去什麼都沒守。
      const size = readPngSize(centerBuf);
      const [needW, needH] = [center.size[0] * 2, center.size[1] * 2];
      if (size && (size.width < needW || size.height < needH)) {
        push(`規則 10: 中央樞紐的圖 ${center.image} 只有 ${size.width}x${size.height}，小於顯示尺寸的兩倍（${needW}x${needH}）`);
      }
    }

    const byId = new Map(nodes.map(n => [n.id, n]));
    for (const [i, id] of center.links.entries()) {
      const n = byId.get(id);
      if (!n) { push(`規則 10: 中央樞紐的 data-links 指向不存在的節點 ${id}`); continue; }
      // 放射線的終點必須真的落在該節點中心，順序也要跟 data-links 對上——這是規則 5 對一般
      // 邊做的同一件事。站台端是拿 links 的 id 去查節點座標、自己重畫這五條線的，所以正本
      // 這邊畫歪了或把 data-links 順序調換了，站台完全看不出來：正本與線上版會安靜地長得
      // 不一樣，而這份 SVG 正是貢獻者用來確認自己改了什麼的東西。
      const [ex, ey] = center.linkEnds[i]!;
      if (Math.abs(ex - n.x) >= 0.5 || Math.abs(ey - n.y) >= 0.5) {
        push(`規則 10: 中央樞紐第 ${i + 1} 條放射線的終點 (${ex}, ${ey}) 沒對上 data-links 指定的節點 ${id} 的中心 (${n.x}, ${n.y})`);
      }
    }
    // 樞紐畫的是「五顆起手骰從樹心長出來」，所以連線集合本來就該等於根集合。日後資料改版多一個
    // 分支時，這裡會先亮黃燈提醒一併更新樞紐，而不是讓新分支的根悄悄少一條線。
    const linkSet = new Set(center.links);
    const rootDiff = [
      ...EXPECTED_ROOTS.filter(r => !linkSet.has(r)),
      ...center.links.filter(id => !EXPECTED_ROOTS.includes(id)),
    ];
    if (rootDiff.length > 0) warn(`規則 10: 中央樞紐的連線與預期的根不一致（差異：${rootDiff.join('、')}）`);
  }

  // 規則 5: 邊端點對齊（marker-end 已由 parseTree 在解析階段強制檢查並提早失敗，
  // 走到這裡代表所有邊都已經有 marker-end，此處不需要也不可能再測到缺失的情況）。
  const at = (x: number, y: number) =>
    nodes.find(n => Math.abs(n.x - x) < 0.5 && Math.abs(n.y - y) < 0.5);
  const idEdges: Edge[] = [];
  for (const e of edges) {
    const a = at(e.from[0], e.from[1]);
    const b = at(e.to[0], e.to[1]);
    if (!a || !b) { push(`規則 5: 邊端點未對齊任何節點中心 ${JSON.stringify(e)}`); continue; }
    idEdges.push([a.id, b.id]);
  }

  // 規則 6: 無環 + 可達性（data-wip="1" 的節點豁免可達性檢查，讓貢獻者可以先接資料再接線；
  // 這些節點改為列入 warnings，供 PR 摘要顯示「待接線節點」）
  const wip = new Set(
    [...doc.querySelectorAll('g.node[data-wip="1"]')].map(g => g.getAttribute('data-id') ?? ''),
  );
  for (const id of wip) warn(`規則 6(c): 節點 ${id} 為待接線節點（data-wip="1"），尚未加入圖遍歷，請於 PR 摘要留意`);
  const ids = nodes.map(n => n.id);
  const { parents, children } = buildAdjacency(idEdges);
  const cycle = detectCycle(ids, children);
  if (cycle) push(`規則 6: 偵測到環 ${cycle.join(' → ')}`);
  const roots = findRoots(ids, parents).filter(id => !wip.has(id));
  const missing = EXPECTED_ROOTS.filter(r => !roots.includes(r));
  const extra = roots.filter(r => !EXPECTED_ROOTS.includes(r));
  if (missing.length > 0) push(`規則 6: 缺少預期的根 ${missing.join(', ')}`);
  if (extra.length > 0) push(`規則 6: 出現非預期的根（可能是斷線節點）${extra.join(', ')}`);
  if (!cycle) {
    for (const id of unreachableFrom(EXPECTED_ROOTS, ids, children)) {
      if (!wip.has(id)) push(`規則 6: 節點 ${id} 從根不可達`);
    }
  }
  return { errors, warnings };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { errors, warnings } = validate(readFileSync('data/dice-tree.svg', 'utf8'), {
    keywords: JSON.parse(readFileSync('data/keywords.json', 'utf8')),
    iconsDir: 'data/icons',
    dataDir: 'data',
  });
  warnings.forEach(w => console.warn(`⚠️  ${w}`));
  errors.forEach(e => console.error(e));
  console.log(errors.length === 0 ? '✅ 驗證通過' : `❌ ${errors.length} 個問題`);
  process.exit(errors.length === 0 ? 0 : 1);
}
