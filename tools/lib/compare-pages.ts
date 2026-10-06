/**
 * `npm run compare` 要開的頁面。
 *
 * ⚠️ **每個載入獨立樣式檔的頁面都要在這裡有代表**，否則改動那個檔時 compare 會回報 0 差異
 * 而它其實一個相關頁面都沒開過（`tests/tools/compare-pages.test.ts` 掃 `src/pages` 的 CSS import 守）。
 *
 * 新頁面在 before 那一側是 404、compare 會直接 exit 2：送新頁面的那個 PR 先別加，下一次比對再補。
 * 活動詳細頁（`/events/<id>`）刻意不收：id 每季會換，取哪一筆都可能只存在於其中一份 dist；
 * `events.css` 由 `/events` 代表。
 */
export const COMPARE_PAGES: readonly string[] = [
  '/', '/tree', '/dice', '/guide/keywords', '/board', '/sim', '/about',
  '/tactic', '/boss', '/rift-shop', '/rewards', '/events',
];
