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
