import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * 這一檔測的是 `tools/normalize-svg.ts` 的 **CLI 區塊**，不是 `normalizeSvg()` 本身。
 *
 * 兩條都是 code review（2026-08-22）在純函式測試碰不到的那一層找到的：寫檔的順序、
 * 以及 nodes.json 的路徑怎麼解析——只測純函式的話，兩個都是永遠的綠燈。
 */
const run = (cwd: string, file: string) => {
  try {
    const stdout = execFileSync('npx', ['tsx', join(process.cwd(), 'tools/normalize-svg.ts'), file], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out: stdout };
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string };
    return { code: err.status, out: `${err.stdout}${err.stderr}` };
  }
};

const NODE = (id: string, label: string) =>
  `<g class="node" transform="matrix(1,0,0,1,10,20)" data-id="${id}">` +
  `<text class="dice-label" y="42">${label}</text></g>`;

describe('normalize CLI', () => {
  // nodes.json 以前是寫死的 `data/nodes.json`，只在 `dropped.length > 0` 時才讀——所以正本
  // 沒事，但拿這支正規化任何「含標籤、又不在 repo 根目錄」的 SVG 就會噴 ENOENT 堆疊，
  // 而且是在破壞性寫檔**之後**才噴。程式碼註解當時還寫著「那些情境不該爆掉」。
  it('SVG 不在 repo 根目錄、旁邊也沒有 nodes.json 時，照常正規化並說明略過比對', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rd2-norm-'));
    const file = join(dir, 'f.svg');
    writeFileSync(file, `<svg xmlns="http://www.w3.org/2000/svg">${NODE('1001', '火骰子')}</svg>`);

    const r = run(dir, 'f.svg');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/略過標籤內容比對/);
    expect(readFileSync(file, 'utf8')).toContain('translate(10.00,20.00)');
    expect(readFileSync(file, 'utf8')).not.toContain('<text');
  });

  // 以前是「先寫檔、再比對、再 exit 1」。訊息正確，但那個錯誤是一次性的：第二次跑時
  // `<text>` 已經被刪掉寫回去了，於是 exit 0、正本與 HEAD 逐位元組相同，貢獻者在 GUI 裡
  // 改的字無聲消失，本機與 CI 全綠。現在漂移時一個位元組都不寫，同一個錯誤跑幾次報幾次。
  it('標籤與 nodes.json 不一致時：報錯、不寫檔，而且再跑一次還是同一個錯', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rd2-norm-'));
    const file = join(dir, 'f.svg');
    const src = `<svg xmlns="http://www.w3.org/2000/svg">${NODE('1001', '火骰子改過')}</svg>`;
    writeFileSync(file, src);
    writeFileSync(join(dir, 'nodes.json'), JSON.stringify({ '1001': { label: '火骰子' } }));

    const first = run(dir, 'f.svg');
    expect(first.code).toBe(1);
    expect(first.out).toMatch(/節點 1001：SVG 寫「火骰子改過」.*label 是「火骰子」/);
    expect(readFileSync(file, 'utf8')).toBe(src); // 一個位元組都沒動

    const second = run(dir, 'f.svg');
    expect(second.code).toBe(1);
    expect(second.out).toMatch(/火骰子改過/);
  });

  it('標籤與 nodes.json 一致時（預覽檔存回正本的正常動線）：刪掉標籤、正常寫檔', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rd2-norm-'));
    const file = join(dir, 'f.svg');
    writeFileSync(file, `<svg xmlns="http://www.w3.org/2000/svg">${NODE('1001', '火骰子')}</svg>`);
    writeFileSync(join(dir, 'nodes.json'), JSON.stringify({ '1001': { label: '火骰子' } }));

    const r = run(dir, 'f.svg');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/移除 1 個節點標籤/);
    expect(readFileSync(file, 'utf8')).not.toContain('<text');
  });
});
