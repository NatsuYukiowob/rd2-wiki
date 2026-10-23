// 獎勵頁的譯本（`data/i18n/<lang>/rewards.json`）：原文整句 → 譯文。
// 同一句在任務、成就群組、門檻標題重複出現，所以不以路徑為鍵。
// id、itemId 這些 join key 不翻（成就群組的 id 就是中文名稱，畫面讀的是 name）。
import type { RewardCatalog, RewardGrant, RewardReferenceSection } from './types.js';

const NUMBER = /\d+(?:\.\d+)?/g;
const numbers = (s: string) => (s.match(NUMBER) ?? []).sort().join();

function grants(list: RewardGrant[], map: (s: string) => string): void {
  for (const g of list) if (g.type !== 'currency') g.label = map(g.label);
}

function section(s: RewardReferenceSection, map: (s: string) => string, withNote: boolean): void {
  s.title = map(s.title);
  s.metricLabel = map(s.metricLabel);
  if (withNote && s.note) s.note = map(s.note);
  for (const img of Object.values(s.tierImages ?? {})) img.alt = map(img.alt);
  for (const tier of s.tiers) grants(tier.rewards, map);
}

/** 畫面上會印出來的句子。維護者註記（catalog.note、每日獎勵那條 note）不在裡面。 */
export function rewardTexts(catalog: RewardCatalog): string[] {
  const found: string[] = [];
  const dict = new Proxy({} as Record<string, string>, {
    get: (_target, key) => {
      if (typeof key !== 'string') return undefined;
      found.push(key);
      return key;
    },
  });
  localizeRewards(catalog, dict);
  return found;
}

/**
 * 疊譯文。`dict` 缺席時原樣退回（預設語言）。有譯本時缺句就留原文，
 * 由 `rewardLocaleIssues()` 在測試裡擋下來。
 */
export function localizeRewards(catalog: RewardCatalog, dict?: Record<string, string>): RewardCatalog {
  if (!dict) return catalog;
  const out = structuredClone(catalog);
  const map = (s: string) => dict[s] ?? s;
  for (const mode of out.modes) {
    mode.name = map(mode.name);
    if (mode.kind === 'threshold') {
      mode.requirementLabel = map(mode.requirementLabel);
      for (const day of mode.taskDays ?? []) for (const task of day.tasks) task.name = map(task.name);
      for (const tier of mode.tiers) grants(tier.rewards, map);
    } else {
      for (const group of mode.groups) {
        group.name = map(group.name);
        for (const stage of group.stages) grants(stage.rewards, map);
      }
    }
  }
  const rep = out.repeatable;
  if (rep) {
    rep.name = map(rep.name);
    for (const s of rep.sections) section(s, map, true);
    for (const task of rep.dailyTasks.tasks) task.name = map(task.name);
    section(rep.dailyTasks.rewards, map, false);
  }
  return out;
}

const CJK = /[\u3400-\u9fff]/;

export function rewardLocaleIssues(catalog: RewardCatalog, dict: Record<string, string>): string[] {
  const texts = new Set(rewardTexts(catalog).filter(t => CJK.test(t)));
  const issues: string[] = [];
  for (const t of texts) if (!(t in dict)) issues.push(`獎勵文案沒有譯文：${t}`);
  for (const k of Object.keys(dict)) if (!texts.has(k)) issues.push(`譯文沒有對上正本：${k}`);
  for (const [k, v] of Object.entries(dict)) {
    if (!v.trim()) issues.push(`譯文是空的：${k}`);
    else if (numbers(k) !== numbers(v)) issues.push(`數字對不上：正本 [${numbers(k)}]、譯文 [${numbers(v)}]（${k}）`);
    else if (CJK.test(v)) issues.push(`譯文還有中文：${k}`);
  }
  return issues;
}
