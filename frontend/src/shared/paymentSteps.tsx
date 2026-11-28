// The steps of the payment sheet that only show something: choosing a method, the wait, the result. The sheet owns what happens when they are used.
import { FormMessage } from './form';
import type { T } from './language/catalogue';
import styles from './paymentSheet.module.css';

export type Method = 'bkash' | 'nagad' | 'card';
interface Remembered {
  method: Method;
  label: string;
}

export function ChooseStep({
  t,
  total,
  methods,
  defaults,
  onPick,
  onForget,
  onCancel,
}: {
  t: T;
  total: string;
  methods: Method[];
  defaults: Remembered | null | undefined;
  onPick: (m: Method) => void;
  onForget: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <h2 id="pay-sheet-title" className={styles.title}>
        {t('pay.sheet.title', { total })}
      </h2>
      <p className={styles.lead}>{t('pay.sheet.choose')}</p>
      <ul className={styles.methods}>
        {(defaults ? [defaults.method, ...methods.filter((m) => m !== defaults.method)] : methods).map((m) => (
          <li key={m}>
            <button type="button" className={styles.method} onClick={() => onPick(m)}>
              <span className={styles.methodName}>{t(`pay.method.${m}`)}</span>
              <span className={styles.methodNote}>
                {defaults && defaults.method === m ? `${t('pay.sheet.default')}: ${defaults.label}` : t(`pay.sheet.note.${m}`)}
              </span>
              <svg viewBox="0 0 12 12" width="14" height="14" aria-hidden="true" focusable="false">
                <path d="M4 1.5 L8.5 6 L4 10.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </li>
        ))}
      </ul>
      <div className={styles.answer}>
        {defaults && (
          <button type="button" className={styles.quiet} onClick={onForget}>
            {t('pay.sheet.forget')}
          </button>
        )}
        <button type="button" className={styles.quiet} onClick={onCancel}>
          {t('pay.cancel')}
        </button>
      </div>
    </>
  );
}

export function ProcessingStep({ t, total }: { t: T; total: string }) {
  return (
    <div className={styles.center} role="status" aria-live="polite">
      <h2 id="pay-sheet-title" className={styles.title}>
        {t('pay.sheet.processing')}
      </h2>
      <p className={styles.lead}>{t('pay.sheet.processing_note', { total })}</p>
      <div className={styles.bar} aria-hidden="true">
        <span />
      </div>
    </div>
  );
}

export function DoneStep({
  t,
  total,
  label,
  alreadyDefault,
  onReceipt,
  onFinish,
}: {
  t: T;
  total: string;
  /** the masked label of what paid */
  label: string;
  /** what paid is already the account's default, so there is nothing to ask */
  alreadyDefault: boolean;
  onReceipt?: () => void;
  onFinish: (saveAsDefault: boolean) => void;
}) {
  return (
    <div className={styles.center}>
      <svg className={styles.tick} viewBox="0 0 48 48" width="56" height="56" aria-hidden="true" focusable="false">
        <circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" strokeWidth="3" />
        <path d="M14 25 l7 7 l13 -15" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <h2 id="pay-sheet-title" className={styles.title} role="status">
        {t('pay.sheet.complete')}
      </h2>
      <p className={styles.amount}>{total}</p>
      <p className={styles.lead}>{t('pay.sheet.held', { method: label })}</p>
      {onReceipt && (
        <button type="button" className={styles.quiet} onClick={onReceipt}>
          {t('orders.receipt')}
        </button>
      )}
      {alreadyDefault ? (
        <button type="button" className={styles.pay} onClick={() => onFinish(false)}>
          {t('pay.sheet.continue')}
        </button>
      ) : (
        <>
          <p className={styles.ask}>{t('pay.sheet.save_ask', { method: label })}</p>
          <div className={styles.answer}>
            <button type="button" className={styles.pay} onClick={() => onFinish(true)}>
              {t('pay.sheet.save_yes')}
            </button>
            <button type="button" className={styles.quiet} onClick={() => onFinish(false)}>
              {t('pay.sheet.save_no')}
            </button>
          </div>
          <p className={styles.fine}>{t('pay.sheet.save_note')}</p>
        </>
      )}
    </div>
  );
}

export function FailedStep({ t, message, onRetry, onCancel }: { t: T; message: string | null; onRetry: () => void; onCancel: () => void }) {
  return (
    <div className={styles.center}>
      <h2 id="pay-sheet-title" className={styles.title}>
        {t('pay.sheet.failed')}
      </h2>
      {message && <FormMessage kind="error">{message}</FormMessage>}
      <p className={styles.lead}>{t('pay.sheet.nothing_charged')}</p>
      <button type="button" className={styles.pay} onClick={onRetry}>
        {t('pay.sheet.try_again')}
      </button>
      <button type="button" className={styles.quiet} onClick={onCancel}>
        {t('pay.cancel')}
      </button>
    </div>
  );
}
