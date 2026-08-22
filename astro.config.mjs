// Astro 站台設定。
// 純靜態產出（output: 'static'）：build:data 先產生 src/generated/tree.json 與
// public/assets 圖示資產，astro build 再把整站編譯進 dist/。
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  // `site` 同時餵三個地方：sitemap 裡的 <loc>、Base.astro 的 canonical 與 og:url。
  // 換網域（#27）時只改這一行，不要在版面裡再寫死一次。
  site: 'https://rd2-wiki.pages.dev',
  output: 'static',
  // sitemap 不帶任何選項是刻意的。
  // ⚠️ 一開始寫了 `filter: page => !page.includes('/404')`，怕 404 頁被收進去——實測
  // （2026-08-22，@astrojs/sitemap 3.7.3）**拿掉 filter 產出的 <loc> 一樣只有三個**，
  // 404 是這個套件預設就排除的。那個 filter 是一行永遠為真的死碼，留著會讓下一個人
  // 以為「排除 404」是我們設定的功勞。`tests/e2e/seo.spec.ts` 的 SEO-2 仍然斷言 sitemap
  // 不含 404——那條守的是上游哪天改掉這個預設。
  integrations: [sitemap()],
});
