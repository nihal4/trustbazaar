// The payout account, /account/payout (docs/design/08_frontend.pdf section 3.3; FR-PAY-17, FR-PAY-18; U8-09): the
// current account and its check status, and adding or replacing it after step-up ('payout.change', SEC-AUTH-08). A
// wallet must be on the member's verified mobile number; a bank account waits for an operator's name check against the
// KYC name; every new account cools off (CP-29) before payouts use it. The full number is never shown back.
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toAsciiDigits } from '../../lib/money.js';
import { useApi } from '../../shared/api';
import { signInPath } from '../../shared/document';
import { errorText } from '../../shared/errors';
import { FormMessage } from '../../shared/form';
import { useT } from '../../shared/language/Language';
import { fieldErrors, isApiError } from '../../shared/problems';
import { FRESHNESS } from '../../shared/query';
import { Popup } from '../../shared/Popup';
import { StepUpCancelled } from '../../shared/stepUp';
import { BrandMark } from './BrandMark';
import { accountLine, accountStatus, type PayoutAccount } from './model';
import en from '../../messages/en/seller.json';
import bn from '../../messages/bn/seller.json';
import styles from './seller.module.css';

const CATALOGUES = { en, bn };
type Kind = PayoutAccount['kind'];

export function Component() {
  const { t, lang } = useT(CATALOGUES);
  const api = useApi();
  const queryClient = useQueryClient();
  const account = useQuery({
    queryKey: ['me', 'payout-account'],
    queryFn: ({ signal }) => api.get('/me/payout-account', { signal }) as Promise<{ account: PayoutAccount | null }>,
    staleTime: FRESHNESS.money,
    retry: false,
  });
  const [kind, setKind] = useState<Kind>('bkash_wallet');
  const [open, setOpen] = useState<Kind | null>(null);
  const [wallet, setWallet] = useState('');
  const [bankName, setBankName] = useState('');
  const [branchName, setBranchName] = useState('');
  const [routing, setRouting] = useState('');
  const [accountName, setAccountName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: (body: Record<string, string>) =>
      api.post('/me/payout-account', body, { stepUpAction: 'payout.change' }) as Promise<{ account: PayoutAccount }>,
    onSuccess: (r) => {
      setSaved(true);
      setMessage(null);
      setOpen(null);
      setWallet('');
      setAccountNumber('');
      queryClient.setQueryData(['me', 'payout-account'], r);
    },
    onError: (e) => {
      if (e instanceof StepUpCancelled) return;
      const reasons = fieldErrors(e).map((f) => f.reason);
      setMessage(
        reasons.includes('not-verified-number')
          ? t('payout.not_verified_number')
          : reasons.includes('not-bangladeshi-mobile')
            ? t('payout.bad_wallet')
            : errorText(e, t, lang),
      );
    },
  });

  if (account.isError && isApiError(account.error, 401))
    return (
      <p>
        <Link to={signInPath('/account/payout')}>{t('seller.sign_in')}</Link>
      </p>
    );
  if (account.isError && isApiError(account.error, 403))
    return (
      <div className={styles.page}>
        <h1>{t('payout.title')}</h1>
        <FormMessage kind="info">{t('seller.verify')}</FormMessage>
      </div>
    );
  const a = account.data?.account ?? null;
  const choose = (k: Kind) => {
    setKind(k);
    setMessage(null);
    setSaved(false);
    setOpen(k);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSaved(false);
    if (kind !== 'bank') {
      if (!wallet.trim()) return setMessage(t('payout.wallet_needed'));
      return save.mutate({ kind, walletNumber: toAsciiDigits(wallet).trim() });
    }
    const number = toAsciiDigits(accountNumber).replace(/[\s-]/g, '');
    const route = toAsciiDigits(routing).replace(/\s/g, '');
    if (!bankName.trim() || !accountName.trim()) return setMessage(t('payout.bank_needed'));
    if (!/^\d{9}$/.test(route)) return setMessage(t('payout.routing_invalid'));
    if (!/^\d{6,20}$/.test(number)) return setMessage(t('payout.number_invalid'));
    save.mutate({
      kind,
      bankName: bankName.trim(),
      ...(branchName.trim() ? { branchName: branchName.trim() } : {}),
      routingNumber: route,
      accountName: accountName.trim(),
      accountNumber: number,
    });
  };

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1>{t('payout.title')}</h1>
      </div>
      {/* two columns divided by one line, as on the dashboard: the account that is in use on the left, the form to add or replace it on the right */}
      <div className={styles.cols}>
        <div className={styles.col}>
          <section aria-labelledby="current-title" className={styles.panel}>
            <h2 id="current-title">{t('payout.current')}</h2>
            {account.isPending && <p role="status">{t('shell.loading')}</p>}
            {account.isSuccess && !a && <p>{t('seller.account_none')}</p>}
            {a && (
              <dl className={styles.facts}>
                <div>
                  <dt>{t('payout.field_account')}</dt>
                  <dd>{accountLine(a, t)}</dd>
                </div>
                <div>
                  <dt>{t('payout.field_status')}</dt>
                  <dd>
                    <span className={a.status === 'active' ? `${styles.dot} ${styles.dotOn}` : styles.dot} aria-hidden="true" />
                    {accountStatus(a, t, lang)}
                  </dd>
                </div>
              </dl>
            )}
          </section>
          <p className={styles.back}>
            <Link to="/seller" className={styles.ghostButton}>
              {t('payout.to_dashboard')}
            </Link>
          </p>
        </div>
        <div className={styles.col}>
          <section aria-labelledby="new-title" className={styles.panel}>
            <h2 id="new-title">{t(a ? 'payout.replace' : 'payout.add')}</h2>
            <p className={styles.hint}>{t('payout.cooling_note')}</p>
            {saved && <FormMessage kind="success">{t('payout.saved')}</FormMessage>}
            <h3>{t('payout.kind')}</h3>
            {/* each way to be paid is a ruled row with its mark; touching it opens its form in a popup over the blurred page */}
            <ul className={styles.options}>
              {(['bkash_wallet', 'nagad_wallet', 'bank'] as const).map((k) => (
                <li key={k}>
                  <button type="button" className={styles.option} aria-haspopup="dialog" onClick={() => choose(k)}>
                    <BrandMark kind={k} />
                    <span>{t(`payout.kind.${k}`)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          {/* the shared Popup stays out of sight while the step-up code is asked and returns, as it was, if the code is refused or cancelled */}
          {open && (
            <Popup id="payout-popup" title={t(`payout.kind.${open}`)} closeLabel={t('payout.close')} busy={save.isPending} onClose={() => setOpen(null)}>
              <form onSubmit={submit} noValidate className={styles.popForm}>
                <div className={styles.popHead}>
                  <BrandMark kind={open} size={48} />
                  <p className={styles.hint}>{t(open === 'bank' ? 'payout.bank_note' : 'payout.wallet_hint')}</p>
                </div>
                {message && <FormMessage kind="error">{message}</FormMessage>}
                {open !== 'bank' ? (
                  <>
                    <label htmlFor="wallet">{t('payout.wallet')}</label>
                    <input
                      id="wallet"
                      data-autofocus
                      inputMode="tel"
                      autoComplete="tel"
                      value={wallet}
                      maxLength={20}
                      onChange={(e) => setWallet(e.target.value)}
                    />
                  </>
                ) : (
                  <>
                    <label htmlFor="bank-name">{t('payout.bank_name')}</label>
                    <input id="bank-name" data-autofocus value={bankName} maxLength={80} onChange={(e) => setBankName(e.target.value)} />
                    <label htmlFor="branch-name">{t('payout.branch_name')}</label>
                    <input id="branch-name" value={branchName} maxLength={80} onChange={(e) => setBranchName(e.target.value)} />
                    <label htmlFor="routing">{t('payout.routing')}</label>
                    <input id="routing" inputMode="numeric" value={routing} maxLength={9} onChange={(e) => setRouting(e.target.value)} />
                    <label htmlFor="account-name">{t('payout.account_name')}</label>
                    <input id="account-name" value={accountName} maxLength={120} autoComplete="name" onChange={(e) => setAccountName(e.target.value)} />
                    <label htmlFor="account-number">{t('payout.account_number')}</label>
                    <input
                      id="account-number"
                      inputMode="numeric"
                      autoComplete="off"
                      value={accountNumber}
                      maxLength={24}
                      onChange={(e) => setAccountNumber(e.target.value)}
                    />
                  </>
                )}
                <div className={styles.buttons}>
                  <button type="submit" className={styles.primary} disabled={save.isPending}>
                    {t(a ? 'payout.save_replace' : 'payout.save')}
                  </button>
                </div>
              </form>
            </Popup>
          )}
        </div>
      </div>
    </div>
  );
}
