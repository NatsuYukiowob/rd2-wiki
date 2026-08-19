-- 訪客計數器的資料表。部署時用：
--   wrangler d1 execute <db-name> --remote --file=functions/schema.sql
-- ⚠️ --remote 一定要加。--local 與 --remote 都沒有預設值，兩個都不給會走本機 sqlite，
-- 建表看起來成功、真正的 D1 一張表都沒有，而且不會有任何錯誤訊息。
--
-- 只有一列。刻意不存訪客識別、不存 IP、不存 User-Agent。
-- k 是預留的分類鍵（日後要分頁計數就多幾列），目前只有 'total'。
CREATE TABLE IF NOT EXISTS hits (
  k TEXT PRIMARY KEY,
  n INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO hits (k, n) VALUES ('total', 0);
