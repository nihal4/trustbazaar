// The two steps of the ID-check wizard that only show something: what to have ready, and the review before the submission.
import { toLocalDigits } from '../../lib/money.js';
import type { Lang } from '../../shared/language/lang';
import { Preview } from './Capture';
import type { useKycT } from './common';
import { FILES_FOR, normaliseDocNumber, type DocType, type ImageKind } from './model';
import styles from './kyc.module.css';

type T = ReturnType<typeof useKycT>['t'];

export function IntroStep({ t }: { t: T }) {
  return (
    <div>
      <p>{t('intro.lead')}</p>
      <ul>
        {(['document', 'both_sides', 'selfie', 'light', 'whole', 'time'] as const).map((k) => (
          <li key={k}>{t(`intro.${k}`)}</li>
        ))}
      </ul>
      <p>{t('intro.privacy')}</p>
    </div>
  );
}

export function ReviewStep({
  t,
  lang,
  docType,
  details,
  images,
}: {
  t: T;
  lang: Lang;
  docType: DocType;
  details: { docNumber: string; fullName: string; dateOfBirth: string };
  images: Partial<Record<ImageKind, Blob>>;
}) {
  return (
    <div>
      <dl className={styles.facts}>
        <div>
          <dt>{t('details.type')}</dt>
          <dd>{t(`details.type.${docType}`)}</dd>
        </div>
        <div>
          <dt>{t(`details.number.${docType}`)}</dt>
          <dd>{normaliseDocNumber(details.docNumber)}</dd>
        </div>
        <div>
          <dt>{t('details.name')}</dt>
          <dd>{details.fullName.trim()}</dd>
        </div>
        <div>
          <dt>{t('details.dob')}</dt>
          <dd>{toLocalDigits(details.dateOfBirth, lang)}</dd>
        </div>
      </dl>
      <ul className={styles.thumbs}>
        {FILES_FOR[docType].map(
          (k) =>
            images[k] && (
              <li key={k}>
                <Preview image={images[k]!} alt={t(`image.${k}.title`)} />
                <span>{t(`image.${k}.title`)}</span>
              </li>
            ),
        )}
      </ul>
      <p>{t('review.once')}</p>
    </div>
  );
}
