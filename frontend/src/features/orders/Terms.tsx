// Terms the user must accept before a step that cannot be undone (U10-23): a popup with numbered points and one acceptance box; the agree button stays off
// until the box is ticked. Used before the handover code, before choosing courier delivery and before opening a dispute. The points are catalogue
// messages `${prefix}.1` ... `${prefix}.${count}`, so each flow keeps its own wording in English and Bangla. Agreeing is first KEPT on the server (who, order,
// which terms, which version, when: POST /orders/{id}/terms-acceptances) and only then does the step go on; if it cannot be kept, the step does not go on.
import { useState } from 'react';
import { useApi } from '../../shared/api';
import { errorText } from '../../shared/errors';
import { FormMessage } from '../../shared/form';
import { Popup } from '../../shared/Popup';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import styles from './orders.module.css';

/** The version of the terms texts; raise it when their wording changes. */
export const TERMS_VERSION = 1;

export function Terms({
  id,
  t,
  lang,
  order,
  kind,
  title,
  intro,
  prefix,
  count,
  check,
  agree,
  back,
  busy = false,
  onAgree,
  onClose,
}: {
  id: string;
  t: T;
  lang: Lang;
  order: string;
  kind: 'handover_code' | 'courier' | 'dispute';
  title: string;
  intro: string;
  prefix: string;
  count: number;
  check: string;
  agree: string;
  back: string;
  busy?: boolean;
  onAgree: () => void;
  onClose: () => void;
}) {
  const api = useApi();
  const [accepted, setAccepted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const accept = async () => {
    if (saving) return;
    setSaving(true);
    setMessage(null);
    try {
      await api.post(`/orders/${encodeURIComponent(order)}/terms-acceptances`, { kind, version: TERMS_VERSION });
      onAgree();
    } catch (e) {
      setMessage(errorText(e, t, lang));
    } finally {
      setSaving(false);
    }
  };
  const working = busy || saving;
  return (
    <Popup id={id} title={title} closeLabel={back} busy={working} onClose={onClose}>
      <p className={styles.hint}>{intro}</p>
      <ol className={styles.terms} role="list">
        {Array.from({ length: count }, (_, i) => (
          <li key={i}>{t(`${prefix}.${i + 1}`)}</li>
        ))}
      </ol>
      <label className={styles.accept}>
        <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
        <span>{check}</span>
      </label>
      {message && <FormMessage kind="error">{message}</FormMessage>}
      <div className={styles.popupButtons}>
        <button type="button" className={styles.primary} disabled={!accepted || working} aria-busy={working} onClick={() => void accept()}>
          {agree}
        </button>
        <button type="button" className={styles.secondary} disabled={working} onClick={onClose}>
          {back}
        </button>
      </div>
    </Popup>
  );
}
