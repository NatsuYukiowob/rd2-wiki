// /relic 的純函式：把 `data/relics.json`／`data/relic-levels.json` 的陣列整理成頁面要印的字。
// 放在 src/lib 而不是頁面 frontmatter 裡，是為了讓 vitest 量得到（頁面本身只有 E2E 量得到）。
import type { Relic, RelicCrystal, RelicReward } from './types';

/**
 * 樣板裡緊跟在 `{k}` 後面的單位；沒有就是空字串。
 * 清單＝`src/lib/growth.ts` 的成長值單位（`%`／秒／次／個／倍）加上這份資料自己的「隻」。
 * ⚠️ 只能是白名單：`{0}的`、`{0}SP` 這種後面接的不是單位。新單位要加進來，否則逐級表只印裸數字。
 */
export function relicUnit(effect: string, k: number): string {
  return new RegExp(`\\{${k}\\}(%|秒|次|個|倍|隻)`).exec(effect)?.[1] ?? '';
}

/** 把 `{k}` 換成「1 級值～滿級值」。單位留在樣板原位，所以讀起來是「30～140%」。 */
export function relicEffectRange(relic: Relic): string {
  return relic.effect.replace(/\{(\d+)\}/g, (_, k: string) => {
    // 規則 32(n) 保證每個佔位都有自己那組數值。
    const list = relic.values[Number(k)]!;
    return `${list[0]}～${list[list.length - 1]}`;
  });
}

export interface CritBand {
  /** 這一段涵蓋的神器總等級（含頭尾）。 */
  from: number;
  to: number;
  /** 段內每 `step` 級加的暴擊傷害（%）。 */
  per: number;
  /** 到 `to` 為止的累計加成（%）。 */
  total: number;
}

/**
 * 收藏等級表壓成「每段加多少」的區間：相鄰且加成相同的列併成一段。
 * 原表 120 列裡只有 9 種值，逐列印是同一個數字重複十幾次。
 */
export function critBands(critDamage: readonly number[], step: number): CritBand[] {
  const bands: CritBand[] = [];
  let total = 0;
  critDamage.forEach((per, i) => {
    total += per;
    const level = (i + 1) * step;
    const last = bands[bands.length - 1];
    if (last && last.per === per) {
      last.to = level;
      last.total = total;
    } else {
      bands.push({ from: level, to: level, per, total });
    }
  });
  return bands;
}

/** 逐級花費加上累計（第 1 級不用升，從第 2 級起列）。 */
export function costRows(pieces: readonly number[], gold: readonly number[]) {
  let sumPieces = 0;
  let sumGold = 0;
  return pieces.slice(1).map((p, i) => {
    sumPieces += p;
    // 規則 32(l) 保證 pieces 與 gold 等長。
    const g = gold[i + 1]!;
    sumGold += g;
    return { level: i + 2, pieces: p, gold: g, sumPieces, sumGold };
  });
}

/** 獎勵種類的顯示名稱。合法的 `goods` 只有這一份，規則 33 也讀它。 */
export const RELIC_GOODS: Record<RelicReward['goods'], string> = { crystal: '裂縫結晶', gold: '金幣' };

/** 「裂縫結晶 ×3」「金幣 ×20,000」。 */
export function rewardText(r: RelicReward): string {
  return `${RELIC_GOODS[r.goods]} ×${r.amount.toLocaleString('en-US')}`;
}

/** 幾筆獎勵依種類加總，照 `RELIC_GOODS` 的順序、只留有拿到的。 */
export function rewardTotals(list: readonly RelicReward[]): RelicReward[] {
  return (Object.keys(RELIC_GOODS) as RelicReward['goods'][])
    .map(goods => ({ goods, amount: list.filter(r => r.goods === goods).reduce((n, r) => n + r.amount, 0) }))
    .filter(r => r.amount > 0);
}

/** 覺醒之甕逐檔加上「領到這一檔為止」的累計（同種類才累加；目前全是裂縫結晶）。 */
export function potRows(tiers: RelicCrystal['pot']['tiers']) {
  return tiers.map((t, i) => ({ ...t, total: rewardTotals(tiers.slice(0, i + 1)) }));
}
