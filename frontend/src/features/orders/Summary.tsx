// The order summary, the same in every state (U10-23): what the order is made of as ruled cells (quantity, item, delivery, total), on the left under the money
// panel. The actions and the way the item gets to the buyer are in the rail on the right; this column says what the order is and where the money is.
import { formatMoney, toLocalDigits } from '../../lib/money.js';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import type { OrderView } from './model';
import styles from './orders.module.css';

export function Breakdown({ o, t, lang }: { o: OrderView; t: T; lang: Lang }) {
  const money = (p: string) => formatMoney(BigInt(p), lang, { decimals: 'always' });
  return (
    <section aria-labelledby="breakdown-title" className={styles.previewBlock}>
      <h2 id="breakdown-title">{t('summary.title')}</h2>
      <dl className={styles.breakdownGrid}>
        <div>
          <dt>{t('summary.quantity')}</dt>
          <dd>{toLocalDigits(String(o.quantity), lang)}</dd>
        </div>
        <div>
          <dt>{t('pay.item')}</dt>
          <dd>{money(o.itemPrice)}</dd>
        </div>
        <div>
          <dt>{t('pay.delivery')}</dt>
          <dd>{o.fulfilment ? money(o.deliveryFee) : t('summary.not_chosen')}</dd>
        </div>
        <div className={styles.totalCell}>
          <dt>{t('pay.total')}</dt>
          <dd>{money(o.total)}</dd>
        </div>
      </dl>
      {o.status === 'awaiting_payment' && o.role === 'buyer' && <p className={styles.hint}>{t('pay.fee_note')}</p>}
    </section>
  );
}
