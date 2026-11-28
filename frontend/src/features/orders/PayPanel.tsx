// The payment panel of an order that awaits payment: how to get the item (meeting the seller or a courier with a quote; a game account's key first),
// the total and the button that opens the payment sheet.
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { formatMoney } from '../../lib/money.js';
import { useApi } from '../../shared/api';
import { useServerNow } from '../../shared/clock';
import { errorText } from '../../shared/errors';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { Popup } from '../../shared/Popup';
import { Panel } from '../../shared/ui';
import { CourierChoice } from './Courier';
import { GamePrepare, gameReady, useGame } from './Game';
import { orderKey, type OrderView } from './model';
import styles from './orders.module.css';

export function PayPanel({ o, t, lang, onPay }: { o: OrderView; t: T; lang: Lang; onPay: () => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const now = useServerNow();
  const [message, setMessage] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [courier, setCourier] = useState(false);
  const over = Date.parse(o.paymentDueAt) <= now;
  // a game account is paid only once the disclosure is acknowledged and the key exists (Unit 5, checkout_ready)
  const game = useGame(o);
  const isGame = o.fulfilment === 'game_account';
  const blockedByGame = isGame && !gameReady(game.data);
  const meet = useMutation({
    mutationFn: () => api.put(`/orders/${encodeURIComponent(o.id)}/fulfilment`, { fulfilment: 'self_pickup' }) as Promise<OrderView>,
    onSuccess: (next) => {
      queryClient.setQueryData(orderKey(o.id), next);
      setChanging(false);
    },
    onError: (e) => setMessage(errorText(e, t, lang)),
  });
  const ready = !!o.fulfilment && !over && !blockedByGame;
  const choosing = !o.fulfilment || changing;
  const total = formatMoney(BigInt(o.total), lang);
  // one step: how do you want it? Meeting the seller is chosen at once; courier asks for the address and the fee in a popup
  return (
    <Panel title={t('pay.title')} className={`${styles.panel} ${styles.early}`}>
      {message && <FormMessage kind="error">{message}</FormMessage>}
      {choosing && !isGame ? (
        <div className={styles.choiceGrid} role="group" aria-label={t('pay.fulfilment')}>
          {o.fulfilmentOptions.includes('self_pickup') && (
            <button type="button" className={styles.choiceCell} disabled={meet.isPending || over} onClick={() => meet.mutate()}>
              <strong>{t('pay.opt.meet')}</strong>
              <span>{t('pay.opt.meet.note')}</span>
            </button>
          )}
          {o.fulfilmentOptions.includes('courier') && (
            <button type="button" className={styles.choiceCell} disabled={over} onClick={() => setCourier(true)}>
              <strong>{t('pay.opt.courier')}</strong>
              <span>{t('pay.opt.courier.note')}</span>
            </button>
          )}
        </div>
      ) : (
        <div className={styles.chosenGrid}>
          <dl>
            <div>
              <dt>{t('pay.delivery')}</dt>
              <dd>{t(`pay.chosen.${o.fulfilment}`)}</dd>
            </div>
          </dl>
          {!isGame && (
            <button type="button" className={styles.changeCell} disabled={over} onClick={() => setChanging(true)}>
              {t('pay.change')}
            </button>
          )}
        </div>
      )}
      {courier && (
        <Popup id="courier-popup" title={t('courier.title')} closeLabel={t('actions.back')} onClose={() => setCourier(false)}>
          <CourierChoice
            o={o}
            t={t}
            lang={lang}
            disabled={over}
            onDone={() => {
              setCourier(false);
              setChanging(false);
            }}
          />
        </Popup>
      )}
      {isGame && game.data && <GamePrepare o={o} g={game.data} t={t} lang={lang} disabled={over} />}
      {isGame && game.isError && <FormMessage kind="error">{errorText(game.error, t, lang)}</FormMessage>}
      {!over && !ready && (
        <p id="pay-why" className={styles.hint}>
          {t(blockedByGame ? 'pay.step_game_first' : 'pay.choose_fulfilment')}
        </p>
      )}
      {over ? (
        <p className={styles.error}>{t('pay.window_over')}</p>
      ) : (
        <div className={styles.payRow}>
          <div>
            <span>{t('pay.total')}</span>
            <strong>{total}</strong>
          </div>
          {ready ? (
            <button type="button" className={styles.primary} onClick={onPay}>
              {t('pay.pay', { total })}
            </button>
          ) : (
            <button type="button" className={styles.primary} disabled aria-describedby="pay-why">
              {t('pay.pay', { total })}
            </button>
          )}
        </div>
      )}
    </Panel>
  );
}
