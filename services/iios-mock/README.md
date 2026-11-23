# Mock IIOS (`@ogc/iios-mock`)

A dev / staging stand-in for IIOS (ADR-040 §3.3), synthetic principals only. It refuses `NODE_ENV=production`.

- **Grants**: it issues sealed grants with a dev key (`/v1/dev/grants`) and resolves a presented grant to a decided state and context (`/v1/grants/resolve`), with `orgAdmin` and `narrowing`. It can also revoke a grant.
- **Access policies** (OGC-ADR-039 option C): IIOS stores and decides. The `/v1/admin/*` endpoints take the caller's grant, open it, decide whether the caller is an admin from IIOS's own member data, and apply the demo's rules (`src/policies.ts`).
- **Storage**: with `IIOS_MOCK_DATABASE_URL` set (VM 2), policies, attachments and their append-only history live in the mock IIOS's own PostgreSQL database. It migrates (`migrations/`, forward-only, SHA-256) and adds any missing seed policies on start, so they survive restarts; the OGC API's roles have no access to that database. Without the variable, policies are kept in memory and reset on every start.
- **Auth**: every endpoint needs the client secret (`Authorization: Bearer <IIOS_MOCK_CLIENT_SECRET>`).

Environment variables: `IIOS_MOCK_KEY` (base64, ≥ 32 bytes), `IIOS_MOCK_CLIENT_SECRET`, `IIOS_MOCK_CLIENT_ID` (default `ogc`), `IIOS_MOCK_DATABASE_URL` (optional), `HOST`, `PORT` (default 8790).
