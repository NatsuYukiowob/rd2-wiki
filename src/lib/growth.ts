import type { Growth, GrowthUnit } from './types.js';

const PATTERN = /(-?[\d.]+)\s*(%|秒|次|個|倍)?\s*\(\+(-?[\d.]+)\s*(%|秒|次|個|倍)?\)/;

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toUnit(raw: string | undefined): GrowthUnit {
  if (raw === '%') return '%';
  if (raw === '秒') return 's';
  if (raw === '次' || raw === '個') return 'count';
  if (raw === '倍') return 'x';
  return '';
}

export function parseGrowth(description: string): { growth: Growth | null; dataIssue: 'placeholder' | null } {
  if (/\{\d+\}/.test(description)) return { growth: null, dataIssue: 'placeholder' };
  const m = PATTERN.exec(description);
  if (!m) return { growth: null, dataIssue: null };
  const outer = toUnit(m[2]);
  const inner = toUnit(m[4]);
  // 兩邊都明確標了單位卻不同，才視為資料錯誤（例如「20%(+4秒)」）。
  // 節點 2208「距離等比傷害倍率增加50倍(+10)」括號內省略了單位，此時視為沿用
  // 括號外已標記的單位，不當成錯誤——全站掃過只有這一個節點是這種省略寫法。
  if (m[2] !== undefined && m[4] !== undefined && outer !== inner) {
    throw new Error(`成長值單位不一致 (${m[2]} vs ${m[4]}): ${description}`);
  }
  const unit = outer || inner;
  return {
    growth: { base: round2(Number(m[1])), perLevel: round2(Number(m[3])), unit },
    dataIssue: null,
  };
}

export function maxLevelValue(growth: Growth, maxLevel: number): number {
  return round2(growth.base + growth.perLevel * (maxLevel - 1));
}
