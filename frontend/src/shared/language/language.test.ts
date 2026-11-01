import { describe, expect, it } from 'vitest';
import { placeholders } from '../../lib/i18n.js';
import libEn from '../../lib/messages/en.json';
import shellEn from '../../messages/en/shell.json';
import shellBn from '../../messages/bn/shell.json';
import { chooseLang } from './lang';
import { readStoredLang, storeLang } from './storage';

// docs/design/08_frontend.pdf, section 6.1.
describe('default language', () => {
  it.each([
    [['bn-BD', 'en'], 'bn'],
    [['bn'], 'bn'],
    [['en-US', 'bn'], 'en'],
    [['fr-FR', 'bn-IN', 'en'], 'bn'],
    [['fr-FR', 'de'], 'en'],
    [[], 'en'],
  ] as const)('DV-58 a browser preferring %j starts in %s', (preferred, lang) => {
    expect(chooseLang(null, preferred)).toBe(lang);
  });

  it('NFR-USE-04 a choice already made wins over the browser', () => {
    expect(chooseLang('en', ['bn-BD'])).toBe('en');
    expect(chooseLang('bn', ['en-US'])).toBe('bn');
  });
});

describe('the kept choice', () => {
  const memory = (): Storage => {
    const m = new Map<string, string>();
    return {
      getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k),
      clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; },
    };
  };

  it('NFR-USE-04 the choice is kept for the next visit', () => {
    const store = memory();
    expect(readStoredLang(store)).toBeNull();
    storeLang('bn', store);
    expect(readStoredLang(store)).toBe('bn');
  });

  it('NFR-USE-04 an unknown stored value and a storage that throws are ignored', () => {
    const store = memory();
    store.setItem('tb-lang', 'fr');
    expect(readStoredLang(store)).toBeNull();
    const broken = { ...memory(), getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(() => storeLang('bn', broken)).not.toThrow();
    expect(readStoredLang(broken)).toBeNull();
  });
});

describe('the shell catalogues', () => {
  const en: Record<string, string> = shellEn;
  const bn: Record<string, string> = shellBn;

  it('NFR-USE-04 both languages have the same keys and placeholders', () => {
    expect(Object.keys(bn).sort()).toEqual(Object.keys(en).sort());
    for (const k of Object.keys(en)) expect(placeholders(bn[k]), k).toEqual(placeholders(en[k]));
  });

  it('NFR-USE-04 the Bangla catalogue is in Bangla script', () => {
    // brand names and the name of the other language stay as they are
    const exempt = new Set(['shell.language.other']);
    for (const [k, v] of Object.entries(bn)) {
      if (!exempt.has(k)) expect(v, k).toMatch(/[ঀ-৿]/);
    }
    expect(en['shell.language.other']).toMatch(/[ঀ-৿]/);
  });

  it('SEC-INP-03 no message contains markup', () => {
    for (const [k, v] of [...Object.entries(en), ...Object.entries(bn)]) expect(v, k).not.toMatch(/[<>]|&\w+;/);
  });

  it('NFR-USE-04 the shell does not redefine a key of the reference catalogue', () => {
    const lib: Record<string, string> = libEn;
    expect(Object.keys(en).filter((k) => k in lib)).toEqual([]);
  });
});
