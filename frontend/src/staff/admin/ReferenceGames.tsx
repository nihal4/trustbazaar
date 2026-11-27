import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../shared/api';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { staffError } from '../cases/common';
import styles from '../staff.module.css';
import { SaveForm, Text } from './forms';
import { Game } from './referenceShared';

export function Games({ t, lang }: { t: T; lang: Lang }) {
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
