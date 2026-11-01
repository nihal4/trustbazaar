// The messages of the shell: the reference catalogues of lib/ (money states, consequences, errors,
// simulated services) and the shell's own file. A feature adds its own file under
// src/messages/<lang>/ with the same keys in both languages (section 6.1).
import { createT } from '../../lib/i18n.js';
import libEn from '../../lib/messages/en.json';
import libBn from '../../lib/messages/bn.json';
import shellEn from '../../messages/en/shell.json';
import shellBn from '../../messages/bn/shell.json';
import type { Lang } from './lang';

export type Catalogue = Record<string, string>;
export type T = (key: string, vars?: Record<string, string>) => string;

export const SHELL_CATALOGUES: Record<Lang, Catalogue> = {
  en: { ...libEn, ...shellEn },
  bn: { ...libBn, ...shellBn },
};

/** In development and tests a missing key or placeholder throws; in production it shows the key. */
export function translator(lang: Lang, extra: Partial<Record<Lang, Catalogue>> = {}): T {
  return createT({ ...SHELL_CATALOGUES[lang], ...extra[lang] }, { strict: import.meta.env.DEV });
}
