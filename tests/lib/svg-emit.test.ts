import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseNodeBlock, emitNodeBlock, emitEdgeLine, newNodeBlock, setLabelText } from '../../src/lib/svg-emit';
import { loadSvg } from '../../tools/lib/dom';
import { normalizeSvg } from '../../tools/normalize-svg';
import { replaceNode, insertNode } from '../../src/lib/svg-edit';

const svgText = readFileSync('data/dice-tree.svg', 'utf8');

/** 從真實檔案切出全部 239 個 `<g class="node">…</g>` 區塊（跨行的節點要整塊取到 </g>）。 */
function allNodeBlocks(text: string): string[] {
  return [...text.matchAll(/<g class="node"[\s\S]*?<\/g>/g)].map(m => m[0]);
}

describe('svg-emit', () => {
  it('對真實檔案的 239 個節點，parse → emit 後位元組完全相同', () => {
    const blocks = allNodeBlocks(svgText);
    expect(blocks.length).toBe(239);
    const mismatches = blocks.filter(b => emitNodeBlock(parseNodeBlock(b)) !== b);
    // 印出第一個不符的區塊，方便定位是哪個欄位沒被模型涵蓋
    expect(mismatches.slice(0, 1)).toEqual([]);
  });

  it('保留符文標籤的 inline font-size', () => {
    const block = allNodeBlocks(svgText).find(b => b.includes('style="font-size:7px"'))!;
    expect(emitNodeBlock(parseNodeBlock(block))).toContain('style="font-size:7px"');
  });

  it('改名字會同步更新 data-name、<title> 與標籤文字', () => {
    const block = allNodeBlocks(svgText).find(b => b.includes('data-id="1002"'))!;
    const n = parseNodeBlock(block);
    const out = emitNodeBlock({ ...n, name: '新名字', labelXml: setLabelText(n.labelXml, '新名字') });
    expect(out).toContain('data-name="新名字"');
    expect(out).toContain('<title>骰子｜新名字｜');
    expect(out).toContain('>新名字</text>');
  });

  it('屬性值的換行編成 &#10;，<title> 用字面換行', () => {
    const n = newNodeBlock({
      x: 100, y: 200, id: '1099', type: 'passive', typeZh: '玩家被動',
      name: '測試被動', label: '測試', cost: '金幣 8,000', description: '第一行\n第二行',
      maxLevel: 15, stroke: '#ef625e', iconHash: 'a5caff6da1d2',
    });
    const out = emitNodeBlock(n);
    expect(out).toContain('data-description="第一行&#10;第二行"');
    expect(out).toContain('<title>玩家被動｜測試被動｜第一行\n第二行\n最高等級：15</title>');
    expect(out).not.toMatch(/data-description="[^"]*\n/);
  });

  it('產生的邊格式與既有資料一致', () => {
    expect(emitEdgeLine([1700, 1271.53], [1506.53, 1078.06]))
      .toBe('<path class="edge" marker-end="url(#arrow)" d="M 1700.00 1271.53 L 1506.53 1078.06" />');
  });

  it('玩家打進 & 或 < 時，屬性值與元素內容各自逃逸且仍是合法 XML', () => {
    // 現行資料 0 個節點含這類字元，所以 239 節點往返測試涵蓋不到這條；
    // 但 Task 12 起玩家會自由打字，沒逃逸的話整份 SVG 會解析失敗、編輯器當場壞掉。
    const n = newNodeBlock({
      x: 100, y: 200, id: '1099', type: 'dice', typeZh: '骰子',
      name: 'A & B', label: 'A & B', cost: '核心 5',
      description: '傷害 < 100 且 A & B', maxLevel: null,
      stroke: '#ef625e', iconHash: 'a5caff6da1d2',
    });
    const out = emitNodeBlock(n);
    expect(out).toContain('data-name="A &amp; B"');
    expect(out).toContain('data-description="傷害 &lt; 100 且 A &amp; B"');
    expect(out).toContain('<title>骰子｜A &amp; B｜傷害 &lt; 100 且 A &amp; B</title>');
    expect(out).toContain('>A &amp; B</text>');
    // 最終驗收：產出的區塊塞進最小 SVG 後，linkedom 必須解析得動且值還原正確。
    // 屬性值故意用 getAttributeNode(...).value 而不是 getAttribute(...)：實測發現 linkedom
    // 對 SVG／XML 文件（非 ignoreCase 的元素）的 getAttribute() 會把「已經正確解碼」的內部值
    // 再套一次 HTML escape（node_modules/linkedom/esm/interface/element.js 的 getAttribute
    // 實作，這是它自己的怪癖，不是這裡的程式碼有問題），導致讀回來又變成 `A &amp; B`。
    // getAttributeNode().value 讀的是解碼後、還沒被那層多餘 escape 動過的原始內部值。
    const doc = loadSvg(`<svg xmlns="http://www.w3.org/2000/svg">${out}</svg>`);
    const g = doc.querySelector('g.node')!;
    expect(g.getAttributeNode('data-name')!.value).toBe('A & B');
    expect(g.getAttributeNode('data-description')!.value).toBe('傷害 < 100 且 A & B');
    expect(g.querySelector('text')!.textContent).toBe('A & B');
  });

  it('setLabelText 寫入的文字也會逃逸', () => {
    const block = allNodeBlocks(svgText).find(b => b.includes('data-id="1002"'))!;
    const n = parseNodeBlock(block);
    expect(setLabelText(n.labelXml, 'A & B')).toContain('>A &amp; B</text>');
  });

  // ── data-wip 覆蓋缺口補測（現行 239 個真實節點裡 0 個帶 data-wip，主測試完全涵蓋不到這個欄位）──
  // data-wip="1" 是「先佔位、之後再接線」的標記，validate 規則 6 靠它豁免可達性檢查。
  // 若 emitter 沒正確保留它，情境是：貢獻者手動加的 data-wip 節點被編輯器改過一次後，
  // 屬性靜默消失 → 節點從根不可達 → CI 報一個看不懂的錯（跟這個屬性完全無關）。
  describe('data-wip', () => {
    it('帶 data-wip="1" 的區塊 parse → emit 後位元組相同', () => {
      const block = allNodeBlocks(svgText).find(b => b.includes('data-id="1002"'))!;
      // 真實資料裡沒有 data-wip 節點，用既有區塊手動插入這個屬性來構造測試樣本
      // （插入位置遵照簡報規則：接在 data-description 之後、右角括號之前）。
      const withWip = block.replace(/(data-description="[^"]*")/, '$1 data-wip="1"');
      expect(withWip).toContain('data-wip="1"');
      const n = parseNodeBlock(withWip);
      expect(n.wip).toBe(true);
      expect(emitNodeBlock(n)).toBe(withWip);
    });

    it('沒有 data-wip 屬性的區塊，parse 後 wip 為 false，emit 也不會憑空生出這個屬性', () => {
      const block = allNodeBlocks(svgText).find(b => b.includes('data-id="1002"'))!;
      const n = parseNodeBlock(block);
      expect(n.wip).toBe(false);
      expect(emitNodeBlock(n)).not.toContain('data-wip');
    });

    it('newNodeBlock 產生的新節點預設不是 wip（介面沒有開放呼叫端指定）', () => {
      const n = newNodeBlock({
        x: 100, y: 200, id: '1099', type: 'dice', typeZh: '骰子',
        name: '測試骰子', label: '測試', cost: '核心 5', description: '測試描述',
        maxLevel: null, stroke: '#ef625e', iconHash: 'a5caff6da1d2',
      });
      expect(n.wip).toBe(false);
      expect(emitNodeBlock(n)).not.toContain('data-wip');
    });

    // 對抗性輸入回歸測試：escapeXmlContent 依 XML 規範不逃逸 `"`，玩家若在描述裡打出字面
    // `data-wip="1"`，這段文字會原樣進到 <title> 元素內容。若 WIP_RE 對整個區塊做無錨點比對，
    // 會把使用者輸入誤判成真的屬性，讓節點從 validate 規則 6 的可達性檢查被靜默豁免——
    // 公開投稿工具上這是可利用的洞。修法：比對範圍限制在開頭標籤內（見 svg-emit.ts 的說明）。
    it('data-description 含字面 data-wip="1" 文字時，wip 仍是 false（不會被使用者輸入誤判）', () => {
      const block = allNodeBlocks(svgText).find(b => b.includes('data-id="1002"'))!;
      const n = parseNodeBlock(block);
      const spoofed = emitNodeBlock({ ...n, description: '打進去字面 data-wip="1" 測試' });
      // 先確認攻擊字串真的混進了輸出（混進 <title> 元素內容，因為 escapeXmlContent 不逃逸 "），
      // 不然下面 wip===false 的斷言可能只是「根本沒混進去」的假陽性，不是修法真的生效
      expect(spoofed).toContain('data-wip="1"');
      expect(parseNodeBlock(spoofed).wip).toBe(false);
    });

    // 假陰性回歸測試：這支測試守的是「即使 boundary 判定曾經（修法前）依賴『屬性值裡不會有
    // 字面 `>`』這個現在已經不成立的前提，也不該假陰性」——用 `indexOf('>')` 切邊界的寫法會讓
    // 玩家在描述打「傷害 > 100」時把接在後面的真 `data-wip="1"` 屬性排除在掃描範圍外。現在
    // `encodeAttr` 會把屬性值裡的字面 `>` 逃逸成 `&gt;`（Critical fix，見該函式），所以這個
    // 特定輸入已經不會再讓 emitter 自己產生未逃逸的 `>`；但 `parseNodeBlock` 的 boundary 判定
    // 刻意不依賴這個新事實（見該函式裡 wip 那段的說明——防禦性設計，對非本 emitter 產生的
    // 既有／手動編輯資料一樣安全），這支測試留著繼續驗證這個防線本身沒有退化。這支測試跟上面
    // 那支要一起看：一支擋假陽性（使用者輸入被誤判成屬性）、一支擋假陰性（真屬性因使用者輸入
    // 而被漏判）。
    it('data-description 含字面 > 且節點真的有 data-wip="1" 時，wip 仍是 true（不會被使用者輸入誤判成沒有）', () => {
      const block = allNodeBlocks(svgText).find(b => b.includes('data-id="1002"'))!;
      const n = parseNodeBlock(block);
      const real = emitNodeBlock({ ...n, wip: true, description: '傷害 > 100 時觸發' });
      // Critical fix（2026-08-18 全分支審查）之前，這裡斷言的是
      // `data-description="傷害 > 100 時觸發"`（字面 >，未逃逸）——那是把 CI 會擋下的非定點
      // 輸出寫進了測試期望值，等於把 emitter 的 bug 固化進測試（見任務報告）。encodeAttr 現在
      // 會把屬性值裡的 `>` 逃逸成 `&gt;`（linkedom 序列化器本來就會轉這個字元，見 svg-emit.ts
      // 檔頭關於 normalizeSvg 定點的說明），這裡改成斷言正確逃逸後的字串；下面 wip===true
      // 的斷言驗的是「即使描述裡原本會產生 `>` 的來源文字，boundary 判定仍不受影響」這件事，
      // 跟 escapeXmlContent 有沒有逃逸 `>` 是兩個獨立的關注點（見 parseNodeBlock 裡 wip 判定
      // 那段的更新後說明）。
      expect(real).toContain('data-description="傷害 &gt; 100 時觸發"');
      expect(parseNodeBlock(real).wip).toBe(true);
    });
  });
});

/**
 * Critical fix 的核心不變量（2026-08-18 全分支審查）：CI 的守門條件不是「輸出是合法 XML」，
 * 是 `normalizeSvg(檔案) === 檔案`（`.github/workflows/ci.yml` 的「正規化定點檢查」）。
 * 上面逐字元列舉的測試（`> ` `< ` `&` 等）驗證的是「這幾個具體字元」有沒有被正確逃逸，但字元
 * 清單本身會漂移——linkedom 換版本、normalizeSvg 的後處理邏輯調整，都可能讓「目前列出的這幾個
 * 字元」不再是完整清單。真正該斷言、也更不容易隨字元清單漂移而失去鑑別力的，是這個不變量本身：
 *
 *   對任意玩家文字 t，把 t 放進節點的 name／description／label 之後產生的檔案，
 *   必須是 normalizeSvg 的定點。
 *
 * 這支測試如果早存在，Critical bug（encodeAttr／escapeXmlContent 漏轉 `>`／U+00A0／`\r`）
 * 在最初實作 emitter 的那個任務就會被抓到，不必等到全分支審查才發現。
 */
describe('emitter 輸出必須是 normalizeSvg 的定點（property test）', () => {
  const n = parseNodeBlock(allNodeBlocks(svgText).find(b => b.includes('data-id="1002"'))!);

  // 對抗性樣本：涵蓋 Critical bug 實測抓到的落差字元（`>`／U+00A0／`\r`），既有已知會逃逸的
  // 字元（`<`／`&`／`"`／`'`／`\n`），可能撞到 normalizeSvg 內部狀態機（見 tools/normalize-svg.ts
  // 的 encodeAttributeNewlines）的結構性子字串（`]]>`／`-->`／`?>`），會提前結束 <title>／<text>
  // 元素的字面標籤（`</title>`），astral 字元（emoji，surrogate pair），以及「解碼不能二次處理」
  // 的字面實體字串（`&#10;`／`&gt;`——這兩個是使用者真的打了這幾個字元，不是實體，見
  // svg-emit.ts 的 decodeAttr 說明）。
  const ADVERSARIAL_INPUTS: string[] = [
    '>', '<', '&', '"', "'", '\r', '\n', '\t', ' ',
    ']]>', '-->', '?>', '</title>',
    '🔥', // emoji（astral 字元，UTF-16 下是 surrogate pair）
    '&#10;', // 字面的實體字串（不是真的換行）——測 decodeAttr 不會把它二次解碼成換行
    '&gt;',  // 字面的 &gt; 字串——測不會被二次解碼成 >
  ];

  it.each(ADVERSARIAL_INPUTS)('玩家文字含 %j 時，替換既有節點後的檔案是 normalizeSvg 的定點', t => {
    const nextBlock = emitNodeBlock({
      ...n, name: t, description: t, labelXml: setLabelText(n.labelXml, t),
    });
    const out = replaceNode(svgText, '1002', nextBlock);
    expect(normalizeSvg(out)).toBe(out);
  });

  it.each(ADVERSARIAL_INPUTS)('玩家文字含 %j 時，parseNodeBlock(emitNodeBlock(...)) 能還原出同一段文字（encodeAttr／decodeAttr 互為反函式）', t => {
    const nextBlock = emitNodeBlock({ ...n, name: t, description: t });
    const roundTripped = parseNodeBlock(nextBlock);
    expect(roundTripped.name).toBe(t);
    expect(roundTripped.description).toBe(t);
  });

  it('複合案例：newNodeBlock 建出的全新節點，name／label／description 同時混合全部對抗性字元，仍是 normalizeSvg 的定點', () => {
    const combined = ADVERSARIAL_INPUTS.join(' / ');
    const block = newNodeBlock({
      x: 100, y: 200, id: '9999', type: 'dice', typeZh: '骰子',
      name: combined, label: combined, cost: '核心 5',
      description: combined, maxLevel: null,
      stroke: '#ef625e', iconHash: 'a5caff6da1d2',
    });
    const out = insertNode(svgText, emitNodeBlock(block));
    expect(normalizeSvg(out)).toBe(out);
  });
});
