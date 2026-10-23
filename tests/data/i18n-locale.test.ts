import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { LANGS, DEFAULT_LANG } from '../../src/lib/i18n';
import { applyLocale, buildLocaleText, localeIssues, localizeKeywords } from '../../src/lib/tree-locale';
import { readTree } from '../helpers/read-tree';
import type { GlossaryRecord } from '../../src/lib/types';

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
