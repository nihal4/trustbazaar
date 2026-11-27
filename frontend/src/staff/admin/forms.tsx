// Small forms of the administration screens: labelled text fields, a submit with the server's answer in words.
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { staffError } from '../cases/common';
import styles from '../staff.module.css';
import { Button, Field, Input } from '../../shared/ui';

export function Text({
  id,
  label,
  value,
  onChange,
  hint,
  inputMode,
  maxLength = 200,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  inputMode?: 'decimal' | 'numeric';
  maxLength?: number;
}) {
  return (
    <Field id={id} label={label} hint={hint}>
      {(control) => <Input {...control} value={value} maxLength={maxLength} inputMode={inputMode} onChange={(e) => onChange(e.target.value)} />}
    </Field>
  );
}

/** A form whose submit runs `run` once `check` returns no problem; the outcome is said under it. */
export function SaveForm({
  title,
  button,
  t,
  lang,
  check,
  run,
  done,
  children,
}: {
  title: string;
  button: string;
  t: T;
  lang: Lang;
  check: () => string | null;
  run: () => Promise<unknown>;
  done: (r: unknown) => string;
  children: ReactNode;
}) {
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const save = useMutation({
    mutationFn: run,
    onSuccess: (r) => setMessage({ kind: 'success', text: done(r) }),
    onError: (e) => setMessage({ kind: 'error', text: staffError(e, t, lang) }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const problem = check();
    if (problem) {
      setMessage({ kind: 'error', text: problem });
      return;
    }
    setMessage(null);
    save.mutate();
  };
  // a unique id for each form (the title is no id: in Bangla it has no letters a pattern for ASCII word characters keeps, and two forms would share one name)
  const id = `form-${useId().replace(/:/g, '')}`;
  return (
    <form onSubmit={submit} noValidate className={styles.panel} aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      {children}
      {message && <FormMessage kind={message.kind}>{message.text}</FormMessage>}
      <p>
        <Button variant="primary" type="submit" disabled={save.isPending}>
          {button}
        </Button>
      </p>
    </form>
  );
}

/** A coordinate as text, in Bangladesh's range (Unit 4 stores areas and points there). */
export const coordinate = (s: string, lat: boolean) => {
  const n = Number(s.trim());
  return Number.isFinite(n) && s.trim() !== '' && (lat ? n >= 20 && n <= 27 : n >= 88 && n <= 93) ? n : null;
};
