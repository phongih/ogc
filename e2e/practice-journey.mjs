/*
 * OGC-AUTH-030 — Playwright E2E for the integrated practice loop (NON-PRODUCTION).
 * Serves apps/web/dist and drives the learner practice journey end to end:
 *   My Learning → Practice now → answer → submit → score → updated next step.
 * Uses the PRE-INSTALLED Playwright chromium (no browser download, no external network).
 *
 * Run after `pnpm --filter @ogc/web build`:  node e2e/practice-journey.mjs
 * Exit code 0 = all checks passed.
 */
import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire("/opt/npm-tools/node_modules/");
const { chromium } = require("playwright");

const DIST = fileURLToPath(new URL("../apps/web/dist/", import.meta.url));
const HOST = "127.0.0.1";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

function startServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
      let filePath = normalize(join(DIST, urlPath));
      if (!filePath.startsWith(DIST)) return void res.writeHead(403).end();
      if (urlPath === "/" || !existsSync(filePath) || extname(filePath) === "") filePath = join(DIST, "index.html");
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
const check = (name, ok) => (checks.push({ name, ok }), console.log(`${ok ? "PASS" : "FAIL"}  ${name}`));

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

    // Sign in as the learner.
    await page.goto(`${base}/login`, { waitUntil: "networkidle" });
    await page.getByText("Choose a demo persona").waitFor();
    await page.getByRole("button", { name: /Linh \(Learner\)/ }).click();
    await page.waitForURL("**/app/**");
    await page.getByRole("heading", { name: "My Learning" }).waitFor();

    // The recommended activity (ACT-A2-3) is practice-enabled → "Practice now" is offered.
    const practiceNow = page.getByRole("link", { name: "Practice now" });
    await practiceNow.waitFor();
    check("[practice] recommended activity offers an interactive 'Practice now'", true);
    await practiceNow.click();
    await page.waitForURL("**/app/learning/practice/**");
    await page.getByRole("heading", { name: "At the market" }).waitFor();
    check("[practice] practice view opens for the recommended activity", true);

    // Answer all four questions correctly, then submit.
    await page.getByText("How much are the apples?").click();
    await page.getByText("No thanks, I'm fine.").click();
    await page.getByText("Can I have half a kilo of tomatoes, please?").click();
    await page.getByText("Can I pay by card?").click();
    await page.getByRole("button", { name: "Submit answers" }).click();

    // Deterministic score surfaces.
    await page.getByText(/You scored 100%/).waitFor();
    check("[practice] deterministic score shown (100%)", true);

    // The updated next step is derived from the new evidence, friendly, no internal ids.
    const nextReason = page.getByTestId("practice-next-reason");
    await nextReason.waitFor();
    const nextText = (await nextReason.textContent()) ?? "";
    check("[practice] updated next step shown with no internal ids", nextText.length > 0 && !/ACT-/.test(nextText));

    // Idempotency at the UI: the completed activity no longer offers 'Practice now'.
    await page.getByRole("link", { name: "← Back to My Learning" }).click();
    await page.getByRole("heading", { name: "My Learning" }).waitFor();
    const pathList = page.getByRole("list", { name: "Path steps" });
    await pathList.waitFor();
    check("[practice] path shows the practised activity as completed", (await pathList.locator('[data-state="completed"]').count()) >= 1);
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
