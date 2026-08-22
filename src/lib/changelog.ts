// 站台更新日誌（data/changelog.json）的型別與一致性檢查。
//
// 為什麼要有「檢查」這件事：更新日誌是全站唯一一個**沒有任何自動來源**的內容——版本號、
// 節點數、圖示都是從資料正本推出來的，只有這份是人手寫的。人手寫的東西一定會忘記寫，
// 而「忘記寫」在畫面上看起來跟「這次沒更新」一模一樣。所以規則 20 把它跟資料正本綁在
// 一起：資料版本一動，最新的資料條目就必須跟著動，否則 CI 紅。
export interface ChangelogDataStamp {
  gameVersion: string;
  gameBundle: string;
}

export interface ChangelogEntry {
  /** 絕對日期 YYYY-MM-DD。 */
  date: string;
  title: string;
  items: string[];
  /** 只有「有跟上游資料表對過」的條目才寫。純站台功能的條目不要寫。 */
  data?: ChangelogDataStamp;
}

export interface Changelog {
  note?: string;
  entries: ChangelogEntry[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 驗證更新日誌本身的結構，以及「最新一筆帶 `data` 的條目」與資料正本的版本欄位一致。
 *
 * 檢查的是**最新一筆帶 data 的條目**而不是 entries[0]：純站台功能的更新（例如這一頁本身）
 * 也是條目，它們排在最前面卻沒有資料版本可言。硬要求 entries[0] 帶 data 的話，每次改前端
 * 都得假造一筆資料版本，那條規則就會被繞過去。
 */
export function checkChangelog(
  changelog: unknown,
  meta: { gameVersion: string; gameBundle: string; updated: string },
): string[] {
  const errors: string[] = [];
  if (typeof changelog !== 'object' || changelog === null || Array.isArray(changelog)) {
    return ['data/changelog.json 的最外層必須是物件'];
  }
  const entries = (changelog as Changelog).entries;
  if (!Array.isArray(entries) || entries.length === 0) {
    return ['data/changelog.json 的 entries 必須是非空陣列'];
  }

  entries.forEach((e, i) => {
    const at = `第 ${i + 1} 筆`;
    if (typeof e?.date !== 'string' || !DATE_RE.test(e.date)) errors.push(`${at} 的 date 必須是 YYYY-MM-DD 絕對日期`);
    if (typeof e?.title !== 'string' || e.title.trim() === '') errors.push(`${at} 缺少 title`);
    if (!Array.isArray(e?.items) || e.items.length === 0 || e.items.some(s => typeof s !== 'string' || s.trim() === '')) {
      errors.push(`${at}（${e?.title ?? '?'}）的 items 必須是非空字串陣列`);
    }
    // `!== undefined` 不夠：`"data": null` 會通過那一關，然後在讀 .gameVersion 時把整個
    // validate 炸成堆疊追蹤。這支是資料的守門員，它自己壞掉時給貢獻者的訊息必須仍然是
    // 「哪一筆、哪裡不對」，不是一段 TypeError。
    if (e?.data !== undefined) {
      if (typeof e.data !== 'object' || e.data === null
        || typeof e.data.gameVersion !== 'string' || typeof e.data.gameBundle !== 'string') {
        errors.push(`${at}（${e?.title ?? '?'}）的 data 必須是同時有 gameVersion 與 gameBundle 的物件`);
      }
    }
  });

  // 由新到舊：日期不得往回走。同一天可以有多筆（先後有意義），所以是「不得遞增」而非「必須遞減」。
  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1]?.date ?? '';
    const cur = entries[i]?.date ?? '';
    if (DATE_RE.test(prev) && DATE_RE.test(cur) && cur > prev) {
      errors.push(`條目必須由新到舊排列，但第 ${i + 1} 筆（${cur}）比第 ${i} 筆（${prev}）新`);
    }
  }

  // 只認結構合法的資料條目：上面已經對壞掉的那些報過錯，這裡再拿它去比對版本只會多噴
  // 一條由同一個原因造成的錯，或者直接 throw。
  const latestData = entries.find(e => typeof e?.data === 'object' && e.data !== null
    && typeof e.data.gameVersion === 'string' && typeof e.data.gameBundle === 'string');
  if (!latestData) {
    errors.push('找不到任何帶 data 區塊的條目——資料版本沒有任何日誌記錄');
  } else {
    const d = latestData.data!;
    if (d.gameVersion !== meta.gameVersion) {
      errors.push(`最新的資料條目（${latestData.date} ${latestData.title}）寫遊戲版本 ${d.gameVersion}，資料正本是 ${meta.gameVersion}`);
    }
    if (d.gameBundle !== meta.gameBundle) {
      errors.push(`最新的資料條目（${latestData.date} ${latestData.title}）寫資源包 ${d.gameBundle}，資料正本是 ${meta.gameBundle}`);
    }
    if (latestData.date !== meta.updated) {
      errors.push(`最新的資料條目日期 ${latestData.date} 與資料正本的 data-updated ${meta.updated} 不一致`);
    }
  }
  return errors;
}
