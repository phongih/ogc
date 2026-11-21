/*
 * Demo data survives a reload — Playwright E2E (NON-PRODUCTION, MOCK). Sam opens a center, the
 * page is reloaded, the center is still there; "Reset demo data" brings back the original data.
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
    const sam = async () => {
      await page.getByText("Choose a demo persona").waitFor();
      await page.getByRole("button", { name: /Sam \(Org Staff\)/ }).click();
      await page.waitForURL("**/app**");
      await page.getByRole("link", { name: "Center operations" }).first().click();
    };
    await page.goto(`${base}/login`, { waitUntil: "networkidle" });
    await sam();

    // Open a small center through the wizard.
    await page.getByRole("link", { name: "+ Set up a new center" }).click();
    const next = () => page.getByRole("button", { name: "Next →" }).click();
    await page.getByLabel("Center name").fill("Kept Center");
    await page.getByLabel(/Center code/).fill("KC-1");
    await next();
    await page.getByLabel(/ENG-A2/).check();
    await next();
    await page.getByRole("button", { name: "+ Add room" }).click();
    await next();
    await page.getByRole("button", { name: "+ Add class" }).click();
    await page.getByRole("group", { name: "Class 1 days" }).getByLabel("Sat").check();
    await page.getByLabel("Class 1 teacher").selectOption({ label: "Ben" });
    await page.getByRole("button", { name: "6. Review & open" }).click();
    await page.waitForFunction(() => {
      const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.startsWith("Open Kept"));
      return b && !b.disabled;
    });
    await page.getByRole("button", { name: "Open Kept Center" }).click();
    await page.getByText(/Center opened/).waitFor();
    await page.getByRole("link", { name: "→ Center operations" }).click();
    await page.getByRole("region", { name: "Kept Center" }).waitFor();
    check("[before reload] Kept Center on Center operations", true);

    // Reload: sign-in is per tab, the demo data is kept in this browser.
    await page.reload({ waitUntil: "networkidle" });
    await page.goto(`${base}/login`, { waitUntil: "networkidle" });
    await sam();
    await page.getByRole("region", { name: "Kept Center" }).waitFor();
    check("[after reload] Kept Center is still there", true);
    await shot(page, "01-kept-after-reload");

    // Reset (two steps, no browser dialog) → back to the original demo data.
    await page.getByRole("button", { name: "Reset demo data" }).click();
    await page.getByRole("button", { name: "Yes, reset" }).click();
    await page.waitForLoadState("networkidle");
    await page.goto(`${base}/login`, { waitUntil: "networkidle" });
    await sam();
    await page.getByRole("region", { name: "Nova English — District 1" }).waitFor();
    check("[after reset] Kept Center is gone", (await page.getByRole("region", { name: "Kept Center" }).count()) === 0);
  } catch (e) {
    check(`unexpected: ${e.message.split("\n")[0]}`, false);
  } finally {
    await browser.close();
    server.close();
  }
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`${checks.length - failed}/${checks.length} persistence E2E checks passed.`);
  process.exit(failed ? 1 : 0);
}

main();
