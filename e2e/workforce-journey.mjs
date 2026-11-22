/*
 * Workforce · Teacher Load — Playwright E2E (NON-PRODUCTION, MOCK; owner decisions 22/11). Sam sees
 * hours vs target per teacher; "Who has room?" next to the class teacher lists candidates with load
 * before → after and assigns nothing; Sam then chooses Mia himself and the loads move; a teacher
 * cannot open Workforce.
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
      if (!filePath.startsWith(DIST)) return void res.writeHead(403).end();
      if (urlPath === "/" || !existsSync(filePath) || extname(filePath) === "")
        filePath = join(DIST, "index.html");
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
const check = (name, ok) => (
  checks.push({ name, ok }),
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`)
);

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
  const shot = async (page, name) =>
    shots && page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const persona = async (name) => {
      await page.getByText("Choose a demo persona").waitFor();
      await page.getByRole("button", { name }).click();
      await page.waitForURL("**/app**");
    };
    const signOut = async () => {
      await page.getByRole("button", { name: "Sign out" }).first().click();
      await page.waitForURL("**/login");
    };
    const workforcePage = async () => {
      await page.getByRole("link", { name: "Center operations" }).first().click();
      await page.getByRole("link", { name: "Workforce" }).click();
      await page.getByTestId("utilization").waitFor();
    };
    await page.goto(`${base}/login`, { waitUntil: "networkidle" });
    await persona(/Sam \(Org Staff\)/);
    await workforcePage();
    check(
      "[sam] Tara 3 of 2.5 h · 120% (over target)",
      ((await page.getByTestId("load-Tara").textContent()) ?? "").includes("3 of 2.5 h · 120%"),
    );
    check(
      "[sam] bands: 1 over · 1 on target · 2 with room",
      (await page.getByTestId("band-over").textContent()) === "1" &&
        (await page.getByTestId("band-meet").textContent()) === "1" &&
        (await page.getByTestId("band-under").textContent()) === "2",
    );
    await shot(page, "01-workforce");

    await page.getByRole("link", { name: "← Center operations" }).click();
    await page.getByRole("button", { name: "Who has room? · A2 Morning — Mon/Wed" }).click();
    const list = page.getByRole("list", { name: "Load suggestions for A2 Morning — Mon/Wed" });
    await list.waitFor();
    const items = await list.locator("li").allTextContents();
    check(
      "[sam] candidates ranked: Ben (over target) last",
      items.length >= 3 &&
        /^Ben/.test(items[items.length - 2]) &&
        /Would go over target/.test(items[items.length - 2]),
    );
    check(
      "[sam] suggesting assigns nothing",
      (await page.getByLabel("Class teacher for A2 Morning — Mon/Wed").inputValue()) !== "" &&
        (await page
          .getByLabel("Class teacher for A2 Morning — Mon/Wed")
          .locator("option:checked")
          .textContent()) === "Tara",
    );
    await shot(page, "02-who-has-room");
    await page.getByLabel("Class teacher for A2 Morning — Mon/Wed").selectOption({ label: "Mia" });
    await page
      .getByLabel("Class teacher for A2 Morning — Mon/Wed")
      .locator("option:checked")
      .filter({ hasText: "Mia" })
      .waitFor({ state: "attached" });
    await page.getByRole("link", { name: "Workforce" }).click();
    await page.getByTestId("load-Mia").filter({ hasText: "1.5 of 4.5 h" }).waitFor();
    check(
      "[sam] after choosing Mia: Mia 1.5 h, Tara 1.5 h (on target)",
      ((await page.getByTestId("load-Tara").textContent()) ?? "").includes("1.5 of 2.5 h · 60%"),
    );
    await signOut();

    await persona(/Tara \(Teacher\)/);
    await page.goto(`${base}/app/operations/workforce`, { waitUntil: "networkidle" });
    check(
      "[tara] a teacher cannot open Workforce",
      (await page.getByTestId("utilization").count()) === 0,
    );
  } catch (e) {
    check(`unexpected: ${e.message.split("\n")[0]}`, false);
  } finally {
    await browser.close();
    server.close();
  }
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`${checks.length - failed}/${checks.length} workforce E2E checks passed.`);
  process.exit(failed ? 1 : 0);
}

main();
