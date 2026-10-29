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

echo "== test (unit + component + accessibility/axe) =="
pnpm --filter @ogc/web test

echo "== build =="
pnpm --filter @ogc/web build

# E2E is run "where supported": it needs a pre-installed Playwright + Chromium.
# No browser download and no external network are attempted; if Playwright is not
# resolvable, the E2E gate is skipped (not failed) so the core gates stay portable.
echo "== e2e (Playwright smoke, if available) =="
if node -e "require.resolve('playwright')" >/dev/null 2>&1 \
  || node -e "require('module').createRequire('/opt/npm-tools/node_modules/').resolve('playwright')" >/dev/null 2>&1; then
  node e2e/smoke.mjs
else
  echo "   Playwright not available in this environment — skipping E2E (core gates unaffected)."
fi

echo "OGC v2 local CI: all gates passed."
