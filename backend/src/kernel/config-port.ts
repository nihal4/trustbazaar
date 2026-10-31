import { Provider } from '@nestjs/common';

// ConfigPort (docs/design/07_disputes_trust_staff.pdf section 4; DC-9, NFR-MNT-06): every unit reads the
// business parameters CP-nn through it, never hard-coded. Unit 7 serves them from its versioned store
// (U7-01). Until then, as Unit 1 section 4.5 says ("initially environment configuration"), this provider
// answers the SRS default of each parameter used so far, as version 0. U7-01 rebinds CONFIG_PORT.
export interface ConfigValues {
  version: number;
  get<T>(code: string): T;
}

export interface ConfigPort {
  current(): Promise<ConfigValues>;
  atVersion(version: number): Promise<{ get<T>(code: string): T }>;
}

export const CONFIG_PORT = Symbol('CONFIG_PORT');

// SRS table of parameters (docs/srs.tex, section "Configurable parameters"), defaults.
export const SRS_DEFAULTS: Record<string, unknown> = {
  'CP-01': { accessTokenMinutes: 15 },
  'CP-02': { idleDays: 7, absoluteDays: 30 },
  'CP-03': { idleMinutes: 15, absoluteHours: 8 },
  'CP-04': { failuresPerAccount: 5, windowMinutes: 15, perAddress: 50 },
  'CP-35': { profileReadsPerMinute: 60 },
};

const defaults = {
  get<T>(code: string): T {
    if (!(code in SRS_DEFAULTS)) throw new Error(`parameter ${code} is not available before U7-01`);
    return SRS_DEFAULTS[code] as T;
  },
};

export const initialConfigPort: ConfigPort = {
  current: async () => ({ version: 0, ...defaults }),
  atVersion: async () => defaults,
};

export const configPortProvider: Provider = { provide: CONFIG_PORT, useValue: initialConfigPort };
