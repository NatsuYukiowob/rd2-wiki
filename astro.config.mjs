// Astro 站台設定。
// 純靜態產出（output: 'static'）：build:data 先產生 src/generated/tree.json 與
// public/assets 圖示資產，astro build 再把整站編譯進 dist/。
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import devEditor from './tools/dev-editor/integration.ts';

export default defineConfig({
  // `site` 同時餵三個地方：sitemap 裡的 <loc>、Base.astro 的 canonical 與 og:url。
  // 換網域（#27）時只改這一行，不要在版面裡再寫死一次。
  site: 'https://rd2wiki.org',
  output: 'static',
  // Astro 7 的預設改成 'jsx'（行內元素之間的空白會被吃掉）；固定 true 維持原本的 HTML 空白。
  compressHTML: true,
  // Astro 7 把 build.target 設成 esnext，CSS 壓縮器（lightningcss）沒有瀏覽器目標時會把 CSS 改寫成
  // 最新語法：`@media (max-width: 720px)` 變 `(width<=720px)`（Safari 16.4 以前不認，手機版規則整批失效）、
  // 丟掉 `-webkit-` 前綴。給它目標才會保留舊寫法並自動補前綴。tests/e2e/static.spec.ts 的 ST9 守這件事。
  vite: { build: { cssTarget: ['chrome107', 'edge107', 'firefox104', 'safari16'] } },
  // sitemap 不帶任何選項是刻意的。
  // ⚠️ 一開始寫了 `filter: page => !page.includes('/404')`，怕 404 頁被收進去——實測
  // （2026-08-22，@astrojs/sitemap 3.7.3）**拿掉 filter 產出的 <loc> 一樣只有三個**，
  // 404 是這個套件預設就排除的。那個 filter 是一行永遠為真的死碼，留著會讓下一個人
  // 以為「排除 404」是我們設定的功勞。`tests/e2e/seo.spec.ts` 的 SEO-2 仍然斷言 sitemap
  // 不含 404——那條守的是上游哪天改掉這個預設。
  // devEditor 只在 `astro dev` 生效（本機文字編輯器，見 CLAUDE.md），build 時是空操作。
  integrations: [sitemap(), devEditor()],
});
