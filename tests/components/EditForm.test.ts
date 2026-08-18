import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { parseNodeBlock, emitNodeBlock } from '../../src/lib/svg-emit';
import { applyFieldEdits, renderEditForm } from '../../src/components/EditForm';

const svgText = readFileSync('data/dice-tree.svg', 'utf8');
const blockOf = (id: string) =>
  svgText.match(new RegExp(`<g class="node"[^>]*data-id="${id}"[\\s\\S]*?</g>`))![0];

describe('applyFieldEdits', () => {
  it('沒有任何編輯時 NodeBlock 不變', () => {
    const b = parseNodeBlock(blockOf('1002'));
    expect(emitNodeBlock(applyFieldEdits(b, {}))).toBe(blockOf('1002'));
  });

  it('改 name 會連動 data-name 與 <title>，但不動畫面標籤', () => {
    const b = parseNodeBlock(blockOf('1002'));
    const out = emitNodeBlock(applyFieldEdits(b, { name: '尖刺骰' }));
    expect(out).toContain('data-name="尖刺骰"');
    expect(out).toContain('<title>骰子｜尖刺骰｜');
    expect(out).toContain('>尖刺骰子</text>'); // 畫面標籤是獨立欄位，沒改就不動
  });

  it('改 label 只動 <text> 內容', () => {
    const b = parseNodeBlock(blockOf('1002'));
    const out = emitNodeBlock(applyFieldEdits(b, { label: '尖刺' }));
    expect(out).toContain('>尖刺</text>');
    expect(out).toContain('data-name="尖刺骰子"');
  });

  it('把 maxLevel 設為 null 會移除 <title> 的「最高等級」那一行', () => {
    const b = parseNodeBlock(blockOf('1101')); // 玩家被動，title 有最高等級：15
    expect(emitNodeBlock(b)).toContain('最高等級：15');
    expect(emitNodeBlock(applyFieldEdits(b, { maxLevel: null }))).not.toContain('最高等級：');
  });

  // 以下三案例是簡報要求之外，自己補的：直接守「'maxLevel' in edits」這條規則本身
  // （簡報的第四案例只驗證 null 有作用，沒有驗證「完全沒提 maxLevel」跟「明確設回同一個
  // 數字」這兩種情況不會互相搞混——這正是 `?? block.titleMaxLevel` 這種寫法會悄悄壞掉、
  // 但 `!== undefined` 或膚淺的 snapshot 測試抓不到的地方）。
  it('完全沒有 maxLevel 這個 key 時，titleMaxLevel 保持原樣（不是被清空）', () => {
    const b = parseNodeBlock(blockOf('1101'));
    const out = emitNodeBlock(applyFieldEdits(b, { name: '自然傷害' })); // 完全不提 maxLevel
    expect(out).toContain('最高等級：15');
  });

  it('把 maxLevel 設為新的數字會改掉 <title> 的最高等級那一行', () => {
    const b = parseNodeBlock(blockOf('1101'));
    const out = emitNodeBlock(applyFieldEdits(b, { maxLevel: 20 }));
    expect(out).toContain('最高等級：20');
    expect(out).not.toContain('最高等級：15');
  });

  it('多個欄位一次改動會全部套用，且互不影響（不可變更新沒有互相覆寫）', () => {
    const b = parseNodeBlock(blockOf('1002'));
    const out = emitNodeBlock(
      applyFieldEdits(b, { name: '尖刺骰', label: '尖刺', cost: '核心 10', description: '新描述' }),
    );
    expect(out).toContain('data-name="尖刺骰"');
    expect(out).toContain('>尖刺</text>');
    expect(out).toContain('data-cost="核心 10"');
    expect(out).toContain('data-description="新描述"');
    expect(out).toContain('<title>骰子｜尖刺骰｜新描述</title>');
  });
});

describe('renderEditForm', () => {
  function render(id: string) {
    const { document } = parseHTML('<html><body><div id="host"></div></body></html>');
    const host = document.getElementById('host') as unknown as HTMLElement;
    const block = parseNodeBlock(blockOf(id));
    renderEditForm(block, host);
    return { host, block };
  }

  it('每個可編輯欄位都掛對應的 data-field，初始值來自 NodeBlock', () => {
    const { host } = render('1002');
    const byField = (name: string) =>
      host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-field="${name}"]`);
    expect(byField('name')?.value).toBe('尖刺骰子');
    // 畫面標籤是從 labelXml 的 <text> 內容取出來的，跟 name 是不同來源，這裡驗證兩者
    // 巧合相等時（1002 的 name 跟 label 剛好都是「尖刺骰子」）也各自讀對自己的來源，
    // 不是同一份資料被複製兩次顯示。
    expect(byField('label')?.value).toBe('尖刺骰子');
    expect(byField('cost')?.value).toBe('核心 8');
    expect(byField('description')?.value).toBe('於怪物移動路徑上，按照骰點等比設置#尖刺');
  });

  it('label 欄位讀的是 labelXml 的內容，不是 data-name（1101 兩者不同）', () => {
    const { host } = render('1101');
    expect(host.querySelector<HTMLInputElement>('[data-field="name"]')?.value).toBe('自然骰子傷害');
    expect(host.querySelector<HTMLInputElement>('[data-field="label"]')?.value).toBe('自然傷害');
  });

  it('titleMaxLevel 為 null 時，等級上限欄位留白；有值時顯示數字', () => {
    const dice = render('1002'); // 骰子節點：titleMaxLevel 恆為 null（等級上限機制不同，見說明）
    expect(dice.host.querySelector<HTMLInputElement>('[data-field="maxLevel"]')?.value).toBe('');
    const passive = render('1101'); // 玩家被動：titleMaxLevel = 15
    expect(passive.host.querySelector<HTMLInputElement>('[data-field="maxLevel"]')?.value).toBe('15');
  });

  it('多行成本（骰子/符文的「最高 N 級」第二行）完整保留在 textarea，不因單行 input 被吃掉換行', () => {
    // 1301：骰子節點，data-cost 含兩行「金幣.../最高 N 級」（見 CLAUDE.md 資料不變量說明）。
    const b = parseNodeBlock(blockOf('1301'));
    expect(b.cost).toContain('\n');
    const { host } = render('1301');
    expect(host.querySelector<HTMLTextAreaElement>('[data-field="cost"]')?.value).toBe(b.cost);
  });

  it('圖示欄位是只接受 PNG 的檔案輸入（Task 14）', () => {
    const { host } = render('1002');
    const iconInput = host.querySelector<HTMLInputElement>('[data-field="icon"]');
    // 讀原始屬性而不是 .accept 這個 IDL 屬性：linkedom 對 <input> 沒有實作 accept 的屬性
    // 反射（讀回來是 undefined），跟 CLAUDE.md「測試環境」一節記錄的其他 linkedom 落差
    // 同一類問題，這裡改用 getAttribute 繞開，不依賴 linkedom 沒實作的那塊 IDL。
    expect(iconInput?.getAttribute('type')).toBe('file');
    expect(iconInput?.getAttribute('accept')).toBe('image/png');
  });

  it('欄位值含 HTML 特殊字元時會逃逸，不會破壞表單結構或造成注入', () => {
    const { document } = parseHTML('<html><body><div id="host"></div></body></html>');
    const host = document.getElementById('host') as unknown as HTMLElement;
    const block = parseNodeBlock(blockOf('1002'));
    renderEditForm({ ...block, description: '傷害 <100> & "測試"' }, host);
    // 驗證輸出的 innerHTML 本身：`<`／`>`／`&`／`"` 都被逃逸成實體，不會被解析成新標籤或
    // 提前結束 textarea／屬性值。不用 `.value` 往回讀（linkedom 的 HTML 解析器不像真的
    // 瀏覽器會把 `&lt;`／`&amp;` 解碼回字元，`.value` 讀到的仍是逃逸後的原始文字——這是
    // linkedom 跟真瀏覽器的既知落差，見 CLAUDE.md「測試環境」一節，這類行為只能靠 E2E
    // 驗；這裡改成直接檢查「有沒有正確逃逸」這件事本身，不依賴 linkedom 的實體解碼）。
    const html = host.innerHTML;
    expect(html).toContain('傷害 &lt;100&gt; &amp; &quot;測試&quot;');
    expect(html).not.toContain('傷害 <100>'); // 沒有逃逸的話會直接出現在這裡，被解析成新元素
    // 同時確認沒有意外多出一顆標籤或把後面的欄位吃掉（結構仍然完整，6 個可編輯欄位都在——
    // Task 14 加了圖示上傳欄位，見 renderEditForm() 的 icon-field）。
    expect(host.querySelectorAll('[data-field]').length).toBe(6);
  });
});
