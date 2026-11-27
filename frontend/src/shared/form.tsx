// Form parts that keep the accessibility rules of section 7 in one place: every field has a visible
// label; hints and errors are tied to the field; errors are also listed in a summary at the top,
// which takes focus and links to each field. They are the app's forms on the primitives (shared/ui, U11-06): the field, the checkbox, the notice and the button are drawn there;
// what is here is what needs the app (the language, the digits of Bangla, the one-time code's cells, the eye of a password).
import { useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { toAsciiDigits, toLocalDigits } from '../lib/money.js';
import { useLanguage } from './language/Language';
import { Button, Checkbox, Field, FieldMessage, IconButton, Input, Notice } from './ui';
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
  const own = input['aria-describedby'];
  const isPassword = input.type === 'password';
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      {(control) => {
        const described = [own, control['aria-describedby']].filter(Boolean).join(' ') || undefined;
        return isPassword ? (
          <PasswordInput value={value} onChange={onChange} control={{ ...control, 'aria-describedby': described }} input={input} />
        ) : (
          <Input value={value} onChange={(e) => onChange(e.target.value)} {...control} {...input} aria-describedby={described} />
        );
      }}
    </Field>
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
  /** an authenticator code may be given as a recovery code instead: letters typed turn the cells into one line of text (up to 40 characters) */
  allowRecovery?: boolean;
}

const RECOVERY_MAX = 40;

/**
 * A one-time code of digits, shown as cells divided by lines (U10-25): `| 4 | 8 | 2 | 0 | 1 | 7 |`. It is one real input (so pasting, autofill and the SMS and
 * e-mail suggestions of a phone all work) laid over the cells, which only show what was typed; the next empty cell is marked. What is typed or pasted is
 * made digits (the digits of Bangla too), spaces and dashes dropped, and cut at the length. With `allowRecovery`, a letter turns it into a line of text
 * for a recovery code (`ABCDE-12345`).
 */
export function CodeField({ id, label, value, onChange, hint, error, length = 6, allowRecovery = false, ...input }: CodeFieldProps) {
  const { lang } = useLanguage();
  const [focused, setFocused] = useState(false);
  const recovery = allowRecovery && /[A-Za-z]/.test(value);
  const shown = recovery ? value.replace(/[^A-Za-z0-9-]/g, '').slice(0, RECOVERY_MAX) : toAsciiDigits(value).replace(/\D/g, '').slice(0, length);
  const clean = (raw: string) =>
    allowRecovery && /[A-Za-z]/.test(raw) ? raw.replace(/[^A-Za-z0-9-]/g, '').slice(0, RECOVERY_MAX) : toAsciiDigits(raw).replace(/\D/g, '').slice(0, length);
  const next = Math.min(shown.length, length - 1);
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      {(control) => {
        const described = [input['aria-describedby'], control['aria-describedby']].filter(Boolean).join(' ') || undefined;
        return (
          <div className={styles.codeGroup} data-focused={focused || undefined} data-invalid={error || input['aria-invalid'] ? true : undefined}>
            <input
              id={control.id}
              className={styles.codeInput}
              value={shown}
              inputMode={allowRecovery ? 'text' : 'numeric'}
              autoComplete="one-time-code"
              autoCapitalize="characters"
              spellCheck={false}
              aria-invalid={control['aria-invalid']}
              {...input}
              aria-describedby={described}
              onChange={(e) => onChange(clean(e.target.value))}
              onFocus={(e) => {
                setFocused(true);
                input.onFocus?.(e);
              }}
              onBlur={(e) => {
                setFocused(false);
                input.onBlur?.(e);
              }}
            />
            {recovery ? (
              <div className={styles.codeCells} data-text aria-hidden="true">
                <span data-here={focused ? true : undefined}>{shown}</span>
              </div>
            ) : (
              <div className={styles.codeCells} aria-hidden="true" style={{ gridTemplateColumns: `repeat(${length}, minmax(0, 1fr))` }}>
                {Array.from({ length }, (_, i) => (
                  <span key={i} data-here={focused && i === next ? true : undefined}>
                    {shown[i] ? toLocalDigits(shown[i], lang) : ''}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      }}
    </Field>
  );
}

/** A password field with an eye: the button shows or hides what was typed (U10-25); a toggle, not a link, with its state in aria-pressed. */
function PasswordInput({
  value,
  onChange,
  control,
  input,
}: {
  value: string;
  onChange: (v: string) => void;
  control: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: true };
  input: InputProps;
}) {
  const { t } = useLanguage();
  const [shown, setShown] = useState(false);
  return (
    <div className={styles.passwordWrap}>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...control}
        {...input}
        aria-describedby={control['aria-describedby']}
        type={shown ? 'text' : 'password'}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
      />
      <IconButton
        variant="quiet"
        className={styles.eye}
        aria-pressed={shown}
        label={t(shown ? 'form.hide_password' : 'form.show_password')}
        onClick={() => setShown((v) => !v)}
      >
        <svg
          viewBox="0 0 24 24"
          width="22"
          height="22"
          aria-hidden="true"
          focusable="false"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
          {shown && <path d="M4 20 20 4" />}
        </svg>
      </IconButton>
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
    <div>
      <Checkbox
        id={id}
        label={label}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        autoFocus={autoFocus}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error && (
        <FieldMessage id={`${id}-error`} tone="error">
          {error}
        </FieldMessage>
      )}
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
    <Notice ref={box} tabIndex={-1} tone="error" title={title} headingLevel={2} titleId="error-summary-title">
      <ul className={styles.summaryList}>
        {items.map((i) => (
          <li key={i.id}>
            <a
              href={`#${i.id}`}
              onClick={(e) => {
                e.preventDefault();
                document.getElementById(i.id)?.focus();
              }}
            >
              {i.message}
            </a>
          </li>
        ))}
      </ul>
    </Notice>
  );
}

/** A message about the whole form (a refused sign-in, a sent link); announced politely or as an alert. */
export function FormMessage({ kind, children }: { kind: 'error' | 'info' | 'success'; children: ReactNode }) {
  return (
    <Notice tone={kind} className={styles.message}>
      {children}
    </Notice>
  );
}

/** The main button of a form: disabled from the click until the answer (section 4.2, "Sent once"). */
export function SubmitButton({ busy, disabled, children }: { busy: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    <Button type="submit" variant="primary" loading={busy} disabled={disabled}>
      {children}
    </Button>
  );
}
