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
  // Each scenario signs in fresh: a full reload resets the in-memory session AND store,
  // so scenarios are independent and progress is the deterministic seeded baseline.
  async function signIn(page, personaRe) {
    await page.goto(`${base}/login`, { waitUntil: "networkidle" });
    await page.getByText("Choose a demo persona").waitFor();
    await page.getByRole("button", { name: personaRe }).click();
    await page.getByRole("link", { name: "OGC Learning" }).waitFor();
    await page.waitForURL("**/app/**");
  }

  try {
    const page = await browser.newPage();

    // 0) Public landing renders.
    await page.goto(`${base}/`, { waitUntil: "networkidle" });
    check("landing shows an h1", (await page.locator("h1").count()) > 0);

    // ── Scenario A — ADMIN (org staff): directory navigation + route continuity ──
    await signIn(page, /Sam \(Org Staff\)/);
    // Keyboard a11y on the authenticated shell (DOM order == tab order; skip-link first).
    const firstTabbable = await page.evaluate(() => {
      const sel = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';
      return (document.querySelector(sel)?.textContent ?? "").trim();
    });
    check("[admin] skip-to-content link is first in tab order", /skip to content/i.test(firstTabbable));
    await page.getByRole("link", { name: "Directory" }).click();
    await page.getByRole("heading", { name: /Organizations/i }).waitFor();
    await page.getByRole("link", { name: /Nova Learning Group/ }).first().click();
    await page.waitForURL("**/app/orgs/**");
    check("[admin] directory → organization detail route continuity", page.url().includes("/app/orgs/"));

    // ── Scenario B — TEACHER: class roster + progress + lesson plan save ──
    await signIn(page, /Tara \(Teacher\)/);
    await page.getByRole("heading", { name: "Teaching" }).waitFor();
    await page.getByRole("link", { name: "Learner overview" }).first().click();
    await page.getByRole("heading", { name: "Learner overview" }).waitFor();
    await page.getByText("Linh N.").first().waitFor(); // roster loads async
    check("[teacher] sees an assigned-class roster", true);
    await page.getByRole("link", { name: /Open lesson plan editor/ }).click();
    await page.getByLabel("Lesson plan title").fill("Smoke plan");
    await page.getByRole("button", { name: /Save plan/ }).click();
    await page.getByText(/Lesson plan saved/).waitFor();
    check("[teacher] can save a lesson plan draft", true);

    // ── Scenario C — LEARNER: enroll → learn → complete → tutor ──
    await signIn(page, /Linh \(Learner\)/);
    await page.getByRole("heading", { name: "My Learning" }).waitFor();
    await page.getByRole("link", { name: "Resume learning" }).first().click();
    await page.getByRole("progressbar").first().waitFor(); // course-progress panel
    const complete = page.getByRole("button", { name: /Complete .*Quiz: At the market/ });
    await complete.waitFor();
    await complete.click();
    await page.waitForFunction(
      () => !document.querySelector('button[aria-label*="Quiz: At the market"]'),
    );
    check("[learner] completes an activity (progress updates)", true);
    // Empty-state: a brand-new tutor conversation shows the start prompt.
    await page.getByRole("link", { name: "AI Tutor" }).click();
    await page.getByRole("button", { name: /New conversation/ }).click();
    await page.getByText(/Start by asking a question below/).waitFor();
    check("[learner] empty-state renders for a new tutor conversation", true);
    const input = page.getByLabel("Message the tutor");
    await input.fill("How do I order food?");
    await page.getByRole("button", { name: "Send" }).click();
    await page.getByText(/In English we usually say|simple rule|Let's practise|tense first|clearer way/).first().waitFor();
    check("[learner] tutor returns a deterministic reply", true);

    // ── Scenario D — GUARDIAN: linked learner progress + D-14 notice ──
    await signIn(page, /Mai \(Guardian\)/);
    await page.getByRole("heading", { name: "Guardian workspace" }).waitFor();
    check("[guardian] sees a linked learner", (await page.getByText("Linh N.").count()) > 0);
    check(
      "[guardian] D-14 self-verification notice present",
      (await page.getByText(/cannot add or verify a learner link/i).count()) > 0,
    );

    // ── Responsive: guardian workspace still renders its heading at phone width ──
    await page.setViewportSize({ width: 375, height: 720 });
    await page.getByRole("heading", { name: "Guardian workspace" }).waitFor();
    check("[responsive] view renders its heading at 375px width", (await page.locator("h1").count()) > 0);

    // ── Scenario E — MOBILE NAV: drawer at 375px (real media queries apply) ──
    await signIn(page, /Linh \(Learner\)/); // reloads at the 375px viewport
    // Desktop primary nav is hidden at phone width; the toggle is visible.
    const toggle = page.getByRole("button", { name: "Open menu" });
    await toggle.waitFor({ state: "visible" });
    check("[mobile] hamburger toggle visible at 375px", await toggle.isVisible());
    await toggle.click();
    const drawer = page.getByRole("dialog", { name: "Menu" });
    await drawer.waitFor();
    await drawer.getByRole("link", { name: "AI Tutor" }).click();
    await page.getByRole("heading", { name: "AI Tutor" }).waitFor();
    // Drawer closes on selection (route change).
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
    check("[mobile] drawer navigates and closes on route selection", true);
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
