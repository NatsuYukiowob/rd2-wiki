// Astro 站台設定。
// 純靜態產出（output: 'static'）：build:data 先產生 src/generated/tree.json 與
// public/assets 圖示資產，astro build 再把整站編譯進 dist/。
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://rd2-wiki.pages.dev',
  output: 'static',
});
