#!/usr/bin/env bash
# B-5 — Verified rollback. Atomically repoints <release_root>/current back to a prior
# release (an explicit sha, or the recorded <release_root>/.previous) and prints before/
# after evidence. Fail-closed if the target release is missing. Refuses the live VM root
# unless OGC_LIVE=1.
#
# Usage: rollback.sh <release_root> [40-hex-sha]
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

root="${1:-}"; sha="${2:-}"
[[ -n "$root" ]] || die "usage: rollback.sh <release_root> [sha]"
assert_safe_abs "$root"
assert_not_live "$root"

cur="$root/current"
before="none"
[[ -L "$cur" ]] && before="$(basename "$(readlink "$cur")")"

if [[ -z "$sha" ]]; then
  [[ -f "$root/.previous" ]] || die "no rollback target: pass <sha> or ensure $root/.previous exists"
  sha="$(tr -d '[:space:]' < "$root/.previous")"
fi
assert_full_sha "$sha"
reldir="releases/$sha"
[[ -d "$root/$reldir" ]] || die "rollback target release missing: $root/$reldir"

tmp="$root/.current.tmp.$$"
rm -f "$tmp"
ln -s "$reldir" "$tmp"
mv -T "$tmp" "$cur"

after="$(basename "$(readlink "$cur")")"
[[ "$after" == "$sha" ]] || die "rollback verify failed: current -> $after (want $sha)"
log "rolled back OK"
printf 'before=%s after=%s\n' "$before" "$after"
