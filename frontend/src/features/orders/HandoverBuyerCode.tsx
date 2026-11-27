// The buyer's side of the handover: the code to read out at the meetup, shown only after the terms are accepted.
import { Popup } from '../../shared/Popup';
import { Terms } from './Terms';
import { useState } from 'react';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { type HandoverView } from './model';
import styles from './orders.module.css';
import { DeviceCheck } from './HandoverDeviceCheck';
import { spaced } from './handoverShared';

/** The buyer's code: first the terms in a popup (check the item properly, what giving the code means), and only on agreeing the code in a second popup. */
export function BuyerCode({
  order,
  code,
  device,
  t,
  lang,
}: {
  order: string;
  code: string | null;
  device: NonNullable<HandoverView['deviceCheck']> | null;
  t: T;
  lang: Lang;
}) {
  const [step, setStep] = useState<'closed' | 'terms' | 'device' | 'code'>('closed');
  const needsDevice = device !== null && !device.matched;
  return (
    <>
      <div className={styles.code}>
        <h3>{t('handover.code_title')}</h3>
        <p>{t('confirm.share_handover_code')}</p>
        <button type="button" className={styles.primary} onClick={() => setStep('terms')}>
          {t('handover.show_code')}
        </button>
      </div>
      {step === 'terms' && (
        <Terms
          id="code-terms"
          t={t}
          lang={lang}
          order={order}
          kind="handover_code"
          title={t('handover.terms_title')}
          intro={t('handover.terms_intro')}
          prefix="handover.terms"
          count={7}
          check={t('handover.terms_check')}
          agree={t('handover.agree_show')}
          back={t('actions.back')}
          onAgree={() => setStep(needsDevice ? 'device' : 'code')}
          onClose={() => setStep('closed')}
        />
      )}
      {step === 'device' && device && (
        <DeviceCheck order={order} device={device} t={t} lang={lang} onMatched={() => setStep('code')} onClose={() => setStep('closed')} />
      )}
      {step === 'code' && (
        <Popup id="code-show" title={t('handover.code_title')} closeLabel={t('handover.hide_code')} onClose={() => setStep('closed')}>
          <p className={styles.codeNote}>{t('confirm.share_handover_code')}</p>
          <p className={`${styles.codeDigits} ${styles.codeCentre}`}>{code ? spaced(code, lang) : t('shell.loading')}</p>
          <div className={styles.popupButtons}>
            <button type="button" className={styles.secondary} onClick={() => setStep('closed')}>
              {t('handover.close_code')}
            </button>
          </div>
        </Popup>
      )}
    </>
  );
}
