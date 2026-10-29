/*
 * OGC v2 — lightweight Playwright E2E smoke (NON-PRODUCTION).
 * Serves the built apps/web/dist with SPA fallback on localhost and drives it with the
 * PRE-INSTALLED Playwright chromium (no browser download, no external network).
 *
 * Run after `pnpm --filter @ogc/web build`:
 *   node e2e/smoke.mjs
 * Exit code 0 = all checks passed.
 */
import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// Playwright is pre-installed globally (not a project dependency, by design: no browser
// download, no added lockfile entry). Resolve it via require from the global tools dir.
const require = createRequire("/opt/npm-tools/node_modules/");
const { chromium } = require("playwright");

const DIST = fileURLToPath(new URL("../apps/web/dist/", import.meta.url));
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
        filePath = join(DIST, "index.html"); // SPA fallback for history router deep links
      }
      const body = await readFile(filePath);
      res.writeHead(200, { "content-type": MIME[extname(filePath)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(500).end("error");
    }
  });
  return new Promise((resolve) => server.listen(0, HOST, () => resolve(server)));
}

const checks = [];
function check(name, ok) {
  checks.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
}

async function main() {
  if (!existsSync(join(DIST, "index.html"))) {
    console.error("dist/index.html not found — run `pnpm --filter @ogc/web build` first.");
    process.exit(2);
  }
  const server = await startServer();
  const { port } = server.address();
  const base = `http://${HOST}:${port}`;

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();

    // 1) Landing renders.
    await page.goto(`${base}/`, { waitUntil: "networkidle" });
    check("landing shows an h1", (await page.locator("h1").count()) > 0);

    // 2) Mock sign-in as a learner.
    await page.goto(`${base}/login`, { waitUntil: "networkidle" });
    await page.getByText("Choose a demo persona").waitFor();
    await page.getByRole("button", { name: /Linh \(Learner\)/ }).click();
    // AppHome redirects to the role's first section (learner → /app/learning).
    await page.getByRole("link", { name: "OGC Learning" }).waitFor();
    await page.waitForURL("**/app/**");
    check("learner reaches the app shell after mock sign-in", page.url().includes("/app/"));

    // NOTE: the mock session lives in client memory only, so navigate via in-app links
    // (client-side routing) rather than page.goto, which would reload and drop the session.

    // 3) Keyboard: the skip-link is the first element in tab order. With no positive
    // tabindex anywhere, DOM order IS tab order, so the first tabbable must be the skip link.
    const firstTabbable = await page.evaluate(() => {
      const sel = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';
      const first = document.querySelector(sel);
      return (first?.textContent ?? "").trim();
    });
    check("skip-to-content link is first in tab order", /skip to content/i.test(firstTabbable));
    // And it is actually focusable via the keyboard.
    await page.locator(".ogc-skip-link").focus();
    check(
      "skip-to-content link is focusable",
      await page.evaluate(() => (document.activeElement?.textContent ?? "").toLowerCase().includes("skip to content")),
    );

    // 4) Navigation: open the catalog, a course, then enroll (all client-side).
    await page.getByRole("link", { name: "Catalog" }).click();
    await page.getByRole("heading", { name: "Course catalog" }).waitFor();
    await page.getByRole("link", { name: /IELTS Foundation B2/ }).click();
    const enroll = page.getByRole("button", { name: /Enroll in/ });
    await enroll.waitFor();
    await enroll.click();
    await page.getByRole("button", { name: /Resume learning/ }).waitFor();
    check("learner can enroll in a course", true);

    // 5) AI Tutor: send a message and get a deterministic reply (lesson context echoed).
    await page.getByRole("link", { name: "AI Tutor" }).click();
    const input = page.getByLabel("Message the tutor");
    await input.waitFor();
    await input.fill("How do I order food?");
    await page.getByRole("button", { name: "Send" }).click();
    await page.getByText(/Lesson context: Everyday English A2/).waitFor();
    check("tutor returns a deterministic reply", true);

    // 6) Responsive: the current view still renders its heading at a phone width.
    await page.getByRole("link", { name: "Catalog" }).click();
    await page.getByRole("heading", { name: "Course catalog" }).waitFor();
    await page.setViewportSize({ width: 375, height: 720 });
    check("catalog renders its heading at 375px width", (await page.locator("h1").count()) > 0);
  } finally {
    await browser.close();
    server.close();
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} E2E checks passed.`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
