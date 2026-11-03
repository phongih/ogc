#!/usr/bin/env bash
# B-5 — Atomic symlink promotion. Points <release_root>/current at releases/<sha> using a
# temporary symlink + atomic rename within the SAME directory (rename(2)). Records the
# previously-live sha for rollback and never deletes release dirs (previous is preserved).
# Refuses the live VM root unless OGC_LIVE=1 (set only by an operator on the VM).
#
# Usage: promote.sh <release_root> <40-hex-sha>
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

root="${1:-}"; sha="${2:-}"
[[ -n "$root" && -n "$sha" ]] || die "usage: promote.sh <release_root> <sha>"
assert_safe_abs "$root"
assert_full_sha "$sha"
assert_not_live "$root"

reldir="releases/$sha"
absdir="$root/$reldir"
[[ -d "$absdir" ]] || die "release dir not found: $absdir (build + place the release before promoting)"
[[ -n "$(ls -A "$absdir")" ]] || die "release dir is empty: $absdir"

mkdir -p "$root"
cur="$root/current"
# Record the rollback target (whatever is live now), if any. Release dirs are never deleted.
if [[ -L "$cur" ]]; then
  prev_sha="$(basename "$(readlink "$cur")")"
  printf '%s\n' "$prev_sha" > "$root/.previous"
  log "recorded rollback target: $prev_sha"
fi

# Atomic swap: temp symlink in the same dir, then rename over current.
tmp="$root/.current.tmp.$$"
rm -f "$tmp"
ln -s "$reldir" "$tmp"
mv -T "$tmp" "$cur"

got="$(readlink "$cur")"
[[ "$got" == "$reldir" ]] || die "promotion verify failed: current -> $got (want $reldir)"
log "promoted: current -> $reldir"
printf '%s\n' "$sha"
