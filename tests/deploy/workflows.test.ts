import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

/**
 * workflow 裡幾條「改錯了 CI 照樣綠」的設定。pr-comment.yml 只在合進 main 之後才生效、
 * dist 上傳只在 main 的 push 才跑，PR 上的 CI 驗不到它們，只能在這裡靜態看。
 *
 * 以文字切步驟（每一步是縮排 6 格的 `- ` 開頭），不引入 YAML 解析器：兩支 workflow 的步驟縮排一致，
 * 下面「每一步都切得到」那條會在縮排變了的時候先紅。
 */
const DIR = '.github/workflows';
const files = readdirSync(DIR).filter(f => f.endsWith('.yml')).map(f => ({ f, text: readFileSync(`${DIR}/${f}`, 'utf8') }));

function steps(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    if (/^ {6}- /.test(line)) out.push(line);
    else if (out.length > 0 && (/^ {7,}\S/.test(line) || line.trim() === '')) out[out.length - 1] += `\n${line}`;
    else if (/^ {0,5}\S/.test(line)) out.push('');  // 回到 job 層：切斷，免得下一個 job 的屬性黏到上一步
  }
  return out.filter(Boolean);
}

const allSteps = files.flatMap(({ f, text }) => steps(text).map(s => ({ f, s })));

describe('.github/workflows', () => {
  it('每一個 uses: 都切得到所屬的步驟', () => {
    const usesInText = files.reduce((n, { text }) => n + (text.match(/^\s*-? *uses: /gm) ?? []).length, 0);
    const usesInSteps = allSteps.filter(({ s }) => /^\s*-? *uses: /m.test(s)).length;
    expect(usesInText).toBeGreaterThan(0);
    expect(usesInSteps).toBe(usesInText);
  });

  it('只用 GitHub 官方的 action（repo 設定 allowed_actions=selected 的鏡像）', () => {
    // repo 的 Actions 設定只放行 actions/、github/。在這裡加別家的 action 之前，先改 repo 設定的白名單，
    // 再把這條測試一起改——否則 PR 上這個 job 會被 GitHub 拒跑。
    const refs = files.flatMap(({ text }) => [...text.matchAll(/uses: ([^@\s]+)@/g)].map(m => m[1]));
    for (const r of refs) expect(r, r).toMatch(/^(actions|github)\//);
  });

  it('每個 checkout 都 persist-credentials: false', () => {
    // 兩支 workflow 在 checkout 之後都沒有要憑證的 git 操作；預設會把 GITHUB_TOKEN 留在 runner 的磁碟上，
    // 之後跑的 PR 端程式碼（verify）、fork 可控的 artifact（pr-comment）、wrangler（deploy）都讀得到。
    const checkouts = allSteps.filter(({ s }) => /uses: actions\/checkout@/.test(s));
    expect(checkouts.length).toBeGreaterThanOrEqual(4);
    for (const { f, s } of checkouts) expect(s, `${f}\n${s}`).toMatch(/persist-credentials: false\b/);
  });

  it('上傳給 deploy 的 dist 帶 include-hidden-files: true', () => {
    // upload-artifact 預設丟掉點開頭的檔案而且不報錯：public/.well-known/ 這類檔會本機看得到、正式站 404。
    const dist = allSteps.filter(({ s }) => /uses: actions\/upload-artifact@/.test(s) && /^\s+name: dist$/m.test(s));
    expect(dist).toHaveLength(1);
    expect(dist[0]?.s).toMatch(/include-hidden-files: true\b/);
  });
});
