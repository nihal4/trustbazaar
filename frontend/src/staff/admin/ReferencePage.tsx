// Reference data, /admin/reference (FR-OPS-08, CP-43; Units 4 and 5; section 7.9; U8-10): the games of game-account
// listings, the drop-off areas with their fare zones, the meetup points and the courier fare table. Each change is
// audited by the server. An area or a point is never deleted, only made inactive; the public lists of areas and games
// show only active ones (Decisions log, U8-10).

import { useQuery } from '@tanstack/react-query';

import { useApi } from '../../shared/api';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { staffError } from '../cases/common';
import { useStaffT } from '../text';
import styles from '../staff.module.css';

import { Games } from './ReferenceGames';
import { FareTable } from './referenceShared';
import { Areas } from './ReferenceAreas';
import { Points } from './ReferencePoints';
import { FareForm } from './ReferenceFareForm';

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
