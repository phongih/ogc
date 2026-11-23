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

# Platform backend (ADR-040). Needs a PostgreSQL superuser URL in OGC_TEST_PG_ADMIN_URL; without
# it the database tests are skipped here (reported) — they always run in GitHub CI.
echo "== test + build: iios-mock, api (Platform, ADR-040) =="
pnpm --filter @ogc/iios-mock test
[ -n "${OGC_TEST_PG_ADMIN_URL:-}" ] || echo "   NOTE: OGC_TEST_PG_ADMIN_URL not set — database tests SKIPPED locally"
pnpm --filter @ogc/api test
pnpm --filter @ogc/iios-mock build
pnpm --filter @ogc/api build

echo "== build: web (demo + Platform) and the bundle guard (ADR-040 §5) =="
pnpm --filter @ogc/web build
pnpm --filter @ogc/web build:platform
node ops/release/check-bundle.mjs demo apps/web/dist
node ops/release/check-bundle.mjs platform apps/web/dist-platform

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
  node e2e/persistence-journey.mjs
  node e2e/engine-journey.mjs
  node e2e/access-journey.mjs
  node e2e/gamification-journey.mjs
  node e2e/growth-journey.mjs
  node e2e/billing-journey.mjs
  node e2e/admissions-journey.mjs
  node e2e/students-journey.mjs
  node e2e/workforce-journey.mjs
  node e2e/forecast-journey.mjs
  node e2e/partners-journey.mjs
  node e2e/studio-journey.mjs
  if [ -n "${OGC_TEST_PG_ADMIN_URL:-}" ]; then
    echo "== e2e: Platform (browser → /v1 → API → mock IIOS + PostgreSQL) =="
    node e2e/platform-journey.mjs
    node e2e/platform-makeup-journey.mjs
  else
    echo "== e2e: Platform NOT RUN — OGC_TEST_PG_ADMIN_URL not set =="
  fi
else
  echo "== e2e: NOT RUN — Playwright unavailable (core gates unaffected) =="
fi

echo "OGC v2 local CI: all gates passed."
