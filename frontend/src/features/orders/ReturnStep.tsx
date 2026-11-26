// U10-23 (FR-TNS-10): the seller's step while a refunded item comes back. At a meetup the seller records that the item is back; for an item with a device
// identifier they first type the identifier of the item they took back, and the server compares it with the one at listing. A mismatch is final: it goes to
// TrustBazaar, which decides. For a courier return nothing is typed; the courier's delivery event completes it.
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useApi } from '../../shared/api';
import { errorText } from '../../shared/errors';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { Popup } from '../../shared/Popup';
import { ConfirmDialog } from '../../shared/ConfirmDialog';
import { useRefresh, type DisputeView } from './Disputes';
import styles from './orders.module.css';

export function ReturnStep({ d, t, lang }: { d: DisputeView; t: T; lang: Lang }) {
  const api = useApi();
  const refresh = useRefresh(d);
  const step = d.returnStep;
  const [popup, setPopup] = useState<'closed' | 'check' | 'confirm'>('closed');
  const [value, setValue] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const base = `/disputes/${encodeURIComponent(d.id)}`;
  const check = useMutation({
    mutationFn: () => api.post(`${base}/return-check`, { value: value.trim() }) as Promise<{ matched: boolean }>,
    onSuccess: () => { setValue(''); setMessage(null); setPopup('closed'); refresh(); },
    onError: (e) => setMessage(errorText(e, t, lang)),
  });
  const received = useMutation({
    mutationFn: () => api.post(`${base}/return-received`, {}),
    onSuccess: () => { setPopup('closed'); refresh(); },
    onError: (e) => { setPopup('closed'); setMessage(errorText(e, t, lang)); refresh(); },
  });
  if (!step) return null;
  if (!step.manual) return <p className={styles.hint}>{t('dispute.return_courier')}</p>;
  const needsCheck = step.last4 !== null && step.check !== 'matched';
  return (
    <div className={styles.returnStep}>
      <h2>{t('dispute.return_title')}</h2>
      {message && popup === 'closed' && <FormMessage kind="error">{message}</FormMessage>}
      {step.check === 'mismatch'
        ? <FormMessage kind="error">{t('dispute.return_mismatch')}</FormMessage>
        : <p className={styles.hint}>{t(needsCheck ? 'dispute.return_check_hint' : 'dispute.return_hint')}</p>}
      {step.check !== 'mismatch' && (needsCheck
        ? <button type="button" className={`${styles.primary} ${styles.cellButton}`} onClick={() => { setMessage(null); setPopup('check'); }}>{t('dispute.return_check_open')}</button>
        : <button type="button" className={`${styles.primary} ${styles.cellButton}`} onClick={() => { setMessage(null); setPopup('confirm'); }}>{t('dispute.return_received')}</button>)}
      {popup === 'check' && (
        <Popup id="return-check" title={t('dispute.return_check_title')} closeLabel={t('actions.back')} busy={check.isPending} onClose={() => setPopup('closed')}>
          <form className={styles.form} noValidate onSubmit={(e) => { e.preventDefault(); if (value.trim().length >= 6) check.mutate(); }}>
            {message && <FormMessage kind="error">{message}</FormMessage>}
            <p className={styles.hint}>{t('dispute.return_check_once')}</p>
            <dl className={styles.statusGrid}><div><dt>{t('handover.device_listing')}</dt><dd>•••• {step.last4}</dd></div></dl>
            <label htmlFor="return-value">{t('handover.device_label')}</label>
            <input id="return-value" value={value} maxLength={40} autoComplete="off" onChange={(e) => setValue(e.target.value)} />
            <div className={styles.popupButtons}>
              <button type="submit" className={styles.primary} disabled={check.isPending || value.trim().length < 6}>{t('handover.device_check')}</button>
              <button type="button" className={styles.secondary} disabled={check.isPending} onClick={() => setPopup('closed')}>{t('actions.back')}</button>
            </div>
          </form>
        </Popup>
      )}
      {popup === 'confirm' && (
        <ConfirmDialog id="return-received" title={t('dispute.return_received')} busy={received.isPending} confirmLabel={t('dispute.return_received_button')} cancelLabel={t('actions.back')}
          onConfirm={() => received.mutate()} onCancel={() => setPopup('closed')}>
          <p>{t('dispute.return_received_confirm')}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
