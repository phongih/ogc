# OGC-ADR-040 — Two runtimes, one codebase: Demo and Platform

- **Status:** Accepted by the owner, 23/11/2026 (direction and the four choices in §3). Each implementation step is still its own PR, CI-gated.
- **Date:** 23/11/2026
- **Decides:** the owner. IIOS decides everything named as IIOS's (see the IIOS handoff, 23/11).
- **Builds on:** OGC-ADR-039 (security, audit, integrity), OGC-DEC-027 (Option C: OGC consumes IIOS decisions), OGC-IIOS-001 (grant contract).

> **Non-claims.** Nothing here makes OGC production-ready, secure or compliant. G2-C is NOT PASSED, the 33.S independent review is pending, D-14 is a design gap, R-06 / R-16 are OPEN, 009B is HELD. Real learner data stays out of every environment until the owner opens those gates; legal questions (Track C) are outside this ADR.

## 1. Decision

Keep the current OGC as a **Demo** on its own VM, and build the **Platform** (backend, PostgreSQL, server-side authorization) on a second VM.

**Two VMs, one repository, one codebase, one CI pipeline, two environments.** We split the runtime, not the product. No fork, no second repository.

|                | VM 1 — Demo                                                         | VM 2 — Platform                                                                      |
| -------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Purpose        | Showroom; baseline to compare against                               | The real system, built domain by domain                                              |
| Frontend build | `mock` adapters + synthetic fixtures                                | `http` adapters only                                                                 |
| Backend        | none                                                                | `services/api` (+ `services/iios-mock` until IIOS exists)                            |
| Data           | synthetic, in the browser (`ogc.demo`)                              | PostgreSQL; **synthetic only** until the gates in §6 open                            |
| Secrets        | none                                                                | only on VM 2, never in the repo or a bundle                                          |
| Change rate    | bug fixes for the demo only                                         | active development                                                                   |
| Hostname       | `ogc.eduos.vn` (kept; `demo.ogc.eduos.vn` may be added as an alias) | `app.ogc.eduos.vn`, `api.ogc.eduos.vn` (proposed; DNS and certificates by the owner) |

## 2. Why

- Developing the backend must not break the demo; a demo incident must not touch real data.
- A database, identity, authorization and learner records do not belong next to a showroom runtime.
- Rollback, secrets and resource use stay independent.
- Cost: one more VM. Accepted.

## 3. Choices made (owner, 23/11, AskUserQuestion)

1. **Stack:** Node 22 / TypeScript, **Fastify** (HTTP), **Kysely** (typed SQL), **PostgreSQL 16**. Same pnpm monorepo; request / response shapes come from `@ogc/contracts` (zod), shared with the web app.
2. **First slice:** the foundation (§4) + Access with the mock IIOS + **Schedule & Attendance** moved to the backend. Every other domain stays mock-only until its own PR.
3. **Grant source until IIOS exists:** a **mock IIOS on the server side** (`services/iios-mock`), a separate process that holds a dev signing key and answers `resolve`. The OGC API never holds that key and never verifies a signature itself — it calls `resolve` and honours the decided state, exactly as with real IIOS (OGC-DEC-027). Replacing it with real IIOS changes the endpoint and credentials, not the authorization logic.
4. **DAK = tenant-scoped data access layer.** Every database read and write goes through one layer that is given the decided grant and enforces the organization (and center) scope; see §4.

## 4. Foundation (services/api)

- **Request pipeline:** request id → grant `resolve` (fail-closed: any state but `valid`, a timeout or a malformed answer = no access) → `authorize(ctx, action, resource)` from `@ogc/contracts` (the same function the demo runs) → handler → audit.
- **DAK (tenant-scoped data access):**
  - handlers never get a raw database handle; they get a scoped handle bound to `ctx.orgId` (and `activeCenter` when present);
  - every tenant table carries `org_id`; PostgreSQL **row-level security** is enabled and forced on them, keyed on a per-transaction setting (`SET LOCAL app.org_id`), so a query that forgets its filter still returns nothing from another organization;
  - the application role is not the table owner and cannot bypass RLS; migrations run as a separate role.
- **Audit:** an append-only `audit_event` table (insert only; update / delete refused by privilege and trigger) — `{event_id, org_id, principal_id, request_id, action, resource, outcome, reason, at, before_hash, after_hash}`. Demo history stays demo history.
- **Idempotency:** every write takes an `Idempotency-Key`; same key + same body → the stored result; same key + different body → refused (ADR-039 F6).
- **Migrations:** numbered, forward-only files in the repo, reviewed in PRs, applied by a dedicated command; never edited after merge.
- **Tests:** against a real local PostgreSQL in CI, including the cross-tenant matrix (own org / other org with a known id / no context) for every route (ADR-039 F4).

## 5. Build-time guard between the two runtimes

- `VITE_OGC_ADAPTER=mock|http` picks the adapters at build time.
- CI checks both builds:
  - the **demo** bundle contains no API base URL and no secret;
  - the **platform** bundle fails to build if a mock adapter or a synthetic fixture is reachable from it;
  - the NON-PRODUCTION banner shows on the demo only.
- `ops/release/` gains an environment parameter; the manifest records it, and `promote.sh` refuses a mock build on the platform root and a platform build on the demo root.

## 6. Gates before any real data (not decided here)

Real learner or staff data, minors' data, or a public production launch on VM 2 needs, at least: the 33.S independent review, the legal review (Track C, including audit retention and guardian consent), real IIOS (or an owner decision about it), and the held items G2-C, D-14, R-06 / R-16, 009B. Until then VM 2 runs synthetic data only. Claude prepares commands; the owner runs anything on a VM.

## 7. Order of work (each a PR)

1. This ADR.
2. Foundation: `services/iios-mock`, `services/api` (pipeline, DAK + RLS, audit, idempotency, migrations), PostgreSQL in CI.
3. Schedule & Attendance on the API + the web `http` adapters + the build guard (§5).
4. VM 2 runbook (OS packages, PostgreSQL, nginx, service units, backups / restore drill) as owner-run command blocks; release toolkit environment parameter.
5. Then one domain per PR, demo kept running in parallel for comparison.
