// Reference data, /admin/reference (FR-OPS-08, CP-43; Units 4 and 5; section 7.9; U8-10): the games of game-account
// listings, the drop-off areas with their fare zones, the meetup points and the courier fare table. Each change is
// audited by the server. An area or a point is never deleted, only made inactive; the public lists of areas and games
// show only active ones (Decisions log, U8-10).
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMoney, parseTaka } from '../../lib/money.js';
import { formatDateTime } from '../../lib/time.js';
import { useApi } from '../../shared/api';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { Choice, staffError } from '../cases/common';
import { useStaffT } from '../text';
import styles from '../staff.module.css';
import { coordinate, SaveForm, Text } from './forms';

const ZONES = ['inside_dhaka', 'dhaka_suburbs', 'outside_dhaka'] as const;
type Zone = (typeof ZONES)[number];
const KINDS = ['police_station', 'shopping_mall', 'bank_branch', 'other_public'] as const;
type Kind = (typeof KINDS)[number];
interface Game {
  id: number;
  slug: string;
  name: string;
  platforms: string[];
  codePlacement: string;
  publisherNote: string;
}
interface Area {
  id: number;
  district: string;
  nameEn: string;
  nameBn: string;
  zone: Zone;
  lat: number;
  lng: number;
  active: boolean;
}
interface Point {
  id: string;
  kind: Kind;
  nameEn: string;
  nameBn: string;
  district: string;
  lat: number;
  lng: number;
  guidance: string | null;
  active: boolean;
}
interface FareRow {
  zone: Zone;
  upTo1kg: string;
  upTo2kg: string;
  perExtraKg: string;
}
interface FareTable {
  version: number;
  effectiveFrom: string;
  source: string;
  rows: FareRow[];
}

export function Component() {
  const { t, lang } = useStaffT();
  return (
    <div>
      <h1>{t('admin.reference.title')}</h1>
      <Games t={t} lang={lang} />
      <Areas t={t} lang={lang} />
      <Points t={t} lang={lang} />
      <Fares t={t} lang={lang} />
    </div>
  );
}

function Games({ t, lang }: { t: T; lang: Lang }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const games = useQuery({
    queryKey: ['admin', 'games'],
    queryFn: ({ signal }) => api.get('/games', { signal }) as Promise<{ items: Game[] }>,
    staleTime: 0,
    retry: false,
  });
  const [g, setG] = useState({ slug: '', name: '', platforms: '', codePlacement: '', publisherNote: '' });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['admin', 'games'] });
  const platforms = (s: string) =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  return (
    <section className={styles.panel} aria-labelledby="games">
      <h2 id="games">{t('admin.games.title')}</h2>
      {games.isError && <FormMessage kind="error">{staffError(games.error, t, lang)}</FormMessage>}
      <ul className={styles.items}>
        {(games.data?.items ?? []).map((x) => (
          <li key={x.id}>
            <strong>{x.name}</strong> · {x.platforms.join(', ')}
            <p className={styles.hint}>{x.codePlacement}</p>
            <SaveForm
              title={t('admin.games.deactivate_title', { name: x.name })}
              button={t('admin.reference.deactivate')}
              t={t}
              lang={lang}
              check={() => null}
              run={() => api.patch(`/admin/games/${x.id}`, { active: false })}
              done={() => {
                refresh();
                return t('admin.reference.deactivated');
              }}
            >
              <p className={styles.hint}>{t('admin.games.deactivate_explain')}</p>
            </SaveForm>
          </li>
        ))}
      </ul>
      <SaveForm
        title={t('admin.games.add')}
        button={t('admin.reference.add')}
        t={t}
        lang={lang}
        check={() =>
          /^[a-z0-9-]{2,40}$/.test(g.slug) &&
          g.name.trim().length >= 2 &&
          platforms(g.platforms).length > 0 &&
          g.codePlacement.trim().length >= 3 &&
          g.publisherNote.trim().length >= 10
            ? null
            : t('admin.games.incomplete')
        }
        run={() =>
          api.post('/admin/games', {
            slug: g.slug,
            name: g.name.trim(),
            platforms: platforms(g.platforms),
            codePlacement: g.codePlacement.trim(),
            publisherNote: g.publisherNote.trim(),
          })
        }
        done={() => {
          refresh();
          setG({ slug: '', name: '', platforms: '', codePlacement: '', publisherNote: '' });
          return t('admin.reference.added');
        }}
      >
        <Text
          id="game-slug"
          label={t('admin.games.slug')}
          value={g.slug}
          onChange={(v) => setG({ ...g, slug: v })}
          hint={t('admin.games.slug_hint')}
          maxLength={40}
        />
        <Text id="game-name" label={t('admin.games.name')} value={g.name} onChange={(v) => setG({ ...g, name: v })} maxLength={80} />
        <Text
          id="game-platforms"
          label={t('admin.games.platforms')}
          value={g.platforms}
          onChange={(v) => setG({ ...g, platforms: v })}
          hint={t('admin.games.platforms_hint')}
        />
        <Text id="game-placement" label={t('admin.games.placement')} value={g.codePlacement} onChange={(v) => setG({ ...g, codePlacement: v })} />
        <Text id="game-note" label={t('admin.games.note')} value={g.publisherNote} onChange={(v) => setG({ ...g, publisherNote: v })} maxLength={500} />
      </SaveForm>
    </section>
  );
}

function Areas({ t, lang }: { t: T; lang: Lang }) {
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

function Points({ t, lang }: { t: T; lang: Lang }) {
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

function Fares({ t, lang }: { t: T; lang: Lang }) {
  const api = useApi();
  const current = useQuery({
    queryKey: ['admin', 'fares'],
    queryFn: ({ signal }) => api.get('/admin/fare-tables/current', { signal }) as Promise<FareTable | null>,
    staleTime: 0,
    retry: false,
  });
  return (
    <section className={styles.panel} aria-labelledby="fares">
      <h2 id="fares">{t('admin.fares.title')}</h2>
      {current.isError && <FormMessage kind="error">{staffError(current.error, t, lang)}</FormMessage>}
      {current.isSuccess && <FareForm key={current.data?.version ?? 0} table={current.data} t={t} lang={lang} />}
    </section>
  );
}

function FareForm({ table, t, lang }: { table: FareTable | null; t: T; lang: Lang }) {
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
