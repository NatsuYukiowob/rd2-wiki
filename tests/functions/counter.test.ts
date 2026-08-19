import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// ⚠️ 不能寫 `import { DatabaseSync } from 'node:sqlite'`。
// Node 24 刻意不把 'sqlite' 列進 module.builtinModules（它只能用 node: 前綴存取），
// 而 vite 用那份清單判斷什麼是內建模組——於是它把 'node:sqlite' 剝成 'sqlite'、
// 當成 npm 套件去找，然後整個測試檔以「Failed to load url sqlite」collect 失敗。
// 用 createRequire 讓載入發生在執行期，vite 的靜態分析就碰不到它。
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as {
  DatabaseSync: new (path: string) => DatabaseSyncLike;
};

/** node:sqlite 沒有隨附型別宣告，這裡只宣告用得到的部分。 */
interface DatabaseSyncLike {
  exec(sql: string): void;
  prepare(sql: string): { get(...params: unknown[]): unknown };
}
import { bumpCounter, readCounter, COUNTER_KEY, type D1Like } from '../../functions/lib/counter';

/**
 * 用真的 SQLite 而不是假物件。
 *
 * 假物件不解析 SQL，餵什麼 SQL 都回同一個 canned 值——那樣把 `SET n = n + 1` 改成
 * `SET n = n`、把 key 打錯、或整個拿掉 `RETURNING n`，測試都不會紅，等於沒有防線。
 * Node 24 內建 node:sqlite，用它就不必新增任何依賴。
 *
 * ⚠️ 這裡只保證 SQL 的 SQLite 語意正確。D1 的 client API 行為（.bind().first() 的簽章、
 * 無列時回 null）靠 wrangler pages dev 的手動 smoke 驗，不是這支測試的責任。
 */
function toD1(db: DatabaseSyncLike): D1Like {
  return {
    prepare: (sql: string) => ({
      bind: (...values: unknown[]) => ({
        first: async <T>(colName: string): Promise<T | null> => {
          const row = db.prepare(sql).get(...(values as string[])) as
            | Record<string, unknown>
            | undefined;
          if (row === undefined) return null;
          const v = row[colName];
          return v === undefined ? null : (v as T);
        },
      }),
    }),
  };
}

let db: DatabaseSyncLike;
let d1: D1Like;

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec(readFileSync('functions/schema.sql', 'utf8'));
  d1 = toD1(db);
});

describe('bumpCounter', () => {
  it('每呼叫一次就真的 +1，且回傳的是遞增後的值', async () => {
    expect(await bumpCounter(d1, COUNTER_KEY)).toBe(1);
    expect(await bumpCounter(d1, COUNTER_KEY)).toBe(2);
    expect(await bumpCounter(d1, COUNTER_KEY)).toBe(3);
  });

  it('回傳值真的來自資料庫，不是自己算的', async () => {
    await bumpCounter(d1, COUNTER_KEY);
    // 繞過 counter.ts 直接查表——兩邊對得起來才代表 RETURNING 真的有回值。
    const row = db.prepare('SELECT n FROM hits WHERE k = ?').get(COUNTER_KEY) as { n: number };
    expect(row.n).toBe(1);
  });

  it('key 不存在時拋錯，而且錯誤訊息帶得出是哪個 key', async () => {
    // 這是「忘記跑建表 SQL 的 seed」的唯一外部訊號。靜默回 0 的話，
    // 線上會看到一個永遠停在 0 的計數器，卻沒有任何地方會紅。
    await expect(bumpCounter(d1, 'nope')).rejects.toThrow(/nope/);
  });
});

describe('readCounter', () => {
  it('讀得到目前的值，而且不會把值加上去', async () => {
    await bumpCounter(d1, COUNTER_KEY);
    await bumpCounter(d1, COUNTER_KEY);
    expect(await readCounter(d1, COUNTER_KEY)).toBe(2);
    expect(await readCounter(d1, COUNTER_KEY)).toBe(2);
    const row = db.prepare('SELECT n FROM hits WHERE k = ?').get(COUNTER_KEY) as { n: number };
    expect(row.n).toBe(2);
  });

  it('key 不存在時拋錯', async () => {
    await expect(readCounter(d1, 'nope')).rejects.toThrow(/nope/);
  });
});
