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
| `OGC_DEV_LOGIN=1`                | `main`    | Staging dev sign-in routes; refused in production     |

## Requests

- `Authorization: Bearer <IIOS grant>`
- `X-OGC-Org: <organization id>`
- Writes also need `Idempotency-Key` (8–128 characters).

## Routes (slice 1)

| Route                                                   | Who                                                    | Port it serves                              |
| ------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------- |
| `GET /v1/health`                                        | public                                                 | —                                           |
| `GET /v1/me/access`                                     | any grant                                              | `MyAccessPort`                              |
| `GET /v1/schedule`                                      | staff (`schedule:manage`, narrowed by center)          | `SchedulePort.getOverview`                  |
| `POST /v1/sessions/:id/reschedule` `{at}`               | staff                                                  | `reschedule`                                |
| `POST /v1/sessions/:id/cancel` `{replacementAt}`        | staff                                                  | `cancelWithReplacement`                     |
| `POST /v1/classes/:id/sessions` `{title, at}`           | staff                                                  | `addSession`                                |
| `PUT /v1/classes/:id/teacher` `{teacherId}`             | staff (not if `classTeacher` is read-only)             | `assignTeacher`                             |
| `PUT /v1/sessions/:id/substitute` `{teacherId \| null}` | staff (not if `substitute` is read-only)               | `setSubstitute`                             |
| `GET /v1/classes/:id/sessions`                          | the class teacher                                      | `AttendancePort.listClassSessions`          |
| `GET` / `PUT /v1/sessions/:id/attendance`               | owner or that session's substitute (`attendance:mark`) | `getSessionAttendance` / `recordAttendance` |
| `GET /v1/classes/:id/attendance-summary`                | the class teacher                                      | `getClassSummary`                           |
| `GET /v1/me/to-mark`                                    | teachers                                               | `listToMark`                                |
| `GET /v1/me/classes`                                    | teachers (403 `not_a_teacher` otherwise)               | — (teacher home)                            |
| `GET /v1/dev/personas`, `POST /v1/dev/login`            | public, only with `OGC_DEV_LOGIN=1` (staging)          | — (mock IIOS issues the grant)              |

Schedule writes return the contract's `ScheduleResult` and attendance writes return `RecordAttendanceResult`; the HTTP status matches the outcome (404, 403, 409, 422).

## Synthetic data

`DATABASE_URL_MIGRATE=… node dist/seed.mjs` loads the demo's organizations, centers, teachers, learners, classes, sessions and marks, run as the owner role. It refuses a database that already has data.

Sessions follow each class's weekly slot in center time (Asia/Ho_Chi_Minh), like the demo: A2 Morning on Mondays and Wednesdays at 09:00, both evening classes on Tuesdays and Thursdays at 18:00. Session ids count from the moment of seeding: `k1-m1` is the latest A2 Morning slot that has started (waiting for attendance), `k1-m2` and `k1-m3` are marked, `k1-p1` and `k1-p2` are the next two.

`node dist/seed.mjs --reset` (staging) deletes the two synthetic organizations' rows and seeds them again in one transaction. Other organizations are not touched. The audit log is append-only and is kept.

## Migrations

`migrations/NNNN_name.sql` files are forward-only. Never edit one after it is merged: the runner refuses a changed file. The `ogc_app` role must exist before the first migration runs.

## Tests

```bash
OGC_TEST_PG_ADMIN_URL=postgres://postgres@127.0.0.1:5432/postgres pnpm --filter @ogc/api test
```

The admin URL is used only to create the test roles and a fresh database per file. Without it, the tests are skipped locally. In CI they fail instead of skipping.
