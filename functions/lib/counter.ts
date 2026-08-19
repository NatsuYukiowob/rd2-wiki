// 訪客計數器的純邏輯。刻意不知道 HTTP——薄殼（functions/api/hits.ts）負責那一層。
//
// ⚠️ 這個檔案在 Cloudflare Workers（workerd）上執行，不是在瀏覽器裡。
// 但專案的 tsconfig 帶著 lib.dom 檢查它（functions/ 併進主 tsconfig 的 include，
// 為的是零新依賴、typecheck 不必跑兩次），所以在這裡寫 document.querySelector(...)、
// localStorage、XMLHttpRequest 全部都編得過、上線才炸。
// 只有標準 Web API（fetch/Request/Response/URL）在 workerd 上真的存在。
//
// ⚠️ 專案開了 noUncheckedIndexedAccess／noUnusedLocals／noUnusedParameters，
// 解構 D1 查詢結果（res.results[0].n）會噴 TS2532「Object is possibly 'undefined'」。
// 那不是設定壞掉，是刻意開的嚴格檢查。

/**
 * D1 用得到的最小介面，自己宣告而不是裝 @cloudflare/workers-types。
 *
 * 理由：Workers types 的 Response／fetch／Headers 會跟站台的 DOM lib 打架，
 * 而分成兩個 tsconfig 又要讓 `npm run typecheck` 跑兩次。這裡只用到 D1 的一小塊，
 * 自己宣告的成本遠低於那兩個代價。
 */
export interface D1Like {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      first<T>(colName: string): Promise<T | null>;
    };
  };
}

/** 目前只有一列。日後要分頁計數就多幾個 key。 */
export const COUNTER_KEY = 'total';

// ⚠️ RETURNING 是「實作支援但未文件化」的依賴：Cloudflare 的 D1 文件從頭到尾沒提過它
// （整份文件語料比對零次命中，只寫「compatible with most SQLite's SQL convention」）。
// 實測可用，但這代表它可能在沒有公告的情況下改變行為——部署後的 curl smoke 是唯一
// 守得住這件事的東西。
//
// 用單一 statement 而不是「SELECT 再 UPDATE」：D1 每個資料庫是單執行緒、一次處理一個
// 查詢，單一 statement 的遞增不會掉數；拆成兩句就會有讀-改-寫的競態。
const SQL_BUMP = 'UPDATE hits SET n = n + 1 WHERE k = ?1 RETURNING n';
const SQL_READ = 'SELECT n FROM hits WHERE k = ?1';

/** 遞增並回傳**遞增後**的值——所以回傳值天然就是「這位訪客的序號」。 */
export async function bumpCounter(db: D1Like, key: string): Promise<number> {
  const n = await db.prepare(SQL_BUMP).bind(key).first<number>('n');
  if (n === null) throw new Error(`計數器沒有這一列，建表 SQL 的 seed 可能沒跑到：k=${key}`);
  return n;
}

/** 只讀，不遞增。 */
export async function readCounter(db: D1Like, key: string): Promise<number> {
  const n = await db.prepare(SQL_READ).bind(key).first<number>('n');
  if (n === null) throw new Error(`計數器沒有這一列，建表 SQL 的 seed 可能沒跑到：k=${key}`);
  return n;
}
