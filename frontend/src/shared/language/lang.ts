// Bangla and English (NFR-USE-04; docs/design/08_frontend.pdf, section 6.1).
export type Lang = 'en' | 'bn';

/**
 * DV-58: with no choice yet, Bangla if the browser prefers Bangla, otherwise English. "Prefers" means
 * Bangla comes before English in the browser's list; a list with neither gives English.
 */
export function chooseLang(stored: Lang | null, preferred: readonly string[] = []): Lang {
  if (stored) return stored;
  for (const tag of preferred) {
    const primary = tag.toLowerCase().split('-')[0];
    if (primary === 'bn') return 'bn';
    if (primary === 'en') return 'en';
  }
  return 'en';
}

export const otherLang = (lang: Lang): Lang => (lang === 'bn' ? 'en' : 'bn');
