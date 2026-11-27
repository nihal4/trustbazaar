// The language of the page (NFR-USE-04; section 6.1): chosen at any time from the header, kept for
// the next visit, and reflected in <html lang> so screen readers pronounce the text correctly.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { translator, type Catalogue, type T } from './catalogue';
import { ensureLangFonts, loadBanglaFont, loadLatinFont } from './font';
import { LanguageSkeleton } from './LanguageSkeleton';
import { chooseLang, type Lang } from './lang';
import { readStoredLang, storeLang } from './storage';

interface LanguageValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: T;
}

const LanguageContext = createContext<LanguageValue | null>(null);
const sr = 'tb-sr-only';
const MIN_MS = 750;
const LEAVE_MS = 300;

export function initialLang(): Lang {
  return chooseLang(readStoredLang(), globalThis.navigator?.languages ?? []);
}

export function LanguageProvider({ children, initial }: { children: ReactNode; initial?: Lang }) {
  const [lang, setLangState] = useState<Lang>(() => initial ?? initialLang());

  useLayoutEffect(() => {
    document.documentElement.lang = lang;
    loadLatinFont();
    if (lang === 'bn') loadBanglaFont();
  }, [lang]);

  // A change of language shows a full-page skeleton while the new language renders underneath and its fonts load, so the change
  // of typeface is never seen. It stays at least MIN_MS (so it reads as a deliberate transition), at most as long as the fonts take.
  const [phase, setPhase] = useState<'idle' | 'loading' | 'leaving'>('idle');
  const current = useRef(lang);
  current.current = lang;
  const setLang = useCallback((next: Lang) => {
    if (next === current.current) return;
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPhase('loading');
    storeLang(next);
    setLangState(next);
    const min = new Promise<void>((resolve) => setTimeout(resolve, MIN_MS));
    void Promise.all([ensureLangFonts(next), min]).then(() =>
      requestAnimationFrame(() => {
        setPhase('leaving');
        setTimeout(() => {
          setPhase('idle');
          if (focused?.isConnected) focused.focus();
        }, LEAVE_MS);
      }),
    );
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    const app = document.getElementById('root');
    if (phase === 'loading') root.setAttribute('aria-busy', 'true');
    else root.removeAttribute('aria-busy');
    // nothing underneath the loading screen can be reached by keyboard or screen reader until it is gone
    if (app) app.inert = phase !== 'idle';
  }, [phase]);

  const value = useMemo(() => ({ lang, setLang, t: translator(lang) }), [lang, setLang]);
  return (
    <LanguageContext.Provider value={value}>
      {children}
      {phase !== 'idle' && <LanguageSkeleton leaving={phase === 'leaving'} />}
      <span className={sr} aria-live="polite">
        {phase === 'loading' ? value.t('shell.language.changing') : ''}
      </span>
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageValue {
  const v = useContext(LanguageContext);
  if (!v) throw new Error('useLanguage outside LanguageProvider');
  return v;
}

/**
 * The translator for a feature: the shell's messages plus the feature's own catalogue
 * (section 6.1). Pass a constant object, so the translator changes only with the language.
 */
export function useT(feature: Record<Lang, Catalogue>): { t: T; lang: Lang } {
  const { lang } = useLanguage();
  const t = useMemo(() => translator(lang, feature), [lang, feature]);
  return { t, lang };
}
