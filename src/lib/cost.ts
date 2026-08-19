import type { ParsedCost } from './types.js';

const LEVEL = /^最高 (\d+) 級$/;

/**
 * 成本上限。正則只管「長得像不像數字」，不管大小——`核心 999999999999999999999` 是合法字面，
 * `Number()` 給回一個超過安全整數範圍的值，加總出來的全樹成本就開始失去精度（而且是**安靜地**）。
 * 這兩個數字比遊戲裡任何現實數值大兩個數量級以上，撞到它代表資料寫錯了，不是遊戲改版。
 */
const MAX_CORE = 10_000;
const MAX_GOLD = 100_000_000;

function checkAmount(kind: string, n: number, max: number): number {
  if (!Number.isSafeInteger(n)) throw new Error(`${kind} 必須是安全整數範圍內的整數: ${n}`);
  if (n > max) throw new Error(`${kind} ${n} 超過上限 ${max}（資料應該寫錯了）`);
  return n;
}

// 金幣開頭：金幣 <N> 可選搭配 ／核心 <N>
const GOLD_PATTERN = /^金幣 (\d{1,3}(?:,\d{3})*)(?:／核心 (\d+))?$/;
// 核心開頭：核心 <N>（不允許搭配其他）
const CORE_PATTERN = /^核心 (\d+)$/;

export function parseCost(raw: string): ParsedCost {
  const [head, tail, ...rest] = raw.split('\n');
  if (rest.length > 0 || head === undefined) throw new Error(`成本字串行數異常: ${JSON.stringify(raw)}`);
  if (head.includes('/')) throw new Error(`分隔符必須是全形／: ${head}`);

  let core = 0;
  let gold = 0;

  // 檢查重複欄位
  if ((head.startsWith('金幣 ') && head.includes('／金幣 ')) ||
      (head.startsWith('核心 ') && head.includes('／核心 '))) {
    throw new Error(`成本格式錯誤：同一種貨幣不可重複出現`);
  }

  // 檢查順序錯誤：如果以核心開頭且含有斜線，表示格式錯誤（核心不應與其他組合）
  if (head.startsWith('核心 ') && head.includes('／')) {
    throw new Error(`成本格式錯誤：金幣必須在核心之前，不可顛倒順序`);
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

  let maxLevel: number | null = null;
  if (tail !== undefined) {
    const l = LEVEL.exec(tail);
    if (!l) throw new Error(`無法解析等級上限: ${JSON.stringify(tail)}`);
    maxLevel = Number(l[1]!);
    if (maxLevel < 1 || maxLevel > 100) throw new Error(`等級上限須在 1..100: ${maxLevel}`);
  }
  return { cost: { core, gold }, maxLevel };
}
