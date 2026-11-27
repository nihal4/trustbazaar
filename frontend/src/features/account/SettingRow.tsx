// A setting that is changed in a popup (U10-25): on the page it is one ruled row, its name on the left and what it is now on the right; touching it opens
// the form in the shared Popup (a sheet over a blurred page), so the page keeps only the rows and the forms take no room until they are wanted.
import { useState, type ReactNode } from 'react';
import { Popup } from '../../shared/Popup';
import { useAccountT } from './common';
import styles from './account.module.css';

export function SettingRow({ id, title, summary, locked = false, children }: { id: string; title: string; summary?: string | null; locked?: boolean; children: ReactNode }) {
  const { t } = useAccountT();
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button type="button" className={styles.settingRow} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <span>{title}</span>
        {summary && <span className={styles.settingValue}>{summary}</span>}
      </button>
      {open && <Popup id={id} title={title} closeLabel={t('legal.close')} busy={locked} onClose={() => setOpen(false)}>{children}</Popup>}
    </li>
  );
}
