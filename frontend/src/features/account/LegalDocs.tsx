// The terms and conditions and the privacy notice as one piece of content (U10-25): shown on /help/terms and /help/privacy, and in a dialog from the
// last step of registration, so a member reads the same text in both places. The dialog is a real one: it holds the focus, closes on Escape, gives the
// focus back to what opened it, and its text scrolls in a region the keyboard can reach.
import { createElement, useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { toLocalDigits } from '../../lib/money.js';
import { useAccountT } from './common';
import { LEGAL_VERSIONS } from './legal';
import { TERMS_TEXT } from './legalText';
import { PrivacyPoints } from './PrivacyNotice';
import styles from './account.module.css';

/** The terms: the introduction, then the numbered sections and their numbered clauses. `level` is the heading level of a section's title. */
export function TermsBody({ level = 2 }: { level?: 2 | 3 }) {
  const { lang } = useAccountT();
  const text = TERMS_TEXT[lang === 'bn' ? 'bn' : 'en'];
  const n = (i: number) => toLocalDigits(String(i), lang);
  return (
    <div className={styles.legal}>
      <p>{text.intro}</p>
      {text.sections.map((s, i) => (
        <section key={s.title} aria-label={s.title}>
          {createElement(`h${level}`, null, `${n(i + 1)}. ${s.title}`)}
          <ol>
            {s.clauses.map((c, j) => (
              <li key={j}>
                <span className={styles.clauseNo}>
                  {n(i + 1)}.{n(j + 1)}
                </span>{' '}
                {c}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function LegalDialog({ kind, opener, onClose }: { kind: 'terms' | 'privacy'; opener?: HTMLElement | null; onClose: () => void }) {
  const { t, lang } = useAccountT();
  const box = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(opener ?? (document.activeElement as HTMLElement | null));
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const before = returnTo.current;
    const scrollY = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    box.current?.querySelector<HTMLElement>('[data-first]')?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== 'Tab' || !box.current) return;
      const items = Array.from(box.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const [first, last] = [items[0], items[items.length - 1]];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !box.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !box.current.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('keydown', key, true);
      document.body.style.overflow = scrollY;
      before?.focus?.();
    };
  }, []);

  const title = kind === 'terms' ? t('legal.terms_title') : t('privacy.title');
  const version = toLocalDigits(kind === 'terms' ? LEGAL_VERSIONS.terms : LEGAL_VERSIONS.privacy, lang);
  const body: ReactNode = kind === 'terms' ? <TermsBody level={3} /> : <PrivacyPoints />;
  return createPortal(
    <div
      className={styles.dialogBackdrop}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby="legal-dialog-title" className={styles.dialog}>
        <div className={styles.dialogHead}>
          <div>
            <h2 id="legal-dialog-title">{title}</h2>
            <p className={styles.version}>{t('help.version', { version })}</p>
          </div>
          <button type="button" className={styles.dialogClose} onClick={onClose} aria-label={t('legal.close')}>
            ×
          </button>
        </div>
        <div className={styles.dialogBody} tabIndex={0} role="region" aria-labelledby="legal-dialog-title" data-first>
          {body}
        </div>
      </div>
    </div>,
    document.body,
  );
}
