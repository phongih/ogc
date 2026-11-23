/*
 * OGC Platform E2E harness (ADR-040): one throwaway stack per journey —
 *   1. fresh databases (OGC: ogc_owner migrates, ogc_app serves; the mock IIOS: its own), migrate
 *      + synthetic seed;
 *   2. the mock IIOS and the API (dev login on) from their built bundles;
 *   3. dist-platform built, bundle guard run, served with a same-origin /v1 proxy (as nginx on VM 2);
 *   4. the journey drives Chromium; everything is torn down and the databases dropped.
 * Needs OGC_TEST_PG_ADMIN_URL and the pre-installed Playwright. Exit 0 = all checks passed.
 */
import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WEB = join(ROOT, "apps/web");
const DIST = join(WEB, "dist-platform");
export const HOST = "127.0.0.1";
const IIOS_PORT = 18790;
export const API_PORT = 18788;
const ADMIN_URL = process.env.OGC_TEST_PG_ADMIN_URL ?? "";
export const NOVA = "00000000-0000-4000-8000-000000000001";

const req = createRequire(join(ROOT, "services/api/package.json"));
const pg = req("pg");
let chromium;
try {
  ({ chromium } = createRequire("/opt/npm-tools/node_modules/")("playwright"));
} catch {
  ({ chromium } = createRequire(join(WEB, "package.json"))("playwright"));
}

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
};

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit", cwd: ROOT, ...opts });
    p.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} exited ${code}`)),
    );
    p.on("error", reject);
  });
}
async function waitFor(url, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not up */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`timed out waiting for ${url}`);
}
const dbUrl = (db, user, pw) => {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${db}`;
  if (user) {
    u.username = user;
    u.password = pw;
  }
  return u.toString();
};

// Static dist-platform with the SPA fallback and a same-origin /v1 proxy — what nginx does on VM 2.
function startFront() {
  const server = http.createServer(async (rq, rs) => {
    if ((rq.url || "").startsWith("/v1/")) {
      const up = http.request(
        { host: HOST, port: API_PORT, path: rq.url, method: rq.method, headers: rq.headers },
        (r) => (rs.writeHead(r.statusCode ?? 502, r.headers), r.pipe(rs)),
      );
      up.on("error", () => rs.writeHead(502).end());
      return rq.pipe(up);
    }
    try {
      const p = decodeURIComponent((rq.url || "/").split("?")[0]);
      let f = normalize(join(DIST, p));
      if (!f.startsWith(DIST)) return rs.writeHead(403).end();
      if (p === "/" || !existsSync(f) || extname(f) === "") f = join(DIST, "platform.html");
      rs.writeHead(200, { "content-type": MIME[extname(f)] ?? "application/octet-stream" });
      rs.end(await readFile(f));
    } catch {
      rs.writeHead(500).end();
    }
  });
  return new Promise((r) => server.listen(0, HOST, () => r(server)));
}

/** A grant for a synthetic member, straight from the API's dev login (for API-level helpers). */
export async function apiAs(principalId) {
  const api = `http://${HOST}:${API_PORT}`;
  const { grant } = await (
    await fetch(`${api}/v1/dev/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ principalId, orgId: NOVA }),
    })
  ).json();
  return (path) =>
    fetch(`${api}${path}`, {
      headers: { authorization: `Bearer ${grant}`, "x-ogc-org": NOVA },
    }).then((r) => r.json());
}

/**
 * Run `journey({ browser, base, check, restartIios })` on a fresh stack and exit with the result.
 * `label` names the summary line.
 */
export async function runPlatformJourney(label, journey) {
  const checks = [];
  const check = (name, ok) => (
    checks.push({ name, ok }),
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}`)
  );
  if (!ADMIN_URL) {
    console.error(`${label}: OGC_TEST_PG_ADMIN_URL is required`);
    process.exit(2);
  }
  for (const f of ["services/api/dist/main.mjs", "services/iios-mock/dist/main.mjs"])
    if (!existsSync(join(ROOT, f))) {
      console.error(`${f} missing — build @ogc/api and @ogc/iios-mock first`);
      process.exit(2);
    }

  // 1) databases
  const name = `ogc_e2e_${randomBytes(5).toString("hex")}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  for (const [role, pw] of [
    ["ogc_owner", "ogc_owner_test_only"],
    ["ogc_app", "ogc_app_test_only"],
  ]) {
    const ex = await admin.query("select 1 from pg_roles where rolname = $1", [role]);
    if (!ex.rowCount)
      await admin.query(`create role ${role} login password '${pw}' nosuperuser nobypassrls`);
  }
  await admin.query(`create database ${name} owner ogc_owner`);
  await admin.query(`create database ${name}_iios`); // the mock IIOS's own database
  await admin.end();
  const env = {
    ...process.env,
    DATABASE_URL_MIGRATE: dbUrl(name, "ogc_owner", "ogc_owner_test_only"),
  };
  await run("node", ["services/api/dist/migrate.mjs"], { env });
  await run("node", ["services/api/dist/seed.mjs"], { env });

  // 2) services
  const secret = randomBytes(24).toString("hex");
  const procs = [];
  const start = (file, e) => {
    const p = spawn("node", [file], {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env, NODE_ENV: "development", ...e },
    });
    procs.push(p);
    return p;
  };
  const iiosEnv = {
    IIOS_MOCK_KEY: randomBytes(32).toString("base64"), // kept across restarts
    IIOS_MOCK_CLIENT_SECRET: secret,
    IIOS_MOCK_DATABASE_URL: dbUrl(`${name}_iios`),
    PORT: String(IIOS_PORT),
  };
  let iiosProc = start("services/iios-mock/dist/main.mjs", iiosEnv);
  const iiosUp = async () => {
    const end = Date.now() + 15000;
    while (Date.now() < end) {
      try {
        const r = await fetch(`http://${HOST}:${IIOS_PORT}/v1/dev/members`, {
          headers: { authorization: `Bearer ${secret}` },
        });
        if (r.ok) return;
      } catch {
        /* not up */
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error("mock IIOS did not come back");
  };
  const restartIios = async () => {
    const exited = new Promise((r) => iiosProc.once("exit", r));
    iiosProc.kill();
    await exited;
    iiosProc = start("services/iios-mock/dist/main.mjs", iiosEnv);
    await iiosUp();
  };
  start("services/api/dist/main.mjs", {
    DATABASE_URL: dbUrl(name, "ogc_app", "ogc_app_test_only"),
    IIOS_URL: `http://${HOST}:${IIOS_PORT}`,
    IIOS_CLIENT_SECRET: secret,
    OGC_DEV_LOGIN: "1",
    HOST,
    PORT: String(API_PORT),
  });

  let front;
  let browser;
  try {
    await waitFor(`http://${HOST}:${API_PORT}/v1/health`, 15000);
    // 3) build + guard + serve
    await run("pnpm", ["--filter", "@ogc/web", "build:platform"]);
    await run("node", ["ops/release/check-bundle.mjs", "platform", DIST]);
    check("bundle guard: dist-platform has no demo persona / mock storage", true);
    front = await startFront();
    const base = `http://${HOST}:${front.address().port}`;
    browser = await chromium.launch();
    // 4) the journey
    await journey({ browser, base, check, restartIios });
  } catch (e) {
    console.error(e);
    if (process.env.E2E_DEBUG && browser)
      for (const ctx of browser.contexts())
        for (const p of ctx.pages())
          console.error(
            "PAGE TEXT:\n" +
              (
                await p
                  .locator("main")
                  .innerText()
                  .catch(() => "?")
              ).slice(0, 3000),
          );
    check(`journey completed (${e.message.split("\n")[0]})`, false);
  } finally {
    await browser?.close();
    front?.close();
    for (const p of procs) p.kill();
    const a = new pg.Client({ connectionString: ADMIN_URL });
    await a.connect();
    await a.query(`drop database if exists ${name} with (force)`);
    await a.query(`drop database if exists ${name}_iios with (force)`);
    await a.end();
  }
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`\n${label}: ${checks.length - failed}/${checks.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
