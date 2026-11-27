// A radio or a checkbox with its label (U11-04): the mark is drawn by the theme (square, ruled, a vermilion fill when chosen), the whole row is the target (44 px high, NFR-USE-06).
import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cx } from './cx';
import styles from './choice.module.css';

type ChoiceProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'children'> & {
  label: ReactNode;
  /** a line under the label that says more (for example what the option costs) */
  hint?: ReactNode;
};

function Choice({ type, label, hint, className, id, ...input }: ChoiceProps & { type: 'radio' | 'checkbox' }) {
  const made = useId();
  const own = id ?? made;
  return (
    <label className={cx(styles.choice, className)} htmlFor={own}>
      <input
        {...input}
        id={own}
        type={type}
        className={cx(styles.mark, type === 'radio' && styles.radio)}
        aria-describedby={hint ? `${own}-hint` : input['aria-describedby']}
      />
      <span className={styles.text}>
        {label}
        {hint && (
          <small id={`${own}-hint`} className={styles.hint}>
            {hint}
          </small>
        )}
      </span>
    </label>
  );
}

export function Radio(props: ChoiceProps) {
  return <Choice {...props} type="radio" />;
}

export function Checkbox(props: ChoiceProps) {
  return <Choice {...props} type="checkbox" />;
}
