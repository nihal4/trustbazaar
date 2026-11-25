// A listing's title with its natural breaks: each part up to a comma is kept whole, so a narrow screen breaks "Samsung Galaxy S21 FE, 128 GB, Graphite"
// after a comma, not inside the model name. The text is exactly the title (parts joined by one space), so the heading's name is unchanged.
import { Fragment } from 'react';
import styles from './listings.module.css';

export function TitleParts({ text }: { text: string }) {
  const parts = text.split(/(?<=,)\s+/);
  return <>{parts.map((p, i) => <Fragment key={i}>{i > 0 ? ' ' : ''}<span className={styles.titlePart}>{p}</span></Fragment>)}</>;
}
