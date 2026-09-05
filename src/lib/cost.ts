import type { Cost, NodeType, ParsedCost, UnlockVia, UpgradeCostTable } from './types.js';

/**
 * 成本上限。正則只管「長得像不像數字」，不管大小——`核心 999999999999999999999` 是合法字面，
 * `Number()` 給回一個超過安全整數範圍的值，加總出來的全樹成本就開始失去精度（而且是**安靜地**）。
 * 這兩個數字比遊戲裡任何現實數值大兩個數量級以上，撞到它代表資料寫錯了，不是遊戲改版。
 */
const MAX_CORE = 10_000;
const MAX_GOLD = 100_000_000;
// 太陽核心（遊戲 GoodsType `CORE_SOLAR`）。v1.1.0 太陽骰子與太陽強化的現實值是 100 ~ 2,000，
// 同 MAX_CORE 的理由取兩個數量級以上的餘裕：撞到它代表資料寫錯，不是遊戲改版。
const MAX_SOLAR = 100_000;

function checkAmount(kind: string, n: number, max: number): number {
  if (!Number.isSafeInteger(n)) throw new Error(`${kind} 必須是安全整數範圍內的整數: ${n}`);
  if (n > max) throw new Error(`${kind} ${n} 超過上限 ${max}（資料應該寫錯了）`);
  return n;
}

// 金幣開頭：金幣 <N> 可選搭配 ／核心 <N>，再可選搭配 ／太陽核心 <N>——**順序固定**，
// 由正則本身保證（三個群組只能照這個先後出現），錯序的字串在下面另有專屬的錯誤訊息。
// ⚠️ 太陽核心的數字兩種寫法都收（`2,000` 與 `2000`）：官方資料表兩種都出現過，而它跟金幣
// 不同——金幣是四位數起跳、逗號是唯一讀得懂的寫法，太陽核心現實值只有三、四位數。
const GOLD_PATTERN = /^金幣 (\d{1,3}(?:,\d{3})*)(?:／核心 (\d+))?(?:／太陽核心 (\d{1,3}(?:,\d{3})+|\d+))?$/;
// 核心開頭：核心 <N>（不允許搭配其他）
const CORE_PATTERN = /^核心 (\d+)$/;

/**
 * 解析解鎖成本字串。**只吃單行**——2026-08-22（#21）之前骰子符文的成本第二行寫著
 * 「最高 N 級」，那個等級上限現在是 `data/nodes.json` 的 `maxLevel` 欄位。
 *
 * 這裡跟著擋掉第二行，而不是留著「還讀得懂但沒人用」的能力：validate 的規則 4 拒絕的輸入，
 * `npm run build:data` 必須也拒絕。兩邊對同一份輸入給不同答案，就是「本機綠、CI 紅」
 * 或反過來的裂縫——`MAX_TEXT_LENGTH` 與 `checkNodeTextRecord` 共用一份判斷正是為了堵這個。
 */
export function parseCost(raw: string): ParsedCost {
  const [head, ...rest] = raw.split('\n');
  if (head === undefined) throw new Error(`成本字串行數異常: ${JSON.stringify(raw)}`);
  if (rest.length > 0) throw new Error(`不可換行（等級上限請寫在 maxLevel 欄位）: ${JSON.stringify(raw)}`);
  if (head.includes('/')) throw new Error(`分隔符必須是全形／: ${head}`);

  let core = 0;
  let gold = 0;
  let solar = 0;

  // 檢查重複欄位。⚠️ 「核心 」是「太陽核心 」的後綴，直接數會把每個太陽核心也數成一個核心，
  // 所以先數太陽核心再扣掉——不扣的話 `金幣 1,000／太陽核心 100` 會被當成兩種貨幣各一次
  // 而通過，但 `核心 5／太陽核心 100` 這種真的重複的寫法反而數不對。
  const countOf = (needle: string) => head.split(needle).length - 1;
  const solarCount = countOf('太陽核心 ');
  const coreCount = countOf('核心 ') - solarCount;
  if (countOf('金幣 ') > 1 || coreCount > 1 || solarCount > 1) {
    throw new Error(`成本格式錯誤：同一種貨幣不可重複出現`);
  }

  // 檢查順序錯誤：如果以核心開頭且含有斜線，表示格式錯誤（核心不應與其他組合）。
  // ⚠️ 這條同時擋掉 `核心 N／太陽核心 M`：那個組合遊戲裡不存在，而「核心開頭不可搭配其他」
  // 本來就是這條規則的語意，為了新貨幣把它放寬會憑空多出一種沒有資料撐腰的合法寫法。
  if (head.startsWith('核心 ') && head.includes('／')) {
    throw new Error(`成本格式錯誤：金幣必須在核心之前，不可顛倒順序`);
  }

  // 太陽核心一律排最後（金幣→核心→太陽核心）。兩種錯序各給一句話，不要讓它們掉進
  // 「無法解析成本字串」——那句訊息對著一個每個欄位都拼對了的字串等於什麼都沒說。
  if (head.startsWith('太陽核心 ') && head.includes('／')) {
    throw new Error(`成本格式錯誤：太陽核心必須排在最後，不可顛倒順序`);
  }
  if (head.includes('／太陽核心 ') && head.includes('／核心 ')
      && head.indexOf('／太陽核心 ') < head.indexOf('／核心 ')) {
    throw new Error(`成本格式錯誤：核心必須在太陽核心之前，不可顛倒順序`);
  }

  // 優先嘗試金幣開頭格式（強制金幣在核心之前）
  const goldMatch = GOLD_PATTERN.exec(head);
  if (goldMatch) {
    const goldStr = goldMatch[1]!;
    // 檢查金幣格式：無逗號時最多 3 位；有逗號時須符合千分位規則（正則已保證）
    if (!goldStr.includes(',') && goldStr.length > 3) {
      throw new Error(`金幣金額格式錯誤：須為 1-3 位或使用千分位逗號: ${goldStr}`);
    }
    gold = checkAmount('金幣', Number(goldStr.replaceAll(',', '')), MAX_GOLD);

    // 如果有搭配的核心，取其值
    if (goldMatch[2]) {
      core = checkAmount('核心', Number(goldMatch[2]), MAX_CORE);
    }
    if (goldMatch[3]) {
      solar = checkAmount('太陽核心', Number(goldMatch[3].replaceAll(',', '')), MAX_SOLAR);
    }
  } else {
    // 檢查是否是金幣開頭但格式錯誤（數字格式不符）
    if (head.startsWith('金幣 ')) {
      const badGoldMatch = /^金幣 (\d+)/.exec(head);
      if (badGoldMatch) {
        // 是金幣開頭但數字格式不符合規則
        throw new Error(`金幣金額格式錯誤：須為 1-3 位或使用千分位逗號`);
      }
    }

    // 再嘗試核心單獨格式
    const coreMatch = CORE_PATTERN.exec(head);
    if (coreMatch) {
      core = checkAmount('核心', Number(coreMatch[1]), MAX_CORE);
    } else {
      throw new Error(`無法解析成本字串: ${JSON.stringify(head)}`);
    }
  }

  return { cost: { core, gold, solar } };
}

/**
 * 把一張升級花費表從 1 級累加到 `toLevel` 級。
 *
 * 回傳 null 而不是丟錯或回 0：呼叫端拿到的節點不一定適用這張表（玩家被動就不適用），
 * 而「0 金幣」跟「這個節點不適用」在畫面上長得一模一樣，只是後者是說謊。
 */
export function cumulativeUpgradeCost(table: UpgradeCostTable, toLevel: number): Cost | null {
  if (!Number.isInteger(toLevel) || toLevel < 1) return null;
  const rows = table.levels.filter(r => r.level <= toLevel);
  // 表格必須真的涵蓋到 toLevel（規則 15 保證 1..N 連續，所以只要數量對就代表涵蓋到）
  if (rows.length !== toLevel) return null;
  // solar 缺席當 0：這張表是社群維護的 JSON，既有的 50 列一個 solar 欄位都沒有（見 LevelCost）。
  return rows.reduce(
    (acc, r) => ({ core: acc.core + r.core, gold: acc.gold + r.gold, solar: acc.solar + (r.solar ?? 0) }),
    { core: 0, gold: 0, solar: 0 },
  );
}

/**
 * 這張表適用於這個節點嗎？型別與等級上限都要對得上（見 UpgradeCostTable 的說明）。
 *
 * 還多要求「玩家真的付了解鎖那一筆」：表格的第 1 級**就是解鎖那一次**，而預設／任務／成就
 * 解鎖的節點根本不付那筆錢（`sumUnlockCost()` 也是這樣排除它們的）。
 *
 * ⚠️ 判準是 `unlockVia === 'cost' || unlockPaid`，不是 `unlockVia` 的字面值——官方 v1.0.3 v2
 * 把恐懼骰子寫成「合作累積900擊殺後，使用8核心解鎖」，成就開門與要不要付錢是兩件事。
 * 目前 9 顆例外骰子全是 maxLevel 1、都套不到這張只適用 50 級符文的表，所以這條不改變任何
 * 顯示——它擋的是「哪天有一顆非成本解鎖的 50 級符文」時，面板多算一筆玩家沒花過的錢。
 */
export function upgradeTableApplies(
  table: UpgradeCostTable | null,
  node: { type: NodeType; maxLevel: number; unlockVia?: UnlockVia; unlockPaid?: true },
): table is UpgradeCostTable {
  if (node.unlockVia !== undefined && node.unlockVia !== 'cost' && !node.unlockPaid) return false;
  return table !== null && table.appliesTo.type === node.type && table.appliesTo.maxLevel === node.maxLevel;
}
