/*
 * Decision Engine — Playwright E2E (NON-PRODUCTION, MOCK). Sam opens the engine, tunes a rule,
 * reads events and the action log; Tara is notified in the app and her support queue follows.
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
  const shots = process.env.SHOTS_DIR;
  const shot = async (page, name) => shots && page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });

  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const persona = async (name) => {
      await page.getByText("Choose a demo persona").waitFor();
      await page.getByRole("button", { name }).click();
      await page.waitForURL("**/app**");
    };
    const signOut = async () => {
      await page.getByRole("button", { name: "Sign out" }).first().click();
      await page.waitForURL("**/login");
    };
    await page.goto(`${base}/login`, { waitUntil: "networkidle" });
    await persona(/Sam \(Org Staff\)/);
    await page.getByRole("link", { name: "Center operations" }).first().click();
    await page.getByRole("link", { name: "Decision Engine" }).click();
    await page.getByText("12 rules · 11 active").waitFor();
    check("[engine] 11 rules, 10 active (no-practice off by default)", true);
    await shot(page, "01-engine-rules");

    // Tune: skill below 53 → the support queue follows.
    await page.getByLabel("Skill below threshold: skill below").fill("53");
    await page.getByRole("button", { name: "Save Skill below threshold" }).click();
    await page.getByRole("button", { name: "Save Skill below threshold" }).waitFor({ state: "detached" });
    await page.getByRole("tab", { name: "Events" }).click();
    const events = page.getByRole("list", { name: "Engine events" });
    await events.getByText(/Attendance not taken/).first().waitFor();
    check("[engine] events state their evidence", (await events.getByText(/Use of English is 52, below 6?\d/).count()) > 0);
    await shot(page, "02-engine-events");
    await page.getByRole("tab", { name: "Action Log" }).click();
    await page.getByRole("table", { name: "Action log" }).waitFor();
    check("[engine] action log lists notifications and queue entries", (await page.getByRole("cell", { name: "center staff" }).count()) > 0);
    await signOut();

    await persona(/Tara \(Teacher\)/);
    const box = page.getByRole("region", { name: "Notifications" });
    await box.getByText(/Attendance not taken: A2 — Unit 6/).first().waitFor();
    check("[tara] notified in the app", true);
    const queue = page.getByRole("list", { name: "Learners needing support" });
    await queue.waitFor();
    const names = await queue.locator(":scope > li p.font-medium").allTextContents();
    check("[tara] the queue follows the tuned rule (An 58, Linh 55 no longer below 53)", !names.join(" ").includes("An P.") && !names.join(" ").includes("Linh N."));
    await shot(page, "03-teacher-notified");
  } catch (e) {
    check(`unexpected: ${e.message.split("\n")[0]}`, false);
  } finally {
    await browser.close();
    server.close();
  }
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`${checks.length - failed}/${checks.length} decision-engine E2E checks passed.`);
  process.exit(failed ? 1 : 0);
}

main();
