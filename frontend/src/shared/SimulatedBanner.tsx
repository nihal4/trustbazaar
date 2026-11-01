// <SimulatedBanner> (section 8.4, NFR-CMP-05): on every payment and courier screen, in both languages, while the
// providers are sandboxes or the mock. Its text is the reference catalogue's (sim.payment, sim.courier).
import { useLanguage } from './language/Language';
import styles from './shell.module.css';

export function SimulatedBanner({ kind }: { kind: 'payment' | 'courier' }) {
  const { t } = useLanguage();
  return <p className={styles.notice} role="note">{t(`sim.${kind}`)}</p>;
}
