// What the chat pages say to someone who is not signed in: it is for members, with the way to sign in and come back to this page.
import { Link } from 'react-router-dom';
import type { T } from '../../shared/language/catalogue';
import styles from './chat.module.css';

export function SignedOutNotice({ next, t }: { next: string; t: T }) {
  return (
    <div className={styles.page}>
      <h1>{t('chat.title')}</h1>
      <p>{t('chat.signed_out')}</p>
      <p>
        <Link to={`/signin?next=${encodeURIComponent(next)}`}>{t('shell.sign_in')}</Link>
      </p>
    </div>
  );
}
