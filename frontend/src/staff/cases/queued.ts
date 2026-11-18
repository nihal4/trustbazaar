// A case known only from its queue (reports, flagged activity, ownership proofs, payout accounts): the queue's item,
// read again, so a case decided elsewhere shows as no longer open.
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../../shared/api';
import type { QueueItem, QueueName } from '../model';
import { queueKey } from '../model';

export function useQueued(queue: QueueName, id: string) {
  const api = useApi();
  const q = useQuery({
    queryKey: queueKey(queue),
    queryFn: ({ signal }) => api.get(`/staff/queues/${queue}`, { signal }) as Promise<{ items: QueueItem[] }>,
    staleTime: 0,
    retry: false,
  });
  return { ...q, item: q.data?.items.find((i) => i.id === id) ?? null };
}
