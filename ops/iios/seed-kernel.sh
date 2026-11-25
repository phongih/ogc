#!/usr/bin/env bash
# seed-kernel.sh — apply the synthetic directory (seed-synthetic.sql) to the IIOS kernel
# cluster as bootstrap (superuser bypasses RLS). Idempotent. Synthetic/dev only (S3a).
#
# seed-synthetic.sql is generated from the mock directory by gen-seed.mjs; regenerate with
#   node ops/iios/gen-seed.mjs > ops/iios/seed-synthetic.sql
# whenever services/iios-mock/src/seed.ts changes.
#
# Connection: bootstrap libpq env (PGHOST/PGPORT/PGUSER=bootstrap/PGPASSWORD), pointed at
# the IIOS cluster (see ops/iios/apply-kernel.sh).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
[ -r "$HERE/seed-synthetic.sql" ] || { echo "missing $HERE/seed-synthetic.sql" >&2; exit 2; }
psql -X -q -v ON_ERROR_STOP=1 -d dak -f "$HERE/seed-synthetic.sql"
echo "seed-kernel: synthetic directory applied to dak"
