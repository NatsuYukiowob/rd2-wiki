import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import sharp from 'sharp';
import { parseTree, COORD_TOLERANCE } from './lib/svg-parse.js';
import { buildSprite, buildHiRes, type IconEntry } from './lib/icons.js';
import { parseCost } from '../src/lib/cost.js';
import { parseGrowth } from '../src/lib/growth.js';
import { extractKeywords } from '../src/lib/keywords.js';
import { branchOfId, categoryOfZh, elementOfStroke, typeOfZh } from '../src/lib/taxonomy.js';
import { buildAdjacency, findRoots } from '../src/lib/graph.js';
import { isGlossaryAlias } from '../src/lib/types.js';
import type { Branch, Edge, GlossaryDisplay, GlossaryRecord, TreeData, TreeNode, UnlockVia, UpgradeCostTable } from '../src/lib/types.js';

interface BuildOpts {
  /** `data/keywords.json` 的內容：key ＝不含 `#` 的詞，同時是規則 8 的白名單與玩家看的解釋。 */
  keywords: Record<string, GlossaryRecord>;
  unlockExceptions: Record<string, { unlockVia: UnlockVia; note?: string }>;
  /**
   * `data/upgrade-cost.json`；沒有這份資料時傳 `null`。
   *
   * 跟 `ValidateOpts` 同款刻意必填：可選的話，呼叫端漏傳只會讓 `meta.upgradeCostTable`
   * 變成 null、全站的「練滿累計」那一列安靜消失，而型別檢查與測試都不會有任何反應。
   * 更糟的是效能預算——`tests/tools/build-data.test.ts` 的 20 KB 斷言量的是它自己組出來的
   * 產物，漏傳等於少量 292 B，測試綠燈而 CLI 實際寫出的檔案已經超標。
   */
  upgradeCostTable: UpgradeCostTable | null;
  spriteIndex: Record<string, [number, number, number, number]>;
  /** sprite.webp 的實際像素尺寸 [寬, 高]，直接寫進 meta.sprite.size 供渲染時的 <image> width/height 使用。 */
  spriteSize: [number, number];
}

export function buildTreeData(svgText: string, opts: BuildOpts): TreeData {
  const { meta: rawMeta, nodes: rawNodes, edges: rawEdges } = parseTree(svgText);
  const whitelist = Object.keys(opts.keywords);
  // rawMeta.center 是「正本裡怎麼寫」的形狀（帶 PNG 檔名），meta.center 是「站台要怎麼畫」的形狀
  // （帶 WebP 網址），欄位名同、內容不同，所以先把它從展開的 rawMeta 裡拆出來，避免覆蓋。
  const { center: rawCenter, ...restMeta } = rawMeta;

  const nodes: TreeNode[] = rawNodes.map(r => {
    const type = typeOfZh(r.typeZh);
    const branch = branchOfId(r.id);
    const { cost, maxLevel } = parseCost(r.costRaw);
    const { growth, dataIssue } = parseGrowth(r.description);
    const level = maxLevel ?? r.titleMaxLevel ?? 1;
    return {
      id: r.id, branch, element: elementOfStroke(r.stroke), type,
      name: r.name, label: r.label,
      shape: r.shape, size: r.size, x: r.x, y: r.y,
      unlockCost: cost,
      unlockVia: opts.unlockExceptions[r.id]?.unlockVia ?? 'cost',
      // 取得條件原文只有例外節點才有（目前 9 個），照 wip／category 的作法「為真才放欄位」，
      // 其餘 230 個節點完全不佔 tree.json 的 gzip 預算。
      ...(opts.unlockExceptions[r.id]?.note ? { unlockNote: opts.unlockExceptions[r.id]!.note! } : {}),
      maxLevel: level,
      prereqMode: null, upgradeCost: null,
      description: r.description,
      // 覺醒只有骰子有；其餘節點的 data-awakening 必須是空的（規則 14），空字串不進 tree.json。
      ...(r.awakening ? { awakening: r.awakening } : {}),
      ...(r.categoryZh ? { category: categoryOfZh(r.categoryZh) } : {}),
      // ⚠️ data-game-id 刻意**不進 tree.json**：它是給貢獻者比對遊戲資源檔的，站台一個字都不
      // 顯示，而 239 個節點各帶一個字串要吃掉 0.55 KB gzip——那是目前預算餘裕的一半。
      // 需要查管理 ID 的人看的是正本，不是這份建置產物。
      keywords: extractKeywords(r.description, whitelist),
      growth,
      dataIssue: dataIssue ?? (level > 1 && !growth ? 'no-growth' : null),
      icon: r.icon,
      // 只在為真時才放欄位：現況 0 個 wip 節點，等於完全不佔 tree.json 的 gzip 預算。
      ...(r.wip ? { wip: true as const } : {}),
    };
  });

  // 容差跟 validate 共用同一個常數：兩邊各寫一份 0.5 的話，一旦漂開就會出現
  // 「validate 認為這條邊接到 A、build-data 認為接到 B」這種兩邊都不報錯的裂縫。
  const at = (x: number, y: number) => nodes.find(n => Math.abs(n.x - x) < COORD_TOLERANCE && Math.abs(n.y - y) < COORD_TOLERANCE);
  const edges: Edge[] = rawEdges.map(e => {
    const a = at(e.from[0], e.from[1]);
    const b = at(e.to[0], e.to[1]);
    if (!a || !b) throw new Error(`邊端點未對齊節點中心：${JSON.stringify(e)}`);
    return [a.id, b.id] as Edge;
  });

  // wip 節點（data-wip="1"＝先佔位、還沒接線）依規則 6(d) 完全不接線，所以在圖上必然是孤點。
  // 不把它們排除的話，findRoots 會把每一顆都當成「根」報出去，站台就會多畫幾條不存在的起手分支。
  const wipIds = new Set(rawNodes.filter(r => r.wip).map(r => r.id));
  const { parents } = buildAdjacency(edges);
  const roots = findRoots(nodes.map(n => n.id), parents).filter(id => !wipIds.has(id)).sort();

  // meta.totalUnlockCost 是「SVG 成本總和」，刻意不排除 unlockVia !== 'cost' 的節點：
  // spec §2.1 說明此總和本來就不等於玩家實際支出（任務／預設解鎖節點另有例外標註），
  // 與前置鏈計算（graph.ts 的 sumUnlockCost，會排除非 cost 節點）用途不同，不可混用。
  //
  // 但 wip 節點要排除：它們的語意是「這顆之後才會接進樹裡」，還沒接線就先把成本算進「全樹解鎖
  // 成本」，等於讓一個佔位節點去動首頁上那個數字。目前正本沒有 wip 節點，所以這條不改變現值。
  const totalUnlockCost = nodes.filter(n => !wipIds.has(n.id)).reduce(
    (acc, n) => ({ core: acc.core + n.unlockCost.core, gold: acc.gold + n.unlockCost.gold }),
    { core: 0, gold: 0 }
  );

  const bounds = {} as Record<Branch, [number, number, number, number]>;
  for (const b of ['nature', 'engineering', 'magic', 'order', 'chaos'] as Branch[]) {
    const sub = nodes.filter(n => n.branch === b);
    const xs = sub.map(n => n.x), ys = sub.map(n => n.y);
    bounds[b] = [Math.min(...xs) - 60, Math.min(...ys) - 60,
      Math.max(...xs) - Math.min(...xs) + 120, Math.max(...ys) - Math.min(...ys) + 120];
  }

  // 樞紐的放射線是寫在正本裡的 id 清單，不是從幾何推回來的——這裡當場檢查它們真的存在。
  // 站台端拿到不存在的 id 只會安靜地少畫一條線，等於樞紐悄悄斷了一隻腳；建置期擋掉才看得見。
  const nodeIds = new Set(nodes.map(n => n.id));
  for (const id of rawCenter?.links ?? []) {
    if (!nodeIds.has(id)) throw new Error(`tree-center 的 data-links 指向不存在的節點 ${id}`);
  }
  const center = rawCenter && {
    x: rawCenter.x,
    y: rawCenter.y,
    size: rawCenter.size,
    // 正本存的是 data/ 底下的 PNG 檔名，站台載的是建置期轉出的 WebP（見下方 CLI 區塊）。
    url: `/assets/${rawCenter.image.replace(/\.png$/, '.webp')}`,
    links: rawCenter.links,
    label: rawCenter.label,
    labelDy: rawCenter.labelDy,
  };

  // meta.glossary 只裝「站台真的會顯示到」的詞條：節點描述用到的詞，再加上這些詞的解釋文字
  // 自己又引用到的詞（例如 #破滅 的解釋裡寫著 #一般怪物、#菁英怪物）。少了這一層傳遞閉包，
  // 面板會出現「解釋裡的 # 標記查不到東西」的破洞；多放整份 62 條則是白白吃 gzip 預算。
  const glossary: Record<string, GlossaryDisplay> = {};
  // 覺醒文字也顯示在面板上、也帶 `#` 標記（#播種／#傳送 就只出現在覺醒裡），所以一起當種子。
  const pending = [
    ...new Set(nodes.flatMap(n => [...n.keywords, ...extractKeywords(n.awakening ?? '', whitelist)])),
  ];
  while (pending.length > 0) {
    const term = pending.pop()!;
    if (glossary[term]) continue;
    const record = opts.keywords[term];
    // extractKeywords 只會吐出白名單裡的詞，所以這裡取不到值代表 whitelist 與 opts.keywords
    // 已經不是同一份資料了——那是程式錯誤，不是資料錯誤，寧可當場炸掉也不要送出半份詞彙表。
    if (!record) throw new Error(`詞彙表缺少節點用到的詞: ${term}`);
    // 別名不自己帶解釋，展開成本尊那一份（規則 8(b) 保證指得到、而且不會再指向另一個別名）。
    const entry = isGlossaryAlias(record) ? opts.keywords[record.aliasOf] : record;
    if (!entry || isGlossaryAlias(entry)) throw new Error(`詞彙 ${term} 的 aliasOf 指不到本尊`);
    glossary[term] = { color: entry.color, desc: entry.desc };
    pending.push(...extractKeywords(entry.desc, whitelist));
  }

  return {
    meta: {
      ...restMeta, roots, bounds,
      totalUnlockCost,
      // key 排序後才寫進去：Object 的插入順序會跟著上面那個 while 迴圈的堆疊順序跑，
      // 資料沒變、diff 卻整段翻掉，規則 11 的差異摘要會誤報。
      glossary: Object.fromEntries(Object.keys(glossary).sort().map(k => [k, glossary[k]!])),
      // 只帶 appliesTo 與 levels：資料檔裡的 note／source 是寫給貢獻者看的，
      // 整段抄進 tree.json 等於每個訪客都下載一次那兩句話。
      upgradeCostTable: opts.upgradeCostTable
        ? { appliesTo: opts.upgradeCostTable.appliesTo, levels: opts.upgradeCostTable.levels }
        : null,
      sprite: { url: '/assets/sprite.webp', size: opts.spriteSize, index: opts.spriteIndex },
      center: center ?? null,
    },
    nodes, edges,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const svgText = readFileSync('data/dice-tree.svg', 'utf8');
  const keywords = JSON.parse(readFileSync('data/keywords.json', 'utf8'));
  const unlockExceptions = JSON.parse(readFileSync('data/unlock-exceptions.json', 'utf8'));
  const upgradeCostTable = JSON.parse(readFileSync('data/upgrade-cost.json', 'utf8'));

  const { meta: rawMeta, nodes: rawNodes } = parseTree(svgText);
  // 圖示的打包格子尺寸＝引用它的節點的顯示尺寸。同一張圖被多個節點共用時，尺寸必然相同
  // （圖是逐節點渲染出來的，位元組一樣就代表像素尺寸一樣），所以取第一個引用者即可；
  // src/lib/render.ts 另有一道主動檢查，真的出現一圖多尺寸會當場丟錯而不是悄悄裁錯。
  const sizeByHash = new Map(rawNodes.map(n => [n.icon, n.size]));
  // 沒有任何節點引用的圖示直接不打包。規則 7(d) 只警告不擋，所以這種檔案是可以合法存在的，
  // 但為它挑一個「誰都沒用到的尺寸」當 fallback 只會讓 buildSprite 憑空多開一個 16 欄的分區，
  // 換來一張沒有人會顯示的圖（code review 指出；先前的 fallback 是 [48, 52]，那個尺寸現在
  // 連一個節點都不是）。真正需要它的那天，會有節點引用它、也就會有尺寸。
  const entries: IconEntry[] = readdirSync('data/icons')
    .filter(f => f.endsWith('.png'))
    .flatMap(f => {
      const hash = f.replace('.png', '');
      const size = sizeByHash.get(hash);
      return size ? [{ hash, buf: readFileSync(`data/icons/${f}`), size }] : [];
    });

  const { sprite, index, size } = await buildSprite(entries);
  const hiRes = await buildHiRes(entries);

  mkdirSync('public/assets/icons', { recursive: true });
  mkdirSync('src/generated', { recursive: true });
  writeFileSync('public/assets/sprite.webp', sprite);
  // 中央樞紐圖：正本存 PNG（可讀、可 diff、跟 data/icons 一致），站台載 WebP。它只有一張、
  // 尺寸固定，沒有理由塞進 sprite（sprite 依「節點類型的顯示尺寸」分區打包，樞紐不屬於任何類型）。
  // 這裡輸出兩倍顯示尺寸，跟 buildHiRes() 的高 DPI 原則一致。
  //
  // 讀檔路徑與輸出檔名都從 rawMeta.center.image 推導，不另外寫死一份檔名——buildTreeData() 裡
  // 的 meta.center.url 是用同一個字串換副檔名組出來的，兩邊各寫一份的話，改了正本的 href 就會
  // 變成「轉出舊圖、tree.json 指向新網址」，樞紐靜靜地變成 404 破圖而所有檢查照樣全綠。
  const center = rawMeta.center;
  if (center) {
    writeFileSync(
      `public/assets/${center.image.replace(/\.png$/, '.webp')}`,
      await sharp(`data/${center.image}`)
        .resize({ width: center.size[0] * 2, height: center.size[1] * 2, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 90 })
        .toBuffer()
    );
  }
  for (const [hash, buf] of hiRes) writeFileSync(`public/assets/icons/${hash}.webp`, buf);

  const data = buildTreeData(svgText, { keywords, unlockExceptions, upgradeCostTable, spriteIndex: index, spriteSize: size });
  const json = JSON.stringify(data);
  writeFileSync('src/generated/tree.json', json);

  console.log(`tree.json ${(Buffer.byteLength(json) / 1024).toFixed(1)} KB, sprite ${(sprite.length / 1024).toFixed(0)} KB`);

  // spec §11 效能預算：正式產物（真實 sprite index，不是測試用的替身資料）
  // 必須量 CLI 實際寫出的 tree.json 與 sprite.webp，測試套件裡的 spriteIndex 是 202 筆全同值
  // [0,0,48,52] 的替身，壓縮率會偏樂觀，量不出真正的邊際。
  //
  // 兩項預算都印出「用了多少 / 預算多少 / 還剩多少」而非只在超標時才報錯：實測值離門檻只有
  // 個位數 KB 的餘裕（tree.json 約 2–3 KB、sprite 約 300 KB），遊戲改版加一整個新分支就可能
  // 一口氣吃掉大半餘裕，提前印出來才有機會在真的撞線前注意到，而不是等紅燈才發現。
  const GZIP_BUDGET_BYTES = 20 * 1024;
  const SPRITE_BUDGET_BYTES = 400 * 1024;
  const gzipBytes = gzipSync(Buffer.from(json)).length;
  const gzipMarginBytes = GZIP_BUDGET_BYTES - gzipBytes;
  const spriteMarginBytes = SPRITE_BUDGET_BYTES - sprite.length;
  console.log(
    `tree.json gzip ${(gzipBytes / 1024).toFixed(1)} KB / ${(GZIP_BUDGET_BYTES / 1024).toFixed(0)} KB，餘裕 ${(gzipMarginBytes / 1024).toFixed(1)} KB`
  );
  console.log(
    `sprite.webp ${(sprite.length / 1024).toFixed(1)} KB / ${(SPRITE_BUDGET_BYTES / 1024).toFixed(0)} KB，餘裕 ${(spriteMarginBytes / 1024).toFixed(1)} KB`
  );
  let budgetExceeded = false;
  if (gzipBytes > GZIP_BUDGET_BYTES) {
    console.error(
      `❌ tree.json gzip 後 ${(gzipBytes / 1024).toFixed(1)} KB 超過效能預算 ${(GZIP_BUDGET_BYTES / 1024).toFixed(0)} KB`
    );
    budgetExceeded = true;
  }
  if (sprite.length > SPRITE_BUDGET_BYTES) {
    console.error(
      `❌ sprite.webp ${(sprite.length / 1024).toFixed(1)} KB 超過效能預算 ${(SPRITE_BUDGET_BYTES / 1024).toFixed(0)} KB`
    );
    budgetExceeded = true;
  }
  if (budgetExceeded) process.exit(1);
}
