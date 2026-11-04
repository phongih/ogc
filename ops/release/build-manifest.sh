#!/usr/bin/env bash
# B-2 — Reproducible synthetic SPA build + SHA-256 asset manifest.
# Builds apps/web with the mock adapter ONLY (rejects any other build mode) and writes a
# manifest of every dist asset's sha256/size.
#
# Usage: build-manifest.sh <src_root> <manifest_out>
# Env:   OGC_BUILD_MODE (default mock; anything else is rejected), OGC_SHA (override sha)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

src="${1:-}"; out="${2:-}"
[[ -n "$src" && -n "$out" ]] || die "usage: build-manifest.sh <src_root> <manifest_out>"
assert_safe_abs "$src"
[[ -f "$src/package.json" ]] || die "not a project root (no package.json): $src"

mode="${OGC_BUILD_MODE:-mock}"
[[ "$mode" == "mock" ]] || die "unexpected build mode '$mode' — only 'mock' is allowed for the synthetic public demo"

if [[ -n "${OGC_SHA:-}" ]]; then
  sha="$OGC_SHA"
elif [[ -f "$src/.release-sha" ]]; then
  sha="$(tr -d '[:space:]' < "$src/.release-sha")"
elif [[ -d "$src/.git" ]]; then
  sha="$(git -C "$src" rev-parse HEAD)"
else
  die "cannot determine release sha (set OGC_SHA, or provide .release-sha / .git in $src)"
fi
assert_full_sha "$sha"

export COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=true
# Use the repo-pinned package manager (package.json "packageManager") via corepack, so the
# build reproduces regardless of the host's default pnpm. Fail clearly when unavailable.
if command -v corepack >/dev/null 2>&1; then
  PNPM=(corepack pnpm)
elif command -v pnpm >/dev/null 2>&1; then
  log "WARNING: corepack not found — using host pnpm $(pnpm --version); build may not match the pinned toolchain"
  PNPM=(pnpm)
else
  die "no pnpm toolchain available (install corepack, or pnpm matching package.json packageManager)"
fi
if [[ ! -d "$src/node_modules" ]]; then
  log "installing dependencies (frozen lockfile) via ${PNPM[*]}"
  ( cd "$src" && "${PNPM[@]}" install --frozen-lockfile >&2 )
fi
log "building synthetic SPA (mock adapter) at $sha"
( cd "$src" && VITE_CATALOG_ADAPTER=mock "${PNPM[@]}" --filter @ogc/web build >&2 )

dist="$src/apps/web/dist"
[[ -f "$dist/index.html" ]] || die "build produced no $dist/index.html"
mkdir -p "$(dirname "$out")"   # ensure the manifest's parent directory exists
node "$HERE/make-manifest.mjs" "$dist" "$sha" "$mode" "$out"
log "manifest written: $out (sha $sha)"
