import { inspect } from 'util';
import { ConfigError, KEYRINGS, loadConfig, MIN_SECRET_BYTES, SECRETS } from './config';

// A complete development environment, as docker-compose.yml provides it.
const dev = (): Record<string, string> => ({
  DATABASE_URL: 'postgres://tb_app:dev-only-app-password-0123456789ab@postgres:5432/trustbazaar',
  REDIS_URL: 'redis://:dev-only-redis-password-0123456789@redis:6379/0',
  JWT_KEY_V1: 'dev-only-jwt-signing-key-0123456789abcdef',
  FIELD_KEY_V1: 'dev-only-field-key-0123456789abcdef0123',
  BIDX_KEY: 'dev-only-blind-index-key-0123456789abcdef',
  KYC_KEK_V1: 'dev-only-kyc-kek-0123456789abcdef012345',
  CSRF_KEY: 'dev-only-csrf-key-0123456789abcdef0123456',
  LINK_KEY: 'dev-only-link-key-0123456789abcdef0123456',
  OTP_PEPPER: 'dev-only-otp-pepper-0123456789abcdef01234',
  CALLBACK_STATE_KEY: 'dev-only-callback-state-key-0123456789ab',
  HANDOVER_KEY: 'dev-only-handover-code-key-0123456789ab',
});

// The same with production values: no dev-only-, https origin, SMTP (as docker-compose.prod.yml requires).
const prod = (): Record<string, string> => {
  const env: Record<string, string> = { TB_ENV: 'production', NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://trustbazaar.example' };
  for (const [k, v] of Object.entries(dev())) env[k] = v.replace(/dev-only-/g, 'prod-xxxxx-');
  env.EMAIL_MODE = 'smtp';
  env.SMTP_URL = 'smtps://mailer:prod-mail-password@smtp.example:465';
  env.PAYMENT_MODE = 'sandbox';
  return env;
};

const problems = (env: Record<string, string | undefined>): string[] => {
  try {
    loadConfig(env);
    return [];
  } catch (err) {
    if (err instanceof ConfigError) return err.problems;
    throw err;
  }
};

describe('configuration', () => {
  it('SEC-DAT-05 a complete development environment loads', () => {
    const cfg = loadConfig(dev());
    expect(cfg.environment).toBe('development');
    expect(cfg.port).toBe(3000);
    expect(cfg.secrets.csrfKey.reveal()).toBe(dev().CSRF_KEY);
  });

  it('SEC-DAT-05 a complete production environment loads', () => {
    expect(loadConfig(prod()).environment).toBe('production');
  });

  it.each([...Object.values(SECRETS), ...Object.values(KEYRINGS).map((k) => `${k}_V1`), 'DATABASE_URL', 'REDIS_URL'])(
    'SEC-DAT-05 the backend refuses to start without %s',
    (name) => {
      const env = dev();
      delete env[name];
      expect(problems(env)).toEqual([expect.stringMatching(new RegExp(`^${name}: missing`))]);
    },
  );

  it(`SEC-DAT-05 a secret shorter than ${MIN_SECRET_BYTES} bytes is refused, in every environment`, () => {
    expect(problems({ ...dev(), OTP_PEPPER: 'x'.repeat(31) })).toEqual([`OTP_PEPPER: shorter than ${MIN_SECRET_BYTES} bytes`]);
    expect(problems({ ...dev(), OTP_PEPPER: 'x'.repeat(32) })).toEqual([]);
  });

  it('SEC-DAT-05 length counts bytes, not characters', () => {
    expect(problems({ ...dev(), LINK_KEY: 'ক'.repeat(11) })).toEqual([]); // 11 characters, 33 bytes
    expect(problems({ ...dev(), LINK_KEY: 'ক'.repeat(10) })).toEqual([`LINK_KEY: shorter than ${MIN_SECRET_BYTES} bytes`]);
  });

  it('SEC-DAT-05 versioned keys: the highest version is current, older ones stay readable', () => {
    const cfg = loadConfig({ ...dev(), JWT_KEY_V2: 'dev-only-jwt-signing-key-2-0123456789abcdef', JWT_KEY_V10: '' });
    expect(cfg.keys.jwt.current).toBe(2);
    expect(cfg.keys.jwt.versions).toEqual([1, 2]);
    expect(cfg.keys.jwt.key(1)?.reveal()).toBe(dev().JWT_KEY_V1);
    expect(cfg.keys.jwt.key(3)).toBeUndefined();
  });

  it('SEC-DAT-05 every version of a versioned key must be at least 32 bytes', () => {
    expect(problems({ ...dev(), FIELD_KEY_V2: 'short' })).toEqual([`FIELD_KEY_V2: shorter than ${MIN_SECRET_BYTES} bytes`]);
  });

  it('SEC-DAT-05 secret values never appear in printed configuration or in errors', () => {
    const env = { ...dev(), STRIPE_SECRET_KEY: 'sk_test_value_that_must_not_print' };
    const cfg = loadConfig(env);
    const printed = JSON.stringify(cfg) + inspect(cfg, { depth: 10 }) + String(cfg.secrets.csrfKey);
    for (const value of Object.values(env)) expect(printed).not.toContain(value);
    expect(String(cfg.secrets.csrfKey)).toBe('[secret CSRF_KEY]');

    const bad = { ...dev(), OTP_PEPPER: 'short-secret-value' };
    expect(problems(bad).join(' ')).not.toContain('short-secret-value');
  });

  it('I-59 in production, every dev-only- value is refused, including passwords and credentials', () => {
    const env = { ...prod(), HANDOVER_KEY: dev().HANDOVER_KEY, REDIS_URL: dev().REDIS_URL, STRIPE_SECRET_KEY: 'dev-only-stripe' };
    expect(problems(env).sort()).toEqual([
      'HANDOVER_KEY: a dev-only- value in production',
      'REDIS_URL password: a dev-only- value in production',
      'STRIPE_SECRET_KEY: a dev-only- value in production',
    ]);
  });

  it('I-59 dev-only- values are accepted outside production', () => {
    expect(problems({ ...dev(), TB_ENV: 'test' })).toEqual([]);
  });

  it('I-59 NODE_ENV=production alone is enough to apply the production rules', () => {
    expect(problems({ ...dev(), NODE_ENV: 'production' })).toContain('CSRF_KEY: a dev-only- value in production');
  });

  it('I-59 in production, the database and Redis need a password of at least 32 bytes', () => {
    expect(problems({ ...prod(), DATABASE_URL: 'postgres://tb_app@postgres:5432/trustbazaar' })).toEqual([
      'DATABASE_URL: no password in production',
    ]);
    expect(problems({ ...prod(), REDIS_URL: 'redis://:short@redis:6379/0' })).toEqual([
      `REDIS_URL password: shorter than ${MIN_SECRET_BYTES} bytes`,
    ]);
  });

  it('SEC-INF-05 debug output is refused in production', () => {
    expect(problems({ ...prod(), LOG_LEVEL: 'debug' })).toEqual(['LOG_LEVEL: debug output is off in production (SEC-INF-05)']);
    expect(problems({ ...dev(), LOG_LEVEL: 'debug' })).toEqual([]);
  });

  it('SEC-DAT-01 the public origin is https in production', () => {
    expect(problems({ ...prod(), PUBLIC_ORIGIN: 'http://trustbazaar.example' })).toEqual([
      'PUBLIC_ORIGIN: must be https in production',
    ]);
  });

  it('FR-ACC-04 the current terms and privacy versions come from the environment and fit the consent record', () => {
    expect(loadConfig(dev()).legal).toEqual({ termsVersion: '2026-11-01', privacyVersion: '2026-11-01' });
    expect(loadConfig({ ...dev(), TERMS_VERSION: 'v2', PRIVACY_VERSION: '2027.1' }).legal).toEqual({ termsVersion: 'v2', privacyVersion: '2027.1' });
    expect(problems({ ...dev(), TERMS_VERSION: 'x'.repeat(21) })).toEqual([
      'TERMS_VERSION: 1 to 20 letters, digits, dots, dashes or underscores',
    ]);
  });

  it('SEC-DAT-02 protected files live under FILES_ROOT, an absolute path (default: the Compose volumes)', () => {
    expect(loadConfig(dev()).filesRoot).toBe('/srv/files');
    expect(problems({ ...dev(), FILES_ROOT: 'files' })).toEqual(['FILES_ROOT: must be an absolute path']);
  });

  it('C-2 payments run in mock or sandbox mode only', () => {
    expect(problems({ ...dev(), PAYMENT_MODE: 'live' })).toEqual(['PAYMENT_MODE: must be one of mock, sandbox']);
    expect(problems({ ...dev(), COURIER_MODE: 'live' })).toEqual(['COURIER_MODE: must be one of mock, sandbox']);
  });

  it('SEC-DAT-05 e-mail by SMTP needs SMTP_URL', () => {
    expect(problems({ ...dev(), EMAIL_MODE: 'smtp' })).toEqual(['SMTP_URL: missing (EMAIL_MODE is smtp)']);
  });

  it('SEC-DAT-05 all problems are reported at once', () => {
    expect(problems({}).length).toBe(Object.keys(SECRETS).length + Object.keys(KEYRINGS).length + 2);
  });

  it('SEC-DAT-05 the loaded configuration cannot be changed afterwards', () => {
    const cfg = loadConfig(dev());
    expect(Object.isFrozen(cfg) && Object.isFrozen(cfg.secrets) && Object.isFrozen(cfg.keys.jwt)).toBe(true);
  });
});
