import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { LANGS, DEFAULT_LANG } from '../../src/lib/i18n';
import { applyLocale, buildLocaleText, localeIssues, localizeKeywords } from '../../src/lib/tree-locale';
import { readTree } from '../helpers/read-tree';
import { statText } from '../../src/lib/stat-text';
import { BULLET_LABEL } from '../../src/lib/offgame-calc';
import { bossLocaleIssues, localizeBosses, localizeTactics, tacticLocaleIssues, type RecordTerms } from '../../src/lib/record-locale';
import { isGlossaryAlias, type Boss, type GlossaryRecord, type Tactic } from '../../src/lib/types';

const json = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const sourceNodes = json('data/nodes.json');
const sourceKeywords = json('data/keywords.json') as Record<string, GlossaryRecord>;

describe.each(LANGS.filter(l => l !== DEFAULT_LANG))('data/i18n/%s', lang => {
  const nodes = json(`data/i18n/${lang}/nodes.json`);
  const keywords = json(`data/i18n/${lang}/keywords.json`);

  it('跟正本雙向對得上（節點、本尊詞、覺醒有無、#標記、數字）', () => {
    expect(localeIssues(sourceNodes, nodes, sourceKeywords, keywords)).toEqual([]);
  });

  it('疊回 TreeData 之後每個 #標記都查得到解釋，幾何與計算欄位不動', () => {
    const tree = readTree();
    const before = tree.nodes.map(n => [n.id, n.unlockCost, n.maxLevel, n.growth]);
    applyLocale(tree, buildLocaleText(readTree(), nodes, sourceKeywords, keywords));
    expect(tree.nodes.map(n => [n.id, n.unlockCost, n.maxLevel, n.growth])).toEqual(before);
    for (const n of tree.nodes) {
      expect(n.name).toBe(nodes[n.id].name);
      for (const k of n.keywords) expect(tree.meta.glossary[k], `${n.id} ${k}`).toBeDefined();
    }
  });

  it('靜態頁的詞彙表沿用原文的錨點與色碼', () => {
    const local = localizeKeywords(sourceKeywords, keywords);
    const canon = Object.values(sourceKeywords).filter(r => !('aliasOf' in r));
    expect(Object.keys(local)).toHaveLength(canon.length);
    expect(new Set(Object.values(local).map(r => ('code' in r ? r.code : '')))).toEqual(
      new Set(canon.map(r => ('code' in r ? r.code : ''))),
    );
  });
});

const CJK = /[\u3400-\u9fff\uff01-\uff0e\uff10-\uff5e]/;

describe.each(LANGS.filter(l => l !== DEFAULT_LANG))('%s：骰子數值表與 /board 的機制句', lang => {
  it('dice-stats.json 的每一段字（項目名、值、成長寫法、備註）都譯得出來', () => {
    const table = json('data/dice-stats.json') as Record<string, { note?: string; stats: Record<string, string>[] }>;
    const texts = new Set<string>([BULLET_LABEL]);
    for (const e of Object.values(table)) {
      if (e.note) texts.add(e.note);
      for (const s of e.stats) for (const [k, v] of Object.entries(s)) if (k !== 'name') texts.add(v);
    }
    const left = [...texts].filter(t => CJK.test(statText(t, lang)));
    expect(left).toEqual([]);
  });

  it('機制句譯文跟正本同一組節點、同一組佔位符', () => {
    const source = json('data/offgame-effects.json').effects as Record<string, { template?: string }>;
    const local = json(`data/i18n/${lang}/offgame-templates.json`) as Record<string, string>;
    const withTemplate = Object.keys(source).filter(id => source[id]!.template);
    expect(Object.keys(local).sort()).toEqual(withTemplate.sort());
    const holes = (s: string) => (s.match(/\{V2?\}/g) ?? []).sort();
    for (const id of withTemplate) {
      expect(holes(local[id]!), id).toEqual(holes(source[id]!.template!));
      expect(CJK.test(local[id]!), id).toBe(false);
    }
  });
});

describe('localeIssues', () => {
  const src = { '1001': { description: '傷害增加20%(+5%)', awakening: '賦予#燙傷' } };
  const kw = { 燙傷: { code: 'BURN', color: '#9B6BFF', desc: '燒' } } as Record<string, GlossaryRecord>;
  const vkw = { 燙傷: { term: 'Bỏng', desc: 'Cháy' } };
  const ok = { '1001': { name: 'Lửa', description: 'Sát thương tăng 20%(+5%)', awakening: 'Gây #Bỏng' } };

  it('合格的譯本沒有問題', () => {
    expect(localeIssues(src, ok, kw, vkw)).toEqual([]);
  });

  it('數字譯錯、少了覺醒、標記查不到都會被指名', () => {
    const bad = { '1001': { name: 'Lửa', description: 'Sát thương tăng 25%(+5%) #Cháy' } };
    const issues = localeIssues(src, bad, kw, vkw);
    expect(issues.some(s => s.includes('數字對不上'))).toBe(true);
    expect(issues.some(s => s.includes('覺醒有無'))).toBe(true);
    expect(issues.some(s => s.includes('白名單'))).toBe(true);
  });

  it('缺譯文與多出來的譯文雙向列出', () => {
    const issues = localeIssues(src, { '9999': ok['1001'] }, kw, {});
    expect(issues).toEqual(expect.arrayContaining(['節點 1001 沒有譯文', '譯文 9999 不是正本的節點', '詞 燙傷 沒有譯名']));
  });
});

describe.each(LANGS.filter(l => l !== DEFAULT_LANG))('%s：戰術與怪物圖鑑', lang => {
  const vkw = json(`data/i18n/${lang}/keywords.json`) as Record<string, { term: string }>;
  const terms: RecordTerms = {
    sourceTerms: Object.keys(sourceKeywords),
    terms: Object.values(vkw).map(k => k.term),
    translate: t => {
      const r = sourceKeywords[t];
      return vkw[r && isGlossaryAlias(r) ? r.aliasOf : t]?.term;
    },
  };

  it('tactics.json 雙向對得上（欄位有無、數字、#標記），疊回後沒有中文', () => {
    const local = json(`data/i18n/${lang}/tactics.json`);
    const source = json('data/tactics.json') as Tactic[];
    expect(tacticLocaleIssues(source, local, terms)).toEqual([]);
    for (const t of localizeTactics(source, local)) {
      const texts = [t.name, t.versus ?? '', t.coop ?? '', ...(t.options ?? []).flatMap(o => [o.name, o.text])];
      for (const s of texts) expect(CJK.test(s), `${t.id} ${s}`).toBe(false);
    }
  });

  it('boss.json 雙向對得上，疊回後沒有中文', () => {
    const local = json(`data/i18n/${lang}/boss.json`);
    const source = json('data/boss.json') as Boss[];
    expect(bossLocaleIssues(source, local, terms)).toEqual([]);
    for (const b of localizeBosses(source, local)) expect(CJK.test(b.name + b.effect), b.id).toBe(false);
  });
});

describe('tacticLocaleIssues', () => {
  const terms: RecordTerms = { sourceTerms: ['一般怪物'], terms: ['Quái thường'], translate: t => (t === '一般怪物' ? 'Quái thường' : undefined) };
  const src = [{ id: '1', name: '甲', versus: '召喚3個#一般怪物' }] as Tactic[];

  it('缺欄位、多欄位、數字與標記不符都會被指名', () => {
    const issues = tacticLocaleIssues(src, { '1': { name: 'A', coop: 'x' }, '2': { name: 'B' } }, terms);
    expect(issues).toEqual(expect.arrayContaining([
      '戰術 1 的 versus 有無跟正本不一致',
      '戰術 1 的 coop 有無跟正本不一致',
      '譯文 2 不是正本的戰術',
    ]));
    const wrong = tacticLocaleIssues(src, { '1': { name: 'A', versus: 'Triệu hồi 4 quái' } }, terms);
    expect(wrong.some(s => s.includes('數字對不上'))).toBe(true);
    expect(wrong.some(s => s.includes('#標記對不上'))).toBe(true);
    expect(tacticLocaleIssues(src, { '1': { name: 'A', versus: 'Triệu hồi 3 #Quái thường' } }, terms)).toEqual([]);
  });
});
