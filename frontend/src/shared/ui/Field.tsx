// The field (U11-04; the underline look is the user's choice, U11-06): a visible label, an optional hint, the control, and an error, tied together for assistive technology (NFR-USE-06; the form rules of docs/design/08_frontend.pdf
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
      {hint && <FieldMessage id={`${own}-hint`}>{hint}</FieldMessage>}
      {children({ id: own, 'aria-describedby': described, 'aria-invalid': error ? true : undefined })}
      {error && (
        <FieldMessage id={`${own}-error`} tone="error">
          {error}
        </FieldMessage>
      )}
    </div>
  );
}

/** The look of a control: a hairline under it (the site's field, in both themes), or a ruled box (a rare variant for a control that stands alone on an open page). */
export type ControlLook = 'line' | 'box';

export function Input({ look = 'line', className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { look?: ControlLook }) {
  return <input {...rest} className={cx(styles.control, look === 'box' && styles.box, className)} />;
}

export function Select({ look = 'line', className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { look?: ControlLook }) {
  return (
    <select {...rest} className={cx(styles.control, styles.select, look === 'box' && styles.box, className)}>
      {children}
    </select>
  );
}

/** Several lines need a frame to be seen: a textarea is always the ruled box. */
export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cx(styles.control, styles.box, styles.textarea, className)} />;
}

/** The text under a control: a hint in muted type or an error in the danger colour (an error is also what `aria-describedby` points at). */
export function FieldMessage({ id, tone = 'hint', children }: { id?: string; tone?: 'hint' | 'error'; children: ReactNode }) {
  return (
    <p id={id} className={tone === 'error' ? styles.error : styles.hint}>
      {children}
    </p>
  );
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
