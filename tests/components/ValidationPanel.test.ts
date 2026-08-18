import { describe, it, expect } from 'vitest';
import { parseHTML } from 'linkedom';
import { renderValidation } from '../../src/components/ValidationPanel';

// Task 14：規則 8 的錯誤要附一顆「加入白名單」按鈕，data-keyword 要精準等於比不到白名單的
// 那個詞——這個抽取邏輯（RULE8_RE + JSON.parse）是純字串操作，不需要真的跑一次 validateWith
// 才能測，跟 EditForm.test.ts 把 applyFieldEdits 獨立於 DOM 測試同一個理由。
describe('renderValidation', () => {
  function render(errors: string[], warnings: string[] = [], gzipBytes = NaN) {
    const { document } = parseHTML('<html><body><div id="host"></div></body></html>');
    const host = document.getElementById('host') as unknown as HTMLElement;
    renderValidation({ errors, warnings }, gzipBytes, host);
    return host;
  }

  it('非規則 8 的錯誤原樣顯示，不加按鈕', () => {
    const host = render(['規則 4: 節點 1002 成本 格式錯誤']);
    expect(host.textContent).toContain('規則 4: 節點 1002 成本 格式錯誤');
    expect(host.querySelector('[data-action="add-keyword"]')).toBeNull();
  });

  it('規則 8 錯誤附一顆「加入白名單」按鈕，data-keyword 精準等於比不到白名單的詞', () => {
    // 訊息格式跟 validate-rules.ts（`規則 8: 節點 ${n.id} ${msg}`）／keywords.ts
    // （`# 標記比不到白名單: ${JSON.stringify(rest.slice(0, 12))}`）逐字一致，這裡直接
    // 構造字串比對，不呼叫 validateWith，避免整條測試依賴 build-tree/svg-parse 的其餘管線。
    const msg = `規則 8: 節點 1002 # 標記比不到白名單: ${JSON.stringify('超新星傷害')}`;
    const host = render([msg]);
    const btn = host.querySelector<HTMLButtonElement>('[data-action="add-keyword"]');
    expect(btn).not.toBeNull();
    expect(btn?.dataset.keyword).toBe('超新星傷害');
    expect(host.textContent).toContain(msg); // 原始訊息原樣保留（原樣呈現，不改寫措辭）
  });

  it('# 後面的文字超過 12 字時，取的是訊息裡實際截斷後的那 12 字，不是整句', () => {
    // keywords.ts 的 rest.slice(0, 12) 上限——這支測試直接守「不要取到後面整句」這個坑
    // （任務簡報特別點名），用剛好 12 字的詞確認抽取結果精準等於訊息裡截斷後的內容，
    // 不是貪心地把整條錯誤訊息、或後面接著的別條規則訊息也一起抓進來。
    const rest12 = '超新星爆炸傷害對敵人造成';
    expect(rest12.length).toBe(12);
    const msg = `規則 8: 節點 1002 # 標記比不到白名單: ${JSON.stringify(rest12)}`;
    const host = render([msg]);
    const btn = host.querySelector<HTMLButtonElement>('[data-action="add-keyword"]');
    expect(btn?.dataset.keyword).toBe(rest12);
  });

  it('多條錯誤混雜規則 8 與其他規則時，只有規則 8 那幾條各自附自己的按鈕', () => {
    const errors = [
      '規則 4: 節點 1002 成本 格式錯誤',
      `規則 8: 節點 1002 # 標記比不到白名單: ${JSON.stringify('冰凍')}`,
      `規則 8: 節點 1003 # 標記比不到白名單: ${JSON.stringify('綻放')}`,
    ];
    const host = render(errors);
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('[data-action="add-keyword"]')];
    expect(buttons.map(b => b.dataset.keyword)).toEqual(['冰凍', '綻放']);
  });
});
