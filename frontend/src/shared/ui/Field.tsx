// The field (U11-04): a visible label, an optional hint, the control, and an error, tied together for assistive technology (NFR-USE-06; the form rules of docs/design/08_frontend.pdf
// section 7). `Field` is the wrapper and gives the control what it needs; `Input`, `Select` and `Textarea` are the controls, one look. `TextField` is the common case: a labelled input.
//   <Field id="phone" label="Phone number" error={error}>{(a) => <Input {...a} value={v} onChange={...} />}</Field>
import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cx } from './cx';
import styles from './field.module.css';

/** What a control needs from its field: its id, the text that describes it and whether it is in error. */
export interface ControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
}

interface FieldProps {
  /** the id of the control; one is made if it is left out */
  id?: string;
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  children: (control: ControlProps) => ReactNode;
}

export function Field({ id, label, hint, error, className, children }: FieldProps) {
  const made = useId();
  const own = id ?? made;
  const described = [hint ? `${own}-hint` : '', error ? `${own}-error` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cx(styles.field, className)}>
      <label htmlFor={own}>{label}</label>
      {hint && (
        <p id={`${own}-hint`} className={styles.hint}>
          {hint}
        </p>
      )}
      {children({ id: own, 'aria-describedby': described, 'aria-invalid': error ? true : undefined })}
      {error && (
        <p id={`${own}-error`} className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cx(styles.control, className)} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cx(styles.control, styles.select, className)}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cx(styles.control, styles.textarea, className)} />;
}

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'children'> & { id?: string; label: string; hint?: string; error?: string };

/** A labelled input: the common case of a field. */
export function TextField({ id, label, hint, error, className, ...input }: TextFieldProps) {
  return (
    <Field id={id} label={label} hint={hint} error={error} className={className}>
      {(control) => <Input {...input} {...control} />}
    </Field>
  );
}
