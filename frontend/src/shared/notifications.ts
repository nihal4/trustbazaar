// What the shell needs from Unit 6's notification centre (FR-NTF-04, FR-NTF-05): the unread count for the
// header, and the language kept in the notification preferences (section 6.1). The centre itself is
// features/notifications.
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi, type Api } from './api';
import { useLanguage } from './language/Language';
import type { Lang } from './language/lang';
import { useMe } from './me';
import { FRESHNESS } from './query';

export interface Subject { type: 'order' | 'listing' | 'payout' | 'refund' | 'account'; id: string }
export interface NotificationView {
  id: string;
  code: string;
  title: string;
  body: string;
  subject: Subject | null;
  createdAt: string;
  readAt: string | null;
}
export interface NotificationPage { items: NotificationView[]; unread: number; nextCursor: string | null }
export interface Preferences { language: Lang; emailTransactional: boolean }

export const NOTIFICATIONS_KEY = ['notifications'] as const;
export const PREFERENCES_KEY = ['me', 'notification-preferences'] as const;

/**
 * (Interim, Decisions log U8-08) Until the live connection pushes `notification.new` (K-07), the
 * first page is read again on focus, on reconnect and every 60 seconds while the tab is visible.
 */
export const UNREAD_POLL_MS = 60_000;

export const fetchNotifications = (api: Api, cursor?: string, signal?: AbortSignal): Promise<NotificationPage> =>
  api.get(`/notifications${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { signal });

/** The unread count, only while someone is signed in. */
export function useUnreadCount(): number | null {
  const api = useApi();
  const me = useMe();
  const q = useQuery({
    queryKey: [...NOTIFICATIONS_KEY, 'first'],
    queryFn: ({ signal }) => fetchNotifications(api, undefined, signal),
    enabled: me.isSuccess,
    staleTime: FRESHNESS.money,
    refetchInterval: UNREAD_POLL_MS,
    refetchIntervalInBackground: false,
    retry: false,
  });
  return me.isSuccess && q.isSuccess ? q.data.unread : null;
}

/**
 * Section 6.1: a signed-in user's language is kept in their notification preferences, so notices use
 * it too. The page's language wins when they differ (Decisions log, U8-08): it is saved after sign-in
 * and on every switch.
 */
export function useLanguageSync(): void {
  const api = useApi();
  const queryClient = useQueryClient();
  const { lang } = useLanguage();
  const me = useMe();
  const prefs = useQuery({
    queryKey: PREFERENCES_KEY,
    queryFn: ({ signal }) => api.get('/me/notification-preferences', { signal }) as Promise<Preferences>,
    enabled: me.isSuccess,
    staleTime: FRESHNESS.account,
    retry: false,
  });
  const save = useMutation({
    mutationFn: (language: Lang) => api.put('/me/notification-preferences', { language }) as Promise<Preferences>,
    onSuccess: (p) => queryClient.setQueryData(PREFERENCES_KEY, p),
  });
  const saved = prefs.data?.language;
  useEffect(() => {
    if (!me.isSuccess || !saved || saved === lang || save.isPending) return;
    save.mutate(lang);
  }, [me.isSuccess, saved, lang]);   // `save` is left out: the request depends on the two languages alone
}
