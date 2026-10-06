import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildGlossary, GROUPS, GUIDE_TABS, KEYWORDS_PATH, termHref,
} from '../../src/lib/glossary-groups';
import type { GlossaryRecord, TreeNode } from '../../src/lib/types';

const keywords = JSON.parse(readFileSync('data/keywords.json', 'utf8')) as Record<string, GlossaryRecord>;

/** buildGlossary 只讀節點的 id／name／description／awakening。 */
const node = (id: string, description: string, awakening?: string) =>
  ({ id, name: `n${id}`, description, ...(awakening ? { awakening } : {}) }) as unknown as TreeNode;

const SYNTH: Record<string, GlossaryRecord> = {
  果實: { code: 'SOW', color: GROUPS[0]!.color, desc: '果實的解釋' },
  播種: { aliasOf: '果實' },
  冰凍: { code: 'FROZEN', color: GROUPS[2]!.color, desc: '冰凍的解釋' },
};

describe('GUIDE_TABS（/guide/keywords 的分類）', () => {
  it('每個色碼分組都恰好屬於一個分類', () => {
    // 分組沒有歸到任何分類的話，那一組的詞條在頁面上永遠切不出來；歸到兩個則會印兩次、錨點撞號。
    for (const g of GROUPS) {
      const owners = GUIDE_TABS.filter(t => t.groups.includes(g.slug)).map(t => t.slug);
      expect(owners, `分組 ${g.slug}`).toHaveLength(1);
    }
  });

  it('分類 slug 不撞號，而且每個都有舊網址的 301（public/_redirects）', () => {
    const slugs = GUIDE_TABS.map(t => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const redirects = readFileSync('public/_redirects', 'utf8');
    const targets = [...redirects.matchAll(/^\/guide\/([a-z-]+)(\/?) \/guide\/keywords\/\?tab=([a-z-]+) 301$/gm)];
    // 舊網址與 tab 參數一一對應：`/guide/<slug>` 一定轉到 `?tab=<slug>`。
    for (const [, from, , tab] of targets) expect(tab).toBe(from);
    // 帶與不帶尾斜線各一條：Pages 的 _redirects 逐字比對路徑，少一條那種寫法就 404。
    const sources = targets.map(([, from, slash]) => `${from}${slash}`).sort();
    expect(sources).toEqual(slugs.flatMap(s => [s, `${s}/`]).sort());
  });
});

describe('buildGlossary／termHref', () => {
  it('真實資料：每個非別名詞條都進了某個分組，連結都指向詞彙頁', () => {
    const index = buildGlossary(keywords, []);
    for (const [term, rec] of Object.entries(keywords)) {
      const href = termHref(index, term);
      const anchor = 'aliasOf' in rec ? (keywords[rec.aliasOf] as { code: string }).code : rec.code;
      expect(href, term).toBe(`${KEYWORDS_PATH}#${anchor}`);
    }
    const grouped = Object.values(index.byGroup).flat().length;
    expect(grouped).toBe(Object.values(keywords).filter(r => !('aliasOf' in r)).length);
  });

  it('別名查到的是本尊那一筆（同一個物件），連結指向本尊的錨點', () => {
    const index = buildGlossary(SYNTH, []);
    expect(index.byTerm.get('播種')).toBe(index.byTerm.get('果實'));
    expect(index.byTerm.get('果實')!.aliases).toEqual(['播種']);
    expect(termHref(index, '播種')).toBe(`${KEYWORDS_PATH}#SOW`);
    // 別名不是獨立詞條：分組裡只有本尊。
    expect(index.byGroup[GROUPS[0]!.slug].map(i => i.term)).toEqual(['果實']);
  });

  it('查不到的詞回 null（呼叫端就不包連結）', () => {
    expect(termHref(buildGlossary(SYNTH, []), '不存在')).toBeNull();
  });

  it('同一節點同時寫本尊與別名、描述與覺醒都寫，usedBy 只算一次', () => {
    const index = buildGlossary(SYNTH, [
      node('1001', '產生#果實，再#播種', '覺醒後#果實加倍'),
      node('1002', '賦予#冰凍'),
    ]);
    expect(index.byTerm.get('果實')!.usedBy.map(u => u.id)).toEqual(['1001']);
    expect(index.byTerm.get('冰凍')!.usedBy.map(u => u.id)).toEqual(['1002']);
  });

  it('只寫在覺醒文案裡的詞也算用到', () => {
    const index = buildGlossary(SYNTH, [node('1001', '沒有標記', '覺醒後賦予#冰凍')]);
    expect(index.byTerm.get('冰凍')!.usedBy.map(u => u.id)).toEqual(['1001']);
  });

  it('沒見過的色碼當場丟例外，不悄悄塞進某一組', () => {
    expect(() => buildGlossary({ 新詞: { code: 'NEW', color: '#123456', desc: 'x' } }, []))
      .toThrow(/色碼 #123456 不在已知的五組裡/);
  });
});
