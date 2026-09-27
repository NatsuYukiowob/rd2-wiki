import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  candidateQueries,
  EditConflict,
  labelPath,
  maskComments,
  rankJsonHits,
  rankSourceHits,
  replaceJsonString,
  replaceSpan,
  scanJsonStrings,
  searchJson,
  searchSource,
} from '../../tools/dev-editor/core';
import { allowed, listFiles, save } from '../../tools/dev-editor/integration';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';

const SAMPLE = `{
  "1001": { "name": "火骰子", "cost": 5, "tags": ["a", "b\\"c"], "ok": true, "x": null },
  "list": [ { "id": "e1", "caption": "第一行\\n第二行" } ]
}
`;

describe('scanJsonStrings', () => {
  it('只收值位置的字串，路徑與原文位置正確', () => {
    const hits = scanJsonStrings(SAMPLE);
    expect(hits.map(h => h.path)).toEqual([
      ['1001', 'name'],
      ['1001', 'tags', 0],
      ['1001', 'tags', 1],
      ['list', 0, 'id'],
      ['list', 0, 'caption'],
    ]);
    for (const h of hits) expect(JSON.parse(SAMPLE.slice(h.start, h.end))).toBe(h.value);
  });

  it('data/ 底下每一份 JSON 都掃得動，字串數與 JSON.parse 走訪結果一致', () => {
    const count = (v: unknown): number =>
      typeof v === 'string' ? 1 : v && typeof v === 'object' ? Object.values(v).reduce((n: number, x) => n + count(x), 0) : 0;
    for (const f of readdirSync('data').filter(f => f.endsWith('.json'))) {
      const text = readFileSync(`data/${f}`, 'utf8');
      expect(scanJsonStrings(text).length, f).toBe(count(JSON.parse(text)));
    }
  });
});

describe('replaceJsonString', () => {
  it('只換那一個字面值，其餘位元組不動', () => {
    const out = replaceJsonString(SAMPLE, ['1001', 'name'], '火骰子', '冰骰子"');
    expect(out).toBe(SAMPLE.replace('"火骰子"', '"冰骰子\\""'));
    expect(JSON.parse(out)['1001'].name).toBe('冰骰子"');
  });

  it('舊值對不上 → EditConflict，不寫入', () => {
    expect(() => replaceJsonString(SAMPLE, ['1001', 'name'], '別的', 'x')).toThrow(EditConflict);
    expect(() => replaceJsonString(SAMPLE, ['nope'], '', 'x')).toThrow(EditConflict);
  });
});

describe('replaceSpan', () => {
  it('舊內容相符才換', () => {
    expect(replaceSpan('abcdef', 2, 4, 'cd', 'XY')).toBe('abXYef');
    expect(() => replaceSpan('abcdef', 2, 4, 'zz', 'XY')).toThrow(EditConflict);
  });
});

describe('labelPath', () => {
  it('陣列元素用 id／name 當標籤', () => {
    expect(labelPath(JSON.parse(SAMPLE), ['list', 0, 'caption'])).toBe('list › [e1] › caption');
    expect(labelPath(JSON.parse(SAMPLE), ['1001', 'tags', 1])).toBe('1001 › tags › [1]');
  });
});

describe('maskComments', () => {
  it('遮掉三種註解、保留長度與換行，不誤傷 URL', () => {
    const src = 'a <!-- 骰子 --> b\n/* 骰子\n骰子 */ c\n  // 骰子\nhref="https://x" 骰子';
    const out = maskComments(src);
    expect(out.length).toBe(src.length);
    expect(out.split('\n').length).toBe(src.split('\n').length);
    expect(out.match(/骰子/g)).toEqual(['骰子']);
    expect(out).toContain('https://x');
  });

  it('字串裡的 /* 不會把到下一個 */ 之間整段吃掉', () => {
    const src = "const g = 'src/*.json';\n<p>骰子圖鑑</p>\n/* 真的註解 */";
    expect(maskComments(src)).toContain('骰子圖鑑');
    expect(maskComments(src)).not.toContain('真的註解');
  });
});

describe('candidateQueries', () => {
  it('整段優先，再來是被數字或換行切開的片段（長的先）', () => {
    expect(candidateQueries('41 顆骰子的完整資料：基本效果\n  符文不在這裡')).toEqual([
      '41 顆骰子的完整資料：基本效果 符文不在這裡',
      '顆骰子的完整資料：基本效果',
      '符文不在這裡',
    ]);
  });
});

describe('searchSource／searchJson', () => {
  const files = [
    { file: 'src/pages/a.astro', text: '<p>\n  顆骰子的完整資料：\n  基本效果</p>\n<!-- 顆骰子的完整資料： 基本效果 -->' },
    { file: 'src/pages/b.astro', text: '<p>顆骰子的完整資料： 基本效果</p>' },
  ];

  it('空白跨縮排換行也對得上，註解裡的不算，value 是原文切片', () => {
    const hits = searchSource(files, '顆骰子的完整資料： 基本效果');
    expect(hits.map(h => [h.file, h.line])).toEqual([
      ['src/pages/a.astro', 2],
      ['src/pages/b.astro', 1],
    ]);
    expect(hits[0]!.value).toBe('顆骰子的完整資料：\n  基本效果');
  });

  it('畫面上的數字對得上原始碼的 {…} 插值，也對得上字面數字', () => {
    const src = [{ file: 'src/pages/d.astro', text: '<p>\n  {nodes.length} 顆骰子、7 骰點\n</p>' }];
    expect(searchSource(src, '41 顆骰子、7 骰點').map(h => h.value)).toEqual(['{nodes.length} 顆骰子、7 骰點']);
    expect(searchSource(src, '41 顆骰子、8 骰點')).toEqual([]);
  });

  it('rankSourceHits：點到的檔案優先', () => {
    const hits = searchSource(files, '顆骰子的完整資料： 基本效果');
    expect(rankSourceHits(hits, 'src/pages/b.astro', 1)[0]!.file).toBe('src/pages/b.astro');
  });

  it('searchJson 以子字串比對（關鍵字標記、換行都不影響）', () => {
    const hits = scanJsonStrings(SAMPLE);
    expect(searchJson(hits, '第一行 第二行').map(h => h.path)).toEqual([['list', 0, 'caption']]);
    expect(searchJson(hits, '骰子').map(h => h.path)).toEqual([['1001', 'name']]);
  });
});

describe('rankJsonHits', () => {
  it('完全相同的排最前，其餘短的先', () => {
    const hits = [{ value: '中秋賞月活動上線了，快來玩' }, { value: '賞月' }, { value: '中秋賞月活動' }];
    expect(rankJsonHits(hits, '中秋賞月活動').map(h => h.value)).toEqual(['中秋賞月活動', '賞月', '中秋賞月活動上線了，快來玩']);
  });
});

describe('rankSourceHits 在截斷之前排序', () => {
  it('前面的檔先有 60 筆命中，點到的檔那一筆仍排第一', () => {
    const files = [
      { file: 'src/a.ts', text: '骰子\n'.repeat(60) },
      { file: 'src/pages/z.astro', text: '<p>骰子</p>' },
    ];
    const ranked = rankSourceHits(searchSource(files, '骰子'), 'src/pages/z.astro', 1);
    expect(ranked.length).toBe(61);
    expect(ranked[0]!.file).toBe('src/pages/z.astro');
  });
});

describe('allowed（寫檔 API 的門）', () => {
  const req = (headers: Record<string, string>, remoteAddress = '127.0.0.1') =>
    ({ method: 'POST', socket: { remoteAddress }, headers: { 'x-dev-editor': '1', ...headers } }) as unknown as IncomingMessage;

  it('本機名稱的 Host 放行', () => {
    expect(allowed(req({ host: '127.0.0.1:4321', origin: 'http://127.0.0.1:4321' }))).toBeNull();
    expect(allowed(req({ host: 'localhost:4321' }))).toBeNull();
    expect(allowed(req({ host: '[::1]:4321' }, '::1'))).toBeNull();
  });

  it('DNS rebinding：連線來自 loopback、Origin＝Host，但主機名不是本機 → 擋', () => {
    expect(allowed(req({ host: 'evil.example:4321', origin: 'http://evil.example:4321' }))).toMatch(/Host/);
  });

  it('非本機來源、缺標頭、Origin 不符都擋', () => {
    expect(allowed(req({ host: '127.0.0.1:4321' }, '192.168.1.5'))).not.toBeNull();
    expect(allowed({ ...req({ host: '127.0.0.1:4321' }), headers: { host: '127.0.0.1:4321' } } as unknown as IncomingMessage)).toMatch(/標頭/);
    expect(allowed(req({ host: '127.0.0.1:4321', origin: 'http://127.0.0.1:9999' }))).toMatch(/Origin/);
  });
});

describe('save（寫入策略由檔案決定）', () => {
  const mkRoot = () => {
    const root = mkdtempSync(join(tmpdir(), 'dev-editor-'));
    mkdirSync(join(root, 'data'));
    mkdirSync(join(root, 'src/pages'), { recursive: true });
    writeFileSync(join(root, 'data/x.json'), '{ "a": "舊" }\n');
    writeFileSync(join(root, 'src/pages/p.astro'), '<p>\r\n  第一行\r\n  第二行\r\n</p>\r\n');
    return root;
  };

  it('對 data/*.json 用 source 方式寫入 → 拒絕，檔案不變', async () => {
    const root = mkRoot();
    const r = await save(root, listFiles(root), { kind: 'source', file: 'data/x.json', start: 7, end: 10, expected: '"舊"', next: '"broken' });
    expect(r.ok).toBe(false);
    expect(readFileSync(join(root, 'data/x.json'), 'utf8')).toBe('{ "a": "舊" }\n');
  });

  it('CRLF 檔案的多行片段：textarea 送回的 LF 會換回 CRLF，不寫出混用換行', async () => {
    const root = mkRoot();
    const text = readFileSync(join(root, 'src/pages/p.astro'), 'utf8');
    const expected = '第一行\r\n  第二行';
    const start = text.indexOf(expected);
    const r = await save(root, listFiles(root), { kind: 'source', file: 'src/pages/p.astro', start, end: start + expected.length, expected, next: '第一行\n  改過' });
    expect(r).toMatchObject({ ok: true, written: '第一行\r\n  改過' });
    const out = readFileSync(join(root, 'src/pages/p.astro'), 'utf8');
    expect(out).toBe('<p>\r\n  第一行\r\n  改過\r\n</p>\r\n');
    expect(out.replace(/\r\n/g, '')).not.toContain('\n');
  });
});

describe('第四輪 review 回歸', () => {
  it('只有數字的查詢不會對上 {…} 程式碼', () => {
    const src = [{ file: 'src/lib/a.ts', text: 'import { core, gold } from "x";\nconst n = 7;' }];
    expect(searchSource(src, '7').map(h => h.value)).toEqual(['7']);
    expect(searchSource([{ file: 'src/p.astro', text: '<p>{n} 顆</p>' }], '41 顆').map(h => h.value)).toEqual(['{n} 顆']);
  });

  it('候選查詢最多 8 個', () => {
    expect(candidateQueries(Array.from({ length: 50 }, (_, k) => 'ab'.repeat(k + 1)).join('\n')).length).toBe(8);
  });

  it('CRLF 檔案裡單行片段改成多行，也換回 CRLF', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dev-editor-'));
    mkdirSync(join(root, 'data'));
    mkdirSync(join(root, 'src/pages'), { recursive: true });
    writeFileSync(join(root, 'src/pages/p.astro'), '<p>\r\n  第一行\r\n</p>\r\n');
    const start = '<p>\r\n  '.length;
    const r = await save(root, listFiles(root), { kind: 'source', file: 'src/pages/p.astro', start, end: start + 3, expected: '第一行', next: '第一行\n第二行' });
    expect(r.ok).toBe(true);
    expect(readFileSync(join(root, 'src/pages/p.astro'), 'utf8')).toBe('<p>\r\n  第一行\r\n第二行\r\n</p>\r\n');
  });

  it('行號用換行位移表算，跟逐段切字串一致', () => {
    const text = 'a\nb\n\n骰子\nc 骰子';
    expect(searchSource([{ file: 'f.ts', text }], '骰子').map(h => h.line)).toEqual([4, 5]);
  });
});

describe('第五輪 review 回歸', () => {
  it('數字要整個對上：15 不會停在 150 裡、5 不會從 15 中間開始', () => {
    const src = [{ file: 'src/p.astro', text: '<p>攻擊力 150</p><p>共 15 顆骰子</p><p>攻擊力 15</p>' }];
    expect(searchSource(src, '攻擊力 15').map(h => h.value)).toEqual(['攻擊力 15']);
    expect(searchSource(src, '5 顆骰子')).toEqual([]);
    const t7 = 'x = 1700; y = 0.7; z = 7;';
    expect(searchSource([{ file: 'a.ts', text: t7 }], '7').map(h => h.start)).toEqual([t7.lastIndexOf('7')]);
  });

  it('字串裡的 /* 與 // 不當註解，後面的字仍找得到', () => {
    const src = "const s = 'a /* b'; const t = '重要文字'; /* c */\nconst u = \"x // y 也重要\";";
    const out = maskComments(src);
    expect(out).toContain('重要文字');
    expect(out).toContain('x // y 也重要');
    expect(out).not.toContain(' c ');
  });

  it('片段不會跨過被遮掉的註解', () => {
    expect(searchSource([{ file: 'p.astro', text: '<p>攻擊力 {/* 基礎 */} 150</p>' }], '攻擊力 150')).toEqual([]);
  });
});
