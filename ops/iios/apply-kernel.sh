#!/usr/bin/env bash
# apply-kernel.sh — install the vendored IIOS r2 kernel + admission guard into a
# dedicated single-superuser PostgreSQL cluster (OGC-ADR-042). Synthetic/dev only.
#
# Applies, in the reviewed order, BYTE-FOR-BYTE (no SQL modification):
#   p00_roles → p01_schema → p01b_r2_person → (seed iios.org_roles) → p02_guard
# The cluster's sole superuser must be `bootstrap` (OB1) and the two org-login roles
# must be mapped in iios.org_roles before the guard (OB5) — this script seeds them.
# r3 (p01c recovery/onboarding) is intentionally NOT applied here: the reviewed p02
# AZG7 allowlist predates r3, so it belongs to S2b under a reviewed guard extension.
#
# Forward-only and safe to re-run: each stage is skipped if already present.
#
# Connection: standard libpq env (PGHOST/PGPORT/PGUSER=bootstrap/PGPASSWORD), pointed
# at the IIOS cluster. Role passwords are read from a root-only secrets file
# ($OGC_IIOS_SECRETS); generated on first run with `openssl rand` and never printed.
#
# Usage: OGC_IIOS_SECRETS=/etc/ogc/iios-kernel.secrets \
#        PGHOST=127.0.0.1 PGPORT=5433 PGUSER=bootstrap PGPASSWORD=… \
#        apply-kernel.sh <kernel_sql_dir>
set -euo pipefail

SQLDIR=${1:?usage: apply-kernel.sh <kernel_sql_dir>}
SECRETS=${OGC_IIOS_SECRETS:?set OGC_IIOS_SECRETS to a root-only secrets file path}
for f in p00_roles p01_schema p01b_r2_person p02_guard; do
  [ -r "$SQLDIR/$f.sql" ] || { echo "missing kernel file: $SQLDIR/$f.sql" >&2; exit 2; }
done

PSQL=(psql -X -q -v ON_ERROR_STOP=1)
# Admin scalar queries connect to the always-present `postgres` database (the IIOS
# kernel DB `dak` may not exist yet, and libpq's default db would be the role name).
scalar() { "${PSQL[@]}" -d postgres -tAc "$1"; }

# 1) role passwords — generate once (append to the shared secrets file, which may already
#    hold PW_BOOTSTRAP from provision-cluster.sh). Keyed on PW_ALPHA, 0600, never echoed.
if [ ! -f "$SECRETS" ] || ! grep -q '^PW_ALPHA=' "$SECRETS" 2>/dev/null; then
  mkdir -p "$(dirname "$SECRETS")"
  ( umask 077
    {
      echo "# IIOS kernel role passwords (synthetic/dev) — generated $(date -u +%FT%TZ)"
      for r in ALPHA BETA AUDITOR MIGRATE SCHEDULER; do echo "PW_${r}=$(openssl rand -hex 24)"; done
    } >> "$SECRETS" )
  echo "apply-kernel: wrote role passwords to $SECRETS"
fi
# shellcheck disable=SC1090
. "$SECRETS"

# 2) p00 — roles + database `dak` (owner iios_owner). Skip if already provisioned.
if [ "$(scalar "select count(*) from pg_roles where rolname='iios_owner'")" = 0 ]; then
  "${PSQL[@]}" -d postgres \
    -v pw_alpha="$PW_ALPHA" -v pw_beta="$PW_BETA" -v pw_auditor="$PW_AUDITOR" \
    -v pw_migrate="$PW_MIGRATE" -v pw_scheduler="$PW_SCHEDULER" \
    -f "$SQLDIR/p00_roles.sql" >/dev/null
  echo "apply-kernel: p00 roles + db dak"
else
  echo "apply-kernel: p00 already applied (iios_owner exists) — skip"
fi

# 3) p01 + p01b — schema into `dak`. Skip if the authz schema is already present.
if [ "$(scalar "select count(*) from pg_database where datname='dak'")" != 1 ]; then
  echo "apply-kernel: database dak missing after p00 — abort" >&2; exit 3
fi
if [ "$("${PSQL[@]}" -d dak -tAc "select count(*) from information_schema.schemata where schema_name='authz'")" = 0 ]; then
  "${PSQL[@]}" -d dak -f "$SQLDIR/p01_schema.sql" >/dev/null
  "${PSQL[@]}" -d dak -f "$SQLDIR/p01b_r2_person.sql" >/dev/null
  echo "apply-kernel: p01 + p01b schema"
else
  echo "apply-kernel: authz schema already present — skip p01/p01b"
fi

# 4) seed iios.org_roles for the two synthetic orgs BEFORE the guard (OB5). The role
#    names are fixed by p00 (iios_app_o_alpha / iios_app_o_beta); org ids are synthetic.
"${PSQL[@]}" -d dak -c \
  "INSERT INTO iios.org_roles VALUES ('iios_app_o_alpha', gen_random_uuid()), ('iios_app_o_beta', gen_random_uuid()) ON CONFLICT DO NOTHING"
echo "apply-kernel: iios.org_roles seeded (alpha, beta)"

# 5) p02 admission guard — only once (it creates the `guard` schema).
if [ "$("${PSQL[@]}" -d dak -tAc "select count(*) from information_schema.schemata where schema_name='guard'")" = 0 ]; then
  "${PSQL[@]}" -d dak -f "$SQLDIR/p02_guard.sql" >/dev/null
  echo "apply-kernel: p02 admission guard applied"
else
  echo "apply-kernel: guard already applied — skip p02"
fi

echo "apply-kernel: DONE (r2 guarded kernel on this cluster)"
