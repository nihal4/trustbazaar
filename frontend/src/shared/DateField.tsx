// A date field with a calendar of our own (U10-26): the date is typed as YYYY-MM-DD (or Bangla digits), or chosen in a popup, a month of ruled day cells under a
// month and a year to choose, so a birth date is reached in three touches and not by paging back through decades. The real input stays, so the label, the
// error and the typing work as in every field; the calendar is the button at its right edge. The value is always YYYY-MM-DD, as the native date input gave it.
import { useEffect, useMemo, useRef, useState } from 'react';
import { toAsciiDigits, toLocalDigits } from '../lib/money.js';
import { useLanguage } from './language/Language';
import { Popup } from './Popup';
import calendar from './calendar.module.css';
import styles from './form.module.css';

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const ms = (isoDate: string) => Date.parse(`${isoDate}T00:00:00Z`);
const valid = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && iso(ms(v)) === v;
const monthStart = (isoDate: string) => `${isoDate.slice(0, 7)}-01`;

interface Props {
  id: string; label: string; value: string; onChange: (value: string) => void; hint?: string; error?: string;
  /** the earliest and the latest date that may be chosen (YYYY-MM-DD) */
  min: string; max: string;
  /** the month the calendar opens at when there is no date yet */
  startAt?: string;
  autoComplete?: string;
}

export function DateField({ id, label, value, onChange, hint, error, min, max, startAt, autoComplete }: Props) {
  const { t, lang } = useLanguage();
  const [open, setOpen] = useState(false);
  const described = [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      {hint && <p id={`${id}-hint`} className={styles.hint}>{hint}</p>}
      <div className={styles.passwordWrap}>
        <input id={id} value={value} inputMode="numeric" placeholder="YYYY-MM-DD" maxLength={10} autoComplete={autoComplete}
          onChange={(e) => onChange(toAsciiDigits(e.target.value))} aria-invalid={error ? true : undefined} aria-describedby={described} />
        <button type="button" className={styles.eye} aria-haspopup="dialog" aria-label={t('form.pick_date')} onClick={() => setOpen(true)}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3.5" y="5" width="17" height="15" /><path d="M3.5 10h17M8 3v4M16 3v4" />
          </svg>
        </button>
      </div>
      {error && <p id={`${id}-error`} className={styles.error}>{error}</p>}
      {open && <Calendar title={label} value={valid(value) ? value : ''} min={min} max={max} startAt={startAt} lang={lang}
        onPick={(v) => { onChange(v); setOpen(false); }} onClose={() => setOpen(false)} />}
    </div>
  );
}

function Calendar({ title, value, min, max, startAt, lang, onPick, onClose }: {
  title: string; value: string; min: string; max: string; startAt?: string; lang: 'en' | 'bn'; onPick: (v: string) => void; onClose: () => void;
}) {
  const { t } = useLanguage();
  const today = iso(Date.now());
  const clamp = (v: string) => (v < min ? min : v > max ? max : v);
  // the day that holds the focus (the one chosen, or today, or the start); its month is the one shown
  const [focus, setFocus] = useState(() => clamp(value || startAt || today));
  const grid = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  const locale = lang === 'bn' ? 'bn-BD' : 'en-GB';
  const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, { ...o, timeZone: 'UTC' });
  const monthName = (m: number) => fmt({ month: 'long' }).format(Date.UTC(2024, m, 1));
  const weekdays = useMemo(() => Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(Date.UTC(2024, 0, 7 + i))), [locale]);
  const y = Number(focus.slice(0, 4));
  const m = Number(focus.slice(5, 7)) - 1;
  const first = ms(monthStart(focus));
  const lead = new Date(first).getUTCDay();
  const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const cells = [...Array.from({ length: lead }, () => null), ...Array.from({ length: days }, (_, i) => iso(first + i * DAY))];
  // the month in rows of a week, the last one filled up, so the grid has rows and cells as a grid should
  const padded = [...cells, ...Array.from({ length: (7 - (cells.length % 7)) % 7 }, () => null)];
  const weeks = Array.from({ length: padded.length / 7 }, (_, i) => padded.slice(i * 7, i * 7 + 7));
  const years: number[] = [];
  for (let yr = Number(max.slice(0, 4)); yr >= Number(min.slice(0, 4)); yr--) years.push(yr);

  // moving by keys moves the focus with the day; the arrows and the month and year lists keep the focus where it is (a keyboard user changing the month stays on the list);
  // showing a month keeps the same day number as far as the month has it
  const go = (to: string, focusDay = false) => { moved.current = focusDay; setFocus(clamp(to)); };
  const shiftMonth = (by: number, focusDay = false) => {
    const target = new Date(Date.UTC(y, m + by, 1));
    const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    go(iso(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(Number(focus.slice(8, 10)), last))), focusDay);
  };
  const canPrev = monthStart(focus) > monthStart(min);
  const canNext = monthStart(focus) < monthStart(max);
  const onKey = (e: React.KeyboardEvent) => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in step) { e.preventDefault(); go(iso(ms(focus) + step[e.key] * DAY), true); }
    else if (e.key === 'PageUp') { e.preventDefault(); shiftMonth(-1, true); }
    else if (e.key === 'PageDown') { e.preventDefault(); shiftMonth(1, true); }
    else if (e.key === 'Home') { e.preventDefault(); go(iso(ms(focus) - new Date(ms(focus)).getUTCDay() * DAY), true); }
    else if (e.key === 'End') { e.preventDefault(); go(iso(ms(focus) + (6 - new Date(ms(focus)).getUTCDay()) * DAY), true); }
  };
  useEffect(() => { if (moved.current) grid.current?.querySelector<HTMLElement>('[data-focus="true"]')?.focus(); }, [focus]);

  return (
    <Popup id={`${title}-calendar`.replace(/\s+/g, '-').toLowerCase()} title={title} closeLabel={t('shell.close')} onClose={onClose}>
      <div className={calendar.head}>
        <button type="button" className={calendar.nav} aria-label={t('form.prev_month')} disabled={!canPrev} onClick={() => shiftMonth(-1)}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <label className={calendar.select}><span className={calendar.hidden}>{t('form.month')}</span>
          <select value={m} onChange={(e) => { const nm = Number(e.target.value); go(iso(Date.UTC(y, nm, Math.min(Number(focus.slice(8, 10)), new Date(Date.UTC(y, nm + 1, 0)).getUTCDate())))); }}>
            {Array.from({ length: 12 }, (_, i) => <option key={i} value={i}>{monthName(i)}</option>)}
          </select>
        </label>
        <label className={calendar.select}><span className={calendar.hidden}>{t('form.year')}</span>
          <select value={y} onChange={(e) => { const ny = Number(e.target.value); go(iso(Date.UTC(ny, m, Math.min(Number(focus.slice(8, 10)), new Date(Date.UTC(ny, m + 1, 0)).getUTCDate())))); }}>
            {years.map((yr) => <option key={yr} value={yr}>{toLocalDigits(String(yr), lang)}</option>)}
          </select>
        </label>
        <button type="button" className={calendar.nav} aria-label={t('form.next_month')} disabled={!canNext} onClick={() => shiftMonth(1)}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
      <div className={calendar.weekdays} aria-hidden="true">{weekdays.map((w) => <span key={w}>{w}</span>)}</div>
      <div className={calendar.days} role="grid" aria-label={`${monthName(m)} ${toLocalDigits(String(y), lang)}`} ref={grid} onKeyDown={onKey}>
        {weeks.map((week, wi) => (
          <div key={wi} role="row" className={calendar.week}>
            {week.map((d, i) => d === null
              ? <span key={`e${wi}-${i}`} role="gridcell" aria-hidden="true" className={calendar.empty} />
              : (
                <button key={d} type="button" role="gridcell" className={`${calendar.day} ${d === value ? calendar.chosen : ''} ${d === today ? calendar.today : ''}`}
                  disabled={d < min || d > max} aria-selected={d === value} aria-current={d === today ? 'date' : undefined} tabIndex={d === focus ? 0 : -1} data-focus={d === focus} data-autofocus={d === focus ? true : undefined}
                  aria-label={fmt({ dateStyle: 'full' }).format(ms(d))} onClick={() => onPick(d)}>
                  {toLocalDigits(String(Number(d.slice(8, 10))), lang)}
                </button>
              ))}
          </div>
        ))}
      </div>
    </Popup>
  );
}
