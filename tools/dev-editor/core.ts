/**
 * 本機 dev-only 文字編輯器的純邏輯層（沒有 I/O，vitest 直接測）。
 *
 * 流程：瀏覽器點到一段字 → 用那段字去兩個地方找來源——`data/*.json` 的字串值、`src/` 原始碼裡
 * 寫死的字——列出候選讓人挑一個改。存檔只換掉「那一個字串／那一段原始碼」，不重新序列化整份檔：
 * `JSON.stringify` 整檔重寫會把 diff 放大成整檔的縮排與陣列換行差異。
 */

export type JsonPath = (string | number)[];

export interface JsonStringHit {
  path: JsonPath;
  /** 字串字面值（含兩側引號）在原文裡的位置。 */
  start: number;
  end: number;
  value: string;
}

/** 掃出 JSON 原文裡每一個「值」位置的字串（不含物件鍵），附上它的路徑與原文位置。 */
export function scanJsonStrings(text: string): JsonStringHit[] {
  const out: JsonStringHit[] = [];
  const literal = /-?\d[\d.eE+-]*|true|false|null/y;
  let i = 0;

  const fail = (what: string): never => {
    throw new Error(`JSON 解析失敗：位置 ${i} 預期 ${what}`);
  };
  const ws = () => {
    while (i < text.length && ' \t\r\n'.includes(text[i]!)) i++;
  };
  const expect = (c: string) => {
    ws();
    if (text[i] !== c) fail(c);
    i++;
  };
  const str = (): [string, number, number] => {
    ws();
    if (text[i] !== '"') fail('字串');
    const start = i++;
    while (text[i] !== '"') {
      if (i >= text.length) fail('字串結尾');
      if (text[i] === '\\') i++;
      i++;
    }
    i++;
    return [JSON.parse(text.slice(start, i)) as string, start, i];
  };
  const value = (path: JsonPath): void => {
    ws();
    const c = text[i];
    if (c === '{') {
      i++;
      ws();
      if (text[i] === '}') { i++; return; }
      for (;;) {
        const [key] = str();
        expect(':');
        value([...path, key]);
        ws();
        if (text[i] === ',') { i++; continue; }
        expect('}');
        return;
      }
    }
    if (c === '[') {
      i++;
      ws();
      if (text[i] === ']') { i++; return; }
      for (let n = 0; ; n++) {
        value([...path, n]);
        ws();
        if (text[i] === ',') { i++; continue; }
        expect(']');
        return;
      }
    }
    if (c === '"') {
      const [v, start, end] = str();
      out.push({ path, start, end, value: v });
      return;
    }
    literal.lastIndex = i;
    if (!literal.test(text)) fail('值');
    i = literal.lastIndex;
  };

  value([]);
  ws();
  if (i !== text.length) fail('檔案結尾');
  return out;
}

export class EditConflict extends Error {}

const samePath = (a: JsonPath, b: JsonPath) => a.length === b.length && a.every((s, k) => s === b[k]);

/**
 * 把 `path` 上的字串換成 `next`。`expected` 是點開時看到的舊值——對不上代表檔案在這之間被改過
 * （另一個分頁、git checkout、手動編輯），丟 `EditConflict` 而不是蓋掉別人的改動。
 */
export function replaceJsonString(text: string, path: JsonPath, expected: string, next: string): string {
  const hit = scanJsonStrings(text).find(h => samePath(h.path, path));
  if (!hit) throw new EditConflict(`找不到路徑 ${path.join(' › ')}`);
  if (hit.value !== expected) throw new EditConflict('這個欄位在點開之後被改過，請重新點一次');
  return text.slice(0, hit.start) + JSON.stringify(next) + text.slice(hit.end);
}

/** 原始碼的一段：直接以原文位置取代。同樣先比對舊內容。 */
export function replaceSpan(text: string, start: number, end: number, expected: string, next: string): string {
  if (text.slice(start, end) !== expected) throw new EditConflict('原始碼在點開之後被改過，請重新點一次');
  return text.slice(0, start) + next + text.slice(end);
}

/**
 * 路徑轉成人看得懂的標籤：陣列元素若是帶 `id`／`name` 的物件就用它代替索引
 * （`events.json › [chuseok-2026] › screenshots › [0] › caption`）。
 */
export function labelPath(root: unknown, path: JsonPath): string {
  const parts: string[] = [];
  let cur: unknown = root;
  for (const seg of path) {
    const next = (cur as Record<string | number, unknown> | undefined)?.[seg];
    if (typeof seg === 'number') {
      const o = next as { id?: unknown; name?: unknown } | undefined;
      const tag = o && typeof o === 'object' ? (o.id ?? o.name) : undefined;
      parts.push(typeof tag === 'string' || typeof tag === 'number' ? `[${tag}]` : `[${seg}]`);
    } else {
      parts.push(seg);
    }
    cur = next;
  }
  return parts.join(' › ');
}

/**
 * 把註解換成等長空白（換行保留，位置不變），避免在註解裡搜到同一句話。
 * 規則刻意粗略：`<!-- -->`、`/* *\/`、行首或空白後的 `//`（`https://` 前面是冒號，不會誤判）。
 */
export function maskComments(src: string): string {
  const blank = (s: string) => s.replace(/[^\n]/g, ' ');
  return src.replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\/|(^|[ \t])\/\/[^\n]*/gm, (m, lead: string | undefined) =>
    lead !== undefined ? lead + blank(m.slice(lead.length)) : blank(m));
}

/**
 * 查詢字串 → regex：空白一律當成「任意空白」，原始碼的縮排換行與畫面上的一個空格就對得上；
 * 數字另外也對得上一段 `{…}` 插值（畫面上的 `41` 在 `.astro` 裡是 `{nodes.length}`）。
 */
export function queryRegex(q: string): RegExp {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const part = (p: string) =>
    p.split(/(\d+(?:[.,]\d+)*)/).map((s, k) => (k % 2 ? `(?:${esc(s)}|\\{[^{}\\n]*\\})` : esc(s))).join('');
  return new RegExp(q.trim().split(/\s+/).map(part).join('\\s+'), 'g');
}

/**
 * 畫面上一個文字節點常是「寫死的字＋插值」拼起來的（`{nodes.length} 顆骰子的完整資料…`）
 * 或被換行切開。整段搜不到時，依序改用各行、以及被數字切開的片段（長的先）。
 */
export function candidateQueries(text: string): string[] {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  const full = norm(text);
  const segs = text
    .split(/\n|\d+(?:[.,]\d+)*/)
    .map(norm)
    .filter(s => s.length >= 2)
    .sort((a, b) => b.length - a.length);
  return [...new Set([full, ...segs])].filter(Boolean);
}

export interface SourceHit {
  file: string;
  start: number;
  end: number;
  line: number;
  value: string;
}

export function searchSource(files: { file: string; text: string }[], q: string, limit = 50): SourceHit[] {
  const re = queryRegex(q);
  const hits: SourceHit[] = [];
  for (const { file, text } of files) {
    const masked = maskComments(text);
    re.lastIndex = 0;
    for (let m; (m = re.exec(masked)); ) {
      const start = m.index;
      const end = start + m[0].length;
      hits.push({ file, start, end, line: text.slice(0, start).split('\n').length, value: text.slice(start, end) });
      if (hits.length >= limit) return hits;
    }
  }
  return hits;
}

export function searchJson(hits: JsonStringHit[], q: string): JsonStringHit[] {
  const re = queryRegex(q);
  return hits.filter(h => {
    re.lastIndex = 0;
    return re.test(h.value);
  });
}

/** 點到的元素所在的檔案排最前面，同檔依與 `data-astro-source-loc` 的行距排序。 */
export function rankSourceHits(hits: SourceHit[], file?: string, line?: number): SourceHit[] {
  const score = (h: SourceHit) =>
    (h.file === file ? 0 : 1e9) + (h.file === file && line !== undefined ? Math.abs(h.line - line) : 0);
  return [...hits].sort((a, b) => score(a) - score(b));
}

/** 資料候選：值與查詢完全相同的排最前面，其餘短的先（越短越可能就是畫面上那一段本身）。 */
export function rankJsonHits<T extends { value: string }>(hits: T[], q: string): T[] {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  const nq = norm(q);
  const score = (h: T) => (norm(h.value) === nq ? 0 : 1e6) + h.value.length;
  return [...hits].sort((a, b) => score(a) - score(b));
}
