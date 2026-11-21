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

# Build the backend FIRST: the web conformance suite spawns the built server to run
# the shared CatalogPort cases against the real localhost HTTP backend.
echo "== build: catalog-api backend =="
pnpm --filter @ogc/catalog-api build

echo "== test: web (unit + component + a11y + CatalogPort conformance mock+http) =="
pnpm --filter @ogc/web test

echo "== test: catalog-api backend (contract + negative + leakage + throttle) =="
pnpm --filter @ogc/catalog-api test

echo "== build: web =="
pnpm --filter @ogc/web build

echo "== test: release toolkit (ops/release) =="
node ops/release/test/release.test.mjs

# E2E needs the pre-installed Playwright + Chromium. If unavailable the E2E gates are
# skipped (reported NOT RUN) so core gates stay portable; no browser download, no
# external network. Full acceptance requires these to EXECUTE.
if node -e "require('module').createRequire('/opt/npm-tools/node_modules/').resolve('playwright')" >/dev/null 2>&1 \
  || node -e "require.resolve('playwright')" >/dev/null 2>&1; then
  echo "== e2e: smoke (mock adapters) =="
  node e2e/smoke.mjs
  echo "== e2e: catalog HTTP adapter (browser → adapter → local backend) =="
  node e2e/catalog-http.mjs
  echo "== e2e: practice + speaking + attendance + operations + make-up + center-setup journeys (cross-role, mock) =="
  node e2e/practice-journey.mjs
  node e2e/speaking-journey.mjs
  node e2e/attendance-journey.mjs
  node e2e/operations-journey.mjs
  node e2e/makeup-journey.mjs
  node e2e/center-setup-journey.mjs
else
  echo "== e2e: NOT RUN — Playwright unavailable (core gates unaffected) =="
fi

echo "OGC v2 local CI: all gates passed."
