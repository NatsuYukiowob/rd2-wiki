import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

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
const FILES = ['src/styles/global.css', 'src/pages/tree.astro', 'src/pages/about.astro'];

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
  'src/styles/global.css gap: 3px',
  // .sr-only 的 `margin: -1px`：視覺隱藏的固定寫法（1px 盒子往回縮 1px，讓它不佔任何空間，
  // 但仍留在無障礙樹裡）。它跟版面節奏無關，級距上也沒有負值這一階。
  'src/styles/global.css margin: -1px',
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
  it('padding／margin／gap／border-radius／font-size 一律走 token，不留裸數值', () => {
    const found = FILES.flatMap(violations).sort();
    expect(found).toEqual([...ALLOWED].sort());
  });

  it('每個 var(--token) 都真的定義得出來，不會靜靜地退回 initial', () => {
    // 打錯的 var() 名稱不會報錯，只會讓那條宣告變成 invalid at computed-value time，
    // 元件安靜地掉回預設值。這裡把所有被引用的名字跟 :root 的定義對一次。
    const global = readFileSync('src/styles/global.css', 'utf8');
    const defined = new Set([...global.matchAll(/^\s{2}(--[a-z0-9-]+):/gm)].map(m => m[1]!));

    // 不在 :root、由執行期寫入或由元件自己設的變數，各自的來源寫在旁邊。
    const runtime = new Set([
      '--nav-h', // src/lib/nav-height.ts 量導覽列高度後寫進 documentElement
      '--chips-h', // src/scripts/tree-canvas.ts 量手機版底部分支列高度
      '--branch', // .dice-card[data-branch=…] 自己設，見 global.css 的分支色條
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
