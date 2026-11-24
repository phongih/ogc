# OGC-ADR-042 — The IIOS kernel as a dedicated Platform cluster (S2)

- **Status:** Proposed — owner approved the direction (dedicated cluster + admission guard; role-per-org tenancy). Each slice is its own PR, CI-gated; the owner approves every merge and runs every VM command.
- **Date:** 24/11/2026
- **Decides:** the owner. IIOS decides everything named as IIOS's (OGC-DEC-027 Option C).
- **Builds on:** OGC-ADR-041 (kernel vendored into the repo, S1), OGC-ADR-040 (Demo/Platform split), OGC-DEC-027, OGC-IIOS-001.

> **Non-claims.** Synthetic/dev only — no real or children's data, dev-signed keys. G2-C not passed, 33.S pending, D-14 a gate, 009B HELD. This stands up the real authorization kernel as infrastructure; it does not open any data gate. The main `postgres`/`ogc` cluster and the running `iios-mock` service are untouched. Reviewed kernel SQL is reused byte-for-byte, never modified.

## 1. Context (from the VM2 survey, 24/11)

The Platform runs **self-hosted PostgreSQL 16** on VM2 (`pgcrypto` available, no Cloud SQL). Its **sole superuser is `postgres`**, which also owns the `ogc` application database; roles `ogc_owner`/`ogc_app` serve the API, and `iios_mock` owns the mock's policy-store database. The owner chose **role-per-org** tenancy (keep the reviewed kernel's `session_user`→organization model) and a **dedicated IIOS cluster with the admission guard applied**.

## 2. Decision

Run the IIOS kernel as a **second, dedicated PostgreSQL 16 cluster on VM2**, isolated by data directory and port (**5433**), localhost + scram only, whose **sole superuser is `bootstrap`**.

This is required by the admission guard: `p02`'s OB1 check demands the only superuser be `bootstrap`. The main cluster cannot satisfy that (its `postgres` superuser administers the whole cluster and the `ogc` DB and cannot be demoted). On a dedicated `bootstrap` cluster the reviewed guard applies **green, byte-for-byte**, and — because the cluster is isolated — the kernel database keeps its reviewed name `dak` with no SQL change.

## 3. Scope

- **S2a (this slice).** Provision the dedicated cluster and install the **r2 guarded kernel**: `p00` → `p01` → `p01b` → seed `iios.org_roles` (two synthetic orgs, OB5) → **`p02` admission guard**. Scripts in `ops/iios/` (`provision-cluster.sh`, `apply-kernel.sh`, `verify-kernel.sh`); owner runs them on VM2. No application wiring.
- **S2b.** Bring `p01c` (r3 recovery/onboarding) under the guard, via a reviewed extension of `p02`'s AZG7 EXECUTE allowlist (which predates r3). Until then `p01c` and `p02` cannot coexist unmodified, so r3 is out of S2a.
- **S3.** Point `iios-mock` at this cluster to issue/resolve grants through `bind_principal`/`current_principal`, replacing the dev-HMAC `token.ts`.

## 4. What S2a guarantees, and how it is verified

The cluster enforces, on synthetic data: sealed-principal binding (forge/replay rejected), per-organization tenant RLS that fails closed, D-14 guardian self-verification prohibition, and the **cluster admission guard** (sole-superuser invariant, privilege lockdown, DDL event triggers).

- The kernel's in-database invariants (sealed principal, RLS, C14) are proven in **CI** against the identical vendored SQL (`services/iios-mock/src/kernel.test.ts`, OGC-ADR-041).
- CI cannot host a single-superuser `bootstrap` cluster, so the **guard** and other on-cluster properties are verified by **`verify-kernel.sh`** against the live IIOS cluster after provisioning (sole superuser `bootstrap`; guard schema + event triggers present; every org-login role mapped; non-bootstrap DDL on `public` denied; an unbound session fails closed with `AZ_NO_PRINCIPAL`).

The full provision → apply → verify chain was validated end-to-end on a throwaway `bootstrap` cluster before this slice (all checks pass; all three scripts idempotent).

## 5. Boundaries

- Reviewed kernel SQL is applied **verbatim**. The only deviations are operational and documented in `apply-kernel.sh`: role passwords are parameterised/generated, and `iios.org_roles` is seeded for the synthetic orgs before the guard.
- Secrets (bootstrap + role passwords) are generated on-host with `openssl rand` into a root-only `0600` file, never printed, never committed.
- The owner runs every VM command; Claude prepares the scripts and the owner-run block and never executes provisioning on the VM.
