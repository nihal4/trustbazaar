// The home page until search and listings arrive (U8-04 replaces it with IF-UI-03's home and search).
import { useLanguage } from './language/Language';

export function Component() {
  const { t } = useLanguage();
  return (
    <>
      <h1>{t('shell.home.title')}</h1>
      <p>{t('shell.home.lead')}</p>
    </>
  );
}
