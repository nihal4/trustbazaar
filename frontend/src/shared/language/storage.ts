// The guest's language choice (docs/design/08_frontend.pdf, sections 6.1 and 8.2). This is the only
// module allowed to use localStorage (eslint.config.js). Signed-in users keep their choice here too,
// until Unit 6's notification preferences can hold it (U8-08; Decisions log, U8-01).
// Storage may be missing or refuse writes (private windows, blocked storage): the choice then lasts
// for this page only.
import type { Lang } from './lang';

const KEY = 'tb-lang';

export function readStoredLang(store: Storage | undefined = globalThis.localStorage): Lang | null {
  try {
    const v = store?.getItem(KEY);
    return v === 'bn' || v === 'en' ? v : null;
  } catch {
    return null;
  }
}

export function storeLang(lang: Lang, store: Storage | undefined = globalThis.localStorage): void {
  try {
    store?.setItem(KEY, lang);
  } catch {
    // not kept; the page still switches
  }
}
