// The privacy notice (FR-PRV-01): purposes, the data collected, how long it is kept (SRS retention table), who receives it, where it is
// stored, and how to withdraw consent. A draft for team and legal review (Decisions log, U8-02); /help/privacy and the dialog of the
// last step of registration show the same text.
import { useAccountT } from './common';

const POINTS = ['purposes', 'data', 'retention', 'recipients', 'location', 'rights'] as const;

/** The points of the notice, shared by the dialog of registration and /help/privacy. */
export function PrivacyPoints() {
  const { t } = useAccountT();
  return (
    <dl>
      {POINTS.map((p) => (
        <div key={p}>
          <dt>{t(`privacy.${p}.title`)}</dt>
          <dd>{t(`privacy.${p}.text`)}</dd>
        </div>
      ))}
    </dl>
  );
}
