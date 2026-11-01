// Pages every document shares: not found, a failed route, and the placeholder that names a document
// until its own screens arrive (the console in U8-10, the KYC wizard in U8-03).
import { Link, useRouteError } from 'react-router-dom';
import { errorText } from './errors';
import { useLanguage } from './language/Language';

export function NotFound({ home }: { home: { path: string; sameDocument: boolean } }) {
  const { t } = useLanguage();
  const label = t('shell.not_found.home');
  return (
    <>
      <h1>{t('shell.not_found.title')}</h1>
      <p>{t('error.not_found')}</p>
      {home.sameDocument ? <Link to={home.path}>{label}</Link> : <a href={home.path}>{label}</a>}
    </>
  );
}

export function RouteError() {
  const { t, lang } = useLanguage();
  return <p role="alert">{errorText(useRouteError(), t, lang)}</p>;
}

export function DocumentTitle({ titleKey }: { titleKey: string }) {
  const { t } = useLanguage();
  return <h1>{t(titleKey)}</h1>;
}
