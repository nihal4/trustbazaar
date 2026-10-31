import { KEYRINGS, SECRETS } from '../../src/kernel/config/config';

// The integration tests run against a real PostgreSQL and Redis, set up as the container sets them up
// (test/README.md): DATABASE_URL names tb_app, the application's account; REDIS_URL names Redis.
export function requireEnv(name: 'DATABASE_URL' | 'REDIS_URL'): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the integration tests (see backend/test/README.md)`);
  return value;
}

// Test values for the backend's secrets, used where the environment gives none. They are test-only
// credentials, separate from development and production ones (SEC-INF-04).
export function useTestSecrets(): void {
  process.env.TB_ENV ??= 'test';
  const names = [...Object.values(SECRETS), ...Object.values(KEYRINGS).map((k) => `${k}_V1`)];
  for (const name of names) process.env[name] ??= `test-only-${name.toLowerCase()}-0123456789abcdef0123456789`;
}
