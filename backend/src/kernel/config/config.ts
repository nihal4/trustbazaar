// Configuration and secrets (K-01): read once at start-up from the environment, checked, then frozen.
// Sources: docs/design/09_integration.pdf section 5.3 (secrets and settings), I-59; docs/design/
// 01_identity_access.pdf section 7 (the Unit 1 secrets and their rotation); SEC-DAT-05, SEC-INF-05.
//
// Rules:
//   - every secret of the backend is present and at least 32 bytes, in every environment (SEC-DAT-05)
//   - in production, no secret, password or provider credential starts with "dev-only-" (I-59), and
//     debug output is off (SEC-INF-05)
//   - a value is never printed: errors name the variable, and a Secret prints as "[secret NAME]"
// Business parameters (CP-01 to CP-47) are not configuration: they come from Unit 7's ConfigPort.

export const MIN_SECRET_BYTES = 32;
const DEV_ONLY = 'dev-only-';

export class Secret {
  readonly #value: string;

  constructor(
    readonly name: string,
    value: string,
  ) {
    this.#value = value;
  }

  /** The value, for the one place that uses it (a key, a password). Never log it. */
  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return `[secret ${this.name}]`;
  }

  toJSON(): string {
    return this.toString();
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return this.toString();
  }
}

/** A versioned key (NAME_V1, NAME_V2, ...): the highest version signs or encrypts; older ones still read. */
export interface Keyring {
  readonly name: string;
  readonly current: number;
  readonly versions: readonly number[];
  key(version: number): Secret | undefined;
}

export type Environment = 'development' | 'test' | 'production';
export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export interface TbConfig {
  readonly environment: Environment;
  readonly port: number;
  readonly logLevel: LogLevel;
  readonly publicOrigin: string;
  /** The current terms of use and privacy notice; registration must accept exactly these (FR-ACC-04). */
  readonly legal: { readonly termsVersion: string; readonly privacyVersion: string };
  /** The protected-file volumes, one folder per purpose (Unit 9 Compose: /srv/files/kyc, ...). */
  readonly filesRoot: string;
  readonly databaseUrl: Secret;
  readonly redisUrl: Secret;
  readonly paymentMode: 'mock' | 'sandbox';
  readonly courierMode: 'mock' | 'sandbox';
  readonly emailMode: 'log' | 'smtp';
  /** Validated by Unit 6's SMS adapter: the design names only "log" and a provider test mode. */
  readonly smsMode: string;
  readonly secrets: Readonly<Record<SecretName, Secret>>;
  readonly keys: Readonly<Record<KeyringName, Keyring>>;
  readonly providers: Readonly<Partial<Record<ProviderName, Secret>>>;
}

// Unit 1 (CSRF_KEY .. OTP_PEPPER), Unit 2 (CALLBACK_STATE_KEY), Unit 4 (HANDOVER_KEY).
export const SECRETS = {
  csrfKey: 'CSRF_KEY',
  linkKey: 'LINK_KEY',
  otpPepper: 'OTP_PEPPER',
  bidxKey: 'BIDX_KEY',
  callbackStateKey: 'CALLBACK_STATE_KEY',
  handoverKey: 'HANDOVER_KEY',
} as const;
export type SecretName = keyof typeof SECRETS;

// Unit 1: versioned keys, rotated as Unit 1 section 7 describes.
export const KEYRINGS = { jwt: 'JWT_KEY', field: 'FIELD_KEY', kycKek: 'KYC_KEK' } as const;
export type KeyringName = keyof typeof KEYRINGS;

// Issued by the providers; their length is theirs. Which ones a mode needs is checked by the units' adapters.
export const PROVIDERS = {
  stripeSecretKey: 'STRIPE_SECRET_KEY',
  stripeWebhookSecret: 'STRIPE_WEBHOOK_SECRET',
  bkashAppKey: 'BKASH_APP_KEY',
  bkashAppSecret: 'BKASH_APP_SECRET',
  bkashUsername: 'BKASH_USERNAME',
  bkashPassword: 'BKASH_PASSWORD',
  nagadMerchantId: 'NAGAD_MERCHANT_ID',
  nagadPrivateKey: 'NAGAD_PRIVATE_KEY',
  courierApiKey: 'COURIER_API_KEY',
  courierWebhookSecret: 'COURIER_WEBHOOK_SECRET',
  smtpUrl: 'SMTP_URL',
  smsApiKey: 'SMS_API_KEY',
} as const;
export type ProviderName = keyof typeof PROVIDERS;

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`configuration refused (${problems.length}):\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

type Env = Record<string, string | undefined>;

export function loadConfig(env: Env): TbConfig {
  const problems: string[] = [];
  const get = (name: string): string | undefined => {
    const v = env[name];
    return v === undefined || v === '' ? undefined : v;
  };
  const oneOf = <T extends string>(name: string, allowed: readonly T[], fallback: T): T => {
    const v = get(name) ?? fallback;
    if ((allowed as readonly string[]).includes(v)) return v as T;
    problems.push(`${name}: must be one of ${allowed.join(', ')}`);
    return fallback;
  };

  const production = get('TB_ENV') === 'production' || get('NODE_ENV') === 'production';
  const declared = oneOf<Environment>('TB_ENV', ['development', 'test', 'production'], 'development');
  const environment: Environment = production ? 'production' : declared;

  const checkSecretValue = (name: string, value: string, minBytes: boolean) => {
    if (minBytes && Buffer.byteLength(value, 'utf8') < MIN_SECRET_BYTES) {
      problems.push(`${name}: shorter than ${MIN_SECRET_BYTES} bytes`);
    }
    if (production && value.startsWith(DEV_ONLY)) problems.push(`${name}: a ${DEV_ONLY} value in production`);
  };

  const secret = (name: string): Secret => {
    const v = get(name);
    if (v === undefined) {
      problems.push(`${name}: missing`);
      return new Secret(name, '');
    }
    checkSecretValue(name, v, true);
    return new Secret(name, v);
  };

  const keyring = (name: string): Keyring => {
    const pattern = new RegExp(`^${name}_V([1-9]\\d*)$`);
    const found = new Map<number, Secret>();
    for (const [key, value] of Object.entries(env)) {
      const m = pattern.exec(key);
      if (!m || value === undefined || value === '') continue;
      checkSecretValue(key, value, true);
      found.set(Number(m[1]), new Secret(key, value));
    }
    if (found.size === 0) problems.push(`${name}_V1: missing (a versioned key needs at least ${name}_V1)`);
    const versions = [...found.keys()].sort((a, b) => a - b);
    return Object.freeze({
      name,
      current: versions[versions.length - 1] ?? 0,
      versions: Object.freeze(versions),
      key: (version: number) => found.get(version),
    });
  };

  // A URL whose password is a secret (DATABASE_URL, REDIS_URL): in production, the password follows I-59.
  const secretUrl = (name: string): Secret => {
    const v = get(name);
    if (v === undefined) {
      problems.push(`${name}: missing`);
      return new Secret(name, '');
    }
    let password = '';
    try {
      password = decodeURIComponent(new URL(v).password);
    } catch {
      problems.push(`${name}: not a valid URL`);
    }
    if (production) {
      if (password === '') problems.push(`${name}: no password in production`);
      else checkSecretValue(`${name} password`, password, true);
    }
    return new Secret(name, v);
  };

  const portText = get('PORT') ?? '3000';
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || port < 1 || port > 65535) problems.push('PORT: must be a port number');

  const logLevel = oneOf<LogLevel>('LOG_LEVEL', ['error', 'warn', 'info', 'debug'], 'info');
  if (production && logLevel === 'debug') problems.push('LOG_LEVEL: debug output is off in production (SEC-INF-05)');

  const publicOrigin = get('PUBLIC_ORIGIN') ?? 'http://localhost:8080';
  try {
    const u = new URL(publicOrigin);
    if (u.origin !== publicOrigin) problems.push('PUBLIC_ORIGIN: must be an origin only (scheme, host, port)');
    if (production && u.protocol !== 'https:') problems.push('PUBLIC_ORIGIN: must be https in production');
  } catch {
    problems.push('PUBLIC_ORIGIN: not a valid URL');
  }

  // FR-ACC-04: the versions a person must accept at registration (Decisions log, U1-03).
  const legalVersion = (name: string): string => {
    const v = get(name) ?? '2026-11-01';
    if (!/^[A-Za-z0-9._-]{1,20}$/.test(v)) problems.push(`${name}: 1 to 20 letters, digits, dots, dashes or underscores`);
    return v;
  };
  const legal = Object.freeze({ termsVersion: legalVersion('TERMS_VERSION'), privacyVersion: legalVersion('PRIVACY_VERSION') });

  const filesRoot = get('FILES_ROOT') ?? '/srv/files';
  if (!filesRoot.startsWith('/')) problems.push('FILES_ROOT: must be an absolute path');

  // C-2 and C-3: payments and couriers are mock or sandbox only; the deliverable never moves real money.
  const paymentMode = oneOf('PAYMENT_MODE', ['mock', 'sandbox'] as const, 'mock');
  const courierMode = oneOf('COURIER_MODE', ['mock', 'sandbox'] as const, 'mock');
  const emailMode = oneOf('EMAIL_MODE', ['log', 'smtp'] as const, 'log');
  const smsMode = get('SMS_MODE') ?? 'log';

  const secrets = Object.fromEntries(
    Object.entries(SECRETS).map(([key, name]) => [key, secret(name)]),
  ) as Record<SecretName, Secret>;
  const keys = Object.fromEntries(
    Object.entries(KEYRINGS).map(([key, name]) => [key, keyring(name)]),
  ) as Record<KeyringName, Keyring>;

  const providers: Partial<Record<ProviderName, Secret>> = {};
  for (const [key, name] of Object.entries(PROVIDERS) as [ProviderName, string][]) {
    const v = get(name);
    if (v === undefined) continue;
    checkSecretValue(name, v, false);
    providers[key] = new Secret(name, v);
  }
  if (emailMode === 'smtp' && !providers.smtpUrl) problems.push('SMTP_URL: missing (EMAIL_MODE is smtp)');

  const databaseUrl = secretUrl('DATABASE_URL');
  const redisUrl = secretUrl('REDIS_URL');

  if (problems.length > 0) throw new ConfigError(problems);

  return Object.freeze({
    environment,
    port,
    logLevel,
    publicOrigin,
    legal,
    filesRoot,
    databaseUrl,
    redisUrl,
    paymentMode,
    courierMode,
    emailMode,
    smsMode,
    secrets: Object.freeze(secrets),
    keys: Object.freeze(keys),
    providers: Object.freeze(providers),
  });
}

let loaded: TbConfig | undefined;

/** The process's configuration: read from process.env on first use, then the same object (read once). */
export function config(): TbConfig {
  loaded ??= loadConfig(process.env);
  return loaded;
}
