import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../shared/api';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { Choice, staffError } from '../cases/common';
import styles from '../staff.module.css';
import { coordinate, SaveForm, Text } from './forms';
import { ZONES, Zone, Area } from './referenceShared';

export function Areas({ t, lang }: { t: T; lang: Lang }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const areas = useQuery({
    queryKey: ['admin', 'areas'],
    queryFn: ({ signal }) => api.get('/delivery/areas', { signal }) as Promise<{ items: Area[] }>,
    staleTime: 0,
    retry: false,
  });
  const [a, setA] = useState({ district: '', nameEn: '', nameBn: '', zone: '' as Zone | '', lat: '', lng: '' });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['admin', 'areas'] });
  return (
    <section className={styles.panel} aria-labelledby="areas">
      <h2 id="areas">{t('admin.areas.title')}</h2>
      {areas.isError && <FormMessage kind="error">{staffError(areas.error, t, lang)}</FormMessage>}
      <ul className={styles.items}>
        {(areas.data?.items ?? []).map((x) => (
          <li key={x.id}>
            <strong>{lang === 'bn' ? x.nameBn : x.nameEn}</strong>, {x.district} · {t(`admin.zone.${x.zone}`)}
            <SaveForm
              title={t('admin.areas.deactivate_title', { name: x.nameEn })}
              button={t('admin.reference.deactivate')}
              t={t}
              lang={lang}
              check={() => null}
              run={() => api.patch(`/admin/areas/${x.id}`, { active: false })}
              done={() => {
                refresh();
                return t('admin.reference.deactivated');
              }}
            >
              <p className={styles.hint}>{t('admin.areas.deactivate_explain')}</p>
            </SaveForm>
          </li>
        ))}
      </ul>
      <SaveForm
        title={t('admin.areas.add')}
        button={t('admin.reference.add')}
        t={t}
        lang={lang}
        check={() =>
          a.district.trim() && a.nameEn.trim() && a.nameBn.trim() && a.zone && coordinate(a.lat, true) !== null && coordinate(a.lng, false) !== null
            ? null
            : t('admin.areas.incomplete')
        }
        run={() =>
          api.post('/admin/areas', {
            district: a.district.trim(),
            nameEn: a.nameEn.trim(),
            nameBn: a.nameBn.trim(),
            zone: a.zone,
            lat: coordinate(a.lat, true),
            lng: coordinate(a.lng, false),
          })
        }
        done={() => {
          refresh();
          setA({ district: '', nameEn: '', nameBn: '', zone: '', lat: '', lng: '' });
          return t('admin.reference.added');
        }}
      >
        <Text id="area-district" label={t('admin.reference.district')} value={a.district} onChange={(v) => setA({ ...a, district: v })} maxLength={40} />
        <Text id="area-en" label={t('admin.reference.name_en')} value={a.nameEn} onChange={(v) => setA({ ...a, nameEn: v })} maxLength={80} />
        <Text id="area-bn" label={t('admin.reference.name_bn')} value={a.nameBn} onChange={(v) => setA({ ...a, nameBn: v })} maxLength={80} />
        <Choice
          legend={t('admin.areas.zone')}
          name="area-zone"
          value={a.zone}
          options={ZONES.map((z) => [z, t(`admin.zone.${z}`)])}
          onChange={(z) => setA({ ...a, zone: z })}
        />
        <Text
          id="area-lat"
          label={t('admin.reference.lat')}
          value={a.lat}
          onChange={(v) => setA({ ...a, lat: v })}
          inputMode="decimal"
          hint={t('admin.reference.coordinates_hint')}
        />
        <Text id="area-lng" label={t('admin.reference.lng')} value={a.lng} onChange={(v) => setA({ ...a, lng: v })} inputMode="decimal" />
      </SaveForm>
    </section>
  );
}
