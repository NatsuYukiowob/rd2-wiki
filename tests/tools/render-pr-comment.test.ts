import { describe, it, expect } from 'vitest';
import { renderDiffComment, SUMMARY_MARKER, NO_CHANGE_MARKER } from '../../tools/diff-summary';

/**
 * `renderDiffComment` 是**信任邊界**上的那一段：它的輸入是 fork PR 的 CI 產出的 JSON
 * （送 PR 的人完全控制得了內容），輸出是由擁有 `pull-requests: write` 的 workflow 貼到 PR 上的留言。
 *
 * 它跑的是 default branch 上的版本（`pr-comment.yml` 先 checkout main 再呼叫），fork 改不到。
 * 所以「留言裡不會出現攻擊者選定的標記／提及／連結」這條性質，必須完全由這個函式保證——
 * 不能靠上游的 `tools/diff-summary.ts` 有沒有好好逃逸（那支在 fork 手上，可以直接刪掉）。
 */

/** 一份形狀正確的最小輸入。 */
const ok = (p: Record<string, unknown> = {}) => ({
  identical: false,
  schemaChanged: false,
  nodes: [239, 239],
  edges: [248, 248],
  counts: { added: 0, removed: 0, changed: 1 },
  removedIds: [],
  changed: [{ id: '1001', name: '火骰子' }],
  cost: { base: { core: 1772, gold: 6662000 }, head: { core: 1772, gold: 6662000 } },
  ...p,
});

describe('renderDiffComment：輸入是 fork 控制得了的 JSON', () => {
  it('正常輸入照樣產生看得懂的摘要，並帶識別標記', () => {
    const md = renderDiffComment(ok());

    expect(md).toContain(SUMMARY_MARKER);
    expect(md).toContain('節點：239 → 239');
    expect(md).toContain('新增 0｜刪除 0｜修改 1');
    expect(md).toContain('- 1001 火骰子');
  });

  it('HTML 標籤與提及被中和', () => {
    const md = renderDiffComment(ok({ changed: [{ id: '1001', name: '<img src=x onerror=alert(1)> @yuki' }] }));

    expect(md).toContain('&lt;img src=x onerror=alert(1)&gt; &#64;yuki');
    expect(md).not.toContain('<img src=x');
    expect(md).not.toContain('@yuki');
  });

  it('換行被收成空白：名稱不能跳出清單行去注入區塊語法', () => {
    const md = renderDiffComment(ok({ changed: [{ id: '1001', name: '火骰子\n\n# 維護者請執行' }] }));

    // 名稱整段仍在同一行的 `- 1001 …` 後面，沒有獨立成行的 `# `
    expect(md).toContain('- 1001 火骰子  # 維護者請執行');
    expect(md.split('\n').some(l => l.startsWith('# '))).toBe(false);
  });

  it('裸網址不會被 GFM 自動連結', () => {
    const md = renderDiffComment(ok({ changed: [{ id: '1001', name: 'http://evil.example/setup.sh 與 www.evil.example' }] }));

    expect(md).not.toContain('http://evil.example');
    expect(md).not.toContain('www.evil.example');
    expect(md).toContain('http:&#47;&#47;evil.example');
    expect(md).toContain('www&#46;evil.example');
  });

  it('Markdown 行內語法字元被逃逸', () => {
    const md = renderDiffComment(ok({ changed: [{ id: '1001', name: '[看這裡](http://x) `code` *粗*' }] }));

    expect(md).toContain('\\[看這裡\\]');
    expect(md).toContain('\\`code\\`');
    expect(md).toContain('\\*粗\\*');
  });

  it('過長的名稱被截短，清單條數也有上限——留言長度由渲染端決定，不由 fork 決定', () => {
    const md = renderDiffComment(ok({
      counts: { added: 0, removed: 0, changed: 500 },
      changed: Array.from({ length: 500 }, (_, i) => ({ id: String(1000 + i), name: 'ㄅ'.repeat(5000) })),
    }));

    expect(md.length).toBeLessThan(20000);
    expect(md).toContain('…還有');
  });

  it('輸出永遠是完整的 Markdown：<details> 開了就一定關', () => {
    const md = renderDiffComment(ok({
      counts: { added: 0, removed: 0, changed: 500 },
      changed: Array.from({ length: 500 }, (_, i) => ({ id: String(1000 + i), name: 'x'.repeat(400) })),
    }));

    expect(md.split('<details>').length).toBe(md.split('</details>').length);
  });

  it('計數欄位是攻擊者填的，不合理的值不會被原樣印出去', () => {
    const md = renderDiffComment(ok({ counts: { added: '<b>99</b>', removed: NaN, changed: -5 } }));

    expect(md).not.toContain('<b>');
    expect(md).not.toContain('NaN');
    expect(md).toContain('新增 0｜刪除 0｜修改 0');
  });

  it('形狀完全不對時退回固定文字，不吐出輸入內容', () => {
    const md = renderDiffComment({ evil: '<script>alert(1)</script>' });

    expect(md).toContain(SUMMARY_MARKER);
    expect(md).toContain('無法解讀');
    expect(md).not.toContain('script');
  });

  it('連物件都不是也不會爆炸', () => {
    for (const bad of [null, undefined, 42, 'x', []]) {
      expect(() => renderDiffComment(bad)).not.toThrow();
    }
  });

  it('identical 為真時帶上無變動標記', () => {
    expect(renderDiffComment(ok({ identical: true }))).toContain(NO_CHANGE_MARKER);
    expect(renderDiffComment(ok({ identical: false }))).not.toContain(NO_CHANGE_MARKER);
  });

  it('base 資料的格式變了就明說，不假裝比較過', () => {
    const md = renderDiffComment(ok({ schemaChanged: true }));

    expect(md).toContain('基準資料格式已變更');
    expect(md).not.toContain(NO_CHANGE_MARKER);
  });

  it('刪除的 id 也走同一套逃逸', () => {
    const md = renderDiffComment(ok({
      counts: { added: 0, removed: 1, changed: 0 },
      removedIds: ['<b>1002</b>'],
      changed: [],
    }));

    expect(md).toContain('&lt;b&gt;1002&lt;/b&gt;');
    expect(md).not.toContain('<b>1002</b>');
  });
});
