# The kernel

What every unit needs and no unit owns. **The kernel never imports a unit**; units import the kernel (ESLint enforces it).

| Folder | What it is |
|---|---|
| `config/` | the one place environment variables are read and checked at start (`loadConfig`); a bad setting stops the process with a list of what is wrong. Includes `DB_POOL_MAX` and `DB_CONNECT_TIMEOUT_MS` |
| `config-port.ts` | `ConfigPort`: how every unit reads a business parameter (`CP-nn`), never from a constant |
| `db/` | the database pool's watchdog (`pool-watch.ts`): logs when requests wait with no connection free |
| `events/` | the event bus and the outbox dispatcher: a unit writes an event in its transaction and subscribers receive it after (DC-6) |
| `http/` | route policies (`@Public`, `@SignedIn`, `@Verified`, `@Staff`), problem documents (RFC 9457), idempotency keys, correlation ids, cursors |
| `jobs/` | the job runner for scheduled work (switched off in tests) |
| `live/` | the socket.io gateway with the Redis adapter, so rooms span instances |
| `health/`, `metrics/` | liveness and readiness; the metrics server on its own port |
| `logging/`, `privacy/` | redaction of secrets in logs; the shape of a unit's part of a data export |

`kernel.module.ts` wires the database (as `tb_app`, never synchronising the schema) and the providers; `clock.ts` is the one source of time, so tests can move it.
