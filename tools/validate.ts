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
  for (const n of nodes) {
    // 規則 7(a): 節點引用的圖示必須存在於 iconsDir。
    if (!iconHashSet.has(n.icon)) push(`規則 7(a): 節點 ${n.id} 引用的圖示 ${n.icon} 不存在`);
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
  });
  warnings.forEach(w => console.warn(`⚠️  ${w}`));
  errors.forEach(e => console.error(e));
  console.log(errors.length === 0 ? '✅ 驗證通過' : `❌ ${errors.length} 個問題`);
  process.exit(errors.length === 0 ? 0 : 1);
}
