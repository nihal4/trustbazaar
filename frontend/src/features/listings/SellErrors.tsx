// The list above a form of the sell pages that says what has to be put right (a field that is missing or wrong), read out at once by a screen reader.
import type { T } from '../../shared/language/catalogue';
import styles from './sell.module.css';

export function SellErrors({ errors, t }: { errors: string[]; t: T }) {
  if (errors.length === 0) return null;
  return (
    <div role="alert" className={styles.errors}>
      <p>{t('sell.fix')}</p>
      <ul>
        {errors.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
    </div>
  );
}
