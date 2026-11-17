// /disputes/:id (docs/design/08_frontend.pdf section 7.7; U8-09): one dispute for either party, the same panel as on
// the order view, with a link back to the order. Notices and links about a dispute can open it directly.
import { Link, useParams } from 'react-router-dom';
import { signInPath } from '../../shared/document';
import { errorText } from '../../shared/errors';
import { FormMessage } from '../../shared/form';
import { useT } from '../../shared/language/Language';
import { isApiError } from '../../shared/problems';
import { DisputePanel, useDispute } from './Disputes';
import en from '../../messages/en/orders.json';
import bn from '../../messages/bn/orders.json';
import styles from './orders.module.css';

const CATALOGUES = { en, bn };

export function Component() {
  const { id = '' } = useParams();
  const { t, lang } = useT(CATALOGUES);
  const dispute = useDispute(id);
  if (dispute.isPending) return <p role="status">{t('shell.loading')}</p>;
  if (dispute.isError) {
    if (isApiError(dispute.error, 401)) return <p><Link to={signInPath(`/disputes/${id}`)}>{t('order.sign_in')}</Link></p>;
    return isApiError(dispute.error, 404) ? <h1>{t('dispute.not_found')}</h1> : <FormMessage kind="error">{errorText(dispute.error, t, lang)}</FormMessage>;
  }
  return (
    <div className={styles.page}>
      <DisputePanel d={dispute.data} o={null} t={t} lang={lang} />
    </div>
  );
}
