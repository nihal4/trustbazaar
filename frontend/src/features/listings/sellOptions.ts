// The choices of the sell form (conditions, ways to hand over, weight and size classes) and the hook that reads the delivery areas.
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../../shared/api';
import { FRESHNESS } from '../../shared/query';
import { type Area } from './sell';

export const CONDITIONS = ['new', 'like_new', 'used', 'for_parts'] as const;

export const FULFILMENT = ['pickup_only', 'courier_only', 'pickup_or_courier'] as const;

export const WEIGHTS = ['up_to_1kg', 'up_to_2kg', 'up_to_5kg', 'up_to_10kg', 'over_10kg'] as const;

export const SIZES = ['small', 'medium', 'large', 'oversize'] as const;

export function useAreas() {
  const api = useApi();
  return useQuery({
    queryKey: ['delivery', 'areas'],
    queryFn: ({ signal }) => api.get('/delivery/areas', { signal }) as Promise<{ items: Area[] }>,
    staleTime: FRESHNESS.reference,
  });
}
