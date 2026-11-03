#!/usr/bin/env bash
# B-2 — Independent artifact integrity verification against a SHA-256 manifest.
# Usage: verify-artifact.sh <dist_dir> <manifest>
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

dist="${1:-}"; man="${2:-}"
[[ -n "$dist" && -n "$man" ]] || die "usage: verify-artifact.sh <dist_dir> <manifest>"
assert_safe_abs "$dist"
[[ -d "$dist" ]] || die "dist not found: $dist"
[[ -f "$man" ]] || die "manifest not found: $man"
node "$HERE/verify-artifact.mjs" "$dist" "$man"
