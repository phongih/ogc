/*
 * OGC v2 — Slice-7 frontend E2E with the HTTP Catalog adapter enabled.
 * Proves the browser → HTTP adapter → local Catalog backend path end-to-end:
 *   1. start @ogc/catalog-api on 127.0.0.1:8787 (must be built: pnpm --filter @ogc/catalog-api build)
 *   2. build the web app with VITE_CATALOG_ADAPTER=http pointing at that backend (→ dist-http)
 *   3. serve dist-http and drive the pre-installed Playwright chromium
 * No external network, no DB. Exit 0 = all checks passed.
 */
import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire("/opt/npm-tools/node_modules/");
const { chromium } = require("playwright");

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WEB = join(ROOT, "apps/web");
const DIST = join(WEB, "dist-http");
const CATALOG_PORT = 8787;
const CATALOG_BASE = `http://127.0.0.1:${CATALOG_PORT}/api/v1`;
const HOST = "127.0.0.1";

const checks = [];
const check = (name, ok) => (checks.push({ name, ok }), console.log(`${ok ? "PASS" : "FAIL"}  ${name}`));

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

function run(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit", ...opts });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
    p.on("error", reject);
  });
}

async function waitFor(url, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`timed out waiting for ${url}`);
}

function startStatic(dir) {
  const server = http.createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
      let filePath = normalize(join(dir, urlPath));
      if (!filePath.startsWith(dir)) return res.writeHead(403).end();
      if (urlPath === "/" || !existsSync(filePath) || extname(filePath) === "") filePath = join(dir, "index.html");
      const body = await readFile(filePath);
      res.writeHead(200, { "content-type": MIME[extname(filePath)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(500).end("error");
    }
  });
  return new Promise((resolve) => server.listen(0, HOST, () => resolve(server)));
}

async function main() {
  if (!existsSync(join(ROOT, "services/catalog-api/dist/main.js"))) {
    console.error("catalog-api not built — run `pnpm --filter @ogc/catalog-api build` first.");
    process.exit(2);
  }

  // 1) start backend
  const backend = spawn("node", ["services/catalog-api/dist/main.js"], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, OGC_CATALOG_PORT: String(CATALOG_PORT) },
  });
  let staticServer;
  let browser;
  try {
    await waitFor(`${CATALOG_BASE}/public/orgs/nova-learning/courses`, 8000);
    check("catalog backend is up", true);

    // 2) build web with the HTTP adapter selected
    await run("pnpm", ["--filter", "@ogc/web", "exec", "vite", "build", "--outDir", "dist-http"], {
      cwd: ROOT,
      env: {
        ...process.env,
        VITE_CATALOG_ADAPTER: "http",
        VITE_CATALOG_API_BASE: CATALOG_BASE,
        VITE_CATALOG_ORG_SLUG: "nova-learning",
      },
    });
    check("web built with http catalog adapter", existsSync(join(DIST, "index.html")));

    // 3) serve + drive
    staticServer = await startStatic(DIST);
    const base = `http://${HOST}:${staticServer.address().port}`;
    browser = await chromium.launch();
    const page = await browser.newPage();

    await page.goto(`${base}/login`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Linh \(Learner\)/ }).click();
    await page.getByRole("link", { name: "OGC Learning" }).waitFor();

    // Catalog list now served by the HTTP backend (first page = 2 courses by code order).
    await page.getByRole("link", { name: "Catalog" }).click();
    await page.getByRole("heading", { name: "Course catalog" }).waitFor();
    await page.getByText("Everyday English A2").waitFor();
    check("catalog list rendered from HTTP backend", true);

    // Explicit pagination: IELTS is on page 2 → "Load more" fetches the next page.
    await page.getByRole("button", { name: "Load more" }).click();
    await page.getByText("IELTS Foundation B2").waitFor();
    check("explicit pagination (Load more) fetches next page from backend", true);

    // Unpublished course must NOT appear anywhere.
    const hasDraft = (await page.getByText(/Advanced English C1/).count()) > 0;
    check("unpublished course absent from HTTP-backed list", !hasDraft);

    // Detail via HTTP backend.
    await page.getByRole("link", { name: /IELTS Foundation B2/ }).click();
    await page.getByRole("heading", { name: "IELTS Foundation B2" }).waitFor();
    check("course detail rendered from HTTP backend", true);

    // An authenticated, mock-backed workflow still works alongside the HTTP catalog.
    await page.getByRole("link", { name: "AI Tutor" }).click();
    await page.getByRole("heading", { name: "AI Tutor" }).waitFor();
    check("authenticated mock-backed workflow still works", true);
  } finally {
    if (browser) await browser.close();
    if (staticServer) staticServer.close();
    backend.kill("SIGTERM");
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} HTTP-adapter E2E checks passed.`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
