// The two showcase sections of the home page (docs/design/10_visual_v3.md, section 3): a bento of product-UI cards that
// show why paying a stranger is safe, and the dark strip "how a purchase goes". All figures and names are demonstration
// content, the page says nothing a real order does not do. Motion is CSS only and rests under reduced motion.
import { formatMoney, toLocalDigits } from '../../lib/money.js';
import type { useT } from '../../shared/language/Language';
import type { Lang } from '../../shared/language/lang';
import styles from './bento.module.css';

type T = ReturnType<typeof useT>['t'];

const Tick = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path className={styles.tickPath} d="M3.5 8.4 l3 3 l6-6.4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

export function SafeBento({ t, lang }: { t: T; lang: Lang }) {
  const digits = ['4', '1', '7', '9', '0', '2'];
  return (
    <section aria-labelledby="home-safe" className={styles.safe}>
      <h2 id="home-safe" className={styles.h2}>{t('home.safe.title')}</h2>
      <div className={styles.bento}>
        <section aria-labelledby="home-promise" className={`${styles.cardBox} ${styles.escrow}`}>
          <p className={styles.label}>{t('home.counterfoil.stub')}</p>
          <h2 id="home-promise" className={styles.h3}>{t('home.promise.title')}</h2>
          <p className={styles.text}>{t('home.safe.escrow_text')}</p>
          <ol className={styles.timeline}>
            <li className={styles.t1}>{t('home.counterfoil.in')}</li>
            <li className={styles.t2}>{t('home.counterfoil.held')}</li>
            <li className={styles.t3}>{t('home.counterfoil.out')}</li>
          </ol>
        </section>

        <article className={`${styles.cardBox} ${styles.auction}`}>
          <h3 className={styles.h3}>{t('home.safe.auction_title')}</h3>
          <p className={styles.text}>{t('home.safe.auction_text')}</p>
          <div className={styles.ui} aria-hidden="true">
            <div className={styles.clockRow}><span className={styles.live} />{t('home.safe.ends')}<strong>{toLocalDigits('02:14:09', lang)}</strong></div>
            <ul className={styles.bids}>
              {[['3', '8700000'], ['1', '8650000'], ['2', '8600000']].map(([n, p], i) => (
                <li key={n} style={{ ['--i' as string]: i }}><span>{t('home.safe.bidder', { n: toLocalDigits(n, lang) })}</span><b>{formatMoney(p, lang)}</b></li>
              ))}
            </ul>
          </div>
        </article>

        <article className={`${styles.cardBox} ${styles.idCard}`}>
          <h3 className={styles.h3}>{t('home.safe.id_title')}</h3>
          <p className={styles.text}>{t('home.safe.id_text')}</p>
          <ul className={styles.checks} aria-hidden="true">
            <li><span className={styles.tickBox}><Tick /></span>{t('home.safe.id_card')}</li>
            <li><span className={styles.tickBox}><Tick /></span>{t('home.safe.id_selfie')}</li>
          </ul>
        </article>

        <article className={`${styles.cardBox} ${styles.code}`}>
          <h3 className={styles.h3}>{t('home.safe.code_title')}</h3>
          <p className={styles.text}>{t('home.safe.code_text')}</p>
          <div className={styles.ui} aria-hidden="true">
            <p className={styles.label}>{t('home.safe.code_label')}</p>
            <div className={styles.digits}>{digits.map((d, i) => <span key={i} style={{ ['--i' as string]: i }}>{toLocalDigits(d, lang)}</span>)}</div>
          </div>
        </article>

        <article className={`${styles.cardBox} ${styles.pay}`}>
          <h3 className={styles.h3}>{t('home.safe.pay_title')}</h3>
          <p className={styles.text}>{t('home.safe.pay_text')}</p>
          <ul className={styles.methods} aria-hidden="true">
            <li>bKash</li><li>Nagad</li><li>{t('home.safe.card')}</li>
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
      <h2 id="home-journey" className={styles.jTitle}>{t('home.journey.title')}</h2>
      <ol className={styles.jSteps}>
        {steps.map((s, i) => (
          <li key={s} style={{ ['--i' as string]: i }}>
            <span className={styles.jNum} aria-hidden="true">{toLocalDigits(String(i + 1), lang)}</span>
            <strong>{t(`home.journey.${s}`)}</strong>
            <span>{t(`home.journey.${s}_text`)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
