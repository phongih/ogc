# IIOS kernel — vendored provenance

The SQL in `kernel/sql/` is the reviewed IIOS authorization kernel (r1–r3), vendored
**byte-for-byte** into this repository as the synthetic/dev foundation for the Platform
IIOS (OGC-DEC-027 Option C; OGC-ADR-041). It is synthetic-only infrastructure: it holds
**no** real or children's data, and nothing here is the production IIOS.

The kernel test (`src/kernel.test.ts`) recomputes these hashes on every run and fails if
any vendored file drifts from the reviewed artifact.

## Vendored files (SHA-256)

| File | SHA-256 | Reviewed in |
| --- | --- | --- |
| `sql/p00_roles.sql` | `86150043b0e875ec545892e26b3ae1dca3609ea18f876744ca727f74641c0869` | r1 (AUTHZ-RUN-002) |
| `sql/p01_schema.sql` | `afd3d6cc414d8cd53244d816d58448485387c81e71bd5ed4f3a5162a4a11b137` | r1 (AUTHZ-RUN-002) |
| `sql/p02_guard.sql` | `b738ddaae27f5ab79ecb3a757afcdd5d5f3d7da7f615d6a35c436b6cfdac9d75` | r1 (AUTHZ-RUN-002) |
| `sql/p01b_r2_person.sql` | `ba7bda09b905ee6bc5f524eaa4fda393548712ae2807310ee68144270d0cd79a` | r2 (C14 / D-14) |
| `sql/p01c_r3_recovery.sql` | `fd8b921d2f5a2374693b77761c260159bf45fb356cc745a566c74bdf50e52406` | r3 (RF-1 / RF-2) |

The synthetic fixture in `src/kernel/fixture.ts` is a faithful transcription of the
reviewed harness `suite.mjs` exports (`makeFixture`, `loadFixture`, `uuid`); source
`suite.mjs` SHA-256 `5f1a49f3eb55b7d557323463c599cb389e6a2521fd0507faa3ad65f1ae8ec8dc`.

## What each file is

- **p00_roles** — role topology: `iios_owner` / `iios_app` (+ per-org login roles),
  `iios_auditor`, `iios_migrate`, `iios_scheduler`, `iios_maint`.
- **p01_schema** — sealed-principal binding (`authz.bind_principal` / `current_principal`,
  per-org HMAC keys), tenant RLS + FORCE (session role → organization via
  `iios.org_of_session()`), SECURITY DEFINER authorization functions owned by `iios_owner`.
- **p01b_r2_person** — person identity (`authz.persons`, `principal_persons`) and the
  D-14 self-verification prohibition in `authz.verify_guardian_link`
  (`AZ_SELF_VERIFY`, `AZ_IDENTITY_UNKNOWN`).
- **p01c_r3_recovery** — guardian-recovery ceremony (RF-1, dual-control) and identity
  onboarding governance (RF-2, separation of duties).
- **p02_guard** — cluster-level admission guard (role-grant lockdown, AZG7 EXECUTE
  allowlist, OB1–OB6 cluster invariants). **Not applied by the dev/test installer** — see
  below.

## Admission guard (p02) is applied elsewhere

`p02_guard.sql` encodes a production-like **cluster** invariant: OB1 requires the only
superuser to be `bootstrap`, OB5 requires every org-login role to be pre-mapped, and
AZG7 pins the exact set of EXECUTE grants to `iios_app`. A shared, managed CI cluster
(superuser `postgres`) cannot satisfy OB1, and extending AZG7 for the r3 functions is a
reviewed change in its own right. Applying and verifying the guard therefore belongs to
the Platform **provisioning** slice, where a controlled role topology exists — not to
this in-database kernel test. The guard is vendored and hash-pinned here so that slice
consumes the identical reviewed artifact.

## Prior independent evidence (isolated synthetic harness)

- r1 — sealed principal, tenant RLS, authorization reads, admission guard (p02 applied on
  a dedicated single-superuser cluster).
- r2 — C14 / D-14 person self-verification prohibition, identity fail-closed.
- r3 — RF-1 recovery dual-control + RF-2 onboarding SoD: 34/34 PASS across two identical
  runs, r1 hash unchanged, unix-socket isolation.
