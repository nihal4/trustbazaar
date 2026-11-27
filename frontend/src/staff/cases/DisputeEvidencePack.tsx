import { useState } from 'react';
import { formatDateTime } from '../../lib/time.js';
import { useApi } from '../../shared/api';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import styles from '../staff.module.css';
import { staffError } from './common';
import { Button } from '../../shared/ui';

export function EvidencePack({ id, t, lang }: { id: string; t: T; lang: Lang }) {
  const api = useApi();
  const [pack, setPack] = useState<{ url: string; expiresAt: string; sha256: string; files: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const make = async () => {
    setBusy(true);
    setError(null);
    try {
      setPack((await api.get(`/staff/disputes/${encodeURIComponent(id)}/evidence-pack`)) as typeof pack);
    } catch (e) {
      setError(staffError(e, t, lang));
    }
    setBusy(false);
  };
  return (
    <section className={styles.panel} aria-labelledby="dispute-pack">
      <h2 id="dispute-pack">{t('staff.dispute.pack_title')}</h2>
      <p className={styles.hint}>{t('staff.dispute.pack_explain')}</p>
      {error && <FormMessage kind="error">{error}</FormMessage>}
      {pack ? (
        <p>
          <a className={styles.openLink} href={pack.url}>
            {t('staff.dispute.pack_download')}
          </a>{' '}
          · {t('staff.dispute.pack_hash', { hash: pack.sha256.slice(0, 16), files: String(pack.files), at: formatDateTime(Date.parse(pack.expiresAt), lang) })}
        </p>
      ) : (
        <Button variant="secondary" type="button" disabled={busy} onClick={() => void make()}>
          {t('staff.dispute.pack_button')}
        </Button>
      )}
    </section>
  );
}
