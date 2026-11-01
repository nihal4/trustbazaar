// The language of the page (NFR-USE-04; section 6.1): chosen at any time from the header, kept for
// the next visit, and reflected in <html lang> so screen readers pronounce the text correctly.
import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { translator, type T } from './catalogue';
import { loadBanglaFont } from './font';
import { chooseLang, type Lang } from './lang';
import { readStoredLang, storeLang } from './storage';

interface LanguageValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: T;
}

const LanguageContext = createContext<LanguageValue | null>(null);

export function initialLang(): Lang {
  return chooseLang(readStoredLang(), globalThis.navigator?.languages ?? []);
}

export function LanguageProvider({ children, initial }: { children: ReactNode; initial?: Lang }) {
  const [lang, setLangState] = useState<Lang>(() => initial ?? initialLang());

  useLayoutEffect(() => {
    document.documentElement.lang = lang;
    if (lang === 'bn') loadBanglaFont();
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    storeLang(next);
    setLangState(next);
  }, []);

  const value = useMemo(() => ({ lang, setLang, t: translator(lang) }), [lang, setLang]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageValue {
  const v = useContext(LanguageContext);
  if (!v) throw new Error('useLanguage outside LanguageProvider');
  return v;
}
