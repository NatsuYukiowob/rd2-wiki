import { describe, it, expect } from 'vitest';
import { langFromPath, stripLang, localizePath, messages, LANGS } from '../../src/lib/i18n';

describe('langFromPath', () => {
  it('沒有前綴是預設語言', () => {
    expect(langFromPath('/')).toBe('zh');
    expect(langFromPath('/tree/')).toBe('zh');
  });
  it('/vi 前綴是越南文', () => {
    expect(langFromPath('/vi')).toBe('vi');
    expect(langFromPath('/vi/')).toBe('vi');
    expect(langFromPath('/vi/guide/keywords/')).toBe('vi');
  });
  it('只認完整的一段，/video/ 不是越南文', () => {
    expect(langFromPath('/video/')).toBe('zh');
  });
});

describe('localizePath', () => {
  it('預設語言原樣回傳', () => {
    expect(localizePath('/tree/', 'zh')).toBe('/tree/');
    expect(localizePath('/vi/tree/', 'zh')).toBe('/tree/');
    expect(localizePath('/vi/', 'zh')).toBe('/');
  });
  it('加前綴、保留 query 與 hash', () => {
    expect(localizePath('/', 'vi')).toBe('/vi/');
    expect(localizePath('/tree/?node=2004', 'vi')).toBe('/vi/tree/?node=2004');
    expect(localizePath('/guide/keywords/#a1', 'vi')).toBe('/vi/guide/keywords/#a1');
  });
  it('重複呼叫不疊前綴', () => {
    expect(localizePath(localizePath('/dice/', 'vi'), 'vi')).toBe('/vi/dice/');
  });
  it('站外網址不動', () => {
    expect(localizePath('https://github.com/', 'vi')).toBe('https://github.com/');
  });
  it('stripLang 是 localizePath(…, zh) 的同義詞', () => {
    expect(stripLang('/vi/sim/')).toBe('/sim/');
    expect(stripLang('/vi')).toBe('/');
  });
});

describe('messages', () => {
  /** 逐鍵比對兩份字典的形狀（型別已經守了鍵，這裡守「值不是空字串」與函式的參數個數）。 */
  const shape = (o: unknown, path = ''): string[] => {
    if (typeof o === 'function') return [`${path}()${o.length}`];
    if (typeof o === 'string') return [path];
    return Object.entries(o as object).flatMap(([k, v]) => shape(v, `${path}.${k}`));
  };
  it('每個語言的鍵與函式參數個數一致', () => {
    const ref = shape(messages('zh'));
    for (const l of LANGS) expect(shape(messages(l))).toEqual(ref);
  });
  it('越南文沒有漏翻成中文的字串', () => {
    const han = /\p{Script=Han}/u;
    const walk = (o: unknown, path = ''): string[] => {
      if (typeof o === 'string') return han.test(o) ? [path] : [];
      if (typeof o === 'function') return [];
      return Object.entries(o as object).flatMap(([k, v]) => walk(v, `${path}.${k}`));
    };
    expect(walk(messages('vi'))).toEqual([]);
  });
});
