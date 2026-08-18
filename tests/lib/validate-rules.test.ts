import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { validateWith, type IconSource } from '../../src/lib/validate-rules';
import { validate } from '../../tools/validate';
import { loadSvg } from '../../tools/lib/dom';
import { parseNodeBlock, emitNodeBlock, setLabelText } from '../../src/lib/svg-emit';

function iconSourceFromDisk(): IconSource {
  const known = new Set<string>();
  const toVerify = new Map<string, { bytes: Uint8Array; actualHash: string }>();
  for (const f of readdirSync('data/icons').filter(n => n.endsWith('.png'))) {
    const hash = f.slice(0, -4);
    const bytes = readFileSync(`data/icons/${f}`);
    known.add(hash);
    toVerify.set(hash, { bytes, actualHash: createHash('sha256').update(bytes).digest('hex').slice(0, 12) });
  }
  return { known, toVerify };
}

const svgText = readFileSync('data/dice-tree.svg', 'utf8');
const keywords = JSON.parse(readFileSync('data/keywords.json', 'utf8')) as string[];

describe('validateWith', () => {
  it('對真實資料的結果與既有 tools/validate 完全一致', () => {
    const a = validate(svgText, { keywords, iconsDir: 'data/icons' });
    const b = validateWith(svgText, { keywords, icons: iconSourceFromDisk() }, loadSvg);
    expect(b.errors).toEqual(a.errors);
    expect(b.warnings.sort()).toEqual(a.warnings.sort());
    expect(b.errors).toEqual([]);
  });

  it('抓得到圖示檔名與內容雜湊不符（規則 7b）', () => {
    const icons = iconSourceFromDisk();
    const [first] = [...icons.toVerify.keys()];
    icons.toVerify.set(first!, { bytes: icons.toVerify.get(first!)!.bytes, actualHash: '000000000000' });
    const r = validateWith(svgText, { keywords, icons }, loadSvg);
    expect(r.errors.some(e => e.includes('規則 7(b)'))).toBe(true);
  });

  it('只驗新增圖示時（toVerify 為子集），既有圖示仍不會被誤報為不存在', () => {
    const full = iconSourceFromDisk();
    const partial = { known: full.known, toVerify: new Map() };
    const r = validateWith(svgText, { keywords, icons: partial }, loadSvg);
    expect(r.errors).toEqual([]);
  });

  it('玩家打進 & 之後整條管線仍然通過（不只是解析對，validate 規則 1 也不能誤報）', () => {
    // 這支測試把 Task 6（svg-emit 的 escapeXmlContent）跟 Task 1 的 getAttributeNode 修正
    // 接在一起驗證。若少了任一邊都會炸：
    // - 沒有 escapeXmlContent：emitNodeBlock 產生的 <title>/<text> 含未逃逸的 &，不合法 XML。
    // - escapeXmlContent 做對了，但 parseTreeWith 還在用 getAttribute：<title> 的 textContent
    //   （linkedom 對元素內容正確解碼 &amp; → &）會被拿去跟 data-name 的 getAttribute（linkedom
    //   對屬性值的具名實體不解碼，讀回來仍是 "A &amp; B"）比對，規則 1 判定兩者不一致，
    //   PR 會被一個看起來「兩個字串明明一樣」的錯誤訊息擋下。
    const block = [...svgText.matchAll(/<g class="node"[\s\S]*?<\/g>/g)]
      .map(m => m[0]).find(b => b.includes('data-id="1002"'))!;
    const n = parseNodeBlock(block);
    const edited = emitNodeBlock({ ...n, name: 'A & B', labelXml: setLabelText(n.labelXml, 'A & B') });
    const modifiedSvg = svgText.replace(block, edited);
    const r = validateWith(modifiedSvg, { keywords, icons: iconSourceFromDisk() }, loadSvg);
    expect(r.errors).toEqual([]);
  });

});

// 註：「validate-rules.ts 不得依賴 Node 專屬模組」不在這裡重複斷言——
// Task 3 建立的 tests/lib/src-browser-safe.test.ts 已經掃描整個 src/lib/ 目錄，
// 這個檔案一搬進去就自動被涵蓋。
