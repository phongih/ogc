# OGC-ADR-041 — The real IIOS kernel on the Platform (synthetic/dev)

- **Status:** Proposed — direction set by the owner (build the real IIOS, reuse the r1–r3 PostgreSQL kernel). Each slice is its own PR, CI-gated; the owner approves every merge.
- **Date:** 24/11/2026
- **Decides:** the owner approves the direction and each slice. IIOS decides everything named as IIOS's (OGC-DEC-027 Option C, OGC-IIOS-001).
- **Builds on:** OGC-ADR-040 (Demo/Platform split), OGC-DEC-027 (OGC consumes IIOS decisions; IIOS is the sole identity/authz authority), OGC-IIOS-001 (grant contract), and the reviewed IIOS kernel r1–r3.

> **Non-claims.** Nothing here makes OGC production-ready, secure or compliant. This replaces a mock signer with the real authorization kernel **running on synthetic data with dev-signed keys**. G2-C is NOT PASSED, the 33.S independent review is pending, D-14 remains a gate, 009B is HELD. Real learner / children's data stays out of every environment until the owner opens those gates with separate authorization. No production IIOS, PostgreSQL, EduOS or IIOS security source is touched; the kernel SQL is reused verbatim, never modified.

## 1. Decision

Replace the stand-in signer (`services/iios-mock`, a dev-HMAC token issuer) with the **real IIOS authorization kernel** — the reviewed r1–r3 PostgreSQL kernel — running on the Platform against **synthetic principals and dev-signed keys**. The kernel is vendored into this repository byte-for-byte (`services/iios-mock/kernel/`, hashes in `PROVENANCE.md`) and installed into PostgreSQL as privileged DDL. OGC stays a read-only consumer of IIOS decisions (Option C): it never writes `authz.*` relations and never verifies guardians.

The kernel is the same artifact independently evidenced in the isolated harness (r1 sealed principal + tenant RLS + admission guard; r2 C14/D-14; r3 RF-1/RF-2, 34/34 ×2). Vendoring + CI re-proof brings that kernel under this repo's branch-and-CI discipline.

## 2. Why reuse r1–r3 rather than build anew

The r1–r3 kernel already encodes, and has been reviewed for, the properties OGC's learners (including children) depend on: a sealed principal that cannot be forged or replayed, per-organization tenant isolation that fails closed, D-14 guardian self-verification prohibition, and dual-control recovery. Re-deriving these would discard that review. Reuse keeps the trust root exactly where OGC-DEC-027 placed it.

## 3. Slice sequence

Each slice is one PR; the owner approves each merge; Claude prepares an owner-run deploy block and never promotes on a VM.

| Slice | Scope | Deployment decision |
| --- | --- | --- |
| **S1** (this PR) | Vendor r1–r3 kernel SQL + synthetic fixture into the repo; CI stands it up in a throwaway PostgreSQL and proves the in-database invariants. No live wiring. | none |
| **S2** | Provision `iios_owner` / `iios_app` role topology for the Platform IIOS database; run the kernel as migrations; apply + verify the admission guard (p02) where OB1–OB6 can hold. | needs the org-model choice (below) |
| **S3** | `iios-mock` issues/resolves grants through the kernel (`bind_principal` / `current_principal`), replacing the dev-HMAC `token.ts`. OGC's `resolve` contract is unchanged. | owner-run deploy |
| **S4** | Expose guardian verify (C14) and recovery (RF-1 / RF-2) via an admin API. | owner-run deploy |
| **S5** | Consent + audit wiring; reconcile the policy store with the kernel. | owner-run deploy |

## 4. S1 scope and boundaries

**S1 proves**, in CI, on a throwaway database created and dropped per run:

- **Provenance** — the vendored SQL is byte-identical to the reviewed kernel (hash gate).
- **Sealed principal** — a valid bind resolves to the bound identity; a forged MAC is rejected (`AZ_BIND_MAC`); an absent bind is rejected (`AZ_NO_PRINCIPAL`).
- **Fail-closed reads** — learner tables are unreadable without a bound principal.
- **Authorization read** — a bound teacher sees only its assigned learners; no cross-tenant rows appear.
- **Tenant anchor** — each session role maps to exactly one organization.
- **D-14 / C14** — guardian self-verification by the same natural person is prohibited (`AZ_SELF_VERIFY`); unknown identity fails closed (`AZ_IDENTITY_UNKNOWN`); a different natural person may verify; identity tables are owner-only at runtime.

**S1 deliberately does not:**

- **Apply the cluster admission guard (p02).** Its OB1 check requires the only superuser to be `bootstrap`, which a managed CI cluster (superuser `postgres`) cannot satisfy, and extending its AZG7 allowlist for the r3 functions is a reviewed change. Guard application + verification is S2, on a provisioned cluster where its preconditions hold. p02 is still vendored and hash-pinned so S2 consumes the identical artifact.
- Touch any live environment, production IIOS, or real data. The installer is dev/test-only and names its two documented deviations from the reviewed `p00_roles.sql` (role creation is parameterised and idempotent; the throwaway database replaces `dak`).

## 5. Open question for S2 (not decided here)

The kernel anchors tenancy on `session_user` → organization (`iios.org_of_session()` via `iios.org_roles`), i.e. one PostgreSQL login role per organization. The Platform must decide whether to adopt that role-per-org model directly or map organization through a session GUC at the application boundary. This is an S2 decision and is called out there for the owner.
