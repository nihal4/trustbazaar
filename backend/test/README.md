# Backend tests

| Command | What | Needs |
|---|---|---|
| `npm test` | Unit tests (`src/**/*.spec.ts`, `test/tools/`), then the coverage gate if run with `-- --coverage` | Nothing |
| `npm run test:integration` | `test/api/`, `test/db/`, `test/concurrency/` against a real database | PostgreSQL 15 and Redis 7, set up as below |

Every test title starts with the requirement it proves, e.g. `it('FR-AUC-04 a bid below the increment is refused', ...)`.
`python3 scripts/check_test_names.py` checks this, and that the requirement exists in `docs/srs.tex` (BUILDING.md section 6).

**Coverage (NFR-MNT-03).** After `npm test -- --coverage`, `test/tools/coverage-gate.ts` fails the run if the
orders, listings, delivery or game-accounts module has measured code with less than 70% of its lines covered.
A module without code yet is reported as pending. Wiring files (`*.module.ts`, `ports/index.ts`), the generated entities (`db/entities/`, `db/enums.ts`,
checked instead by `test/db/*-entities.spec.ts`) and the
migrations are not measured.

## A database for the integration tests

The same steps as the `integration` job in `.github/workflows/ci.yml`. From the repository root, with a
PostgreSQL 15 superuser in `PGHOST`, `PGPORT`, `PGUSER` and `PGPASSWORD`:

```sh
export POSTGRES_USER=$PGUSER TB_DATABASE=trustbazaar_test \
       TB_OWNER_PASSWORD=dev-only-owner-password-0123456789 TB_APP_PASSWORD=dev-only-app-password-0123456789ab
sh docs/design/deploy/postgres/init/01_roles.sh        # tb_owner and tb_app, as the container creates them
cd backend && npm run build
DATABASE_URL=postgres://tb_owner:$TB_OWNER_PASSWORD@$PGHOST:${PGPORT:-5432}/$TB_DATABASE npm run migrate
DATABASE_URL=postgres://tb_app:$TB_APP_PASSWORD@$PGHOST:${PGPORT:-5432}/$TB_DATABASE \
REDIS_URL=redis://localhost:6379/0 npm run test:integration
```

The roles are created once per PostgreSQL cluster; to start again, drop the database and both roles.
The Compose stack's PostgreSQL is not reachable from the host (it is on an internal network, SEC-INF-02), so
use a separate PostgreSQL for tests.

**The outbox dispatcher (K-04)** polls every 5 seconds in every test app. A test file that drains the outboxes
by hand (`test/api/outbox.spec.ts`) sets `OUTBOX_DISPATCHER=off` before starting its app and restores it after.
Likewise **the job runner (K-05)**: `test/api/jobs.spec.ts` sets `JOB_RUNNER=off` and runs jobs with `runNow()`.
