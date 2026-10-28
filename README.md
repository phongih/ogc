# OGC v2 — Isolated Development Workspace

**NON-PRODUCTION.** Synthetic data and mock adapters only. Authorized under OGC-ENG-AUTH-001 / OGC-ENG-PLAN-001 Slice-1 Execution Authorization (29/10/2026).

## Boundaries (carried from the authorization)
- G2-C **NOT PASSED**; 33.S **independent review pending**; D-14 **design gap**; R-06 / R-16 **OPEN**.
- No PostgreSQL provisioning, no production/public deployment, no real learner data, no production credentials.
- **No source imported from EduOS or frozen IIOS security r1.**
- Mock authorization is explicitly **NON-PRODUCTION** and is designed to be swapped for a governed backend adapter later.
- Local git only — no remote, push, or PR.

## Layout
- `packages/contracts` — typed API contracts (zod + TS). Independent of any implementation.
- `packages/mock-authz` — NON-PRODUCTION authorization stub.
- `apps/web` — Vite + React + TS + Tailwind. Public Learning site + authenticated workspace.

## Commands
```
pnpm install
pnpm dev          # local dev server (container localhost only)
pnpm typecheck
pnpm lint
pnpm test
pnpm build        # static build, not deployed
```

## Slice-1 scope
Public Landing → Mock Login → Organization → Brand → Center → Center Detail, on synthetic fixtures via mock adapters. Database disabled.
