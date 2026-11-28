// An avatar or a photo place (U11-04, U11-16): a square on the line grid with a picture, or the initial of a name when there is none (there is no photo upload): the grid drawn in the square and the initial in
// the accent colour. The picture is decorative: the name is next to it. The three sizes are the ones the site uses: a thread of a chat (sm), the other party of an order (md) and the member's own page (lg).
import { cx } from './cx';
import styles from './avatar.module.css';

export type AvatarSize = 'sm' | 'md' | 'lg';

/** The first letters of the first `words` words of a name ("Test Seller" -> "TS"; with 1, "T"). */
export function initials(name: string, words = 2): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, words)
      .map((word) => [...word][0] ?? '')
      .join('')
      .toUpperCase() || '?'
  );
}

export function Avatar({
  name,
  src,
  size = 'md',
  words = 2,
  className,
}: {
  name: string;
  src?: string;
  size?: AvatarSize;
  /** how many words of the name give a letter each: 2 ("TS") or 1 ("T") */
  words?: 1 | 2;
  className?: string;
}) {
  return (
    <span className={cx(styles.avatar, styles[size], className)} aria-hidden="true">
      {src ? <img src={src} alt="" /> : initials(name, words)}
    </span>
  );
}
