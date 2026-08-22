import type { Page } from '@playwright/test';

/**
 * 在頁面裡把一個 CSS 變數解析成瀏覽器正規化過的顏色字串，好跟 computed style 直接比。
 *
 * 抽出來共用：chrome.spec.ts 與 codex.spec.ts 原本各有一份逐字相同的實作。
 */
export async function resolveColor(page: Page, cssVar: string): Promise<string> {
  return page.evaluate(name => {
    const probe = document.createElement('span');
    probe.style.color = `var(${name})`;
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  }, cssVar);
}
