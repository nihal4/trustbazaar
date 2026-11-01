// Form parts that keep the accessibility rules of section 7 in one place: every field has a visible
// label; hints and errors are tied to the field; errors are also listed in a summary at the top,
// which takes focus and links to each field.
import { useEffect, useRef, type InputHTMLAttributes, type ReactNode } from 'react';
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
  const described = [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      {hint && <p id={`${id}-hint`} className={styles.hint}>{hint}</p>}
      {error && <p id={`${id}-error`} className={styles.error}>{error}</p>}
      <input id={id} value={value} onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined} aria-describedby={described} {...input} />
    </div>
  );
}

interface CheckboxProps {
  id: string;
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: string;
}

export function CheckboxField({ id, label, checked, onChange, error }: CheckboxProps) {
  return (
    <div className={styles.checkbox}>
      {error && <p id={`${id}-error`} className={styles.error}>{error}</p>}
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined} />
      <label htmlFor={id}>{label}</label>
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
