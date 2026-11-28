// The fields of the payment sheet's details step: a card (number, holder, expiry, cvc) and a wallet (number and PIN). They only show and report what is typed;
// the sheet owns the values and what makes them ready.
import type { T } from './language/catalogue';
import { detectBrand, formatCardNumber, formatExpiry } from './cardBrand';
import styles from './paymentSheet.module.css';

export function CardFields({
  t,
  brand,
  number,
  setNumber,
  holder,
  setHolder,
  expiry,
  setExpiry,
  cvc,
  setCvc,
}: {
  t: T;
  brand: ReturnType<typeof detectBrand>;
  number: string;
  setNumber: (v: string) => void;
  holder: string;
  setHolder: (v: string) => void;
  expiry: string;
  setExpiry: (v: string) => void;
  cvc: string;
  setCvc: (v: string) => void;
}) {
  return (
    <>
      <label className={styles.field}>
        <span>
          {t('pay.sheet.card_number')}
          {brand.label && (
            <strong className={styles.brand} data-brand={brand.id}>
              {brand.label}
            </strong>
          )}
        </span>
        <input
          inputMode="numeric"
          autoComplete="cc-number"
          value={number}
          onChange={(e) => setNumber(formatCardNumber(e.target.value))}
          placeholder="0000 0000 0000 0000"
          maxLength={23}
        />
      </label>
      <label className={styles.field}>
        <span>{t('pay.sheet.holder')}</span>
        <input autoComplete="cc-name" value={holder} onChange={(e) => setHolder(e.target.value)} maxLength={60} />
      </label>
      <div className={styles.pair}>
        <label className={styles.field}>
          <span>{t('pay.sheet.expiry')}</span>
          <input
            inputMode="numeric"
            autoComplete="cc-exp"
            value={expiry}
            onChange={(e) => setExpiry(formatExpiry(e.target.value))}
            placeholder="MM/YY"
            maxLength={5}
          />
        </label>
        <label className={styles.field}>
          <span>{t('pay.sheet.cvc')}</span>
          <input
            inputMode="numeric"
            autoComplete="cc-csc"
            type="password"
            value={cvc}
            onChange={(e) => setCvc(e.target.value.replace(/\D/g, '').slice(0, brand.cvc))}
            placeholder={'•'.repeat(brand.cvc)}
            maxLength={brand.cvc}
          />
        </label>
      </div>
    </>
  );
}

export function WalletFields({
  t,
  method,
  wallet,
  setWallet,
  pin,
  setPin,
}: {
  t: T;
  method: 'bkash' | 'nagad';
  wallet: string;
  setWallet: (v: string) => void;
  pin: string;
  setPin: (v: string) => void;
}) {
  return (
    <>
      <label className={styles.field}>
        <span>{t('pay.sheet.wallet', { method: t(`pay.method.${method}`) })}</span>
        <input
          inputMode="numeric"
          autoComplete="tel-national"
          value={wallet}
          onChange={(e) => setWallet(e.target.value.replace(/\D/g, '').slice(0, 11))}
          placeholder="01XXXXXXXXX"
          maxLength={11}
        />
      </label>
      <label className={styles.field}>
        <span>{t('pay.sheet.pin', { method: t(`pay.method.${method}`) })}</span>
        <input
          inputMode="numeric"
          type="password"
          autoComplete="off"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="••••"
          maxLength={6}
        />
      </label>
      <p className={styles.lead}>{t('pay.sheet.no_otp')}</p>
    </>
  );
}
