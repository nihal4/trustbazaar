// The listing of a page that shows one (its page and the auction room): fetched once under one key, and what is said when it cannot be shown.
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../../shared/api';
import { takeEarly } from '../../shared/early';
import { errorText } from '../../shared/errors';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { isApiError } from '../../shared/problems';
import { FRESHNESS } from '../../shared/query';
import { listingKey, type ListingView } from './model';

export function useListing(id: string) {
  const api = useApi();
  return useQuery({
    queryKey: listingKey(id),
    queryFn: async ({ signal }) =>
      (await takeEarly<ListingView>(`/listings/${id}`)) ?? (api.get(`/listings/${encodeURIComponent(id)}`, { signal }) as Promise<ListingView>),
    staleTime: FRESHNESS.search,
    retry: false,
  });
}

/** A listing that is not there says so with the way back; any other failure says what it was. */
export function ListingFailed({ error, t, lang }: { error: unknown; t: T; lang: Lang }) {
  if (!isApiError(error, 404)) return <FormMessage kind="error">{errorText(error, t, lang)}</FormMessage>;
  return (
    <div>
      <h1>{t('listing.not_found')}</h1>
      <p>
        <Link to="/search">{t('shell.home_link')}</Link>
      </p>
    </div>
  );
}
