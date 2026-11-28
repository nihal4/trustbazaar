// The parameters, /admin/config (FR-OPS-03, FR-OPS-08, FR-OPS-09, SEC-IRM-04; section 7.9; U8-10). Every parameter
// of the SRS table with its current value, edited as its own fields; "Check" asks the server for every broken rule at
// once (Unit 7's config_violations), and publishing needs a reason. A change to CP-30 is proposed for a second
// administrator. The emergency switches (new orders, payouts, game accounts) are their own panel: turning one on or
// off is always a proposal. The versions published so far, newest first.
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../shared/api';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { problemName } from '../../shared/problems';
import { Action, staffError } from '../cases/common';
import { Versions } from './ConfigVersions';
import { useStaffT } from '../text';
import styles from '../staff.module.css';
import { Button, Checkbox, Field, Input } from '../../shared/ui';

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
interface ConfigSet {
  version: number;
  values: Record<string, Json>;
}
const configKey = ['admin', 'config'] as const;
/** The emergency switches (CP-30's emergency.control): changed only by proposal. */
export const SWITCHES = ['SW-new_orders', 'SW-payouts', 'CP-36'];
/** Four-eyes parameters besides the switches (Unit 7: publish answers four-eyes-required). */
const GUARDED = new Set([...SWITCHES, 'CP-30']);

export function Component() {
  const { t, lang } = useStaffT();
  const api = useApi();
  const config = useQuery({
    queryKey: configKey,
    queryFn: ({ signal }) => api.get('/admin/config', { signal }) as Promise<ConfigSet>,
    staleTime: 0,
    retry: false,
  });
  return (
    <div>
      <h1>{t('admin.config.title')}</h1>
      {config.isPending && <p role="status">{t('shell.loading')}</p>}
      {config.isError && <FormMessage kind="error">{staffError(config.error, t, lang)}</FormMessage>}
      {config.data && (
        <>
          <Switches set={config.data} t={t} lang={lang} />
          <Editor key={config.data.version} set={config.data} t={t} lang={lang} />
        </>
      )}
      <Versions t={t} lang={lang} />
    </div>
  );
}

function Switches({ set, t, lang }: { set: ConfigSet; t: T; lang: Lang }) {
  const api = useApi();
  return (
    <section className={styles.panel} aria-labelledby="switches">
      <h2 id="switches">{t('admin.switches.title')}</h2>
      <p className={styles.hint}>{t('admin.switches.explain')}</p>
      {SWITCHES.filter((c) => c in set.values).map((code) => {
        const on = set.values[code] === true;
        return (
          <Action
            key={code}
            title={`${t(`admin.param.${code}`)}: ${t(on ? 'admin.switches.on' : 'admin.switches.off')}`}
            button={t(on ? 'admin.switches.propose_off' : 'admin.switches.propose_on')}
            consequence={t('staff.member.four_eyes_consequence')}
            t={t}
            lang={lang}
            run={(reason) => api.post('/admin/config/proposals', { changes: { [code]: !on }, reason })}
            done={() => t('staff.member.proposed')}
          />
        );
      })}
    </section>
  );
}

function Editor({ set, t, lang }: { set: ConfigSet; t: T; lang: Lang }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const codes = useMemo(
    () =>
      Object.keys(set.values)
        .filter((c) => !SWITCHES.includes(c))
        .sort(),
    [set],
  );
  const [draft, setDraft] = useState<Record<string, Json>>(() => structuredClone(set.values));
  const [bad, setBad] = useState<Set<string>>(new Set());
  const [violations, setViolations] = useState<string[] | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const changes = Object.fromEntries(codes.filter((c) => JSON.stringify(draft[c]) !== JSON.stringify(set.values[c])).map((c) => [c, draft[c]]));
  const changed = Object.keys(changes);
  const guarded = changed.some((c) => GUARDED.has(c));
  const edit = (code: string, path: (string | number)[], value: Json, ok: boolean) => {
    setViolations(null);
    setDraft((d) => ({ ...d, [code]: setAt(d[code], path, value) }));
    setBad((b) => {
      const n = new Set(b);
      const k = `${code}:${path.join('.')}`;
      if (ok) n.delete(k);
      else n.add(k);
      return n;
    });
  };
  const check = async () => {
    setCheckError(null);
    try {
      const r = (await api.post('/admin/config/validate', { changes })) as { violations: string[] };
      setViolations(r.violations);
    } catch (e) {
      setCheckError(staffError(e, t, lang));
    }
  };
  return (
    <section aria-labelledby="params">
      <h2 id="params">{t('admin.config.params', { version: String(set.version) })}</h2>
      <p className={styles.hint}>{t('admin.config.explain')}</p>
      <ul className={styles.items}>
        {codes.map((code) => (
          <li key={code} className={code in changes ? styles.changed : undefined}>
            <fieldset className={styles.choice}>
              <legend>
                <strong>{code}</strong> · {t(`admin.param.${code}`)}
                {GUARDED.has(code) ? ` · ${t('admin.config.four_eyes')}` : ''}
              </legend>
              <Value code={code} path={[]} value={draft[code]} original={set.values[code]} onChange={edit} t={t} />
            </fieldset>
          </li>
        ))}
      </ul>
      <div className={styles.panel}>
        <p>{changed.length ? t('admin.config.changed', { codes: changed.join(', ') }) : t('admin.config.unchanged')}</p>
        <p>
          <Button variant="secondary" type="button" disabled={!changed.length || bad.size > 0} onClick={() => void check()}>
            {t('admin.config.check')}
          </Button>
        </p>
        {checkError && <FormMessage kind="error">{checkError}</FormMessage>}
        {violations && violations.length === 0 && <FormMessage kind="success">{t('admin.config.no_violations')}</FormMessage>}
        {violations && violations.length > 0 && (
          <div role="alert" className={styles.warning}>
            <p>{t('admin.config.violations')}</p>
            <ul>
              {violations.map((v) => (
                <li key={v}>{v}</li>
              ))}
            </ul>
          </div>
        )}
        {bad.size > 0 && <FormMessage kind="error">{t('admin.config.bad_fields')}</FormMessage>}
      </div>
      {changed.length > 0 && bad.size === 0 && (
        <Action
          title={t(guarded ? 'admin.config.propose_title' : 'admin.config.publish_title')}
          button={t(guarded ? 'admin.config.propose' : 'admin.config.publish')}
          consequence={t(guarded ? 'staff.member.four_eyes_consequence' : 'admin.config.publish_consequence')}
          t={t}
          lang={lang}
          run={async (reason) => {
            try {
              return await api.post(guarded ? '/admin/config/proposals' : '/admin/config', { changes, reason });
            } catch (e) {
              if (problemName(e) === 'config-invalid') {
                const rules = ((e as { errors?: { rule?: string }[] }).errors ?? []).map((x) => x.rule).filter((r): r is string => !!r);
                setViolations(rules);
              }
              throw e;
            }
          }}
          done={(r) => (guarded ? t('staff.member.proposed') : t('admin.config.published', { version: String((r as { version: number }).version) }))}
          onDone={() => {
            if (!guarded) void queryClient.invalidateQueries({ queryKey: ['admin'] });
          }}
        />
      )}
    </section>
  );
}

/** One parameter's value as fields: objects by key, lists as comma-separated text, numbers and durations as text. */
function Value({
  code,
  path,
  value,
  original,
  onChange,
  t,
}: {
  code: string;
  path: (string | number)[];
  value: Json;
  original: Json;
  t: T;
  onChange: (code: string, path: (string | number)[], value: Json, ok: boolean) => void;
}) {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return (
      <div className={styles.fields}>
        {Object.keys(value)
          .sort()
          .map((k) => (
            <Value
              key={k}
              code={code}
              path={[...path, k]}
              value={value[k]}
              t={t}
              onChange={onChange}
              original={original && typeof original === 'object' && !Array.isArray(original) ? original[k] : null}
            />
          ))}
      </div>
    );
  }
  const id = `p-${code}-${path.join('-') || 'value'}`;
  const label = path.length ? String(path[path.length - 1]).replace(/_/g, ' ') : t('admin.config.value');
  if (typeof original === 'boolean') {
    return <Checkbox id={id} label={label} checked={value === true} onChange={(e) => onChange(code, path, e.target.checked, true)} />;
  }
  return <ConfigValue id={id} label={label} value={value} original={original} onChange={(v, ok) => onChange(code, path, v, ok)} t={t} />;
}

/** One value of a parameter: a labelled field that says in words when what was typed is not the kind of value the parameter holds. */
function ConfigValue({
  id,
  label,
  value,
  original,
  onChange,
  t,
}: {
  id: string;
  label: string;
  value: Json;
  original: Json;
  onChange: (v: Json, ok: boolean) => void;
  t: T;
}) {
  const [text, setText] = useState(() => show(value));
  const [error, setError] = useState(false);
  const numeric = typeof original === 'number' || (Array.isArray(original) && typeof original[0] === 'number');
  const shownLabel = Array.isArray(original) ? `${label} (${t('admin.config.list')})` : label;
  const problem = numeric ? t('admin.config.need_number') : t('admin.config.need_value');
  return (
    <Field id={id} label={shownLabel} error={error ? problem : undefined}>
      {(control) => (
        <Input
          {...control}
          value={text}
          inputMode={numeric ? 'numeric' : undefined}
          onChange={(e) => {
            setText(e.target.value);
            const r = parse(e.target.value, original);
            setError(!r.ok);
            onChange(r.value, r.ok);
          }}
        />
      )}
    </Field>
  );
}

const show = (v: Json) => (Array.isArray(v) ? v.join(', ') : v === null ? '' : String(v));
/** The typed value of a field, in the form the original had (Unit 7 stores numbers, durations as text, lists). */
export function parse(text: string, original: Json): { ok: boolean; value: Json } {
  const s = text.trim();
  const number = (x: string) => (/^-?\d+$/.test(x) ? Number(x) : NaN);
  if (Array.isArray(original)) {
    const parts = s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    if (typeof original[0] === 'number') {
      const ns = parts.map(number);
      return { ok: parts.length > 0 && ns.every(Number.isFinite), value: ns };
    }
    return { ok: parts.length > 0, value: parts };
  }
  if (typeof original === 'number') {
    const n = number(s);
    return { ok: Number.isFinite(n), value: Number.isFinite(n) ? n : s };
  }
  if (original === null) {
    if (s === '') return { ok: true, value: null };
    const n = number(s);
    return { ok: true, value: Number.isFinite(n) ? n : s };
  }
  return { ok: s.length > 0, value: s };
}
function setAt(root: Json, path: (string | number)[], value: Json): Json {
  if (!path.length) return value;
  const [k, ...rest] = path;
  const o = (root && typeof root === 'object' && !Array.isArray(root) ? root : {}) as Record<string, Json>;
  return { ...o, [k]: setAt(o[String(k)], rest, value) };
}
