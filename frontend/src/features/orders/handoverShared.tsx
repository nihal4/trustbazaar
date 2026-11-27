// What the handover's parts share: the Dhaka date-time input, the name of a place and the 'where' line of a proposal.
import { toLocalDigits } from '../../lib/money.js';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { type MeetupPoint, type OwnPlace } from './model';
import styles from './orders.module.css';

/** 'YYYY-MM-DDTHH:mm' typed as Dhaka time (UTC+6, no daylight saving) to an ISO instant; null when not a time. */
export function dhakaInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const t = Date.parse(`${value}:00+06:00`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** The code digit by digit, so it can be read aloud ("4 8 1 9 0 2"). */
export const spaced = (code: string, lang: Lang) => toLocalDigits(code.split('').join(' '), lang);

export function placeName(point: MeetupPoint | null, place: OwnPlace | null, lang: Lang): string {
  if (point) return `${lang === 'bn' ? point.nameBn : point.nameEn}, ${point.district}`;
  return place?.name ?? '';
}

/** A curated point has a map link; a place of the parties' own never has one, and carries the safety notice. */
export function Where({ point, place, t, lang }: { point: MeetupPoint | null; place: OwnPlace | null; t: T; lang: Lang }) {
  return (
    <>
      <span>{placeName(point, place, lang)}</span>
      {point && (
        <>
          {' '}
          ·{' '}
          <a href={point.mapUrl} target="_blank" rel="noopener noreferrer">
            {t('handover.map')}
          </a>
        </>
      )}
      {point?.guidance && <span className={styles.hint}> · {point.guidance}</span>}
      {place && <span className={styles.notice}>{t('handover.own_place_notice')}</span>}
    </>
  );
}
