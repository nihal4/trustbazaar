// A dispute's case file, /staff/disputes/:id (FR-DSP-05 to FR-DSP-09, FR-GAM-18; section 7.9; U8-10): for the
// operator who claimed it. Names as shown publicly, contact details masked (SEC-ACC-05); evidence opens by signed
// links that expire (CP-31); the chat only through the case. The actions: ask the seller for more, decide with the
// exact split from Unit 2 (a partial refund's split is asked of the server before deciding), and the evidence pack.
// At CP-30 the decision is a proposal a second operator approves.
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMoney, parseTaka } from '../../lib/money.js';
import { formatDateTime, formatDeadline } from '../../lib/time.js';
import { useApi } from '../../shared/api';
import { useServerNow } from '../../shared/clock';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { useStaffT } from '../text';
import styles from '../staff.module.css';
import { Action, CaseFrame, Choice, Facts, short, staffError } from './common';

type Outcome = 'release' | 'full_refund' | 'partial_refund' | 'refund_after_return';
interface Split { refunded: string; sellerPayout: string }
interface Outcomes { itemPrice: string; deliveryFee: string; release: Split; fullRefund: Split; partialRefund: (Split & { itemRefund: string }) | null }
interface Link { url: string; expiresAt: string }
interface CaseFile {
  dispute: { id: string; type: string; status: string; description: string; openedAt: string; sellerDueAt: string; infoDueAt: string | null; decisionTargetAt: string | null; fourEyes: boolean };
  parties: { buyer: { displayName: string; verified: boolean } | null; seller: { displayName: string; verified: boolean } | null };
  order: { id: string; status: string; listing: { title: string; itemKind?: string }; itemPrice: string; deliveryFee: string; total: string; fulfilment: string | null; paidAt: string | null };
  escrow: { state: string; amountCollected: string };
  outcomes: Outcomes;
  game: null | { details: Record<string, unknown> | null; proof: null | { screenshot: Link | null; status?: string }; confirmations: { step: string; at: string }[]; accessLog: { at: string; party: string; network: string | null }[] };
  chat: { threadId: string; path: string } | null;
  returnCheck?: { checks: { matched: boolean; at: string }[]; canResolve: boolean; finding: { finding: string; reason: string; at: string } | null; findings: ('false_claim' | 'swap')[] };
  history: { from: string | null; to: string; actor: string; reason: string | null; at: string }[];
  statements: { party: string; text: string | null; at: string }[];
  evidence: { id: string; party: string; mime: string; size: number; at: string; link: Link | null }[];
  context: { disputes: unknown[]; strikes: { party: string; reason: string; at: string }[]; sanctions: { party: string; kind: string; reason: string; startsAt: string }[] };
}
export const caseKey = (id: string) => ['staff', 'dispute', id] as const;

export function Component() {
  const { id = '' } = useParams();
  const { t, lang } = useStaffT();
  const api = useApi();
  const file = useQuery({
    queryKey: caseKey(id),
    queryFn: ({ signal }) => api.get(`/staff/disputes/${encodeURIComponent(id)}/case-file`, { signal }) as Promise<CaseFile>,
    staleTime: 0,
    retry: false,
  });
  return (
    <CaseFrame title={t('staff.dispute.title', { ref: short(id) })} back="/staff/queues/disputes" t={t}>
      {file.isPending && <p role="status">{t('shell.loading')}</p>}
      {file.isError && <FormMessage kind="error">{staffError(file.error, t, lang)}</FormMessage>}
      {file.isSuccess && <CaseBody f={file.data} t={t} lang={lang} />}
    </CaseFrame>
  );
}

function CaseBody({ f, t, lang }: { f: CaseFile; t: T; lang: Lang }) {
  const now = useServerNow();
  const money = (p: string) => formatMoney(BigInt(p), lang);
  const at = (iso: string) => formatDateTime(Date.parse(iso), lang);
  const party = (p: { displayName: string; verified: boolean } | null) => (p ? `${p.displayName}${p.verified ? ` · ${t('staff.case.verified')}` : ''}` : '—');
  const d = f.dispute;
  const open = d.status !== 'decided' && d.status !== 'withdrawn' && d.status !== 'closed';
  return (
    <>
      <section className={styles.panel} aria-labelledby="dispute-facts">
        <h2 id="dispute-facts">{t('staff.dispute.facts')}</h2>
        <Facts rows={[
          [t('staff.dispute.type'), d.type],
          [t('staff.dispute.status'), d.status],
          [t('staff.dispute.opened'), at(d.openedAt)],
          [t('staff.dispute.decide_by'), d.decisionTargetAt ? formatDeadline(Date.parse(d.decisionTargetAt), now, lang) : null],
          [t('staff.dispute.info_due'), d.infoDueAt ? formatDeadline(Date.parse(d.infoDueAt), now, lang) : null],
          [t('staff.dispute.buyer'), party(f.parties.buyer)],
          [t('staff.dispute.seller'), party(f.parties.seller)],
          [t('staff.dispute.item'), f.order.listing.title],
          [t('staff.dispute.collected'), money(f.escrow.amountCollected)],
          [t('staff.dispute.escrow'), f.escrow.state],
        ]} />
        <h3>{t('staff.dispute.description')}</h3>
        <p className={styles.text}>{d.description}</p>
        {d.fourEyes && <FormMessage kind="info">{t('staff.dispute.four_eyes')}</FormMessage>}
      </section>

      <section className={styles.panel} aria-labelledby="dispute-statements">
        <h2 id="dispute-statements">{t('staff.dispute.statements')}</h2>
        {f.statements.length === 0 && <p className={styles.hint}>{t('staff.dispute.none')}</p>}
        <ul className={styles.items}>
          {f.statements.map((s, i) => <li key={i}><p><strong>{t(`staff.party.${s.party}`)}</strong> · {at(s.at)}</p><p className={styles.text}>{s.text ?? t('staff.dispute.removed')}</p></li>)}
        </ul>
        <h3>{t('staff.dispute.evidence')}</h3>
        {f.evidence.length === 0 && <p className={styles.hint}>{t('staff.dispute.none')}</p>}
        <ul className={styles.items}>
          {f.evidence.map((e) => (
            <li key={e.id}>
              {t(`staff.party.${e.party}`)} · {at(e.at)} · {e.link
                ? <a href={e.link.url} target="_blank" rel="noopener noreferrer">{t('staff.case.open_file')}</a>
                : t('staff.dispute.purged')}
            </li>
          ))}
        </ul>
        <p className={styles.hint}>{t('staff.case.links_expire')}</p>
      </section>

      {f.game && <GameEvidence g={f.game} t={t} lang={lang} />}
      {f.chat && <Chat path={f.chat.path} t={t} lang={lang} />}

      <section className={styles.panel} aria-labelledby="dispute-history">
        <h2 id="dispute-history">{t('staff.dispute.history')}</h2>
        <ol className={styles.items}>
          {f.history.map((h, i) => <li key={i}>{at(h.at)} · {h.from ?? '—'} → {h.to} · {h.actor}{h.reason ? ` · ${h.reason}` : ''}</li>)}
        </ol>
        <p>{t('staff.dispute.context', { disputes: String(f.context.disputes.length), strikes: String(f.context.strikes.length), sanctions: String(f.context.sanctions.length) })}</p>
      </section>

      {f.returnCheck && <ReturnPanel f={f} rc={f.returnCheck} t={t} lang={lang} />}
      {open && d.status !== 'awaiting_return' && <RequestInfo id={d.id} t={t} lang={lang} />}
      {open && d.status !== 'awaiting_return' && <Decide f={f} t={t} lang={lang} />}
      <EvidencePack id={d.id} t={t} lang={lang} />
    </>
  );
}

function GameEvidence({ g, t, lang }: { g: NonNullable<CaseFile['game']>; t: T; lang: Lang }) {
  const at = (iso: string) => formatDateTime(Date.parse(iso), lang);
  return (
    <section className={styles.panel} aria-labelledby="dispute-game">
      <h2 id="dispute-game">{t('staff.dispute.game')}</h2>
      <p className={styles.hint}>{t('staff.dispute.game_no_credentials')}</p>
      {g.details && <Facts rows={Object.entries(g.details).filter(([, v]) => typeof v === 'string' || typeof v === 'number').map(([k, v]) => [k, String(v)])} />}
      {g.proof?.screenshot && <p><a href={g.proof.screenshot.url} target="_blank" rel="noopener noreferrer">{t('staff.dispute.proof_screenshot')}</a></p>}
      <h3>{t('staff.dispute.takeover')}</h3>
      <ul className={styles.items}>{g.confirmations.map((c) => <li key={c.step}>{c.step} · {at(c.at)}</li>)}</ul>
      <h3>{t('staff.dispute.access')}</h3>
      <ul className={styles.items}>{g.accessLog.map((a, i) => <li key={i}>{at(a.at)} · {t(`staff.party.${a.party}`)} · {a.network ?? '—'}</li>)}</ul>
    </section>
  );
}

interface ChatView { closed: boolean; messages: { seq: number; from: string; kind: string; text: string | null; caption: string | null; image: Link | null; flags: string[]; at: string; removed: boolean }[] }
function Chat({ path, t, lang }: { path: string; t: T; lang: Lang }) {
  const api = useApi();
  const [shown, setShown] = useState(false);
  const chat = useQuery({
    queryKey: ['staff', 'chat', path],
    queryFn: ({ signal }) => api.get(path, { signal }) as Promise<ChatView>,
    enabled: shown,
    staleTime: 0,
    retry: false,
  });
  return (
    <section className={styles.panel} aria-labelledby="dispute-chat">
      <h2 id="dispute-chat">{t('staff.dispute.chat')}</h2>
      {!shown && <button type="button" className={styles.secondary} onClick={() => setShown(true)}>{t('staff.dispute.show_chat')}</button>}
      {chat.isError && <FormMessage kind="error">{staffError(chat.error, t, lang)}</FormMessage>}
      {chat.data && (
        <ol className={styles.items}>
          {chat.data.messages.map((m) => (
            <li key={m.seq} className={styles.message}>
              <p><strong>{t(`staff.party.${m.from}`)}</strong> · {formatDateTime(Date.parse(m.at), lang)}{m.flags.length ? ` · ${m.flags.join(', ')}` : ''}</p>
              {m.removed ? <p className={styles.hint}>{t('staff.dispute.removed')}</p>
                : m.kind === 'text' ? <p className={styles.text}>{m.text}</p>
                  : <p>{m.caption}{m.image && <> <a href={m.image.url} target="_blank" rel="noopener noreferrer">{t('staff.case.open_file')}</a></>}</p>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function RequestInfo({ id, t, lang }: { id: string; t: T; lang: Lang }) {
  const api = useApi();
  const queryClient = useQueryClient();
  return (
    <Action title={t('staff.dispute.request_title')} button={t('staff.dispute.request_button')} consequence={t('staff.dispute.request_consequence')}
      reasonLabel={t('staff.dispute.request_note')} t={t} lang={lang}
      run={(note) => api.post(`/staff/disputes/${encodeURIComponent(id)}/request-info`, { note })}
      done={(r) => t('staff.dispute.request_done', { at: formatDateTime(Date.parse((r as { infoDueAt: string }).infoDueAt), lang) })}
      onDone={() => void queryClient.invalidateQueries({ queryKey: caseKey(id) })} />
  );
}

function Decide({ f, t, lang }: { f: CaseFile; t: T; lang: Lang }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [outcome, setOutcome] = useState<Outcome | ''>('');
  const [amount, setAmount] = useState('');
  const [payer, setPayer] = useState<'buyer' | 'seller' | ''>('');
  const [partial, setPartial] = useState<Outcomes['partialRefund']>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const money = (p: string) => formatMoney(BigInt(p), lang);
  const game = f.order.listing.itemKind === 'game_account' || f.game !== null;
  const parsed = parseTaka(amount);
  const itemRefund = parsed.ok ? String(parsed.poisha) : null;
  const preview = async () => {
    setPreviewError(null);
    setPartial(null);
    if (!itemRefund) { setPreviewError(t('staff.dispute.amount_invalid')); return; }
    try {
      const r = (await api.get(`/staff/disputes/${encodeURIComponent(f.dispute.id)}/outcome-preview?itemRefund=${itemRefund}`)) as Outcomes;
      setPartial(r.partialRefund);
    } catch (e) {
      setPreviewError(staffError(e, t, lang));
    }
  };
  const split = outcome === 'release' ? f.outcomes.release
    : outcome === 'full_refund' || outcome === 'refund_after_return' ? f.outcomes.fullRefund
      : outcome === 'partial_refund' && partial && partial.itemRefund === itemRefund ? partial : null;
  const valid = outcome !== '' && (outcome !== 'partial_refund' || split !== null) && (outcome !== 'refund_after_return' || payer !== '');
  const options: [Outcome, string][] = [
    ['release', t('staff.outcome.release')], ['full_refund', t('staff.outcome.full_refund')], ['partial_refund', t('staff.outcome.partial_refund')],
    ...(game ? [] : [['refund_after_return', t('staff.outcome.refund_after_return')] as [Outcome, string]]),
  ];
  return (
    <Action title={t('staff.dispute.decide_title')} button={t('staff.dispute.decide_button')} t={t} lang={lang}
      consequence={f.dispute.fourEyes ? t('staff.dispute.four_eyes') : t('staff.dispute.decide_consequence')}
      minReason={20} valid={valid} invalidText={t('staff.dispute.decide_incomplete')}
      run={(reason) => api.post(`/staff/disputes/${encodeURIComponent(f.dispute.id)}/decision`, {
        outcome, reason, ...(outcome === 'partial_refund' ? { itemRefund } : {}), ...(outcome === 'refund_after_return' ? { returnPayer: payer } : {}),
      })}
      done={(r) => t((r as { status: string }).status === 'proposed' ? 'staff.dispute.proposed' : 'staff.dispute.decided')}
      onDone={() => void queryClient.invalidateQueries({ queryKey: caseKey(f.dispute.id) })}>
      <Choice legend={t('staff.dispute.outcome')} name="outcome" value={outcome} options={options} onChange={(v) => { setOutcome(v); setPartial(null); }} />
      {outcome === 'partial_refund' && (
        <div className={styles.field}>
          <label htmlFor="item-refund">{t('staff.dispute.amount', { max: money(f.outcomes.itemPrice) })}</label>
          <input id="item-refund" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setPartial(null); }} />
          <p><button type="button" className={styles.secondary} onClick={() => void preview()}>{t('staff.dispute.show_split')}</button></p>
          {previewError && <FormMessage kind="error">{previewError}</FormMessage>}
        </div>
      )}
      {outcome === 'refund_after_return' && (
        <Choice legend={t('staff.dispute.return_payer')} name="payer" value={payer} options={[['buyer', t('staff.party.buyer')], ['seller', t('staff.party.seller')]]} onChange={setPayer} />
      )}
      {split && (
        <p className={styles.split} role="status">{t('staff.dispute.split', { refunded: money(split.refunded), payout: money(split.sellerPayout) })}</p>
      )}
      {f.dispute.fourEyes && <p><strong>{t('staff.dispute.four_eyes')}</strong></p>}
    </Action>
  );
}

function EvidencePack({ id, t, lang }: { id: string; t: T; lang: Lang }) {
  const api = useApi();
  const [pack, setPack] = useState<{ url: string; expiresAt: string; sha256: string; files: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const make = async () => {
    setBusy(true);
    setError(null);
    try {
      setPack((await api.get(`/staff/disputes/${encodeURIComponent(id)}/evidence-pack`)) as typeof pack);
    } catch (e) {
      setError(staffError(e, t, lang));
    }
    setBusy(false);
  };
  return (
    <section className={styles.panel} aria-labelledby="dispute-pack">
      <h2 id="dispute-pack">{t('staff.dispute.pack_title')}</h2>
      <p className={styles.hint}>{t('staff.dispute.pack_explain')}</p>
      {error && <FormMessage kind="error">{error}</FormMessage>}
      {pack
        ? <p><a href={pack.url}>{t('staff.dispute.pack_download')}</a> · {t('staff.dispute.pack_hash', { hash: pack.sha256.slice(0, 16), files: String(pack.files), at: formatDateTime(Date.parse(pack.expiresAt), lang) })}</p>
        : <button type="button" className={styles.secondary} disabled={busy} onClick={() => void make()}>{t('staff.dispute.pack_button')}</button>}
    </section>
  );
}

/** U10-23 (FR-TNS-10): the seller's check of the returned item, the operator's way out of a stuck return, and the finding of a buyer's bad faith. */
function ReturnPanel({ f, rc, t, lang }: { f: CaseFile; rc: NonNullable<CaseFile['returnCheck']>; t: T; lang: Lang }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const id = f.dispute.id;
  const [outcome, setOutcome] = useState<'refund' | 'release' | ''>('');
  const [finding, setFinding] = useState<'false_claim' | 'swap' | ''>('');
  const refresh = () => void queryClient.invalidateQueries({ queryKey: caseKey(id) });
  const awaiting = f.dispute.status === 'awaiting_return';
  if (!awaiting && rc.checks.length === 0 && !rc.finding && rc.findings.length === 0) return null;
  return (
    <>
      <section className={styles.panel} aria-labelledby="dispute-return">
        <h2 id="dispute-return">{t('staff.return.title')}</h2>
        {rc.checks.length === 0
          ? <p>{t(awaiting ? 'staff.return.not_checked' : 'staff.return.none')}</p>
          : <ul className={styles.items}>{rc.checks.map((c, i) => <li key={i}>{formatDateTime(Date.parse(c.at), lang)} · {t(c.matched ? 'staff.return.matched' : 'staff.return.mismatch')}</li>)}</ul>}
        {rc.finding && <p><strong>{t(`staff.finding.${rc.finding.finding}`)}</strong> · {formatDateTime(Date.parse(rc.finding.at), lang)} · {rc.finding.reason}</p>}
      </section>
      {rc.canResolve && (
        <Action title={t('staff.return.resolve_title')} button={t('staff.return.resolve_button')} minReason={20} t={t} lang={lang}
          consequence={t(outcome === 'release' ? 'staff.return.consequence_release' : 'staff.return.consequence_refund')}
          valid={outcome !== ''} invalidText={t('staff.return.choose')}
          run={(reason) => api.post(`/staff/disputes/${encodeURIComponent(id)}/resolve-return`, { outcome, reason })}
          done={() => t('staff.return.resolved')} onDone={refresh}>
          <p className={styles.hint}>{t('staff.return.resolve_hint')}</p>
          <Choice legend={t('staff.return.outcome')} name="return-outcome" value={outcome}
            options={[['refund', t('staff.return.refund')], ['release', t('staff.return.release')]]} onChange={setOutcome} />
        </Action>
      )}
      {rc.findings.length > 0 && (
        <Action title={t('staff.finding.title')} button={t('staff.finding.button')} minReason={20} t={t} lang={lang}
          consequence={t(finding === 'swap' ? 'staff.finding.consequence_swap' : 'staff.finding.consequence_false')}
          valid={finding !== ''} invalidText={t('staff.finding.choose')}
          run={(reason) => api.post(`/staff/disputes/${encodeURIComponent(id)}/buyer-finding`, { finding, reason })}
          done={(r) => t((r as { suspended: boolean }).suspended ? 'staff.finding.done_suspended' : 'staff.finding.done')} onDone={refresh}>
          <p className={styles.hint}>{t('staff.finding.hint')}</p>
          <Choice legend={t('staff.finding.kind')} name="finding-kind" value={finding}
            options={rc.findings.map((k) => [k, t(`staff.finding.${k}`)] as ['false_claim' | 'swap', string])} onChange={setFinding} />
        </Action>
      )}
    </>
  );
}
