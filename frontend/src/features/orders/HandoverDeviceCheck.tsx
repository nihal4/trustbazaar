// The check of a device's identifier at the meetup (a phone or a laptop): the buyer's part of the handover.
import { Popup } from '../../shared/Popup';
import { PopupActions } from '../../shared/ui';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toLocalDigits } from '../../lib/money.js';
import { useApi } from '../../shared/api';
import { errorText } from '../../shared/errors';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { problemName } from '../../shared/problems';
import { handoverKey, type HandoverView } from './model';
import styles from './orders.module.css';

/** U10-23: before the code, the buyer types the identifier the device shows (*#06# on a phone); the server compares it with the listing's. */
export function DeviceCheck({
  order,
  device,
  t,
  lang,
  onMatched,
  onClose,
}: {
  order: string;
  device: NonNullable<HandoverView['deviceCheck']>;
  t: T;
  lang: Lang;
  onMatched: () => void;
  onClose: () => void;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [value, setValue] = useState('');
  const [left, setLeft] = useState(device.attemptsLeft);
  const [wrong, setWrong] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const check = useMutation({
    mutationFn: () =>
      api.post(`/orders/${encodeURIComponent(order)}/device-check`, { value: value.trim() }) as Promise<{ matched: boolean; attemptsLeft: number }>,
    onSuccess: (r) => {
      setLeft(r.attemptsLeft);
      if (r.matched) {
        void queryClient.invalidateQueries({ queryKey: handoverKey(order) });
        onMatched();
      } else {
        setWrong(true);
        setMessage(null);
      }
    },
    onError: (e) => setMessage(problemName(e) === 'validation-failed' && left <= 0 ? t('handover.device_locked') : errorText(e, t, lang)),
  });
  const locked = left <= 0;
  return (
    <Popup id="device-check" title={t('handover.device_title')} closeLabel={t('actions.back')} busy={check.isPending} onClose={onClose}>
      <form
        className={styles.form}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim().length >= 6 && !locked) check.mutate();
        }}
      >
        {wrong && !locked && <FormMessage kind="error">{t('handover.device_wrong', { n: toLocalDigits(String(left), lang) })}</FormMessage>}
        {locked && <FormMessage kind="error">{t('handover.device_locked')}</FormMessage>}
        {message && <FormMessage kind="error">{message}</FormMessage>}
        <dl className={styles.statusGrid}>
          <div>
            <dt>{t('handover.device_listing')}</dt>
            <dd>•••• {device.last4}</dd>
          </div>
        </dl>
        <label htmlFor="device-value">{t('handover.device_label')}</label>
        <input id="device-value" value={value} maxLength={40} autoComplete="off" disabled={locked} onChange={(e) => setValue(e.target.value)} />
        <PopupActions>
          <button type="submit" disabled={check.isPending || locked || value.trim().length < 6}>
            {t('handover.device_check')}
          </button>
          <button type="button" disabled={check.isPending} onClick={onClose}>
            {t('actions.back')}
          </button>
        </PopupActions>
      </form>
    </Popup>
  );
}
