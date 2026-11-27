// The 'Message the seller' action of a listing (FR-CHT-01): opens or finds the conversation and goes to it.
import { Link } from 'react-router-dom';
import { errorText } from '../../shared/errors';
import { FormMessage } from '../../shared/form';
import type { Lang } from '../../shared/language/lang';
import { useOpenThread } from '../../shared/chat';
import { ChatIcon } from '../../shared/icons';
import styles from './listings.module.css';
import { T } from './listingShared';

/** FR-CHT-01: a conversation with the seller about this listing (U8-13); signed-out visitors sign in first. */
export function MessageSeller({ listingId, signedIn, nextPath, t, lang }: { listingId: string; signedIn: boolean; nextPath: string; t: T; lang: Lang }) {
  const { open, busy, error } = useOpenThread();
  // one ruled cell at the end of the seller row: a chat mark (its name is in the label, for the screen reader and the tooltip)
  if (!signedIn)
    return (
      <Link
        className={styles.chatCell}
        to={`/signin?next=${encodeURIComponent(nextPath)}`}
        aria-label={t('listing.message_seller_sign_in')}
        title={t('listing.message_seller_sign_in')}
      >
        <ChatIcon />
      </Link>
    );
  return (
    <>
      <button
        type="button"
        className={styles.chatCell}
        onClick={() => open(listingId)}
        disabled={busy}
        aria-busy={busy}
        aria-label={t('listing.message_seller')}
        title={t('listing.message_seller')}
      >
        <ChatIcon />
      </button>
      {error !== null && (
        <div className={styles.chatError}>
          <FormMessage kind="error">{errorText(error, t, lang)}</FormMessage>
        </div>
      )}
    </>
  );
}
