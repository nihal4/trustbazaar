import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDeadline } from '../../lib/time.js';
import { useApi } from '../../shared/api';
import { useServerNow } from '../../shared/clock';
import { ConfirmDialog } from '../../shared/ConfirmDialog';
import { errorText } from '../../shared/errors';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { problemName } from '../../shared/problems';
import { myStatusKey, type MyStatus } from './model';
import styles from './listings.module.css';
import { Button } from '../../shared/ui';
import { money } from './auctionShared';

/** FR-AUC-15: the offered bidder accepts (an order to pay within CP-11) or declines. */
export function Offer({ auctionId, offer, t, lang }: { auctionId: string; offer: NonNullable<MyStatus['secondChanceOffer']>; t: T; lang: Lang }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const now = useServerNow();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const decide = useMutation({
    mutationFn: (decision: 'accept' | 'decline') =>
      api.post(`/auctions/${encodeURIComponent(auctionId)}/second-chance/${encodeURIComponent(offer.id)}/decision`, { decision }) as Promise<{
        status: 'accepted' | 'declined';
        orderId: string | null;
      }>,
    onSuccess: (r) => {
      setConfirming(false);
      if (r.status === 'accepted' && r.orderId) void navigate(`/orders/${encodeURIComponent(r.orderId)}`);
      else setMessage({ kind: 'info', text: t('auction.offer.declined') });
      void queryClient.invalidateQueries({ queryKey: myStatusKey(auctionId) });
    },
    onError: (e) => {
      setConfirming(false);
      setMessage({ kind: 'error', text: problemName(e) === 'offer-closed' ? t('auction.offer.closed') : errorText(e, t, lang) });
      void queryClient.invalidateQueries({ queryKey: myStatusKey(auctionId) });
    },
  });
  const sending = useRef(false);
  const send = (decision: 'accept' | 'decline') => {
    if (sending.current) return;
    sending.current = true;
    decide.mutate(decision, {
      onSettled: () => {
        sending.current = false;
      },
    });
  };
  const price = money(offer.price, lang);
  return (
    <div className={styles.offer} role="region" aria-labelledby="offer-title">
      <h3 id="offer-title">{t('auction.offer.title')}</h3>
      <p>{t('auction.offer.body', { price })}</p>
      <p>{t('auction.offer.deadline', { at: formatDeadline(Date.parse(offer.expiresAt), now, lang) })}</p>
      {message && <FormMessage kind={message.kind}>{message.text}</FormMessage>}
      <div className={styles.actions}>
        <Button variant="primary" type="button" disabled={decide.isPending} onClick={() => setConfirming(true)}>
          {t('auction.offer.accept', { price })}
        </Button>
        <button type="button" disabled={decide.isPending} onClick={() => send('decline')}>
          {t('auction.offer.decline')}
        </button>
      </div>
      {confirming && (
        <ConfirmDialog
          id="offer-confirm"
          title={t('auction.offer.confirm_title')}
          busy={decide.isPending}
          confirmLabel={t('auction.offer.accept', { price })}
          cancelLabel={t('auction.cancel')}
          onConfirm={() => send('accept')}
          onCancel={() => setConfirming(false)}
        >
          <p>{t('auction.offer.confirm', { price })}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
