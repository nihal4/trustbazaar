// An avatar or a photo place (U11-04): a square on the line grid with a picture, or the initials of a name when there is none. The picture is decorative: the name is next to it.
import { cx } from './cx';
import styles from './avatar.module.css';

export type AvatarSize = 'sm' | 'md' | 'lg';

/** The first letters of the first two words of a name ("Test Seller" -> "TS"). */
export function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => [...word][0] ?? '')
      .join('')
      .toUpperCase() || '?'
  );
}

export function Avatar({ name, src, size = 'md', className }: { name: string; src?: string; size?: AvatarSize; className?: string }) {
  return (
    <span className={cx(styles.avatar, styles[size], className)} aria-hidden="true">
      {src ? <img src={src} alt="" /> : initials(name)}
    </span>
  );
}
