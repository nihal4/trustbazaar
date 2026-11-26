// The payment sheet (U10-23; FR-PAY-01, FR-PAY-02; NFR-CMP-05): a sheet that rises from the bottom of the screen over a blurred page, where the buyer
// chooses bKash, Nagad or a card, types the details, pays, sees the payment complete, and is asked whether to keep the method as the default. It is the
// same on the checkout and on the order page. The providers are simulated (PAYMENT_MODE=mock): any details are accepted, no OTP is asked, no real money
// moves, and the sheet says so. What is typed is never sent or stored; only the method's own name goes to the server (POST /orders/{id}/payments),
// exactly as before. With a simulated provider the sheet plays the provider's page itself (completeMockPayment) and then reads the ORDER's status; with a real
// provider (a page on a configured host) it leaves for that page as it always did. The default method is kept on the account (GET, PUT and DELETE /me/payment-method)
// as a masked label only: the kind, a card's brand and the last four digits. Browser storage is not used (SEC-SES-03).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMoney } from '../lib/money.js';
import { useApi } from './api';
import { errorText } from './errors';
import { FormMessage } from './form';
import type { T } from './language/catalogue';
import type { Lang } from './language/lang';
import { problemName } from './problems';
import { SimulatedBanner } from './SimulatedBanner';
import { cardLooksComplete, detectBrand, formatCardNumber, formatExpiry, lastFour, maskWallet, walletLooksValid } from './cardBrand';
import { away, completeMockPayment, isMockProviderPage, providerPage, type Provider } from './payments';
import styles from './paymentSheet.module.css';

type Method = 'bkash' | 'nagad' | 'card';
const PROVIDER_OF: Record<Method, Provider> = { bkash: 'bkash', nagad: 'nagad', card: 'stripe' };
const METHODS: Method[] = ['bkash', 'nagad', 'card'];
/** The sheet shows the processing for at least this long, so a quick simulated provider still reads as a payment being made. */
const MIN_PROCESSING_MS = 2_800;
const POLL_MS = 600;
const POLL_LIMIT_MS = 15_000;

/** The default method as the server keeps it: a masked label only (kind, a card's brand, the last four digits). */
interface Saved { kind: Method; brand: string | null; last4: string }
interface DefaultMethod { method: Method; label: string; saved: Saved }
const DEFAULT_KEY = ['me', 'payment-method'] as const;

/** The order the sheet pays: id, total (poisha) and the query key the app keeps it under. */
export interface PayableOrder { id: string; total: string; key: readonly unknown[] }

export function PaymentSheet({ order, onClose, onPaid, onReceipt, t, lang }: { order: PayableOrder; onClose: () => void; onPaid: (orderId: string) => void; /** Saves the receipt of the order just paid (the order as the server now has it); the page that owns the receipt passes it. */ onReceipt?: (paid: unknown) => void; t: T; lang: Lang }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState<'choose' | 'details' | 'processing' | 'done' | 'failed'>('choose');
  const [method, setMethod] = useState<Method | null>(null);
  const [number, setNumber] = useState('');
  const [holder, setHolder] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');
  const [wallet, setWallet] = useState('');
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [paidWith, setPaidWith] = useState<DefaultMethod | null>(null);
  const sending = useRef(false);
  const paidOrder = useRef<unknown>(null);
  const saved = useQuery({ queryKey: DEFAULT_KEY, queryFn: ({ signal }) => api.get('/me/payment-method', { signal }) as Promise<{ method: Saved | null }>, retry: false, staleTime: 30_000 });
  const savedLabel = (m: Saved) => (m.kind === 'card' ? `${m.brand || t('pay.sheet.card')} ${t('pay.sheet.ending', { last: m.last4 })}` : `${t(`pay.method.${m.kind}`)} ${t('pay.sheet.ending', { last: m.last4 })}`);
  const defaults: DefaultMethod | null = saved.data?.method ? { method: saved.data.method.kind, label: savedLabel(saved.data.method), saved: saved.data.method } : null;
  const total = formatMoney(BigInt(order.total), lang);
  const brand = useMemo(() => detectBrand(number), [number]);

  useEffect(() => {
    const d = dialog.current;
    if (d && typeof d.showModal === 'function' && !d.open) d.showModal();
    else d?.setAttribute('open', '');
  }, []);

  const ready = method === 'card'
    ? cardLooksComplete(number, expiry, cvc) && holder.trim().length >= 2
    : method !== null && walletLooksValid(wallet) && pin.replace(/\D/g, '').length >= 4;

  const label = (m: Method): string => (m === 'card'
    ? `${brand.label || t('pay.sheet.card')} ${t('pay.sheet.ending', { last: lastFour(number) })}`
    : `${t(`pay.method.${m}`)} ${maskWallet(wallet)}`);

  async function pay() {
    if (!method || !ready || sending.current) return;
    sending.current = true;
    setMessage(null);
    setStep('processing');
    const started = Date.now();
    try {
      const r = await api.post(`/orders/${encodeURIComponent(order.id)}/payments`, { provider: PROVIDER_OF[method] }, { idempotent: true }) as { redirectUrl: string };
      if (!isMockProviderPage(r.redirectUrl)) {
        // a real provider: only its own page, as before (SEC-PAY-02); the details typed here are not used
        const page = providerPage(r.redirectUrl);
        if (!page) throw new Error('bad-redirect');
        away.go(page);
        return;
      }
      await completeMockPayment(r.redirectUrl, 'succeeded');
      // the order's own status says whether it was paid (FR-PAY-02); the sheet never takes the provider's word for it
      let paid = false;
      for (let waited = 0; waited < POLL_LIMIT_MS && !paid; waited += POLL_MS) {
        const o = await api.get(`/orders/${encodeURIComponent(order.id)}`) as { status: string };
        paid = o.status === 'paid';
        if (paid) paidOrder.current = o;
        if (!paid) await new Promise((res) => setTimeout(res, POLL_MS));
      }
      if (!paid) throw new Error('not-paid');
      const rest = MIN_PROCESSING_MS - (Date.now() - started);
      if (rest > 0) await new Promise((res) => setTimeout(res, rest));
      const mask: Saved = method === 'card' ? { kind: 'card', brand: brand.label || null, last4: lastFour(number) } : { kind: method, brand: null, last4: wallet.replace(/\D/g, '').slice(-4) };
      setPaidWith({ method, label: label(method), saved: mask });
      setStep('done');
    } catch (e) {
      const name = problemName(e);
      setMessage(name === 'feature-off' ? t('pay.provider_off') : name === 'provider-unavailable' ? t('pay.provider_unavailable')
        : (e as Error).message === 'bad-redirect' ? t('pay.bad_redirect') : (e as Error).message === 'not-paid' ? t('pay.sheet.not_paid') : errorText(e, t, lang));
      if (name === 'order-state') void queryClient.invalidateQueries({ queryKey: order.key });
      setStep('failed');
    } finally {
      sending.current = false;
    }
  }

  // the answer to "keep it as your default?" is kept on the account (a masked label only); a failure to save never blocks the order
  const finish = async (saveAsDefault: boolean) => {
    if (saveAsDefault && paidWith) {
      try {
        await api.put('/me/payment-method', paidWith.saved);
        void queryClient.invalidateQueries({ queryKey: DEFAULT_KEY });
      } catch { /* the payment is made; the default can be set next time */ }
    }
    onPaid(order.id);
  };
  const forget = async () => {
    try {
      await api.del('/me/payment-method');
      void queryClient.invalidateQueries({ queryKey: DEFAULT_KEY });
    } catch { /* shown again next time */ }
  };
  const busy = step === 'processing';
  const close = () => { if (!busy) onClose(); };

  return (
    <dialog ref={dialog} className={styles.sheet} aria-labelledby="pay-sheet-title" onCancel={(e) => { e.preventDefault(); if (step === 'done') void finish(false); else close(); }}
      onClick={(e) => { if (e.target === dialog.current && step !== 'done') close(); }}>
      <div className={styles.inner}>
        <div className={styles.grab} aria-hidden="true" />
        <SimulatedBanner kind="payment" />

        {step === 'choose' && (
          <>
            <h2 id="pay-sheet-title" className={styles.title}>{t('pay.sheet.title', { total })}</h2>
            <p className={styles.lead}>{t('pay.sheet.choose')}</p>
            <ul className={styles.methods}>
              {(defaults ? [defaults.method, ...METHODS.filter((m) => m !== defaults.method)] : METHODS).map((m) => (
                <li key={m}>
                  <button type="button" className={styles.method} onClick={() => { setMethod(m); setStep('details'); }}>
                    <span className={styles.methodName}>{t(`pay.method.${m}`)}</span>
                    <span className={styles.methodNote}>{defaults && defaults.method === m ? `${t('pay.sheet.default')}: ${defaults.label}` : t(`pay.sheet.note.${m}`)}</span>
                    <svg viewBox="0 0 12 12" width="14" height="14" aria-hidden="true" focusable="false"><path d="M4 1.5 L8.5 6 L4 10.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                </li>
              ))}
            </ul>
            <div className={styles.answer}>
              {defaults && <button type="button" className={styles.quiet} onClick={() => void forget()}>{t('pay.sheet.forget')}</button>}
              <button type="button" className={styles.quiet} onClick={close}>{t('pay.cancel')}</button>
            </div>
          </>
        )}

        {step === 'details' && method && (
          <form onSubmit={(e) => { e.preventDefault(); void pay(); }} className={styles.form} noValidate>
            <h2 id="pay-sheet-title" className={styles.title}>{t(`pay.sheet.title_${method}`)}</h2>
            <p className={styles.lead}>{t('pay.sheet.any_details')}</p>
            {method === 'card' ? (
              <>
                <label className={styles.field}>
                  <span>{t('pay.sheet.card_number')}{brand.label && <strong className={styles.brand} data-brand={brand.id}>{brand.label}</strong>}</span>
                  <input inputMode="numeric" autoComplete="cc-number" value={number} onChange={(e) => setNumber(formatCardNumber(e.target.value))} placeholder="0000 0000 0000 0000" maxLength={23} />
                </label>
                <label className={styles.field}>
                  <span>{t('pay.sheet.holder')}</span>
                  <input autoComplete="cc-name" value={holder} onChange={(e) => setHolder(e.target.value)} maxLength={60} />
                </label>
                <div className={styles.pair}>
                  <label className={styles.field}>
                    <span>{t('pay.sheet.expiry')}</span>
                    <input inputMode="numeric" autoComplete="cc-exp" value={expiry} onChange={(e) => setExpiry(formatExpiry(e.target.value))} placeholder="MM/YY" maxLength={5} />
                  </label>
                  <label className={styles.field}>
                    <span>{t('pay.sheet.cvc')}</span>
                    <input inputMode="numeric" autoComplete="cc-csc" type="password" value={cvc} onChange={(e) => setCvc(e.target.value.replace(/\D/g, '').slice(0, brand.cvc))} placeholder={'•'.repeat(brand.cvc)} maxLength={brand.cvc} />
                  </label>
                </div>
              </>
            ) : (
              <>
                <label className={styles.field}>
                  <span>{t('pay.sheet.wallet', { method: t(`pay.method.${method}`) })}</span>
                  <input inputMode="numeric" autoComplete="tel-national" value={wallet} onChange={(e) => setWallet(e.target.value.replace(/\D/g, '').slice(0, 11))} placeholder="01XXXXXXXXX" maxLength={11} />
                </label>
                <label className={styles.field}>
                  <span>{t('pay.sheet.pin', { method: t(`pay.method.${method}`) })}</span>
                  <input inputMode="numeric" type="password" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="••••" maxLength={6} />
                </label>
                <p className={styles.lead}>{t('pay.sheet.no_otp')}</p>
              </>
            )}
            <button type="submit" className={styles.pay} disabled={!ready}>{t('pay.pay', { total })}</button>
            <button type="button" className={styles.quiet} onClick={() => setStep('choose')}>{t('pay.sheet.back')}</button>
          </form>
        )}

        {step === 'processing' && (
          <div className={styles.center} role="status" aria-live="polite">
            <h2 id="pay-sheet-title" className={styles.title}>{t('pay.sheet.processing')}</h2>
            <p className={styles.lead}>{t('pay.sheet.processing_note', { total })}</p>
            <div className={styles.bar} aria-hidden="true"><span /></div>
          </div>
        )}

        {step === 'done' && paidWith && (
          <div className={styles.center}>
            <svg className={styles.tick} viewBox="0 0 48 48" width="56" height="56" aria-hidden="true" focusable="false"><circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" strokeWidth="3" /><path d="M14 25 l7 7 l13 -15" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <h2 id="pay-sheet-title" className={styles.title} role="status">{t('pay.sheet.complete')}</h2>
            <p className={styles.amount}>{total}</p>
            <p className={styles.lead}>{t('pay.sheet.held', { method: paidWith.label })}</p>
            {onReceipt && <button type="button" className={styles.quiet} onClick={() => onReceipt(paidOrder.current)}>{t('orders.receipt')}</button>}
            {defaults?.label === paidWith.label ? (
              <button type="button" className={styles.pay} onClick={() => void finish(false)}>{t('pay.sheet.continue')}</button>
            ) : (
              <>
                <p className={styles.ask}>{t('pay.sheet.save_ask', { method: paidWith.label })}</p>
                <div className={styles.answer}>
                  <button type="button" className={styles.pay} onClick={() => void finish(true)}>{t('pay.sheet.save_yes')}</button>
                  <button type="button" className={styles.quiet} onClick={() => void finish(false)}>{t('pay.sheet.save_no')}</button>
                </div>
                <p className={styles.fine}>{t('pay.sheet.save_note')}</p>
              </>
            )}
          </div>
        )}

        {step === 'failed' && (
          <div className={styles.center}>
            <h2 id="pay-sheet-title" className={styles.title}>{t('pay.sheet.failed')}</h2>
            {message && <FormMessage kind="error">{message}</FormMessage>}
            <p className={styles.lead}>{t('pay.sheet.nothing_charged')}</p>
            <button type="button" className={styles.pay} onClick={() => setStep('details')}>{t('pay.sheet.try_again')}</button>
            <button type="button" className={styles.quiet} onClick={close}>{t('pay.cancel')}</button>
          </div>
        )}
      </div>
    </dialog>
  );
}
