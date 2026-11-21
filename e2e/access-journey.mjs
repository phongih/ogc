/*
 * Access policy — Playwright E2E (NON-PRODUCTION, MOCK). Olivia (Org Admin) attaches a policy to
 * Sam and creates one; Sam then sees only District 1, read-only teacher fields and no center setup.
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
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
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
    await persona(/Olivia \(Org Admin\)/);
    await page.getByRole("link", { name: "Access" }).first().click();
    await page.getByRole("heading", { name: "Access policies" }).waitFor();
    check("[admin] members counted (8)", (await page.locator('[data-stat="Members"]').textContent()) === "8");
    check("[admin] two seed policies", (await page.locator("[data-policy]").count()) === 2);
    check("[admin] cannot change own access", (await page.getByText(/another Org Admin must change this/).count()) === 1);

    await page.getByLabel("Access policy for Sam (Org Staff)").selectOption({ label: "Front desk — District 1 only" });
    await page.getByText("used by 1").waitFor();
    check("[admin] policy attached to Sam", (await page.locator('[data-stat="Restricted"]').textContent()) === "1");

    await page.getByRole("button", { name: "+ New policy" }).click();
    await page.getByLabel("Policy name").fill("Engine tuner");
    await page.getByLabel("Rule 1: action").selectOption("engine:manage");
    await page.getByLabel("Rule 1: read-only rule actions").check();
    await page.getByRole("button", { name: "Create policy" }).click();
    await page.locator('[data-policy="Engine tuner"]').waitFor();
    check("[admin] new policy created (v1, history kept)", (await page.locator('[data-policy="Engine tuner"]').getByText(/v1 · created by Olivia/).count()) === 1);
    await shot(page, "01-access-admin");
    await signOut();

    await persona(/Sam \(Org Staff\)/);
    await page.getByRole("link", { name: "Center operations" }).first().click();
    await page.getByText(/Limited by access policy: Front desk — District 1 only/).waitFor();
    check("[sam] told which policy limits him", true);
    check("[sam] no center setup link", (await page.getByRole("link", { name: "+ Set up a new center" }).count()) === 0);
    check("[sam] only District 1 classes", (await page.getByRole("region", { name: "B1 Evening — Tue/Thu" }).count()) === 0 && (await page.getByRole("region", { name: "A2 Morning — Mon/Wed" }).count()) === 1);
    check("[sam] class teacher is read-only", await page.getByLabel("Class teacher for A2 Morning — Mon/Wed").isDisabled());
    await shot(page, "02-sam-restricted");
  } catch (e) {
    check(`unexpected: ${e.message.split("\n")[0]}`, false);
  } finally {
    await browser.close();
    server.close();
  }
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`${checks.length - failed}/${checks.length} access-policy E2E checks passed.`);
  process.exit(failed ? 1 : 0);
}

main();
