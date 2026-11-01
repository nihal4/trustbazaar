// The notification centre and its preferences (FR-NTF-04, FR-NTF-05; section 3.3, /notifications). Notices
// arrive from Unit 6 already written in the user's language; their text is shown as plain text, and
// each links to the object it concerns. Opening one marks it read; "Mark all as read" does all of them.
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDateTime } from '../../lib/time.js';
import { toLocalDigits } from '../../lib/money.js';
import { useApi } from '../../shared/api';
import { errorText } from '../../shared/errors';
import { CheckboxField, FormMessage, SubmitButton } from '../../shared/form';
import { useLanguage, useT } from '../../shared/language/Language';
import type { Lang } from '../../shared/language/lang';
import { useMe } from '../../shared/me';
import {
  fetchNotifications, NOTIFICATIONS_KEY, PREFERENCES_KEY, type NotificationPage, type NotificationView, type Preferences, type Subject,
} from '../../shared/notifications';
import { isApiError } from '../../shared/problems';
import { FRESHNESS } from '../../shared/query';
import en from '../../messages/en/notifications.json';
import bn from '../../messages/bn/notifications.json';
import styles from './notifications.module.css';

const CATALOGUES = { en, bn };

/** Where a notice leads: the route of the object it names (section 3.3). */
export function subjectPath(s: Subject | null): string | null {
  if (!s) return null;
  const id = encodeURIComponent(s.id);
  switch (s.type) {
    case 'order': return `/orders/${id}`;
    case 'listing': return `/listings/${id}`;
    case 'payout': return '/account/payout';
    case 'account': return '/account/security';
    default: return null;   // a refund is shown on its order, which the notice text names
  }
}

export function Component() {
  const { t, lang } = useT(CATALOGUES);
  const me = useMe();

  if (me.isPending) return <p role="status">{t('shell.loading')}</p>;
  if (me.isError) {
    return (
      <div className={styles.page}>
        <h1>{t('notifications.title')}</h1>
        <p>{t('notifications.signed_out')}</p>
        <p><Link to={`/signin?next=${encodeURIComponent('/notifications')}`}>{t('shell.sign_in')}</Link></p>
      </div>
    );
  }
  return (
    <div className={styles.page}>
      <h1>{t('notifications.title')}</h1>
      <List t={t} lang={lang} />
      <PreferencesForm />
    </div>
  );
}

function List({ t, lang }: { t: ReturnType<typeof useT>['t']; lang: Lang }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [message, setMessage] = useState<string | null>(null);

  const pages = useInfiniteQuery({
    queryKey: [...NOTIFICATIONS_KEY, 'list'],
    queryFn: ({ pageParam, signal }) => fetchNotifications(api, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: NotificationPage) => last.nextCursor ?? undefined,
    staleTime: FRESHNESS.money,
    retry: false,
  });

  const markRead = useMutation({
    mutationFn: (body: { ids: string[] } | { all: true }) => api.post('/notifications/read', body) as Promise<{ unread: number }>,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
    onError: (e) => setMessage(errorText(e, t, lang)),
  });

  const open = (n: NotificationView) => {
    if (!n.readAt) markRead.mutate({ ids: [n.id] });
    const to = subjectPath(n.subject);
    if (to) navigate(to);
  };

  if (pages.isPending) return <p role="status">{t('shell.loading')}</p>;
  if (pages.isError) return <FormMessage kind="error">{errorText(pages.error, t, lang)}</FormMessage>;

  const items = pages.data.pages.flatMap((p) => p.items);
  const unread = pages.data.pages[0]?.unread ?? 0;
  return (
    <section aria-labelledby="notifications-list-title">
      <h2 id="notifications-list-title" className={styles.visuallyHidden}>{t('notifications.list')}</h2>
      <div className={styles.toolbar}>
        <p role="status">
          {unread > 0 ? t('notifications.unread_count', { count: toLocalDigits(String(unread), lang) }) : t('notifications.all_read')}
        </p>
        {unread > 0 && (
          <button type="button" className={styles.secondary} disabled={markRead.isPending}
            onClick={() => markRead.mutate({ all: true })}>{t('notifications.mark_all')}</button>
        )}
      </div>
      {message && <FormMessage kind="error">{message}</FormMessage>}
      {items.length === 0
        ? <p>{t('notifications.empty')}</p>
        : (
          <ul className={styles.list}>
            {items.map((n) => (
              <li key={n.id} className={n.readAt ? styles.read : styles.unread}>
                <button type="button" className={styles.item} onClick={() => open(n)}>
                  {!n.readAt && <span className={styles.new}>{t('notifications.new')}</span>}
                  <span className={styles.title}>{n.title}</span>
                  <span className={styles.body}>{n.body}</span>
                  <span className={styles.time}>{formatDateTime(Date.parse(n.createdAt), lang)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      {pages.hasNextPage && (
        <button type="button" className={styles.secondary} onClick={() => void pages.fetchNextPage()} disabled={pages.isFetchingNextPage}>
          {t('notifications.more')}
        </button>
      )}
    </section>
  );
}

/** FR-NTF-05: the language of notices (the page's language too) and transactional e-mails. */
function PreferencesForm() {
  const { t, lang } = useT(CATALOGUES);
  const { setLang } = useLanguage();
  const api = useApi();
  const queryClient = useQueryClient();
  const prefs = useQuery({
    queryKey: PREFERENCES_KEY,
    queryFn: ({ signal }) => api.get('/me/notification-preferences', { signal }) as Promise<Preferences>,
    staleTime: FRESHNESS.account,
    retry: false,
  });
  const [email, setEmail] = useState<boolean | null>(null);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const save = useMutation({
    mutationFn: (p: Partial<Preferences>) => api.put('/me/notification-preferences', p) as Promise<Preferences>,
    onSuccess: (p) => {
      queryClient.setQueryData(PREFERENCES_KEY, p);
      setEmail(null);
      setMessage({ kind: 'success', text: t('preferences.saved') });
    },
    onError: (e) => setMessage({ kind: 'error', text: errorText(e, t, lang) }),
  });

  if (prefs.isPending) return null;
  if (prefs.isError) return isApiError(prefs.error, 401) ? null : <FormMessage kind="error">{errorText(prefs.error, t, lang)}</FormMessage>;

  const emailOn = email ?? prefs.data.emailTransactional;
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    setMessage(null);
    save.mutate({ emailTransactional: emailOn });
  };

  return (
    <section aria-labelledby="preferences-title" className={styles.preferences}>
      <h2 id="preferences-title">{t('preferences.title')}</h2>
      <fieldset className={styles.choice}>
        <legend>{t('preferences.language')}</legend>
        <p className={styles.hint}>{t('preferences.language_hint')}</p>
        {(['bn', 'en'] as const).map((l) => (
          <div key={l}>
            <input id={`pref-lang-${l}`} type="radio" name="language" checked={lang === l} onChange={() => setLang(l)} />
            <label htmlFor={`pref-lang-${l}`} lang={l}>{l === 'bn' ? 'বাংলা' : 'English'}</label>
          </div>
        ))}
      </fieldset>
      <form onSubmit={submit} noValidate>
        {message && <FormMessage kind={message.kind}>{message.text}</FormMessage>}
        <CheckboxField id="pref-email" label={t('preferences.email')} checked={emailOn} onChange={setEmail} />
        <p className={styles.hint}>{t('preferences.email_hint')}</p>
        <SubmitButton busy={save.isPending} disabled={email === null}>{t('preferences.save')}</SubmitButton>
      </form>
    </section>
  );
}
