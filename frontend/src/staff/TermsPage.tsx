// The terms operators maintain, /staff/terms (FR-LST-11, FR-CHT-07; section 7.9; U8-10): the listing screening terms
// (a match holds a new listing for review, or refuses it if prohibited) and the chat detection terms (a match flags
// the message). Both are operator actions in the API, so they sit with the queues (Decisions log, U8-10).
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDateTime } from '../lib/time.js';
import { useApi } from '../shared/api';
import { FormMessage } from '../shared/form';
import type { T } from '../shared/language/catalogue';
import type { Lang } from '../shared/language/lang';
import { Choice, staffError } from './cases/common';
import { SaveForm, Text } from './admin/forms';
import { useStaffT } from './text';
import styles from './staff.module.css';

export function Component() {
  const { t, lang } = useStaffT();
  return (
    <div>
      <h1>{t('staff.terms.title')}</h1>
      <Screening t={t} lang={lang} />
      <Detection t={t} lang={lang} />
    </div>
  );
}

function Screening({ t, lang }: { t: T; lang: Lang }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const terms = useQuery({
    queryKey: ['staff', 'screening-terms'],
    queryFn: ({ signal }) =>
      api.get('/staff/screening-terms', { signal }) as Promise<{ items: { id: number; term: string; severity: string; addedAt: string }[] }>,
    staleTime: 0,
    retry: false,
  });
  const [term, setTerm] = useState('');
  const [severity, setSeverity] = useState<'prohibited' | 'high_risk' | ''>('');
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['staff', 'screening-terms'] });
  const remove = useMutation({ mutationFn: (id: number) => api.del(`/staff/screening-terms/${id}`), onSettled: refresh });
  return (
    <section className={styles.panel} aria-labelledby="screening">
      <h2 id="screening">{t('staff.terms.screening')}</h2>
      <p className={styles.hint}>{t('staff.terms.screening_explain')}</p>
      {terms.isError && <FormMessage kind="error">{staffError(terms.error, t, lang)}</FormMessage>}
      {remove.isError && <FormMessage kind="error">{staffError(remove.error, t, lang)}</FormMessage>}
      <ul className={styles.items}>
        {(terms.data?.items ?? []).map((x) => (
          <li key={x.id}>
            <strong>{x.term}</strong> · {t(`staff.terms.severity.${x.severity}`)} · {formatDateTime(Date.parse(x.addedAt), lang)}{' '}
            <button type="button" className={styles.secondary} disabled={remove.isPending} onClick={() => remove.mutate(x.id)}>
              {t('staff.terms.remove', { term: x.term })}
            </button>
          </li>
        ))}
      </ul>
      <SaveForm
        title={t('staff.terms.add_screening')}
        button={t('admin.reference.add')}
        t={t}
        lang={lang}
        check={() => (term.trim() && severity ? null : t('staff.terms.incomplete'))}
        run={() => api.post('/staff/screening-terms', { term: term.trim(), severity })}
        done={() => {
          refresh();
          setTerm('');
          setSeverity('');
          return t('admin.reference.added');
        }}
      >
        <Text id="screening-term" label={t('staff.terms.term')} value={term} onChange={setTerm} maxLength={80} />
        <Choice
          legend={t('staff.terms.severity')}
          name="screening-severity"
          value={severity}
          options={[
            ['prohibited', t('staff.terms.severity.prohibited')],
            ['high_risk', t('staff.terms.severity.high_risk')],
          ]}
          onChange={setSeverity}
        />
      </SaveForm>
    </section>
  );
}

function Detection({ t, lang }: { t: T; lang: Lang }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const terms = useQuery({
    queryKey: ['staff', 'detection-terms'],
    queryFn: ({ signal }) => api.get('/staff/chat/detection-terms', { signal }) as Promise<{ items: { term: string; flag: string; addedAt: string }[] }>,
    staleTime: 0,
    retry: false,
  });
  const [term, setTerm] = useState('');
  const [flag, setFlag] = useState<'payment_phrase' | 'off_platform_app' | 'credentials' | ''>('');
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['staff', 'detection-terms'] });
  const remove = useMutation({ mutationFn: (x: string) => api.del(`/staff/chat/detection-terms?term=${encodeURIComponent(x)}`), onSettled: refresh });
  return (
    <section className={styles.panel} aria-labelledby="detection">
      <h2 id="detection">{t('staff.terms.detection')}</h2>
      <p className={styles.hint}>{t('staff.terms.detection_explain')}</p>
      {terms.isError && <FormMessage kind="error">{staffError(terms.error, t, lang)}</FormMessage>}
      <ul className={styles.items}>
        {(terms.data?.items ?? []).map((x) => (
          <li key={x.term}>
            <strong>{x.term}</strong> · {t(`staff.terms.flag.${x.flag}`)}{' '}
            <button type="button" className={styles.secondary} disabled={remove.isPending} onClick={() => remove.mutate(x.term)}>
              {t('staff.terms.remove', { term: x.term })}
            </button>
          </li>
        ))}
      </ul>
      <SaveForm
        title={t('staff.terms.add_detection')}
        button={t('admin.reference.add')}
        t={t}
        lang={lang}
        check={() => (term.trim() && flag ? null : t('staff.terms.incomplete'))}
        run={() => api.post('/staff/chat/detection-terms', { term: term.trim(), flag })}
        done={() => {
          refresh();
          setTerm('');
          setFlag('');
          return t('admin.reference.added');
        }}
      >
        <Text id="detection-term" label={t('staff.terms.term')} value={term} onChange={setTerm} />
        <Choice
          legend={t('staff.terms.flag')}
          name="detection-flag"
          value={flag}
          options={[
            ['payment_phrase', t('staff.terms.flag.payment_phrase')],
            ['off_platform_app', t('staff.terms.flag.off_platform_app')],
            ['credentials', t('staff.terms.flag.credentials')],
          ]}
          onChange={setFlag}
        />
      </SaveForm>
    </section>
  );
}
