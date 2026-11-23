# @ogc/api — OGC Platform API (ADR-040)

Fastify + Kysely + PostgreSQL 16. Synthetic data only until the gates in ADR-040 §6 open.

## Request pipeline

1. Request id.
2. The grant is resolved at IIOS (`services/iios-mock` until real IIOS exists). This step is fail-closed.
3. `authorize()` runs; it comes from `@ogc/contracts` and is the same evaluator the demo uses.
4. The handler runs inside the DAK, which is one transaction scoped to the grant's organization by row-level security.
5. The request is audited.

## Environment

| Variable                         | Used by   | Meaning                                               |
| -------------------------------- | --------- | ----------------------------------------------------- |
| `DATABASE_URL`                   | `main`    | Connection as `ogc_app` (not the owner, no BYPASSRLS) |
| `DATABASE_URL_MIGRATE`           | `migrate` | Connection as the owner role that runs migrations     |
| `IIOS_URL`, `IIOS_CLIENT_SECRET` | `main`    | Where to resolve grants, and the client credential    |
| `IIOS_TIMEOUT_MS`                | `main`    | Default 2000; a timeout refuses the request (503)     |
| `HOST`, `PORT`                   | `main`    | Default `127.0.0.1:8788`                              |

## Requests

- `Authorization: Bearer <IIOS grant>`
- `X-OGC-Org: <organization id>`
- Writes also need `Idempotency-Key` (8–128 characters).

## Migrations

`migrations/NNNN_name.sql` files are forward-only. Never edit one after it is merged: the runner refuses a changed file. The `ogc_app` role must exist before the first migration runs.

## Tests

```bash
OGC_TEST_PG_ADMIN_URL=postgres://postgres@127.0.0.1:5432/postgres pnpm --filter @ogc/api test
```

The admin URL is used only to create the test roles and a fresh database per file. Without it, the tests are skipped locally. In CI they fail instead of skipping.
