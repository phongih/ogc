import { afterAll, beforeAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { httpCatalog } from "../lib/adapters/httpCatalog";
import { organizations } from "../fixtures/directory";
import { runCatalogConformance } from "./catalogConformance";

// Exercises httpCatalog against the ACTUAL localhost backend (not a mock). The built
// @ogc/catalog-api server is spawned on a dedicated local port; httpCatalog is pointed
// at it via the runtime config hook. Requires `pnpm --filter @ogc/catalog-api build`
// (local CI builds it before the web tests).
const PORT = 8788;
const BASE = `http://127.0.0.1:${PORT}/api/v1`;
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const serverEntry = join(repoRoot, "services/catalog-api/dist/main.js");

let proc: ChildProcess | undefined;

beforeAll(async () => {
  if (!existsSync(serverEntry)) {
    throw new Error(`catalog-api not built at ${serverEntry} — run: pnpm --filter @ogc/catalog-api build`);
  }
  proc = spawn("node", [serverEntry], {
    env: { ...process.env, OGC_CATALOG_PORT: String(PORT) },
    stdio: "ignore",
  });
  (globalThis as unknown as { __OGC_CATALOG__?: { base: string } }).__OGC_CATALOG__ = { base: BASE };
  const end = Date.now() + 8000;
  while (Date.now() < end) {
    try {
      const r = await fetch(`${BASE}/public/orgs/nova-learning/courses`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("catalog-api did not become ready");
}, 15000);

afterAll(() => {
  proc?.kill("SIGTERM");
  delete (globalThis as unknown as { __OGC_CATALOG__?: unknown }).__OGC_CATALOG__;
});

// http fixtures: Nova has e04 unpublished → exercises the published-only invariant.
runCatalogConformance({
  name: "httpCatalog (real backend)",
  port: httpCatalog,
  knownOrgId: organizations[0].id, // Nova → slug nova-learning
  otherKnownOrgId: organizations[1].id, // Lumen → slug lumen-edu
  unknownOrgId: "00000000-0000-4000-8000-0000000unkn0",
  unpublishedCourseId: "00000000-0000-4000-8000-000000000e04",
});
