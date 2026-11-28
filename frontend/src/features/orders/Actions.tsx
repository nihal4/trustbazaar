// What can be done now, and only that (docs/design/08_frontend.pdf section 7.5 (3); IF-UI-05; FR-PAY-07, FR-PAY-09;
// U8-06). Each action states its consequence first; only actions the order's state allows are offered, and the server
// checks again (an `order-state` answer refreshes the order). Buyer: confirm receipt after the delivery event, or ask
// to cancel before it. Seller: answer a cancellation request, or cancel (a full refund and a strike). Opening a dispute
// is the dispute part of the order view (Disputes.tsx, U8-09); early release is the game-account screens' (U8-07).
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { formatMoney } from '../../lib/money.js';
import { useApi } from '../../shared/api';
import { Popup } from '../../shared/Popup';
import { ActionCell, ActionList, PopupActions } from '../../shared/ui';
import { ConfirmDialog } from '../../shared/ConfirmDialog';
import { errorText } from '../../shared/errors';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { problemName } from '../../shared/problems';
import { orderKey, type OrderView } from './model';
import styles from './orders.module.css';

type Action = 'confirm' | 'request' | 'cancel' | 'accept' | 'decline';

/** The actions the order's state allows for this party. Pure, for the tests. */
export function actionsOf(o: OrderView): Action[] {
  const held = o.status === 'paid' && o.escrow?.state === 'held';
  if (!held) return [];
  const pending = o.cancellationRequest?.status === 'pending';
  const before = o.deliveryEventAt === null;
  if (o.role === 'buyer') {
    if (!before) return o.escrow?.releasePolicy === 'standard' ? ['confirm'] : [];
    return pending ? [] : ['request'];
  }
  if (!before) return [];
  return pending ? ['accept', 'decline', 'cancel'] : ['cancel'];
}

export function Actions({ o, t, lang, extra, bare }: { o: OrderView; t: T; lang: Lang; extra?: ReactNode; bare?: boolean }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const back = t('actions.back');
  const [open, setOpen] = useState<Action | null>(null);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const sending = useRef(false);
  const id = encodeURIComponent(o.id);
  const act = useMutation({
    mutationFn: (a: Action): Promise<OrderView> => {
      switch (a) {
        case 'confirm':
          return api.post(`/orders/${id}/confirm-receipt`, {}) as Promise<OrderView>;
        case 'request':
          return api.post(`/orders/${id}/cancellation-requests`, { reason: reason.trim() }) as Promise<OrderView>;
        case 'cancel':
          return api.post(`/orders/${id}/cancel`, { reason: reason.trim() }) as Promise<OrderView>;
        default:
          return api.post(`/orders/${id}/cancellation-requests/${encodeURIComponent(o.cancellationRequest?.id ?? '')}/decision`, {
            decision: a,
          }) as Promise<OrderView>;
      }
    },
    onSuccess: (next) => {
      setOpen(null);
      setConfirming(false);
      setReason('');
      queryClient.setQueryData(orderKey(o.id), next);
      void queryClient.invalidateQueries({ queryKey: orderKey(o.id) });
    },
    onError: (e) => {
      setOpen(null);
      setConfirming(false);
      setMessage(problemName(e) === 'order-state' ? t('actions.changed') : errorText(e, t, lang));
      void queryClient.invalidateQueries({ queryKey: orderKey(o.id) });
    },
  });
  const run = (a: Action) => {
    if (sending.current) return;
    sending.current = true;
    setMessage(null);
    act.mutate(a, {
      onSettled: () => {
        sending.current = false;
      },
    });
  };

  const allowed = actionsOf(o);
  const request = o.cancellationRequest;
  const collected = BigInt(o.escrow?.amountCollected ?? o.total);
  const toSeller = formatMoney(collected - BigInt(o.escrow?.amountRefunded ?? '0'), lang);
  const refund = formatMoney(collected, lang);
  const needsReason = open === 'request' || open === 'cancel';
  const reasonOk = reason.trim().length > 0;

  const submitReason = (e: FormEvent) => {
    e.preventDefault();
    if (!reasonOk) return setMessage(t('actions.reason_needed'));
    if (open === 'request') run('request');
    else setConfirming(true);
  };

  if (allowed.length === 0 && !request && !extra) return null;
  const Wrap = bare ? 'div' : 'section';
  return (
    <Wrap {...(bare ? { className: styles.bare } : { 'aria-labelledby': 'actions-title', className: styles.panel })}>
      {!bare && <h2 id="actions-title">{t('actions.title')}</h2>}
      {message && !needsReason && <FormMessage kind="error">{message}</FormMessage>}
      {request && <RequestStatus o={o} t={t} />}
      {allowed.length === 0 && !extra && <p className={styles.hint}>{t('actions.none')}</p>}
      <ActionList>
        {extra}
        {allowed.includes('confirm') && (
          <ActionCell variant="primary" onClick={() => setOpen('confirm')} disabled={act.isPending}>
            {t('actions.confirm_receipt')}
          </ActionCell>
        )}
        {allowed.includes('accept') && (
          <ActionCell variant="primary" onClick={() => setOpen('accept')} disabled={act.isPending}>
            {t('actions.accept_request')}
          </ActionCell>
        )}
        {allowed.includes('decline') && (
          <ActionCell onClick={() => run('decline')} disabled={act.isPending}>
            {t('actions.decline_request')}
          </ActionCell>
        )}
        {allowed.includes('request') && open !== 'request' && (
          <ActionCell variant="quiet" onClick={() => setOpen('request')}>
            {t('actions.ask_cancel')}
          </ActionCell>
        )}
        {allowed.includes('cancel') && open !== 'cancel' && <ActionCell onClick={() => setOpen('cancel')}>{t('actions.seller_cancel')}</ActionCell>}
      </ActionList>

      {needsReason && !confirming && (
        <Popup
          id="action-reason"
          title={t(open === 'request' ? 'actions.ask_cancel' : 'actions.seller_cancel')}
          closeLabel={back}
          busy={act.isPending}
          onClose={() => {
            setOpen(null);
            setReason('');
            setMessage(null);
          }}
        >
          <form onSubmit={submitReason} noValidate className={styles.form}>
            {message && <FormMessage kind="error">{message}</FormMessage>}
            <p>{t(open === 'request' ? 'actions.ask_cancel_note' : 'actions.seller_cancel_note')}</p>
            <label htmlFor="action-reason">{t('actions.reason')}</label>
            <textarea
              id="action-reason"
              aria-invalid={!reasonOk && !!message}
              value={reason}
              maxLength={500}
              rows={3}
              onChange={(e) => setReason(e.target.value)}
            />
            <PopupActions>
              <button type="submit" disabled={act.isPending}>
                {t(open === 'request' ? 'actions.send_request' : 'actions.continue')}
              </button>
              <button
                type="button"

                onClick={() => {
                  setOpen(null);
                  setReason('');
                  setMessage(null);
                }}
              >
                {back}
              </button>
            </PopupActions>
          </form>
        </Popup>
      )}

      {open === 'confirm' && (
        <ConfirmDialog
          id="confirm-receipt"
          title={t('actions.confirm_receipt')}
          busy={act.isPending}
          confirmLabel={t('actions.release_button', { amount: toSeller })}
          cancelLabel={back}
          onConfirm={() => run('confirm')}
          onCancel={() => setOpen(null)}
        >
          <p>{t('confirm.confirm_receipt', { amount: toSeller })}</p>
        </ConfirmDialog>
      )}
      {open === 'accept' && (
        <ConfirmDialog
          id="accept-request"
          title={t('actions.accept_request')}
          busy={act.isPending}
          confirmLabel={t('actions.refund_button', { amount: refund })}
          cancelLabel={back}
          onConfirm={() => run('accept')}
          onCancel={() => setOpen(null)}
        >
          <p>{t('actions.accept_note', { amount: refund })}</p>
        </ConfirmDialog>
      )}
      {open === 'cancel' && confirming && (
        <ConfirmDialog
          id="seller-cancel"
          title={t('actions.seller_cancel')}
          busy={act.isPending}
          confirmLabel={t('actions.cancel_button', { amount: refund })}
          cancelLabel={back}
          onConfirm={() => run('cancel')}
          onCancel={() => setConfirming(false)}
        >
          <p>{t('confirm.seller_cancel', { amount: refund })}</p>
        </ConfirmDialog>
      )}
    </Wrap>
  );
}

function RequestStatus({ o, t }: { o: OrderView; t: T }) {
  const r = o.cancellationRequest;
  if (!r) return null;
  const who = o.role === 'buyer' ? 'buyer' : 'seller';
  return (
    <div className={styles.request}>
      <p>
        <strong>{t(`actions.request.${r.status}.${who}`)}</strong>
      </p>
      <p>{t('actions.request_reason', { reason: r.reason })}</p>
    </div>
  );
}
