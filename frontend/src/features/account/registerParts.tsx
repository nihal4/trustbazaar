// Small pieces of the registration and sign-in pages: the sentence that accepts the terms and the privacy notice, with the two names as links to their dialogs, and the
// line for someone who already has an account, and the line for someone who has none.
import type { MouseEvent, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../shared/ui';
import type { useAccountT } from './common';
import styles from './account.module.css';

type T = ReturnType<typeof useAccountT>['t'];

/** The words of the acceptance with {terms} and {privacy} swapped for buttons that open the document. */
export function acceptText(t: T, open: (kind: 'terms' | 'privacy') => (ev: MouseEvent<HTMLButtonElement>) => void): ReactNode {
  return t('register.accept_text', { terms: '{terms}', privacy: '{privacy}' })
    .split(/(\{terms\}|\{privacy\})/)
    .map((part, i) => {
      if (part === '{terms}')
        return (
          <Button variant="link" inline key={i} type="button" onClick={open('terms')}>
            {t('legal.terms_name')}
          </Button>
        );
      if (part === '{privacy}')
        return (
          <Button variant="link" inline key={i} type="button" onClick={open('privacy')}>
            {t('legal.privacy_name')}
          </Button>
        );
      return part;
    });
}

export function HaveAccount({ t, next }: { t: T; next: string | null }) {
  return (
    <p className={styles.footNote}>
      {t('register.have_account')} <Link to={next ? `/signin?next=${encodeURIComponent(next)}` : '/signin'}>{t('signin.link')}</Link>
    </p>
  );
}

/** The foot of the first two sign-in steps: the way to an account. */
export function NoAccount({ t, next }: { t: T; next: string | null }) {
  return (
    <p className={styles.footNote}>
      {t('signin.no_account')} <Link to={next ? `/register?next=${encodeURIComponent(next)}` : '/register'}>{t('register.link')}</Link>
    </p>
  );
}
