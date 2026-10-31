// The integration tests run against a real PostgreSQL and Redis, set up as the container sets them up
// (test/README.md): DATABASE_URL names tb_app, the application's account; REDIS_URL names Redis.
export function requireEnv(name: 'DATABASE_URL' | 'REDIS_URL'): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the integration tests (see backend/test/README.md)`);
  return value;
}
