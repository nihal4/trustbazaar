// A date field with a calendar of our own (U10-26): the date is typed as YYYY-MM-DD (or Bangla digits), or chosen in a popup, a month of ruled day cells under a
// month and a year to choose, so a birth date is reached in three touches and not by paging back through decades. The real input stays, so the label, the
// error and the typing work as in every field; the calendar is the button at its right edge. The value is always YYYY-MM-DD, as the native date input gave it.
import { useState } from 'react';
import { toAsciiDigits, toLocalDigits } from '../lib/money.js';
import { useLanguage } from './language/Language';
import { usePendingStepUp } from './stepUp';
import { Field, IconButton, Input } from './ui';
import { Calendar, isValidDate } from './ui/Calendar';
import styles from './form.module.css';

interface Props {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string;
  /** the earliest and the latest date that may be chosen (YYYY-MM-DD) */
  min: string;
  max: string;
  /** the month the calendar opens at when there is no date yet */
  startAt?: string;
  autoComplete?: string;
}

export function DateField({ id, label, value, onChange, hint, error, min, max, startAt, autoComplete }: Props) {
  const { t, lang } = useLanguage();
  const [open, setOpen] = useState(false);
  const stepping = usePendingStepUp() !== null;
  return (
    <>
      <Field id={id} label={label} hint={hint} error={error}>
        {(control) => (
          <div className={styles.passwordWrap}>
            <Input
              {...control}
              value={value}
              inputMode="numeric"
              placeholder="YYYY-MM-DD"
              maxLength={10}
              autoComplete={autoComplete}
              onChange={(e) => onChange(toAsciiDigits(e.target.value))}
            />
            <IconButton variant="quiet" className={styles.eye} aria-haspopup="dialog" label={t('form.pick_date')} onClick={() => setOpen(true)}>
              <svg
                viewBox="0 0 24 24"
                width="22"
                height="22"
                aria-hidden="true"
                focusable="false"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3.5" y="5" width="17" height="15" />
                <path d="M3.5 10h17M8 3v4M16 3v4" />
              </svg>
            </IconButton>
          </div>
        )}
      </Field>
      {open && (
        <Calendar
          title={label}
          value={isValidDate(value) ? value : ''}
          min={min}
          max={max}
          startAt={startAt}
          hidden={stepping}
          locale={lang === 'bn' ? 'bn-BD' : 'en-GB'}
          digits={(ascii) => toLocalDigits(ascii, lang)}
          labels={{ close: t('shell.close'), prevMonth: t('form.prev_month'), nextMonth: t('form.next_month'), month: t('form.month'), year: t('form.year') }}
          onPick={(v) => {
            onChange(v);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
