import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatMoney, parseTaka } from '../../lib/money.js';
import { formatDateTime } from '../../lib/time.js';
import { useApi } from '../../shared/api';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import styles from '../staff.module.css';
import { SaveForm, Text } from './forms';
import { ZONES, FareTable } from './referenceShared';

export function FareForm({ table, t, lang }: { table: FareTable | null; t: T; lang: Lang }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const taka = (p: string | undefined) => (p ? formatMoney(BigInt(p), 'en', { decimals: 'auto' }).replace('৳', '') : '');
  const [rows, setRows] = useState(() =>
    ZONES.map((zone) => {
      const r = table?.rows.find((x) => x.zone === zone);
      return { zone, upTo1kg: taka(r?.upTo1kg), upTo2kg: taka(r?.upTo2kg), perExtraKg: taka(r?.perExtraKg) };
    }),
  );
  const [source, setSource] = useState('');
  const poisha = (s: string, zeroOk: boolean) => {
    const r = parseTaka(s);
    return r.ok && (zeroOk || r.poisha > 0n) ? String(r.poisha) : null;
  };
  const parsed = rows.map((r) => ({
    zone: r.zone,
    upTo1kg: poisha(r.upTo1kg, false),
    upTo2kg: poisha(r.upTo2kg, false),
    perExtraKg: poisha(r.perExtraKg || '0', true),
  }));
  return (
    <>
      {table && (
        <p>{t('admin.fares.current', { version: String(table.version), from: formatDateTime(Date.parse(table.effectiveFrom), lang), source: table.source })}</p>
      )}
      <SaveForm
        title={t('admin.fares.publish_title')}
        button={t('admin.fares.publish')}
        t={t}
        lang={lang}
        check={() => (parsed.every((r) => r.upTo1kg && r.upTo2kg && r.perExtraKg) && source.trim() ? null : t('admin.fares.incomplete'))}
        run={() => api.post('/admin/fare-tables', { source: source.trim(), rows: parsed })}
        done={(r) => {
          void queryClient.invalidateQueries({ queryKey: ['admin', 'fares'] });
          return t('admin.fares.published', { version: String((r as FareTable).version) });
        }}
      >
        {rows.map((r, i) => (
          <fieldset key={r.zone} className={styles.choice}>
            <legend>{t(`admin.zone.${r.zone}`)}</legend>
            <div className={styles.fields}>
              {(['upTo1kg', 'upTo2kg', 'perExtraKg'] as const).map((k) => (
                <Text
                  key={k}
                  id={`fare-${r.zone}-${k}`}
                  label={t(`admin.fares.${k}`)}
                  value={r[k]}
                  inputMode="decimal"
                  onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, [k]: v } : x)))}
                />
              ))}
            </div>
          </fieldset>
        ))}
        <Text id="fare-source" label={t('admin.fares.source')} value={source} onChange={setSource} hint={t('admin.fares.source_hint')} maxLength={500} />
      </SaveForm>
    </>
  );
}
