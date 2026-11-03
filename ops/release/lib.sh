#!/usr/bin/env bash
# Shared fail-closed helpers for the OGC release toolkit. Source this; do not execute it.
# NON-PRODUCTION: synthetic SPA release tooling. No secrets, no production credentials.
set -euo pipefail

log() { printf '[release] %s\n' "$*" >&2; }
die() { printf '[release][ERROR] %s\n' "$*" >&2; exit 1; }

# Reject empty, relative, root, or paths containing a ".." segment (fail-closed).
assert_safe_abs() {
  local p="${1:-}"
  [[ -n "$p" ]] || die "empty path"
  [[ "$p" = /* ]] || die "path must be absolute: $p"
  case "/$p/" in
    */../*) die "path contains '..': $p" ;;
  esac
  [[ "$p" != "/" ]] || die "refusing to operate on '/'"
}

# A full 40-hex git commit id, nothing else.
assert_full_sha() {
  local s="${1:-}"
  [[ "$s" =~ ^[0-9a-f]{40}$ ]] || die "expected a full 40-hex commit id, got: '${s}'"
}

# The real production release root on the VM. The promotion/rollback scripts refuse to
# touch it unless OGC_LIVE=1 is set explicitly by an operator ON the VM — never in dev,
# CI or tests. This enforces AUTH-017: do not run promote/rollback against the real VM.
OGC_LIVE_ROOT="/var/www/ogc"
assert_not_live() {
  local root resolved
  root="${1:-}"
  resolved="$(readlink -f "$root" 2>/dev/null || printf '%s' "$root")"
  if [[ "$resolved" == "$OGC_LIVE_ROOT" ]]; then
    [[ "${OGC_LIVE:-0}" == "1" ]] || die "refusing to operate on live root $OGC_LIVE_ROOT without OGC_LIVE=1 (live promotion is an explicit, owner-approved step on the VM)"
  fi
}
