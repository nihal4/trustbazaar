// The counterfoil (docs/design/10_visual_v2.md, section 6): the money-order world's one signature. A form split by a
// perforated tear line: the stub keeps the reference and the amount, the form shows where the money is (paid in,
// held, paid out) and holds the action. When the money is paid out, the stub carries a postmark with the date. Used
// on the listing's buy panel, at checkout, on the order and on the seller's payouts; the words come from the page.
import type { ReactNode } from 'react';
import styles from './counterfoil.module.css';

export type CounterfoilStage = { key: string; label: string; state: 'done' | 'current' | 'next' };

type Props = {
  /** the stub's heading, such as the order reference */
  stub: ReactNode;
  /** the amount in figures, and in words as on the form when the page has them */
  amount?: string;
  amountWords?: string;
  /** the form's title */
  title: ReactNode;
  stages?: CounterfoilStage[];
  /** each stage's state in words, for assistive technology and for anyone who cannot tell the marks apart; without
   *  them the stages read as a sequence (an explanation, not an order's state) */
  stateWords?: Record<CounterfoilStage['state'], string>;
  /** the postmark's date, shown once the money has been paid out */
  postmark?: string;
  /** the id of a heading inside the counterfoil that names it as a region */
  labelledBy?: string;
  children?: ReactNode;
};

export function Counterfoil({ stub, amount, amountWords, title, stages, stateWords, postmark, labelledBy, children }: Props) {
  return (
    <section className={styles.counterfoil} aria-labelledby={labelledBy}>
      <div className={styles.stub}>
        <div className={styles.stubText}>{stub}</div>
        {/* the stub's copy of the amount, as on a money order; read once, on the form */}
        {amount && <p className={styles.stubAmount} aria-hidden="true">{amount}</p>}
        {postmark && (
          <p className={styles.postmark}>
            <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false">
              <path d="M5 10.4 l3.2 3.2 l6.8 -7.4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>{postmark}</span>
          </p>
        )}
      </div>
      <div className={styles.form}>
        <div className={styles.title}>{title}</div>
        {amount && (
          <p className={styles.amount}>
            <span className={styles.figures}>{amount}</span>
            {amountWords && <span className={styles.words}>{amountWords}</span>}
          </p>
        )}
        {stages && stages.length > 0 && (
          <ol className={styles.stages}>
            {stages.map((s) => (
              <li key={s.key} className={styles[s.state]} aria-current={stateWords && s.state === 'current' ? 'step' : undefined}>
                <span className={styles.box} aria-hidden="true" />
                <span>{s.label}</span>
                {stateWords && <span className={styles.visuallyHidden}>{stateWords[s.state]}</span>}
              </li>
            ))}
          </ol>
        )}
        {children}
      </div>
    </section>
  );
}
