// The game-account part of the order view (docs/design/08_frontend.pdf section 7.6; Unit 5 sections 3 and 6;
// FR-GAM-05, FR-GAM-07, FR-GAM-10 to FR-GAM-17; IF-UI-06, NFR-USE-03; U8-07). Before payment the buyer acknowledges
// the publisher-risk disclosure by its version and creates the key in this browser; payment waits for both (the
// server's checkout_ready). The key and the credentials live on secure.html, reached by a full page load
// (/secure/orders/{id}/key, /credentials, /deliver), so their strict policy holds (SEC-GAM-03). After payment the
// tab shows the handover's state with its deadlines as countdowns, and the buyer may release early after the
// takeover, with step-up and confirm.release_early.
import { Panel } from '../../shared/ui';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMoney } from '../../lib/money.js';
import { formatDateTime, formatDeadline } from '../../lib/time.js';
import { useApi } from '../../shared/api';
import { useServerNow } from '../../shared/clock';
import { ConfirmDialog } from '../../shared/ConfirmDialog';
import { errorText } from '../../shared/errors';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { problemName } from '../../shared/problems';
import { FRESHNESS } from '../../shared/query';
import { StepUpCancelled } from '../../shared/stepUp';
import { orderKey, type OrderView } from './model';
import styles from './orders.module.css';

type HandoverStatus = 'preparing' | 'awaiting_credentials' | 'delivered' | 'rekey_requested' | 'disputed' | 'taken_over' | 'cancelled' | 'closed';
export interface GameView {
  orderId: string;
  role: 'buyer' | 'seller';
  disclosure: { currentVersion: number; acknowledgedVersion: number | null; acknowledgedAt: string | null };
  status: HandoverStatus | null;
  keyVersion: number;
  rekeysUsed: number;
  credentialsDueAt: string | null;
  firstDeliveredAt: string | null;
  deliveredAt: string | null;
  takeoverDueAt: string | null;
  rekeyDueAt: string | null;
  takenOverAt: string | null;
  takeoverSource: 'checklist' | 'window_end' | null;
  steps: Record<'password' | 'recovery_email' | 'recovery_phone' | 'social_logins' | 'two_step', string | null>;
  protectionEndsAt: string | null;
}
const gameKey = (orderId: string) => ['orders', orderId, 'game'] as const;
/** The disclosure texts this client has, by version (Decisions log, U5-03: the text is the web client's). */
const DISCLOSURE_VERSIONS = [1];

/** Unit 5, AS-5: the browser can keep a non-extractable key (Web Crypto) in IndexedDB. */
function gameBrowserReady(): boolean {
  return typeof globalThis.crypto?.subtle?.generateKey === 'function' && typeof globalThis.indexedDB?.open === 'function';
}

/** A credential screen: a full page load of secure.html, never a client-side route. */
const secureHref = (orderId: string, screen: 'key' | 'credentials' | 'deliver') => `/secure/orders/${encodeURIComponent(orderId)}/${screen}`;

export function useGame(o: OrderView) {
  const api = useApi();
  return useQuery({
    queryKey: gameKey(o.id),
    queryFn: ({ signal }) => api.get(`/orders/${encodeURIComponent(o.id)}/game`, { signal }) as Promise<GameView>,
    staleTime: FRESHNESS.money,
    retry: false,
    enabled: o.listing.itemKind === 'game_account' && o.status !== 'cancelled',
    // Unit 5 asks the seller for the credentials from the order's paid event, a moment after the payment (the outbox is
    // read every 5 s, DV-67): while the order is paid but the handover still "preparing", ask again every 2 s, at most
    // a minute, so neither side keeps seeing "Ready for payment" (U8-11)
    refetchInterval: (q) => (o.status === 'paid' && q.state.data?.status === 'preparing' && q.state.dataUpdateCount < GAME_POLLS ? GAME_POLL_MS : false),
  });
}

const GAME_POLL_MS = 2_000;
const GAME_POLLS = 30;

/** Ready to pay: the current disclosure acknowledged and key version 1 registered (Unit 5's checkout_ready). */
export const gameReady = (g: GameView | undefined) =>
  !!g && g.disclosure.acknowledgedVersion === g.disclosure.currentVersion && g.status === 'preparing' && g.keyVersion >= 1;

/** Before payment, inside the pay panel: the disclosure, then the key. */
export function GamePrepare({ o, g, t, lang, disabled }: { o: OrderView; g: GameView; t: T; lang: Lang; disabled: boolean }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [read, setRead] = useState(false);
  const version = g.disclosure.currentVersion;
  const known = DISCLOSURE_VERSIONS.includes(version);
  const acknowledged = g.disclosure.acknowledgedVersion === version;
  const ack = useMutation({
    mutationFn: () => api.post(`/orders/${encodeURIComponent(o.id)}/game/acknowledge`, { version }),
    onSuccess: () => {
      setMessage(null);
      void queryClient.invalidateQueries({ queryKey: gameKey(o.id) });
    },
    onError: (e) => setMessage(errorText(e, t, lang)),
  });
  if (!gameBrowserReady()) return <FormMessage kind="error">{t('game.browser_unsupported')}</FormMessage>;
  return (
    <div className={styles.game}>
      <h3>{t('game.disclosure_title')}</h3>
      {known ? (
        <div className={styles.disclosure}>
          {[1, 2, 3].map((n) => (
            <p key={n}>{t(`game.disclosure.v${version}.${n}`)}</p>
          ))}
        </div>
      ) : (
        <FormMessage kind="error">{t('game.disclosure_unknown')}</FormMessage>
      )}
      {message && <FormMessage kind="error">{message}</FormMessage>}
      {acknowledged ? (
        <p>
          <strong>{t('game.acknowledged', { at: formatDateTime(Date.parse(g.disclosure.acknowledgedAt ?? ''), lang) })}</strong>
        </p>
      ) : (
        known && (
          <>
            <div className={styles.check}>
              <input id="disclosure-read" type="checkbox" checked={read} onChange={(e) => setRead(e.target.checked)} />
              <label htmlFor="disclosure-read">{t('game.understand')}</label>
            </div>
            <button type="button" className={styles.secondary} disabled={!read || ack.isPending || disabled} onClick={() => ack.mutate()}>
              {t('game.acknowledge')}
            </button>
          </>
        )
      )}
      {acknowledged && (
        <>
          <h3>{t('game.key_title')}</h3>
          <p>{t('game.same_browser')}</p>
          {g.keyVersion >= 1 ? (
            <p>
              <strong>{t('game.key_ready')}</strong>
            </p>
          ) : (
            <p>
              <a className={styles.primaryLink} href={secureHref(o.id, 'key')}>
                {t('game.create_key')}
              </a>
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** After payment: the handover's state, the links to the credential screens, the deadlines and early release. */
export function GameTab({ o, g, t, lang }: { o: OrderView; g: GameView; t: T; lang: Lang }) {
  const now = useServerNow();
  const buyer = g.role === 'buyer';
  const deadlines: [string, string | null][] = [
    ['game.deadline.credentials', g.status === 'awaiting_credentials' ? g.credentialsDueAt : null],
    ['game.deadline.rekey', g.status === 'rekey_requested' ? g.rekeyDueAt : null],
    ['game.deadline.takeover', g.status === 'delivered' ? g.takeoverDueAt : null],
    ['game.deadline.protection', g.status === 'taken_over' ? g.protectionEndsAt : null],
  ];
  const sealFor = !buyer && (g.status === 'awaiting_credentials' || g.status === 'rekey_requested');
  const open = buyer && (g.status === 'delivered' || g.status === 'taken_over' || g.status === 'disputed');
  return (
    <Panel title={t('game.title')} className={styles.panel}>
      <p>
        <strong>{g.status ? t(`game.status.${g.status}.${g.role}`) : t('game.status.none')}</strong>
      </p>
      {deadlines.some(([, at]) => at) && (
        <dl className={styles.deadlines}>
          {deadlines
            .filter(([, at]) => at)
            .map(([key, at]) => (
              <div key={key}>
                <dt>{t(key)}</dt>
                <dd>{formatDeadline(Date.parse(at as string), now, lang)}</dd>
              </div>
            ))}
        </dl>
      )}
      {sealFor && (
        <p>
          <a className={styles.primaryLink} href={secureHref(o.id, 'deliver')}>
            {t('game.deliver_link')}
          </a>
        </p>
      )}
      {open && (
        <p>
          <a className={styles.primaryLink} href={secureHref(o.id, 'credentials')}>
            {t('game.credentials_link')}
          </a>
        </p>
      )}
      {open && <p className={styles.hint}>{t('game.same_browser')}</p>}
      {buyer && g.status === 'taken_over' && <ReleaseEarly o={o} g={g} t={t} lang={lang} />}
    </Panel>
  );
}

function ReleaseEarly({ o, g, t, lang }: { o: OrderView; g: GameView; t: T; lang: Lang }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const release = useMutation({
    mutationFn: () => api.post(`/orders/${encodeURIComponent(o.id)}/release-early`, {}, { stepUpAction: 'game.release_early' }) as Promise<OrderView>,
    onSuccess: (next) => {
      setConfirming(false);
      queryClient.setQueryData(orderKey(o.id), next);
      void queryClient.invalidateQueries({ queryKey: orderKey(o.id) });
    },
    onError: (e) => {
      setConfirming(false);
      if (e instanceof StepUpCancelled) return;
      setMessage(problemName(e) === 'order-state' ? t('actions.changed') : errorText(e, t, lang));
      void queryClient.invalidateQueries({ queryKey: orderKey(o.id) });
    },
  });
  if (!(o.escrow?.state === 'held' && o.escrow.releasePolicy === 'game_protection')) return null;
  const amount = formatMoney(BigInt(o.escrow.amountCollected) - BigInt(o.escrow.amountRefunded), lang);
  const at = g.protectionEndsAt ?? o.escrow.autoReleaseAt;
  return (
    <div>
      {message && <FormMessage kind="error">{message}</FormMessage>}
      <button type="button" className={styles.secondary} onClick={() => setConfirming(true)}>
        {t('game.release_early')}
      </button>
      {confirming && (
        <ConfirmDialog
          id="release-early"
          title={t('game.release_early')}
          busy={release.isPending}
          confirmLabel={t('actions.release_button', { amount })}
          cancelLabel={t('actions.back')}
          onConfirm={() => release.mutate()}
          onCancel={() => setConfirming(false)}
        >
          <p>{t('confirm.release_early', { amount, at: at ? formatDateTime(Date.parse(at), lang) : '—' })}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
