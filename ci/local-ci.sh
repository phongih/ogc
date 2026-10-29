#!/usr/bin/env bash
# OGC v2 local CI — NON-PRODUCTION, no deployment, no network beyond the package registry.
# Runs the same gates a CI runner would: typecheck, lint, tests, build.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== install (frozen lockfile) =="
pnpm install --frozen-lockfile

echo "== typecheck =="
pnpm -r --if-present typecheck

echo "== lint =="
pnpm lint

echo "== test =="
pnpm --filter @ogc/web test

echo "== build =="
pnpm --filter @ogc/web build

echo "OGC v2 local CI: all gates passed."
