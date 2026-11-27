// Form parts that keep the accessibility rules of section 7 in one place: every field has a visible
// label; hints and errors are tied to the field; errors are also listed in a summary at the top,
// which takes focus and links to each field.
import { useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { toAsciiDigits, toLocalDigits } from '../lib/money.js';
import { useLanguage } from './language/Language';
import styles from './form.module.css';

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'value' | 'onChange'>;

interface FieldProps extends InputProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string;
}

export function TextField({ id, label, value, onChange, hint, error, ...input }: FieldProps) {
  // the field's own hint and error, after whatever the page already ties it to (the heading, a message under it): none of them may replace the others
  const described = [input['aria-describedby'], hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
  const isPassword = input.type === 'password';
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      {hint && <p id={`${id}-hint`} className={styles.hint}>{hint}</p>}
      {isPassword
        ? <PasswordInput id={id} value={value} onChange={onChange} invalid={Boolean(error)} described={described} input={input} />
        : <input id={id} value={value} onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined} {...input} aria-describedby={described} />}
      {error && <p id={`${id}-error`} className={styles.error}>{error}</p>}
    </div>
  );
}

interface CodeFieldProps extends Omit<InputProps, 'maxLength' | 'type' | 'inputMode' | 'autoComplete'> {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string;
  /** how many digits the code has (a one-time code is 6) */
  length?: number;
}

/**
 * A one-time code of digits, shown as cells divided by lines (U10-25): `| 4 | 8 | 2 | 0 | 1 | 7 |`. It is one real input (so pasting, autofill and the SMS and
 * e-mail suggestions of a phone all work) laid over the cells, which only show what was typed; the next empty cell is marked. What is typed or pasted is
 * made digits (the digits of Bangla too), spaces and dashes dropped, and cut at the length.
 */
export function CodeField({ id, label, value, onChange, hint, error, length = 6, ...input }: CodeFieldProps) {
  const { lang } = useLanguage();
  const [focused, setFocused] = useState(false);
  const described = [input['aria-describedby'], hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
  const digits = toAsciiDigits(value).replace(/\D/g, '').slice(0, length);
  const next = Math.min(digits.length, length - 1);
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      {hint && <p id={`${id}-hint`} className={styles.hint}>{hint}</p>}
      <div className={styles.codeGroup} data-focused={focused || undefined} data-invalid={error || input['aria-invalid'] ? true : undefined}>
        <input id={id} className={styles.codeInput} value={digits} inputMode="numeric" autoComplete="one-time-code"
          aria-invalid={error ? true : undefined} {...input} aria-describedby={described}
          onChange={(e) => onChange(toAsciiDigits(e.target.value).replace(/\D/g, '').slice(0, length))}
          onFocus={(e) => { setFocused(true); input.onFocus?.(e); }} onBlur={(e) => { setFocused(false); input.onBlur?.(e); }} />
        <div className={styles.codeCells} aria-hidden="true" style={{ gridTemplateColumns: `repeat(${length}, minmax(0, 1fr))` }}>
          {Array.from({ length }, (_, i) => (
            <span key={i} data-here={focused && i === next ? true : undefined}>{digits[i] ? toLocalDigits(digits[i], lang) : ''}</span>
          ))}
        </div>
      </div>
      {error && <p id={`${id}-error`} className={styles.error}>{error}</p>}
    </div>
  );
}

/** A password field with an eye: the button shows or hides what was typed (U10-25); a toggle, not a link, with its state in aria-pressed. */
function PasswordInput({ id, value, onChange, invalid, described, input }: { id: string; value: string; onChange: (v: string) => void; invalid: boolean; described?: string; input: InputProps }) {
  const { t } = useLanguage();
  const [shown, setShown] = useState(false);
  return (
    <div className={styles.passwordWrap}>
      <input id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid ? true : undefined}
        {...input} aria-describedby={described} type={shown ? 'text' : 'password'} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
      <button type="button" className={styles.eye} aria-pressed={shown} aria-label={t(shown ? 'form.hide_password' : 'form.show_password')} onClick={() => setShown((v) => !v)}>
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
          {shown && <path d="M4 20 20 4" />}
        </svg>
      </button>
    </div>
  );
}

interface CheckboxProps {
  id: string;
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: string;
  autoFocus?: boolean;
}

export function CheckboxField({ id, label, checked, onChange, error, autoFocus }: CheckboxProps) {
  return (
    <div className={styles.checkbox}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} autoFocus={autoFocus}
        aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined} />
      <label htmlFor={id}>{label}</label>
      {error && <p id={`${id}-error`} className={styles.error}>{error}</p>}
    </div>
  );
}

export interface SummaryItem {
  id: string;
  message: string;
}

/** Shown when a submit finds errors; takes focus each time the list changes. */
export function ErrorSummary({ title, items }: { title: string; items: SummaryItem[] }) {
  const box = useRef<HTMLDivElement>(null);
  const key = items.map((i) => `${i.id}:${i.message}`).join('|');
  useEffect(() => {
    if (key) box.current?.focus();
  }, [key]);
  if (items.length === 0) return null;
  return (
    <div ref={box} tabIndex={-1} className={styles.summary} role="alert" aria-labelledby="error-summary-title">
      <h2 id="error-summary-title">{title}</h2>
      <ul>
        {items.map((i) => (
          <li key={i.id}>
            <a href={`#${i.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(i.id)?.focus(); }}>
              {i.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A message about the whole form (a refused sign-in, a sent link); announced politely or as an alert. */
export function FormMessage({ kind, children }: { kind: 'error' | 'info' | 'success'; children: ReactNode }) {
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={styles[kind]}>
      {children}
    </div>
  );
}

/** The main button of a form: disabled from the click until the answer (section 4.2, "Sent once"). */
export function SubmitButton({ busy, disabled, children }: { busy: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="submit" className={styles.primary} disabled={busy || disabled} aria-busy={busy || undefined}>
      {children}
    </button>
  );
}
