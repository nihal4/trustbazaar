// Building the credential pages without markup strings (SEC-INP-03; the page's policy also forbids them with
// Trusted Types): elements are created and text is set as text.
import { formatDateTime, formatDeadline } from '../lib/time.js';
import type { Lang } from './context';

type Prop = string | number | boolean | ((e: Event) => void) | undefined;
export type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, Prop> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

/** A deadline as a Dhaka time and a countdown, refreshed every second by tick() (NFR-USE-03, NFR-USE-08). */
export function deadline(iso: string, lang: Lang, now: () => number): HTMLElement {
  const el = h('span', { 'data-deadline': iso, 'data-lang': lang });
  el.textContent = formatDeadline(Date.parse(iso), now(), lang);
  return el;
}
export function tick(now: () => number) {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-deadline]'))) {
    el.textContent = formatDeadline(Date.parse(el.dataset.deadline ?? ''), now(), (el.dataset.lang as Lang) ?? 'en');
  }
}
export const when = (iso: string, lang: Lang) => formatDateTime(Date.parse(iso), lang);

/** Replace the screen's content and move focus to its heading, so a screen reader hears the change. */
export function show(root: HTMLElement, ...nodes: Child[]) {
  root.replaceChildren(...nodes.filter((n): n is Node | string => n !== null && n !== undefined && n !== false));
  root.querySelector<HTMLElement>('h1')?.focus();
}

export const b64u = (b: Uint8Array) => {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
