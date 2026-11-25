// The home page (money-order design, docs/design/10_visual_v2.md, section 7, AC-HOME-1 to AC-HOME-3; IF-UI-03;
// FR-SRC-01; FR-MON-05): the headline and the search, and beside them the counterfoil that shows how the money moves;
// the categories, the auctions ending soonest, the featured listings apart with their note, the newest listings, and
// how selling works. Searching goes to
// /search with the words in the URL; everything shown here comes from GET /search and GET /categories.
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toLocalDigits } from '../../lib/money.js';
import { useApi } from '../../shared/api';
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
        <div className={styles.glow} aria-hidden="true" />
        <div className={styles.heroText}>
          <p className={styles.eyebrow}><Check />{t('home.promise.id')}</p>
          <h1 className={styles.title}>{t('home.title')}</h1>
          <p className={styles.lede}>{t('home.promise.text')}</p>
          <form role="search" aria-label={t('home.search_placeholder')} className={styles.search} onSubmit={search}>
            <label htmlFor="home-q" className={styles.visuallyHidden}>{t('home.search_label')}</label>
            <svg className={styles.searchIcon} viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
              <path d="M11 4 a7 7 0 1 0 0.01 0 Z M16.5 16.5 L21 21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input id="home-q" type="search" maxLength={100} value={words} placeholder={t('home.search_placeholder')} onChange={(e) => setWords(e.target.value)} />
            <button type="submit">{t('search.submit')}</button>
          </form>
          <ul className={styles.chips}>
            {top.slice(0, 5).map((c) => <li key={c.id}><Link to={`/search?category=${c.id}`}>{lang === 'bn' ? c.nameBn : c.nameEn}</Link></li>)}
          </ul>
        </div>
        <div className={styles.stage} aria-hidden="false">
          <section className={styles.escrow} aria-labelledby="home-promise">
            <p className={styles.stub}>{t('home.counterfoil.stub')}</p>
            <h2 id="home-promise" className={styles.escrowHead}><span className={styles.escrowDot} />{t('home.promise.title')}</h2>
            <ol className={styles.track}>
              <li className={styles.done}><span className={styles.node}><Check /></span><span>{t('home.counterfoil.in')}</span></li>
              <li className={styles.current}><span className={styles.node} /><span>{t('home.counterfoil.held')}</span></li>
              <li><span className={styles.node} /><span>{t('home.counterfoil.out')}</span></li>
            </ol>
            <p className={styles.escrowNote}>{t('home.promise.pay')}</p>
          </section>
          <div className={styles.floatA}><Check />{t('home.promise.id')}</div>
        </div>
      </section>

      {top.length > 0 && (
        <nav aria-label={t('home.categories')} className={styles.catsWrap}>
          <ul className={styles.cats}>
            <li><Link className={`${styles.cat} ${styles.catAll}`} to="/search">{t('home.all')}</Link></li>
            {top.map((c) => <li key={c.id}><Link className={styles.cat} to={`/search?category=${c.id}`}>{lang === 'bn' ? c.nameBn : c.nameEn}</Link></li>)}
          </ul>
        </nav>
      )}

      {ending.length > 0 && (
        <section aria-labelledby="home-auctions" className={styles.section}>
          <div className={styles.head}><h2 id="home-auctions">{t('home.auctions')}</h2><Link to="/search?saleFormat=auction&sort=ending_soon">{t('home.auctions_all')}</Link></div>
          <ul className={styles.rail}>{ending.map((c) => <ListingCard key={c.id} c={c} t={t} lang={lang} />)}</ul>
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
        <Link to="/sell/new" className={styles.sellBtn}>{t('home.sell.start')}</Link>
      </section>
    </div>
  );
}
