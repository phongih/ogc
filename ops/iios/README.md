# IIOS Platform cluster (S2a) — synthetic/dev

Stands up the **real IIOS authorization kernel** (reviewed r2 config, with the admission
guard) as a dedicated PostgreSQL cluster on VM2, using the kernel SQL vendored in S1
(`services/iios-mock/kernel/sql/`, hashes in `kernel/PROVENANCE.md`). See **OGC-ADR-042**
for the decision and **OGC-ADR-041** for the kernel vendoring.

Synthetic/dev only: no real or children's data, dev-signed keys. OGC stays a read-only
consumer of IIOS decisions (OGC-DEC-027 Option C).

## Why a separate cluster

The admission guard `p02` requires (OB1) the cluster's **only** superuser to be
`bootstrap`. The main Platform cluster's sole superuser is `postgres`, which also
administers the `ogc` application database — it cannot be demoted. So IIOS gets its own
PostgreSQL 16 cluster on the same host, isolated by data directory and port (5433), with
`bootstrap` as the sole superuser. There the reviewed guard applies **green, byte-for-byte**.

## Scope of S2a

Installs the **r2 guarded kernel**: `p00` (roles + database `dak`) → `p01` (sealed
principal + tenant RLS) → `p01b` (person identity + D-14 self-verification) → **`p02`
admission guard**. The two synthetic org-login roles are mapped in `iios.org_roles`
before the guard (OB5).

**Not in S2a:** `p01c` (r3 recovery/onboarding). The reviewed `p02` AZG7 allowlist
predates r3, so r3-under-guard is a separate slice (**S2b**) with a reviewed guard
extension. Wiring `iios-mock` to issue grants through this kernel is **S3**.

## Scripts

All run as **root on VM2**. Secrets (bootstrap + role passwords) are generated with
`openssl rand` into a root-only `0600` file and never printed.

| Script | What it does | Idempotent |
| --- | --- | --- |
| `provision-cluster.sh` | initdb a 2nd PG16 cluster (sole superuser `bootstrap`, port 5433, localhost+scram), install the `ogc-iios-pg` systemd unit, start it | yes (skips initdb if present) |
| `apply-kernel.sh <sqldir>` | apply `p00/p01/p01b`, seed `iios.org_roles`, apply `p02` | yes (skips applied stages) |
| `verify-kernel.sh` | read-only checks: sole superuser, guard live, org mapping, non-bootstrap DDL denied, unbound session fails closed | read-only |

Tunables are environment variables documented at the top of each script (defaults target
VM2). `OGC_IIOS_NO_SYSTEMD=1` starts via `pg_ctl` instead of systemd (used by the local
end-to-end test).

## Owner-run block (VM2)

```bash
sudo -s
export REL=/opt/ogc-platform/current           # or a specific release snapshot
export SQLDIR="$REL/services/iios-mock/kernel/sql"
export OGC_IIOS_SECRETS=/etc/ogc/iios-kernel.secrets
cd "$REL/ops/iios"

# 1) provision the dedicated IIOS cluster (sole superuser bootstrap, port 5433)
bash provision-cluster.sh
# phải ra: provision: IIOS cluster up on 127.0.0.1:5433 (sole superuser bootstrap)

# 2) apply the guarded r2 kernel
PWB=$(. "$OGC_IIOS_SECRETS"; printf '%s' "$PW_BOOTSTRAP")
PGHOST=127.0.0.1 PGPORT=5433 PGUSER=bootstrap PGPASSWORD="$PWB" \
  bash apply-kernel.sh "$SQLDIR"
# phải ra: apply-kernel: DONE (r2 guarded kernel on this cluster)

# 3) verify (read-only)
PGHOST=127.0.0.1 PGPORT=5433 PGUSER=bootstrap PGPASSWORD="$PWB" \
  bash verify-kernel.sh
# phải ra: verify-kernel: ALL CHECKS PASS
```

Nothing above touches the main `postgres`/`ogc` cluster or the running `iios-mock`
service. The kernel holds only synthetic data.

## Verification

CI proves the kernel's sealed-principal / RLS / C14 invariants against the identical
vendored SQL (`services/iios-mock/src/kernel.test.ts`, OGC-ADR-041). It cannot host a
single-superuser `bootstrap` cluster, so the **guard** and the on-cluster properties are
verified by `verify-kernel.sh` against the live IIOS cluster after provisioning.
