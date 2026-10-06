import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** src/ 底下全部 .astro（遞迴）。 */
function astroFiles(dir = 'src'): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? astroFiles(join(dir, e.name)) : e.name.endsWith('.astro') ? [join(dir, e.name)] : []);
}

/**
 * 模板區（frontmatter、`<script>`、`<style>` 以外）。JSX 註解先拿掉：它們的內文會提到 `<script>` 這種字樣，
 * 先剝 script 的話會從註解裡那個字一路吃到真的 `</script>`，把中間的 `<!--` 一起藏起來。
 */
function templateOf(src: string): string {
  return src
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/g, '')
    .replace(/<style\b[\s\S]*?<\/style>/g, '');
}

describe('模板註解', () => {
  it('.astro 模板裡不准用 `<!-- -->`（Astro 會原樣輸出到正式 HTML），一律 `{/* */}`', () => {
    // `<!-- -->` 寫在 .map() 裡會每張卡片輸出一次：/dice 曾有四成位元組是維護者註解。
    const files = astroFiles();
    expect(files.length).toBeGreaterThan(10);
    const offenders = files.flatMap(f => {
      const n = templateOf(readFileSync(f, 'utf8')).match(/<!--/g)?.length ?? 0;
      return n > 0 ? [`${f}: ${n} 段`] : [];
    });
    expect(offenders).toEqual([]);
  });

  it('templateOf 的反例：模板裡的 `<!--` 抓得到，script／style／frontmatter 裡的不算', () => {
    expect(templateOf('---\nconst a = "<!--";\n---\n<p>x</p><!-- y -->')).toContain('<!--');
    expect(templateOf('{/* 提到 <script> */}<p/><!-- y --><script>"<!--"</script>')).toContain('<!--');
    expect(templateOf('---\nconst a = "<!--";\n---\n<script>"<!--"</script><style>/*<!--*/</style>')).not.toContain('<!--');
  });
});
