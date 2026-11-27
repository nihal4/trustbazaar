// The colour theme of every document (U10-28): "dark" (the default, the look of the app) or "light", kept in this browser (tb-theme) and set on <html data-theme> before
// the first paint by public/theme-init.js. Any component can read it and change it; all follow, in every open tab of the document.
import { useSyncExternalStore } from 'react';

export type ThemeMode = 'light' | 'dark';
const KEY = 'tb-theme';
const EVENT = 'tb-theme-change';

export const currentTheme = (): ThemeMode => (typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

export function setTheme(mode: ThemeMode): void {
  document.documentElement.dataset.theme = mode;
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* blocked storage: the choice lasts for this visit */
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY && (e.newValue === 'light' || e.newValue === 'dark')) {
      document.documentElement.dataset.theme = e.newValue;
      onChange();
    }
  };
  window.addEventListener(EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}

export function useTheme(): [ThemeMode, (mode: ThemeMode) => void] {
  const mode = useSyncExternalStore(subscribe, currentTheme, () => 'dark' as ThemeMode);
  return [mode, setTheme];
}
