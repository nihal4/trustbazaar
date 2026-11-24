// The home page (money-order design, docs/design/10_visual_v2.md, section 7, AC-HOME-1 to AC-HOME-3; IF-UI-03;
// FR-SRC-01; FR-MON-05): the headline and the search, and beside them the counterfoil that shows how the money moves;
// the categories, the auctions ending soonest, the featured listings apart with their note, the newest listings, and
// how selling works. Searching goes to
// /search with the words in the URL; everything shown here comes from GET /search and GET /categories.
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { toLocalDigits } from '../../lib/money.js';
import { useApi } from '../../shared/api';
import { Counterfoil } from '../../shared/Counterfoil';
import { errorText } from '../../shared/errors';
import { FormMessage } from '../../shared/form';
import { useT } from '../../shared/language/Language';
import { FRESHNESS } from '../../shared/query';
import en from '../../messages/en/search.json';
import bn from '../../messages/bn/search.json';
import { ListingCard } from './ListingCard';
import type { Category, SearchPage } from './SearchPage';
import styles from './home.module.css';

const CATALOGUES = { en, bn };

const Check = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
    <circle cx="8" cy="8" r="8" fill="currentColor" />
    <path d="M4.5 8.2 l2.3 2.3 l4.7 -5" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function Component() {
  const { t, lang } = useT(CATALOGUES);
  const api = useApi();
  const navigate = useNavigate();
  const [words, setWords] = useState('');

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: ({ signal }) => api.get('/categories', { signal }) as Promise<Category[]>,
    staleTime: FRESHNESS.reference,
  });
  const newest = useQuery({
    queryKey: ['search', 'sort=newest'],
    queryFn: ({ signal }) => api.get('/search?sort=newest', { signal }) as Promise<SearchPage>,
    staleTime: FRESHNESS.search,
    retry: false,
  });
  const auctions = useQuery({
    queryKey: ['search', 'saleFormat=auction&sort=ending_soon'],
    queryFn: ({ signal }) => api.get('/search?saleFormat=auction&sort=ending_soon', { signal }) as Promise<SearchPage>,
    staleTime: FRESHNESS.search,
    retry: false,
  });

  const search = (e: FormEvent) => {
    e.preventDefault();
    const q = words.trim();
    void navigate(q ? `/search?q=${encodeURIComponent(q)}` : '/search');
  };
  // the first ten top categories; the rest are in the search page's category filter
  const top = (categories.data ?? []).filter((c) => c.parentId === null && c.selectable).slice(0, 10);
  const ending = (auctions.data?.items ?? []).slice(0, 4);
  const featured = newest.data?.featured ?? [];

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroText}>
          <h1 className={styles.title}>{t('home.title')}</h1>
          <form role="search" className={styles.search} onSubmit={search}>
            <label htmlFor="home-q" className={styles.visuallyHidden}>{t('home.search_label')}</label>
            <svg className={styles.searchIcon} viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
              <path d="M11 4 a7 7 0 1 0 0.01 0 Z M16.5 16.5 L21 21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input id="home-q" type="search" maxLength={100} value={words} placeholder={t('home.search_placeholder')} onChange={(e) => setWords(e.target.value)} />
            <button type="submit">{t('search.submit')}</button>
          </form>
          <ul className={styles.facts}>
            <li><Check />{t('home.promise.id')}</li>
            <li><Check />{t('home.promise.pay')}</li>
          </ul>
        </div>
        <div className={styles.foil}>
          <Counterfoil
            stub={<strong>{t('home.counterfoil.stub')}</strong>}
            title={<><h2 className={styles.foilTitle}>{t('home.promise.title')}</h2><p className={styles.foilText}>{t('home.promise.text')}</p></>}
            stages={[
              { key: 'in', label: t('home.counterfoil.in'), state: 'done' },
              { key: 'held', label: t('home.counterfoil.held'), state: 'current' },
              { key: 'out', label: t('home.counterfoil.out'), state: 'next' },
            ]}
          />
        </div>
      </section>

      {top.length > 0 && (
        <nav aria-label={t('home.categories')}>
          <ul className={styles.cats}>
            <li><Link className={`${styles.cat} ${styles.catAll}`} to="/search">{t('home.all')}</Link></li>
            {top.map((c) => <li key={c.id}><Link className={styles.cat} to={`/search?category=${c.id}`}>{lang === 'bn' ? c.nameBn : c.nameEn}</Link></li>)}
          </ul>
        </nav>
      )}

      {ending.length > 0 && (
        <section aria-labelledby="home-auctions" className={styles.section}>
          <div className={styles.head}><h2 id="home-auctions">{t('home.auctions')}</h2><Link to="/search?saleFormat=auction&sort=ending_soon">{t('home.auctions_all')}</Link></div>
          <ul className={`${styles.grid} ${styles.four}`}>{ending.map((c) => <ListingCard key={c.id} c={c} t={t} lang={lang} />)}</ul>
        </section>
      )}

      {featured.length > 0 && (
        <section aria-labelledby="home-featured" className={styles.section}>
          <div className={styles.head}><h2 id="home-featured">{t('search.featured')}</h2></div>
          <p className={styles.note}>{t('search.featured_note')}</p>
          <ul className={styles.grid}>{featured.map((c) => <ListingCard key={c.id} c={c} t={t} lang={lang} />)}</ul>
        </section>
      )}

      <section aria-labelledby="home-newest" className={styles.section}>
        <div className={styles.head}><h2 id="home-newest">{t('home.newest')}</h2><Link to="/search?sort=newest">{t('home.newest_all')}</Link></div>
        {newest.isPending && <p role="status">{t('shell.loading')}</p>}
        {newest.isError && <FormMessage kind="error">{errorText(newest.error, t, lang)}</FormMessage>}
        {newest.data && (newest.data.items.length === 0
          ? <p>{t('search.empty')}</p>
          : <ul className={styles.grid}>{newest.data.items.map((c) => <ListingCard key={c.id} c={c} t={t} lang={lang} />)}</ul>)}
      </section>

      <section aria-labelledby="home-sell" className={styles.sell}>
        <h2 id="home-sell">{t('home.sell.title')}</h2>
        <ol className={styles.steps}>
          {([1, 2, 3] as const).map((n) => (
            <li key={n}><span className={styles.num} aria-hidden="true">{toLocalDigits(String(n), lang)}</span><span><strong>{t(`home.sell.step${n}`)}</strong>{t(`home.sell.step${n}_text`)}</span></li>
          ))}
        </ol>
        <Button component={Link} to="/sell/new" variant="outline" color="teal">{t('home.sell.start')}</Button>
      </section>
    </div>
  );
}
