// The TrustBazaar logotype (docs/design/10_visual_v3.md, section 2): the name set in outlined letters with a coin held in
// each "a" of "bazaar", and in Bangla the name with the coin as its full stop. Drawn once as SVG files in public/brand/
// (outlines, so the brand never waits for a font); one colour, plus a reversed version for dark grounds. Decorative:
// the link around it is named.
import { useLanguage } from './language/Language';
import styles from './shell.module.css';

export function Logo({ onDark = false }: { onDark?: boolean }) {
  const { lang } = useLanguage();
  const src = `/brand/trustbazaar${lang === 'bn' ? '-bn' : ''}${onDark ? '-reversed' : ''}.svg`;
  return (
    <span className={styles.logo}>
      <img className={lang === 'bn' ? `${styles.logotype} ${styles.logotypeBn}` : styles.logotype} src={src} alt="" height={30} decoding="async" />
    </span>
  );
}
