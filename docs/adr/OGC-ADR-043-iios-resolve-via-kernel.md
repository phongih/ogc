# OGC-ADR-043 — Resolve grants through the IIOS kernel (S3)

- **Status:** Proposed — owner approved the direction (Option A). Each sub-slice is its own PR, CI-gated; the owner approves every merge and runs every VM command.
- **Date:** 25/11/2026
- **Decides:** the owner. IIOS decides everything named as IIOS's (OGC-DEC-027 Option C).
- **Builds on:** OGC-ADR-042 (the guarded kernel cluster on VM2, S2a), OGC-ADR-041 (vendored kernel), OGC-IIOS-001 (grant contract).

> **Non-claims.** Synthetic/dev only — no real or children's data, dev keys. The OGC-facing `resolve` contract (`IiosContextResolution` / `IiosGrantedContext`) does not change. G2-C not passed, 33.S pending, D-14 a gate, 009B HELD.

## 1. Decision (Option A)

Make the IIOS kernel on VM2 the authority for **identity, role and orgAdmin** behind `iios-mock`'s `resolve`, while **narrowing stays** in the mock policy store for now (the kernel has no narrowing model — that is OGC-ADR-039's construct, migrated in a later slice). The grant token stays the OGC↔IIOS carrier; OGC's logic is unchanged.

## 2. What the kernel exposes, and the resolve derivation

An org session (`iios_app_o_<org>`) may read the authorization metadata tables — `staff_center_grants`, `class_assignments`, `guardian_links`, `consents` — scoped to its own organization by the `org_sel` RLS policy, **without binding a principal**. From these, resolve derives, unbound:

- **orgAdmin** = the principal holds an active `org.admin` grant in `staff_center_grants`.
- **role** = `staff` (appears in `staff_center_grants`), else `teacher` (`class_assignments`), else `guardian` (`guardian_links`).

Two facts constrain the design and are reused, not fought:

- **`authz.principals` and the learner tables (`app.learners`, `app.enrollments`) are not readable by an org session** — `principals` is not granted to `iios_app`, and the learner tables carry a RESTRICTIVE policy that fails closed without a bound principal. So **learner identity and the bind-confirmed type require a bind**, which `iios-mock` performs because it holds the org signing key (it is the IIOS authority).
- **`bind_principal` verifies the claimed (type, id) against `authz.principals`** (step 7 → `AZ_BIND_PRINCIPAL`). A successful bind is therefore the kernel confirming the principal exists with that type — the real per-request identity check.

The mock↔kernel id bridge is a deterministic `uuidv5(name)` over a fixed namespace (`ops/iios/gen-seed.mjs`), so the seed and the runtime agree without a lookup table.

## 3. Sub-slices

- **S3a (this slice).** Seed the synthetic directory into the kernel and prove the unbound derivation. `ops/iios/gen-seed.mjs` → `ops/iios/seed-synthetic.sql` (principals, grants, catalog, centers, classes, org mapping), applied by `ops/iios/seed-kernel.sh` as bootstrap. `services/iios-mock/src/seed.test.ts` (CI) asserts orgAdmin + staff/teacher/guardian derivation and tenant isolation, and documents that learner identity comes via bind in S3b.
- **S3b.** A kernel client in `iios-mock`: per-org connection to the cluster (`iios_app_o_<org>`), the unbound derivation above, plus a bind (using the org key) to confirm identity and resolve learners.
- **S3c.** Rewire `/v1/grants/resolve` to source role + orgAdmin from the kernel (behind a config flag such as `OGC_IIOS_KERNEL_URL`); narrowing stays from the mock store; `resolve` contract unchanged; vitest coverage.

## 4. Boundaries

- Reviewed kernel SQL unchanged. The directory seed is synthetic data applied as bootstrap; it is idempotent and regenerated from `services/iios-mock/src/seed.ts`.
- The org signing key that `iios-mock` will hold (S3b) is a per-deployment dev secret, generated on-host and stored root-only — never committed.
- No production cluster, no `iios_mock` service change in S3a, no real or children's data.
