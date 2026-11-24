#!/usr/bin/env bash
# verify-kernel.sh — read-only checks that the IIOS cluster is correctly hardened and
# the kernel's fail-closed guarantees hold (OGC-ADR-042). Makes no changes.
#
# Connection: bootstrap libpq env (PGHOST/PGPORT/PGUSER=bootstrap/PGPASSWORD) for the
# admin checks; the org-login password is read from $OGC_IIOS_SECRETS for the
# unprivileged fail-closed check.
#
# The full sealed-principal / RLS / C14 invariant suite runs in CI against the identical
# vendored kernel (services/iios-mock/src/kernel.test.ts, OGC-ADR-041); this script
# verifies the properties that depend on the live, guarded cluster.
set -euo pipefail

SECRETS=${OGC_IIOS_SECRETS:?set OGC_IIOS_SECRETS}
# shellcheck disable=SC1090
. "$SECRETS"
PSQL=(psql -X -q -v ON_ERROR_STOP=1)
fail=0
ok()   { echo "PASS  $1"; }
bad()  { echo "FAIL  $1"; fail=1; }

# 1) OB1 — the cluster's sole superuser is `bootstrap`
supers=$("${PSQL[@]}" -d postgres -tAc "select string_agg(rolname, ',' order by rolname) from pg_roles where rolsuper")
[ "$supers" = bootstrap ] && ok "sole superuser = bootstrap" || bad "superusers = '$supers' (want bootstrap)"

# 2) admission guard installed (guard schema + its event trigger)
g=$("${PSQL[@]}" -d dak -tAc "select count(*) from information_schema.schemata where schema_name='guard'")
[ "$g" = 1 ] && ok "admission guard schema present" || bad "guard schema missing"
et=$("${PSQL[@]}" -d dak -tAc "select count(*) from pg_event_trigger")
[ "$et" -ge 1 ] && ok "event trigger(s) present ($et)" || bad "no event triggers"

# 3) every org-login role is mapped (OB5 precondition, still true post-guard)
unmapped=$("${PSQL[@]}" -d dak -tAc "select count(*) from pg_roles r where r.rolname like 'iios\\_app\\_o\\_%' and not exists (select 1 from iios.org_roles o where o.role_name = r.rolname)")
[ "$unmapped" = 0 ] && ok "all org-login roles mapped in iios.org_roles" || bad "$unmapped org-login role(s) unmapped"

# 4) guard is live — a non-bootstrap role cannot create objects in public
evil=$(PGUSER=iios_app_o_alpha PGPASSWORD="$PW_ALPHA" "${PSQL[@]}" -d dak -tAc "CREATE TABLE public.verify_evil(x int)" 2>&1 || true)
echo "$evil" | grep -qiE "permission denied" && ok "non-bootstrap DDL on public denied" || bad "DDL not denied: $evil"

# 5) fail-closed — the sealed-principal gate rejects an unbound session (data-independent:
#    an empty learner table would not exercise the row policy, so probe the gate directly).
np=$(PGUSER=iios_app_o_alpha PGPASSWORD="$PW_ALPHA" "${PSQL[@]}" -d dak -tAc "select authz.current_principal()" 2>&1 || true)
echo "$np" | grep -q "AZ_NO_PRINCIPAL" && ok "unbound session fails closed (AZ_NO_PRINCIPAL)" || bad "gate not fail-closed: $np"

echo
[ "$fail" = 0 ] && echo "verify-kernel: ALL CHECKS PASS" || { echo "verify-kernel: FAILURES PRESENT"; exit 1; }
