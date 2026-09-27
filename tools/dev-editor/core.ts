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
 * 會追蹤字串字面值（`'…'`／`"…"` 到行尾為止、`` `…` `` 可跨行），字串裡的 `/*`、`//` 不當註解。
 * `/*` 與 `//` 另外要求前面是行首、空白或 `{`：`.astro` 模板文字裡的 `https://`、`src/*.json` 不在字串裡。
 * 模板文字裡的撇號（英文 don't）會被當成字串開頭——那只會讓那一行的註解沒遮到（多搜到幾筆），
 * 不會把真的字藏起來，方向是安全的；而且單雙引號字串在換行處就結束，不會外溢。
 */
export function maskComments(src: string): string {
  const out = src.split('');
  const blank = (from: number, to: number) => { for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' '; };
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i]!;
    if (c === '\'' || c === '"' || c === '`') {
      let j = i + 1;
      while (j < n && src[j] !== c && (c === '`' || src[j] !== '\n')) j += src[j] === '\\' ? 2 : 1;
      i = j + 1;
      continue;
    }
    if (src.startsWith('<!--', i)) {
      const e = src.indexOf('-->', i + 4);
      const to = e === -1 ? n : e + 3;
      blank(i, to);
      i = to;
      continue;
    }
    const lead = i === 0 || /[\s{]/.test(src[i - 1]!);
    if (lead && src.startsWith('/*', i)) {
      const e = src.indexOf('*/', i + 2);
      const to = e === -1 ? n : e + 2;
      blank(i, to);
      i = to;
      continue;
    }
    if (lead && src.startsWith('//', i)) {
      const e = src.indexOf('\n', i);
      const to = e === -1 ? n : e;
      blank(i, to);
      i = to;
      continue;
    }
    i++;
  }
  return out.join('');
}

/** 空白正規化：畫面文字、查詢框與「完全相同」的比對都用這一份。 */
export const normSpace = (s: string) => s.replace(/\s+/g, ' ').trim();

/** 存這個檔之後 server 會不會重跑 build:data（client 顯示「約數秒」用同一份判準）。 */
export const rebuildsAfterSave = (file: string) => /^(data\/.*\.json|src\/lib\/)/.test(file);

/**
 * 查詢字串 → regex：空白一律當成「任意空白」，原始碼的縮排換行與畫面上的一個空格就對得上；
 * 數字另外也對得上一段 `{…}` 插值（畫面上的 `N` 在 `.astro` 裡是 `{nodes.length}`）。
 */
export function queryRegex(q: string): RegExp {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 查詢只有數字時不開 `{…}` 這條路：否則「7」會對上每一個檔裡的 `{ core, gold }` 之類的程式碼。
  const onlyNumbers = !/[^\d.,\s]/.test(q);
  // 數字前後加邊界：否則「攻擊力 15」會停在「攻擊力 150」的 0 前面，改成 20 就寫出 200。
  const num = (s: string) => `(?<![\\d.,])${esc(s)}(?!\\d|[.,]\\d)`;
  const part = (p: string) =>
    p.split(/(\d+(?:[.,]\d+)*)/).map((s, k) => (k % 2 ? (onlyNumbers ? num(s) : `(?:${num(s)}|\\{[^{}\\n]*\\})`) : esc(s))).join('');
  return new RegExp(q.trim().split(/\s+/).map(part).join('\\s+'), 'g');
}

/**
 * 畫面上一個文字節點常是「寫死的字＋插值」拼起來的（`{nodes.length} 顆骰子的完整資料…`）
 * 或被換行切開。整段搜不到時，依序改用各行、以及被數字切開的片段（長的先）。
 */
export function candidateQueries(text: string): string[] {
  const norm = normSpace;
  const full = norm(text);
  const segs = text
    .split(/\n|\d+(?:[.,]\d+)*/)
    .map(norm)
    .filter(s => s.length >= 2)
    .sort((a, b) => b.length - a.length);
  // 上限 8 個：點到大容器時整頁文字會切出幾百段，每段都要掃全部檔案，會卡住 dev server。
  return [...new Set([full, ...segs])].filter(Boolean).slice(0, 8);
}

export interface SourceHit {
  file: string;
  start: number;
  end: number;
  line: number;
  value: string;
}

/** `masked` 可由呼叫端先算好：同一次請求會對每個候選查詢各搜一輪，註解遮罩只需要算一次。 */
export function searchSource(files: { file: string; text: string; masked?: string }[], q: string): SourceHit[] {
  const re = queryRegex(q);
  const hits: SourceHit[] = [];
  for (const { file, text, masked: pre } of files) {
    const masked = pre ?? maskComments(text);
    const nl: number[] = [];
    for (let k = text.indexOf('\n'); k !== -1; k = text.indexOf('\n', k + 1)) nl.push(k);
    const lineOf = (pos: number) => {
      let lo = 0, hi = nl.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (nl[mid]! < pos) lo = mid + 1; else hi = mid; }
      return lo + 1;
    };
    re.lastIndex = 0;
    for (let m; (m = re.exec(masked)); ) {
      const start = m.index;
      const end = start + m[0].length;
      // `\s+` 會吃過被遮成空白的註解（`攻擊力 {/* 基礎 */} 150`）；片段裡含註解就不列，免得存檔把註解一起改掉。
      if (masked.slice(start, end) !== text.slice(start, end)) continue;
      hits.push({ file, start, end, line: lineOf(start), value: text.slice(start, end) });
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
  const nq = normSpace(q);
  const score = (h: T) => (normSpace(h.value) === nq ? 0 : 1e6) + h.value.length;
  return [...hits].sort((a, b) => score(a) - score(b));
}

export type SaveResult =
  | { ok: true; rebuilt: { code: number; out: string } | null; written: string }
  | { ok: false; conflict: boolean; error: string };

export type JsonSearchHit = { file: string; path: JsonPath; label: string; value: string };

export type SearchResult = {
  query: string;
  sourceFirst: boolean;
  warnings: string[];
  json: JsonSearchHit[];
  source: SourceHit[];
  more: boolean;
};
