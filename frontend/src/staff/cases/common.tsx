// What every case screen shares (section 7.9; FR-OPS-02; U8-10): an action is a form with a required reason, its
// consequence confirmed before it runs, the server's refusal in words, and what happened afterwards.
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { ConfirmDialog } from '../../shared/ConfirmDialog';
import { errorText } from '../../shared/errors';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { fieldErrors, problemName } from '../../shared/problems';
import styles from '../staff.module.css';

export const short = (id: string | null | undefined) => (id ? id.slice(0, 8) : '—');

/** The server's refusals the console puts in words; anything else is the shared text. */
const KNOWN = new Set(['not-claimed', 'conflict-of-interest', 'already-claimed', 'feature-off', 'listing-state', 'kyc-cannot-approve']);
const KNOWN_FIELDS = new Set([
  'too-short', 'required', 'between-zero-and-item-price', 'partial-refund-only', 'not-for-this-item', 'live-check-not-matched',
  'use-the-ownership-review', 'underage', 'out-of-range',
]);
export function staffError(e: unknown, t: T, lang: Lang): string {
  const name = problemName(e);
  const field = fieldErrors(e).find((f) => KNOWN_FIELDS.has(f.reason));
  if (field) return t(`staff.refusal.${field.reason}`);
  if (name && KNOWN.has(name)) return t(`staff.refusal.${name}`);
  return errorText(e, t, lang);
}

export function CaseFrame({ title, back, children, t }: { title: string; back: string; children: ReactNode; t: T }) {
  return (
    <div>
      <p><Link to={back}>{t('staff.case.back')}</Link></p>
      <h1>{title}</h1>
      {children}
    </div>
  );
}

export function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className={styles.facts}>
      {rows.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
    </dl>
  );
}

interface ActionProps {
  title: string;
  button: string;
  consequence: string;
  t: T; lang: Lang;
  /** The reason's label and its minimum length (FR-OPS-02: every action has a reason). */
  reasonLabel?: string;
  minReason?: number;
  maxReason?: number;
  /** Other fields of the form; `valid` says whether they are complete. */
  children?: ReactNode;
  valid?: boolean;
  invalidText?: string;
  run: (reason: string) => Promise<unknown>;
  done: (result: unknown) => string;
  onDone?: (result: unknown) => void;
}

/** An action with a required reason, confirmed first (IF-UI-10). */
export function Action({ title, button, consequence, t, lang, reasonLabel, minReason = 10, maxReason = 1000, children, valid = true, invalidText, run, done, onDone }: ActionProps) {
  const id = useId();
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const action = useMutation({
    mutationFn: () => run(reason.trim()),
    onSuccess: (r) => { setConfirming(false); setReason(''); setMessage({ kind: 'success', text: done(r) }); onDone?.(r); },
    onError: (e) => { setConfirming(false); setMessage({ kind: 'error', text: staffError(e, t, lang) }); },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    if (!valid) { setMessage({ kind: 'error', text: invalidText ?? t('staff.action.incomplete') }); return; }
    if (reason.trim().length < minReason) { setMessage({ kind: 'error', text: t('staff.action.reason_short', { min: String(minReason) }) }); return; }
    setConfirming(true);
  };
  return (
    <form onSubmit={submit} noValidate className={styles.panel} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{title}</h2>
      {children}
      <label htmlFor={`${id}-reason`}>{reasonLabel ?? t('staff.action.reason')}</label>
      <textarea id={`${id}-reason`} rows={3} maxLength={maxReason} value={reason} onChange={(e) => setReason(e.target.value)} aria-describedby={`${id}-hint`} className={styles.wide} />
      <p id={`${id}-hint`} className={styles.hint}>{t('staff.action.reason_hint', { min: String(minReason) })}</p>
      {message && <FormMessage kind={message.kind}>{message.text}</FormMessage>}
      <p><button type="submit" className={styles.primary} disabled={action.isPending}>{button}</button></p>
      {confirming && (
        <ConfirmDialog id={`${id}-confirm`} title={title} busy={action.isPending} confirmLabel={button} cancelLabel={t('staff.approvals.back')}
          onConfirm={() => action.mutate()} onCancel={() => setConfirming(false)}>
          <p>{consequence}</p>
        </ConfirmDialog>
      )}
    </form>
  );
}

/** A choice between a few values, as radio buttons (44 px rows). */
export function Choice<V extends string>({ legend, name, value, options, onChange }: { legend: string; name: string; value: V | ''; options: [V, string][]; onChange: (v: V) => void }) {
  return (
    <fieldset className={styles.choice}>
      <legend>{legend}</legend>
      {options.map(([v, label]) => (
        <div key={v}>
          <input id={`${name}-${v}`} type="radio" name={name} checked={value === v} onChange={() => onChange(v)} />
          <label htmlFor={`${name}-${v}`}>{label}</label>
        </div>
      ))}
    </fieldset>
  );
}
