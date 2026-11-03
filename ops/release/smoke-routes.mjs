/*
 * B-4 — Local Playwright browser smoke for a release candidate's major routes.
 * Serves a built dist (SPA fallback) on localhost and drives it with the PRE-INSTALLED
 * Playwright chromium (no browser download, no external network). Signs in through the
 * mock-login page per role (the session is in-memory, so deep links require it).
 *
 * Usage: node ops/release/smoke-routes.mjs [dist_dir]   (default: apps/web/dist)
 * Exit 0 = all route smokes passed.
 */
import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire("/opt/npm-tools/node_modules/");
const { chromium } = require("playwright");

const DEFAULT_DIST = fileURLToPath(new URL("../../apps/web/dist/", import.meta.url));
const DIST = process.argv[2] ? resolve(process.argv[2]) + "/" : DEFAULT_DIST;
const HOST = "127.0.0.1";

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function startServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
      let filePath = normalize(join(DIST, urlPath));
      if (!filePath.startsWith(DIST)) {
        res.writeHead(403).end();
        return;
      }
      if (urlPath === "/" || !existsSync(filePath) || extname(filePath) === "") {
        filePath = join(DIST, "index.html"); // SPA fallback
      }
      const body = await readFile(filePath);
      res.writeHead(200, { "content-type": MIME[extname(filePath)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(500).end("error");
    }
  });
  return new Promise((r) => server.listen(0, HOST, () => r(server)));
}

const checks = [];
function check(name, ok) {
  checks.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
}

async function main() {
  if (!existsSync(join(DIST, "index.html"))) {
    console.error(`dist/index.html not found at ${DIST} — build the SPA first.`);
    process.exit(2);
  }
  const server = await startServer();
  const base = `http://${HOST}:${server.address().port}`;
  const browser = await chromium.launch();
  const page = await browser.newPage();

  async function signIn(personaRe) {
    await page.goto(`${base}/login`, { waitUntil: "networkidle" });
    await page.getByText("Choose a demo persona").waitFor();
    await page.getByRole("button", { name: personaRe }).click();
    await page.waitForURL("**/app/**");
  }
  async function heading(name) {
    try {
      await page.getByRole("heading", { name }).first().waitFor({ timeout: 8000 });
      return true;
    } catch {
      return false;
    }
  }

  try {
    await page.goto(`${base}/`, { waitUntil: "networkidle" });
    check("public landing renders an h1", (await page.locator("h1").count()) > 0);

    await page.goto(`${base}/login`, { waitUntil: "networkidle" });
    check("login shows the mock persona chooser", (await page.getByText("Choose a demo persona").count()) > 0);

    await signIn(/Sam \(Org Staff\)/);
    check("staff lands on the directory (Organizations)", await heading(/Organizations/));

    await signIn(/Tara \(Teacher\)/);
    check("teacher lands on Teaching", await heading(/^Teaching$/));

    await signIn(/Linh \(Learner\)/);
    check("learner lands on My Learning", await heading(/My Learning/));
    await page.getByRole("link", { name: "Catalog" }).click();
    check("learner can open the Course catalog", await heading(/Course catalog/));

    await signIn(/Mai \(Guardian\)/);
    check("guardian lands on the Guardian workspace", await heading(/Guardian workspace/));
  } finally {
    await browser.close();
    server.close();
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} route smokes passed`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
