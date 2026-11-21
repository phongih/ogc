/*
 * P2 · Center setup wizard — Playwright E2E (NON-PRODUCTION, MOCK). Sam opens a new center in
 * Nova Learning Group: info → courses → rooms → a Saturday class with Ben → a mock fee → review →
 * open; the class appears on Center operations with its sessions.
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
    await page.goto(`${base}/login`, { waitUntil: "networkidle" });
    await persona(/Sam \(Org Staff\)/);
    await page.getByRole("link", { name: "Center operations" }).first().click();
    await page.getByRole("link", { name: "+ Set up a new center" }).click();
    const next = () => page.getByRole("button", { name: "Next →" }).click();

    await page.getByLabel("Center name").fill("Nova English — Binh Thanh");
    await page.getByLabel(/Center code/).fill("NV-BT");
    await page.getByLabel("City").fill("Ho Chi Minh City");
    await next();
    await page.getByLabel(/ENG-A2/).check();
    await page.getByLabel(/ENG-B1/).check();
    await next();
    await page.getByRole("button", { name: "+ Add room" }).click();
    await page.getByRole("button", { name: "+ Add room" }).click();
    await next();
    await page.getByRole("button", { name: "+ Add class" }).click();
    await page.getByRole("group", { name: "Class 1 days" }).getByLabel("Sat").check();
    await page.getByLabel("Class 1 teacher").selectOption({ label: "Ben" });
    await page.getByLabel("Class 1 name").fill("A2 Weekend");
    await shot(page, "01-wizard-classes");
    check("[wizard] checklist complete", (await page.getByText("Checklist · 5/5").count()) === 1);
    await next();
    await page.getByRole("button", { name: "+ Fee for ENG-A2" }).click();
    await page.getByLabel("Fee for ENG-A2").fill("4500000");
    await next();
    await shot(page, "02-wizard-review");
    await page.getByRole("button", { name: "Open Nova English — Binh Thanh" }).click();
    await page.getByText(/Center opened · 1 class · 4 sessions scheduled/).waitFor();
    check("[wizard] center opened with 4 sessions", true);
    await page.getByRole("link", { name: "→ Center operations" }).click();
    await page.getByRole("region", { name: "A2 Weekend — Sat" }).waitFor();
    check("[ops] the new class is on Center operations with its teacher", (await page.getByLabel("Class teacher for A2 Weekend — Sat").inputValue()) !== "");
    await shot(page, "03-ops-new-class");
  } catch (e) {
    check(`unexpected: ${e.message.split("\n")[0]}`, false);
  } finally {
    await browser.close();
    server.close();
  }
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`${checks.length - failed}/${checks.length} center-setup E2E checks passed.`);
  process.exit(failed ? 1 : 0);
}

main();
