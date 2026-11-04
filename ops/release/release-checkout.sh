#!/usr/bin/env bash
# B-1 — Non-destructive, SHA-pinned checkout.
# Produces a clean, self-contained snapshot of the source tree at an exact commit using
# `git archive` (reads only; never touches the source repo's working tree — no reset,
# no in-place checkout). Writes a .release-sha provenance file.
#
# Usage: release-checkout.sh <repo_dir> <40-hex-sha> <dest_dir>
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

repo="${1:-}"; sha="${2:-}"; dest="${3:-}"
[[ -n "$repo" && -n "$sha" && -n "$dest" ]] || die "usage: release-checkout.sh <repo_dir> <sha> <dest_dir>"
assert_safe_abs "$repo"
assert_safe_abs "$dest"
assert_full_sha "$sha"
[[ -d "$repo/.git" ]] || die "not a git repository: $repo"
git -C "$repo" cat-file -e "${sha}^{commit}" 2>/dev/null || die "commit not found in repo: $sha"
[[ ! -e "$dest" ]] || die "dest already exists (refusing to overwrite): $dest"

mkdir -p "$dest"
# Snapshot the exact tree. Pipefail makes a failure in archive OR tar abort the script.
git -C "$repo" archive --format=tar "$sha" | tar -x -C "$dest"
[[ -f "$dest/package.json" ]] || die "snapshot missing package.json — invalid checkout at $sha"
printf '%s\n' "$sha" > "$dest/.release-sha"
log "checked out $sha -> $dest (git-archive snapshot; source repo working tree untouched)"
printf '%s\n' "$sha"
