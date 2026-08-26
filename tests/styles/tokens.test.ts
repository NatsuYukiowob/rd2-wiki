import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

/**
 * 版面級距的守門測試（2026-08-22）。
 *
 * 這一輪精緻化的起點就是「沒有級距」：半徑寫過 2/4/6/8/10px 五種、字級十種擠在
 * 0.78–1.05rem、間距九種。每一條單看都合理，湊起來就是每個元件對齊到不同的格線。
 * 把值換成 token 只解決當下；沒有這條測試，下一次「就這一個地方特別一點」就會把它漂回去。
 *
 * 規則：padding／margin／gap／border-radius／font-size 這幾個屬性的值裡，不准出現裸的
 * rem／px 數字，一律走 var(--space-*) / var(--r-*) / var(--fs-*)。
 * 例外只有兩類，而且都寫在下面的 ALLOWED 裡，逐條有理由：
 * - `0` 與 `auto`：不是尺寸，沒有級距可言。
 * - `em` 與 `%`：相對於元素自己的字級或尺寸，改成絕對級距反而是錯的。
 */
/**
 * 掃描名單（2026-08-26 拆檔後改成自動列舉）。
 *
 * ⚠️ 用 readdirSync 而不是 glob 套件：少一個會寫錯的東西。字串一律用 posix 斜線拼——
 * ALLOWED 的鍵要對得上，而 path.join() 在 Windows 會給反斜線；readdirSync 的
 * `recursive: true` 在 Windows 上回傳的路徑一樣是反斜線，下面用 replace 收斂掉。
 */
const STYLE_DIR = 'src/styles';
const CSS_FILES = readdirSync(STYLE_DIR)
  .filter(f => f.endsWith('.css')).sort().map(f => `${STYLE_DIR}/${f}`);

/**
 * .astro 掃描名單：遞迴列舉 `src/pages`（含 `guide/` 子目錄）與 `src/components`，
 * 挑出**內容含 `<style`** 的檔案，不是寫死幾個檔名。
 *
 * ⚠️ 2026-08-26 code review 抓到：原本這裡是寫死的三個檔（`tree.astro`／`about.astro`／
 * `sim.astro`）——那三個今天剛好是僅有帶 `<style>` 的頁面，但下一個人給 `board.astro`／
 * `dice.astro`／`DiceCard.astro` 之類隨便一個加一段 `<style>` 塞裸 px 進去，這條測試
 * 會安靜地全綠，而「擋裸 px」正是它唯一的存在理由。改成自動掃才不會漏。
 */
function astroFilesWithStyle(dir: string): string[] {
  return (readdirSync(dir, { recursive: true }) as string[])
    .filter(f => f.endsWith('.astro'))
    .map(f => `${dir}/${f.replace(/\\/g, '/')}`)
    .filter(f => readFileSync(f, 'utf8').includes('<style'));
}
const ASTRO_FILES = [
  ...astroFilesWithStyle('src/pages'),
  ...astroFilesWithStyle('src/components'),
].sort();
const FILES = [...CSS_FILES, ...ASTRO_FILES];
const TOKENS_FILE = `${STYLE_DIR}/tokens.css`;

const SIZED_PROPS = new Set([
  'padding', 'margin', 'gap', 'row-gap', 'column-gap', 'border-radius', 'font-size',
  'padding-top', 'padding-bottom', 'padding-left', 'padding-right',
  'margin-top', 'margin-bottom', 'margin-left', 'margin-right',
]);

/**
 * 允許留下的裸數值，`檔名 屬性: 值` 格式。
 * ⚠️ 要往這裡加東西之前先想一次：這個值真的不屬於任何一階嗎？多半的答案是「應該補一階
 * token」而不是「開一個例外」。
 */
const ALLOWED = [
  // .guide-swatch 的五格色票之間的縫。那不是版面間距，是一個 1.5rem×0.35rem 小色塊
  // 內部的視覺分隔，跟著色塊尺寸走而不是跟著頁面節奏走。
  'src/styles/components.css gap: 3px',
  // .sr-only 的 `margin: -1px`：視覺隱藏的固定寫法（1px 盒子往回縮 1px，讓它不佔任何空間，
  // 但仍留在無障礙樹裡）。它跟版面節奏無關，級距上也沒有負值這一階。
  'src/styles/base.css margin: -1px',
];

/** 裸的尺寸數值：帶 rem 或 px 單位的數字。`0` 沒有單位，不算。 */
const RAW = /^-?\d*\.?\d+(rem|px)$/;

/**
 * 註解要先拿掉再掃：這個 repo 的註解裡經常引用舊的寫死數值（「舊版寫死 top: 3rem」之類），
 * 那是說明歷史，不是還活著的宣告，掃到會變成永遠修不好的假紅。
 */
function stripComments(src: string): string {
  // 用等長空白換掉，位移不變，:root 的範圍才還對得上。
  return src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
}

function violations(file: string): string[] {
  const src = stripComments(readFileSync(file, 'utf8'));
  // :root 本身就是級距的定義處，跳過。
  const root = /^:root \{[\s\S]*?^\}$/m.exec(src);
  const skip: [number, number] = root ? [root.index, root.index + root[0].length] : [-1, -1];

  const out: string[] = [];
  // 不綁行首：宣告寫成一行（`.x { padding: 1rem; }`）一樣要掃得到。
  for (const m of src.matchAll(/([a-z-]+):\s*([^;{}\n]+);/g)) {
    if (m.index !== undefined && m.index >= skip[0] && m.index < skip[1]) continue;
    const [, prop, value] = m;
    if (!SIZED_PROPS.has(prop!)) continue;
    if (value!.includes('var(') || value!.includes('calc(')) continue;
    if (value!.split(/\s+/).some(part => RAW.test(part))) out.push(`${file} ${prop}: ${value}`);
  }
  return out;
}

describe('版面級距', () => {
  /**
   * 這條守的是**底下那條 var() 解析測試**（以及裸 px 那條）的掃描名單沒有漂移。
   *
   * ⚠️ 2026-08-26 code review 抓到：原本這裡是 `onDisk.filter(f => !FILES.includes(f))`，
   * 而 `onDisk` 重跑的是產生 `CSS_FILES` 的**同一個運算式**，`CSS_FILES ⊆ FILES`——
   * 這條斷言恆真，永遠不可能紅，唯一活著的守門只剩底下 `>= 9` 這個魔術數字。改成跟
   * 一份**寫死**的九個檔名對照：少一個（誤刪／改名）、多一個沒人知道的檔、或有人把
   * `CSS_FILES` 自己改回寫死清單卻漏掉一個，三種壞法都會紅。
   */
  const EXPECTED_CSS = [
    'base.css', 'board.css', 'canvas.css', 'chrome.css', 'components.css',
    'content.css', 'detail.css', 'dice.css', 'tokens.css',
  ].map(f => `${STYLE_DIR}/${f}`).sort();

  it('掃描名單剛好是九個 .css，一個不多一個不少', () => {
    const onDisk = readdirSync(STYLE_DIR)
      .filter(f => f.endsWith('.css')).sort().map(f => `${STYLE_DIR}/${f}`);
    expect(onDisk, 'src/styles 底下的 .css 集合跟預期的九個檔對不上').toEqual(EXPECTED_CSS);
    expect(FILES).toContain(TOKENS_FILE);
  });

  it('padding／margin／gap／border-radius／font-size 一律走 token，不留裸數值', () => {
    const found = FILES.flatMap(violations).sort();
    expect(found).toEqual([...ALLOWED].sort());
  });

  it('每個 var(--token) 都真的定義得出來，不會靜靜地退回 initial', () => {
    // 打錯的 var() 名稱不會報錯，只會讓那條宣告變成 invalid at computed-value time，
    // 元件安靜地掉回預設值。這裡把所有被引用的名字跟 :root 的定義對一次。
    // ⚠️ 只讀 tokens.css，不要把九個檔合併起來當來源。下面那條正則是 `^\s{2}(--…):`，
    // 只認縮排兩格、不綁 :root 區塊——合併之後任何元件規則裡縮排兩格的自訂屬性
    // 都會被誤認成「:root 有定義」，這條規則就廢了。
    const tokens = readFileSync(TOKENS_FILE, 'utf8');
    const defined = new Set([...tokens.matchAll(/^\s{2}(--[a-z0-9-]+):/gm)].map(m => m[1]!));

    // 不在 :root、由執行期寫入或由元件自己設的變數，各自的來源寫在旁邊。
    const runtime = new Set([
      '--nav-h', // src/lib/nav-height.ts 量導覽列高度後寫進 documentElement
      '--chips-h', // src/scripts/tree-canvas.ts 量手機版底部分支列高度
      '--sim-panel-h', // src/scripts/sim.ts 量 /sim 手機版抽屜的實際高度（footer 靠它讓位）
      '--branch', // .dice-card[data-branch=…] 自己設，見 components.css 的分支色條
    ]);

    const missing = new Set<string>();
    for (const file of FILES) {
      for (const m of stripComments(readFileSync(file, 'utf8')).matchAll(/var\((--[a-z0-9-]+)/g)) {
        const name = m[1]!;
        if (!defined.has(name) && !runtime.has(name)) missing.add(`${file} ${name}`);
      }
    }
    expect([...missing].sort()).toEqual([]);
  });
});

/**
 * import 順序守門測試（2026-08-26，final-fix 補的）。
 *
 * `Base.astro` 那五行 `import '../styles/*.css'` 的順序就是層疊順序，調換會靜默改變
 * 全站樣式——唯一的防線本來只有旁邊那句註解。頁面級 CSS（`detail`／`canvas`／`dice`／
 * `board`）同理，必須寫在該頁 `import Base` 之後，否則頁面級 `<link>` 會排到 Base 的
 * `<link>` 前面、同具體度的規則反而輸掉（實測案例：`board.astro` 的 css import 搬到
 * `import Base` 之前重建，`/board` 的 `<style>` offset 1976 < Base `<link>` offset 5783，
 * 零錯誤零警告——這正是這條測試要接住的失效模式）。
 */
describe('import 順序＝層疊順序', () => {
  const BASE_FILE = 'src/layouts/Base.astro';

  it('Base.astro 五個 CSS import 的順序固定', () => {
    const src = readFileSync(BASE_FILE, 'utf8');
    const names = [...src.matchAll(/^import '\.\.\/styles\/([a-z]+\.css)';$/gm)].map(m => m[1]!);
    expect(names).toEqual([
      'tokens.css', 'base.css', 'chrome.css', 'content.css', 'components.css',
    ]);
  });

  it('頁面級 CSS import 都排在該頁 `import Base` 之後', () => {
    const pages: { file: string; css: string[] }[] = [
      { file: 'src/pages/tree.astro', css: ['detail.css', 'canvas.css'] },
      { file: 'src/pages/sim.astro', css: ['canvas.css'] },
      { file: 'src/pages/dice.astro', css: ['dice.css'] },
      { file: 'src/pages/board.astro', css: ['board.css'] },
    ];
    for (const { file, css } of pages) {
      const lines = readFileSync(file, 'utf8').split('\n');
      const baseLine = lines.findIndex(l => /^import Base from /.test(l));
      expect(baseLine, `${file} 找不到 import Base`).toBeGreaterThanOrEqual(0);
      for (const name of css) {
        // 行首錨定，不是子字串比對：`.includes()` 連 `// import '../styles/board.css';`
        // 這種整行被註解掉的 import 都會判定「找到了」——複審實測過，把 board.astro 的
        // css import 整行注解掉，這條測試原本仍然 5/5 全綠。跟上面 Base.astro 那條用
        // 同一種手法：比對整行字面值，註解掉之後那一行就不再等於這個字串。
        const cssLine = lines.findIndex(l => l === `import '../styles/${name}';`);
        expect(cssLine, `${file} 找不到 import '../styles/${name}'`).toBeGreaterThanOrEqual(0);
        expect(cssLine, `${file} 的 ../styles/${name} import 排在 import Base 之前`)
          .toBeGreaterThan(baseLine);
      }
    }
  });
});
