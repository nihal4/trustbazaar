import { useState } from 'react';
import { CheckboxField, FormMessage, SubmitButton } from '../../shared/form';
import { useAccountT } from './common';
import styles from './account.module.css';
import { Stepper, CopyButton } from './mfaShared';

/** The recovery codes, shown once: copy, save as a text file, and a confirmation before leaving. */
export function RecoveryCodes({ codes, fresh, onDone }: { codes: string[]; fresh: 'enabled' | 'regenerated'; onDone: () => void }) {
  const { t } = useAccountT();
  const [saved, setSaved] = useState(false);
  const text = codes.join('\n');

  const download = () => {
    const blob = new Blob([`${t('mfa.file_heading')}\n\n${text}\n`], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'trustbazaar-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      {fresh === 'enabled' && <Stepper current={4} />}
      <FormMessage kind="info">{t(fresh === 'enabled' ? 'mfa.codes_intro' : 'mfa.codes_new_intro')}</FormMessage>
      <ol className={styles.codes} aria-label={t('mfa.codes_title')}>
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ol>
      {/* the codes are kept in two ways: copied, or saved as a text file */}
      <div className={styles.actions}>
        <CopyButton text={text} label={t('mfa.copy_codes')} />
        <button type="button" onClick={download}>
          {t('mfa.download_codes')}
        </button>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (saved) onDone();
        }}
        noValidate
      >
        <CheckboxField id="mfa-codes-saved" label={t('mfa.codes_saved')} checked={saved} onChange={setSaved} />
        <SubmitButton busy={false} disabled={!saved}>
          {t('mfa.done')}
        </SubmitButton>
      </form>
    </div>
  );
}
