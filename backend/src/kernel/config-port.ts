// ConfigPort (docs/design/07_disputes_trust_staff.pdf section "Parameters and Feature Switches"; DC-9,
// NFR-MNT-06, FR-OPS-08): every unit reads the business parameters CP-nn through it, never hard-coded.
// Unit 7 implements it over staff.config_versions (U7-01); the values have the shapes of the seeded
// version 1 (docs/design/sql/07_disputes_trust_staff.sql), for example CP-01 = {"access": "15 minutes"}.
// A running order or auction keeps the version it was created with and reads it through atVersion().
// The emergency switches (SEC-IRM-04) are read with switchOn(), never from a cache.
export interface ParameterValues {
  get<T>(code: string): T;
  /** A duration parameter (or one field of it) in milliseconds: ms('CP-01', 'access'), ms('CP-31'). */
  ms(code: string, field?: string): number;
}

export interface ConfigValues extends ParameterValues {
  version: number;
}

export type SwitchName = 'SW-new_orders' | 'SW-payouts';

export interface ConfigPort {
  current(): Promise<ConfigValues>;
  atVersion(version: number): Promise<ParameterValues>;
  switchOn(name: SwitchName): Promise<boolean>;
}

export const CONFIG_PORT = Symbol('CONFIG_PORT');

const UNIT_MS: Record<string, number> = {
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
  month: 30 * 86_400_000,
  year: 365 * 86_400_000,
};

/** "15 minutes", "1 day 2 hours", "1 year" -> milliseconds (the interval texts of the parameter set). */
export function durationMs(text: string): number {
  const parts = [...text.trim().toLowerCase().matchAll(/(\d+(?:\.\d+)?)\s*(second|minute|hour|day|week|month|year)s?/g)];
  if (parts.length === 0 || parts.map((p) => p[0]).join(' ').replace(/\s+/g, ' ') !== text.trim().toLowerCase().replace(/\s+/g, ' ')) {
    throw new Error(`not a duration: "${text}"`);
  }
  return parts.reduce((sum, p) => sum + Number(p[1]) * UNIT_MS[p[2]], 0);
}

/** Wraps a parameter set (code -> value) with the typed readers. */
export function parameterValues(values: Record<string, unknown>): ParameterValues {
  const get = <T>(code: string): T => {
    if (!(code in values)) throw new Error(`unknown parameter ${code}`);
    return values[code] as T;
  };
  return {
    get,
    ms(code: string, field?: string): number {
      const v = get<unknown>(code);
      const text = field === undefined ? v : (v as Record<string, unknown>)[field];
      if (typeof text !== 'string') throw new Error(`${code}${field ? `.${field}` : ''} is not a duration`);
      return durationMs(text);
    },
  };
}
