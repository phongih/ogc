/*
 * OGC Platform E2E (ADR-040): browser → Platform web (dist-platform) → /v1 proxy → Platform API →
 * mock IIOS + PostgreSQL (RLS). Synthetic data only.
 *   1. a fresh database (roles as on the VM: ogc_owner migrates, ogc_app serves), migrate + seed
 *   2. start the mock IIOS and the API (dev login on) from their built bundles
 *   3. build dist-platform, run the bundle guard, serve it with a same-origin /v1 proxy
 *   4. Sam (staff): a clashing reschedule is refused with the clash sentence; a free time saves
 *   5. Tara (teacher): marks the session waiting for attendance; the summary counts it
 *   6. a stale / revoked grant (401) sends the user back to sign in
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
const HOST = "127.0.0.1";
const IIOS_PORT = 18790;
const API_PORT = 18788;
const ADMIN_URL = process.env.OGC_TEST_PG_ADMIN_URL ?? "";

const req = createRequire(join(ROOT, "services/api/package.json"));
const pg = req("pg");
let chromium;
try {
  ({ chromium } = createRequire("/opt/npm-tools/node_modules/")("playwright"));
} catch {
  ({ chromium } = createRequire(join(WEB, "package.json"))("playwright"));
}

const checks = [];
const check = (name, ok) => (
  checks.push({ name, ok }),
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`)
);
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
  u.username = user;
  u.password = pw;
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

/** "YYYY-MM-DDTHH:MM" in center time (UTC+7) for UTC midnight today + d days at a center hour. */
function centerLocal(d, hour) {
  const day0 = Math.floor(Date.now() / 86400000) * 86400000;
  const t = new Date(day0 + d * 86400000 + (hour - 7) * 3600000 + 7 * 3600000);
  return `${t.toISOString().slice(0, 10)}T${String(hour).padStart(2, "0")}:00`;
}

async function main() {
  if (!ADMIN_URL) {
    console.error("platform E2E: OGC_TEST_PG_ADMIN_URL is required");
    process.exit(2);
  }
  for (const f of ["services/api/dist/main.mjs", "services/iios-mock/dist/main.mjs"])
    if (!existsSync(join(ROOT, f))) {
      console.error(`${f} missing — build @ogc/api and @ogc/iios-mock first`);
      process.exit(2);
    }

  // 1) database
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
  await admin.end();
  const ownerUrl = dbUrl(name, "ogc_owner", "ogc_owner_test_only");
  const env = { ...process.env, DATABASE_URL_MIGRATE: ownerUrl };
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
  };
  start("services/iios-mock/dist/main.mjs", {
    IIOS_MOCK_KEY: randomBytes(32).toString("base64"),
    IIOS_MOCK_CLIENT_SECRET: secret,
    PORT: String(IIOS_PORT),
  });
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
    const page = await browser.newPage();
    const apiCalls = [];
    page.on("request", (r) => r.url().includes("/v1/") && apiCalls.push(r.url()));

    // 4) Sam — staff schedule
    await page.goto(`${base}/`);
    await page.getByRole("heading", { name: "Sign in (staging)" }).waitFor();
    check(
      "sign-in lists both synthetic orgs",
      (await page.getByText("Lumen", { exact: false }).count()) > 0,
    );
    check(
      "banner says staging / synthetic / mock IIOS",
      (await page.getByText("STAGING · synthetic data · mock IIOS").count()) === 1,
    );
    await page.getByRole("button", { name: "Sam (Org Staff)" }).click();
    await page.getByRole("heading", { name: "Schedule" }).waitFor();
    check("Sam lands on Schedule", page.url().endsWith("/schedule"));
    check(
      "header shows Sam · staff",
      ((await page.getByTestId("who").textContent()) ?? "").includes("Sam"),
    );
    check(
      "Lumen classes are not shown to Nova staff",
      (await page.getByText("Lumen", { exact: false }).count()) === 0,
    );

    const row = page.getByTestId("session-k1-p1");
    await row.getByLabel("New time for k1-p1").fill(centerLocal(2, 18)); // Tara teaches B1 Evening then
    await row.getByRole("button", { name: "Reschedule" }).click();
    const refusal = row.getByTestId("refusal");
    await refusal.waitFor();
    const rtext = (await refusal.textContent()) ?? "";
    check(
      "clashing reschedule refused with the clash explained",
      rtext.includes("already busy") && /B1 Evening/.test(rtext),
    );

    await row.getByLabel("New time for k1-p1").fill(centerLocal(1, 15));
    await row.getByRole("button", { name: "Reschedule" }).click();
    await page
      .getByTestId("session-k1-p1")
      .getByText("15:00", { exact: false })
      .waitFor({ timeout: 5000 });
    check("free time saves and the schedule re-reads it", true);
    check(
      "every API call went to the same origin /v1",
      apiCalls.every((u) => u.startsWith(`${base}/v1/`)),
    );

    // 5) Tara — attendance
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByRole("button", { name: "Tara (Teacher)" }).click();
    await page.getByRole("heading", { name: "Teaching" }).waitFor();
    const toMark = page.getByRole("link", { name: /A2 — / }).first();
    check("Tara has a session to mark", (await toMark.count()) === 1);
    await toMark.click();
    await page.getByRole("button", { name: "Save attendance" }).waitFor();
    check(
      "save disabled until every learner is marked",
      await page.getByRole("button", { name: "Save attendance" }).isDisabled(),
    );
    await page.getByLabel("Linh N. present").check();
    await page.getByLabel("Minh T. late").check();
    await page.getByLabel("An P. absent").check();
    await page.getByRole("button", { name: "Save attendance" }).click();
    await page.getByRole("status").getByText("Saved.").waitFor();
    check("attendance saved", true);
    await page.goto(`${base}/teaching`);
    await page.getByRole("heading", { name: "Teaching" }).waitFor();
    await page.getByText("Nothing to mark.").waitFor();
    check("to-mark list is empty after saving", true);
    await page.getByRole("link", { name: "A2 Morning — Mon/Wed" }).click();
    await page.getByRole("heading", { name: "Attendance summary" }).waitFor();
    const cells = await page
      .getByRole("row", { name: /An P\./ })
      .locator("td")
      .allTextContents();
    // [name, present, late, absent, attended, absent streak]: the new mark is absent → streak ≥ 1
    check(
      "summary counts the new absence (absent ≥ 1, streak ≥ 1)",
      Number(cells[3]) >= 1 && Number(cells[5]) >= 1,
    );

    // 6) a grant the API refuses → back to sign in
    await page.evaluate(() => {
      const k = "ogc.platform.session";
      const s = JSON.parse(sessionStorage.getItem(k));
      s.grant = "not-a-grant";
      sessionStorage.setItem(k, JSON.stringify(s));
    });
    await page.goto(`${base}/teaching`);
    await page.getByRole("heading", { name: "Sign in (staging)" }).waitFor({ timeout: 5000 });
    check("a refused grant (401) sends the user back to sign in", true);
  } catch (e) {
    console.error(e);
    check(`journey completed (${e.message.split("\n")[0]})`, false);
  } finally {
    await browser?.close();
    front?.close();
    for (const p of procs) p.kill();
    const a = new pg.Client({ connectionString: ADMIN_URL });
    await a.connect();
    await a.query(`drop database if exists ${name} with (force)`);
    await a.end();
  }
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`\nplatform E2E: ${checks.length - failed}/${checks.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
main();
