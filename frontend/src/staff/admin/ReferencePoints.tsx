import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../shared/api';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { Choice, staffError } from '../cases/common';
import styles from '../staff.module.css';
import { coordinate, SaveForm, Text } from './forms';
import { KINDS, Kind, Point } from './referenceShared';

export function Points({ t, lang }: { t: T; lang: Lang }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const points = useQuery({
    queryKey: ['admin', 'points'],
    queryFn: ({ signal }) => api.get('/admin/meetup-points', { signal }) as Promise<{ items: Point[] }>,
    staleTime: 0,
    retry: false,
  });
  const [p, setP] = useState({ kind: '' as Kind | '', nameEn: '', nameBn: '', district: '', lat: '', lng: '', guidance: '' });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['admin', 'points'] });
  return (
    <section className={styles.panel} aria-labelledby="points">
      <h2 id="points">{t('admin.points.title')}</h2>
      {points.isError && <FormMessage kind="error">{staffError(points.error, t, lang)}</FormMessage>}
      <ul className={styles.items}>
        {(points.data?.items ?? []).map((x) => (
          <li key={x.id}>
            <strong>{lang === 'bn' ? x.nameBn : x.nameEn}</strong>, {x.district} · {t(`admin.point.${x.kind}`)} ·{' '}
            {t(x.active ? 'admin.reference.active' : 'admin.reference.inactive')}
            <SaveForm
              title={t(x.active ? 'admin.points.deactivate_title' : 'admin.points.activate_title', { name: x.nameEn })}
              button={t(x.active ? 'admin.reference.deactivate' : 'admin.reference.activate')}
              t={t}
              lang={lang}
              check={() => null}
              run={() => api.patch(`/admin/meetup-points/${encodeURIComponent(x.id)}`, { active: !x.active })}
              done={() => {
                refresh();
                return t(x.active ? 'admin.reference.deactivated' : 'admin.reference.activated');
              }}
            >
              {null}
            </SaveForm>
          </li>
        ))}
      </ul>
      <SaveForm
        title={t('admin.points.add')}
        button={t('admin.reference.add')}
        t={t}
        lang={lang}
        check={() =>
          p.kind && p.nameEn.trim() && p.nameBn.trim() && p.district.trim() && coordinate(p.lat, true) !== null && coordinate(p.lng, false) !== null
            ? null
            : t('admin.points.incomplete')
        }
        run={() =>
          api.post('/admin/meetup-points', {
            kind: p.kind,
            nameEn: p.nameEn.trim(),
            nameBn: p.nameBn.trim(),
            district: p.district.trim(),
            lat: coordinate(p.lat, true),
            lng: coordinate(p.lng, false),
            ...(p.guidance.trim() ? { guidance: p.guidance.trim() } : {}),
          })
        }
        done={() => {
          refresh();
          setP({ kind: '', nameEn: '', nameBn: '', district: '', lat: '', lng: '', guidance: '' });
          return t('admin.reference.added');
        }}
      >
        <Choice
          legend={t('admin.points.kind')}
          name="point-kind"
          value={p.kind}
          options={KINDS.map((k) => [k, t(`admin.point.${k}`)])}
          onChange={(k) => setP({ ...p, kind: k })}
        />
        <Text id="point-en" label={t('admin.reference.name_en')} value={p.nameEn} onChange={(v) => setP({ ...p, nameEn: v })} maxLength={120} />
        <Text id="point-bn" label={t('admin.reference.name_bn')} value={p.nameBn} onChange={(v) => setP({ ...p, nameBn: v })} maxLength={120} />
        <Text id="point-district" label={t('admin.reference.district')} value={p.district} onChange={(v) => setP({ ...p, district: v })} maxLength={40} />
        <Text
          id="point-lat"
          label={t('admin.reference.lat')}
          value={p.lat}
          onChange={(v) => setP({ ...p, lat: v })}
          inputMode="decimal"
          hint={t('admin.reference.coordinates_hint')}
        />
        <Text id="point-lng" label={t('admin.reference.lng')} value={p.lng} onChange={(v) => setP({ ...p, lng: v })} inputMode="decimal" />
        <Text id="point-guidance" label={t('admin.points.guidance')} value={p.guidance} onChange={(v) => setP({ ...p, guidance: v })} maxLength={300} />
      </SaveForm>
    </section>
  );
}
