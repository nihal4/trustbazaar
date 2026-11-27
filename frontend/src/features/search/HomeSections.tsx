// The two showcase sections of the home page (docs/design/10_visual_v3.md, section 3): four product-UI cards that show why
// paying a stranger is safe, and the strip "how a purchase goes". The figures and names are an example (the same S24 Ultra
// auction as the hero window, marked "Example"); a real order never shows them. Everything rests except the auction's
// live dot; the hero clock is the page's one moving number.
import { formatMoney, toLocalDigits } from '../../lib/money.js';
import { Stepper } from '../../shared/ui';
import { moneySteps } from '../../shared/moneySteps';
import type { useT } from '../../shared/language/Language';
import type { Lang } from '../../shared/language/lang';
import styles from './bento.module.css';

type T = ReturnType<typeof useT>['t'];

const Tick = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
    <path d="M3.5 8.4 l3 3 l6-6.4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function SafeBento({ t, lang, clock }: { t: T; lang: Lang; clock: string }) {
  const digits = ['4', '1', '7', '9', '0', '2'];
  return (
    <section aria-labelledby="home-safe" className={styles.safe}>
      <h2 id="home-safe" className={styles.h2}>
        {t('home.safe.title')}
      </h2>
      <div className={styles.bento}>
        <article aria-labelledby="home-promise" className={`${styles.cardBox} ${styles.escrow}`}>
          <h3 id="home-promise" className={styles.h3}>
            {t('home.promise.title')}
          </h3>
          <p className={styles.text}>{t('home.safe.escrow_text')}</p>
          <div className={styles.ui}>
            <p className={styles.caption}>{t('home.counterfoil.stub')}</p>
            <Stepper
              look="rows"
              steps={moneySteps([t('home.counterfoil.in'), t('home.counterfoil.held'), t('home.counterfoil.out')], 'held')}
              className={styles.timeline}
            />
          </div>
        </article>

        <article className={`${styles.cardBox} ${styles.auction}`}>
          <h3 className={styles.h3}>{t('home.safe.auction_title')}</h3>
          <p className={styles.text}>{t('home.safe.auction_text')}</p>
          <div className={styles.clockRow} aria-hidden="true">
            <span className={styles.live} />
            {t('home.safe.ends')}
            <strong>{toLocalDigits(clock, lang)}</strong>
            <em className={styles.tag}>{t('home.demo.example')}</em>
          </div>
          <div className={styles.ui} aria-hidden="true">
            <ul className={styles.bids}>
              {[
                ['3', '8500000'],
                ['1', '8400000'],
                ['2', '8300000'],
              ].map(([n, p]) => (
                <li key={n}>
                  <span>{t('home.safe.bidder', { n: toLocalDigits(n, lang) })}</span>
                  <b>{formatMoney(p, lang)}</b>
                </li>
              ))}
            </ul>
          </div>
        </article>

        <article className={`${styles.cardBox} ${styles.idCard}`}>
          <h3 className={styles.h3}>{t('home.safe.id_title')}</h3>
          <p className={styles.text}>{t('home.safe.id_text')}</p>
          <ul className={styles.checks} aria-hidden="true">
            <li>
              <span className={styles.tickBox}>
                <Tick />
              </span>
              {t('home.safe.id_card')}
            </li>
            <li>
              <span className={styles.tickBox}>
                <Tick />
              </span>
              {t('home.safe.id_selfie')}
            </li>
          </ul>
        </article>

        <article className={`${styles.cardBox} ${styles.code}`}>
          <h3 className={styles.h3}>{t('home.safe.code_title')}</h3>
          <p className={styles.text}>{t('home.safe.code_text')}</p>
          <div className={styles.ui} aria-hidden="true">
            <p className={styles.caption}>{t('home.safe.code_label')}</p>
            <div className={styles.digits}>
              {digits.map((d, i) => (
                <span key={i}>{toLocalDigits(d, lang)}</span>
              ))}
            </div>
          </div>
        </article>

        <article className={`${styles.cardBox} ${styles.pay}`}>
          <h3 className={styles.h3}>{t('home.safe.pay_title')}</h3>
          <p className={styles.text}>{t('home.safe.pay_text')}</p>
          <ul className={styles.methods} aria-hidden="true">
            <li>bKash</li>
            <li>Nagad</li>
            <li>{t('home.safe.card')}</li>
          </ul>
        </article>
      </div>
    </section>
  );
}

export function Journey({ t, lang }: { t: T; lang: Lang }) {
  const steps = ['find', 'ask', 'pay', 'meet'] as const;
  return (
    <section aria-labelledby="home-journey" className={styles.journey}>
      <h2 id="home-journey" className={styles.h2}>
        {t('home.journey.title')}
      </h2>
      <ol className={styles.jSteps}>
        {steps.map((s, i) => (
          <li key={s}>
            <span className={styles.jNum} aria-hidden="true">
              {toLocalDigits(String(i + 1), lang)}
            </span>
            <strong>{t(`home.journey.${s}`)}</strong>
            <span>{t(`home.journey.${s}_text`)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
