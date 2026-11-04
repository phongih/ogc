#!/usr/bin/env bash
# B-6 — Preflight release orchestrator. Composes the existing toolkit end-to-end into one
# reproducible command: checkout → build+manifest → verify-artifact → smoke (non-fatal) →
# place the release + write a release-record.json.
#
# It does NOT promote: swapping the live symlink stays a separate, owner-gated step
# (promote.sh). This never touches /var/www/ogc/current and refuses the live root.
#
# Usage: make-release.sh <repo_dir> <40-hex-sha> <stage_root>
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

repo="${1:-}"; sha="${2:-}"; stage="${3:-}"
[[ -n "$repo" && -n "$sha" && -n "$stage" ]] || die "usage: make-release.sh <repo_dir> <sha> <stage_root>"
assert_safe_abs "$repo"
assert_safe_abs "$stage"
assert_full_sha "$sha"
assert_not_live "$stage"   # a preflight stage is never the live root

work="$stage/work/$sha"
reldir="$stage/releases/$sha"
manifest="$stage/manifests/$sha.json"
record="$reldir/release-record.json"
mkdir -p "$stage/manifests"

log "1/5 checkout"      ; "$HERE/release-checkout.sh" "$repo" "$sha" "$work" >/dev/null
log "2/5 build+manifest"; "$HERE/build-manifest.sh"   "$work" "$manifest" >&2
log "3/5 verify"        ; "$HERE/verify-artifact.sh"  "$work/apps/web/dist" "$manifest" >&2
log "4/5 smoke"         ; node "$HERE/smoke-routes.mjs" "$work/apps/web/dist" >&2 || log "smoke skipped/failed (non-fatal in preflight)"
log "5/5 place release" ; mkdir -p "$reldir" && cp -a "$work/apps/web/dist/." "$reldir/"

node -e '
  const { createHash } = require("node:crypto");
  const { readFileSync, writeFileSync } = require("node:fs");
  const [sha, manifestPath, record] = process.argv.slice(1);
  const manifest = readFileSync(manifestPath);
  const rec = {
    schema: "ogc-release-record/1",
    sha,
    manifest: manifestPath,
    manifestSha256: createHash("sha256").update(manifest).digest("hex"),
    assetCount: JSON.parse(manifest).assets.length,
    placedAt: new Date().toISOString(),
    promoted: false,
    note: "preflight only — live symlink NOT changed; promotion is a separate gated step",
  };
  writeFileSync(record, JSON.stringify(rec, null, 2) + "\n");
' "$sha" "$manifest" "$record"

log "release candidate prepared: $reldir (NOT promoted). record: $record"
printf '%s\n' "$sha"
