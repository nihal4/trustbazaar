// Server state lives in TanStack Query's cache and nowhere else (section 4.3).
import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '../lib/api.js';

/** DV-56: how long data stays fresh. A feature sets `staleTime` from here on its queries. */
export const FRESHNESS = {
  /** orders, escrow, handover, disputes, the own account and KYC status */
  money: 0,
  account: 0,
  /** search results and listings */
  search: 30_000,
  /** categories, areas, games, meetup points */
  reference: 3_600_000,
} as const;

/**
 * Defaults: nothing is fresh unless a query says so; queries refetch on focus and on reconnect, and
 * retry only after a network failure. A state change is never retried automatically (section 4.2):
 * mutations do not retry.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 0,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        retry: (failures, error) => error instanceof ApiError && error.status === 0 && failures < 2,
      },
      mutations: { retry: false },
    },
  });
}
