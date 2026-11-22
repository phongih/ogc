/*
 * Business Forecast — Playwright E2E (NON-PRODUCTION, MOCK; owner decisions 22/11). Sam sees four
 * horizons (3 / 6 / 9 / 12 months) next to last year, labelled synthetic history, students starting
 * from today's 7 learners, month-by-month detail per horizon, capacity from Workforce targets, the
 * pipeline cross-check and read-only assumptions; a teacher cannot open it.
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
    await page.goto(`${base}/login`, { waitUntil: "networkidle" });
    await persona(/Sam \(Org Staff\)/);
    await page.getByRole("link", { name: "Center operations" }).first().click();
    await page.getByRole("link", { name: "Forecast", exact: true }).click();
    const summary = page.getByRole("table", { name: "Forecast by horizon" });
    await summary.waitFor();
    const heads = await summary.locator("thead th").allTextContents();
    check(
      "[sam] four horizons: 3 / 6 / 9 / 12 months",
      ["3 months", "6 months", "9 months", "12 months"].every((h) => heads.includes(h)),
    );
    check(
      "[sam] every cell is compared with last year",
      ((await page.getByTestId("cell-enrolments-12").textContent()) ?? "").includes("last year"),
    );
    check(
      "[sam] history is labelled synthetic",
      (await page.getByText("synthetic demo data").count()) > 0,
    );
    check(
      "[sam] students start from today's 7 learners",
      (await page.getByText("7 learners enrolled today").count()) > 0,
    );
    check(
      "[sam] money shown with billing access",
      (await page.getByTestId("cell-collected-3").count()) === 1 &&
        (await page.getByTestId("receivables").count()) === 1,
    );
    await shot(page, "01-forecast");

    await page.getByRole("button", { name: "12 mo" }).click();
    const detail = page.getByRole("table", { name: "New enrolments by month" });
    check("[sam] 12-month detail has 12 months", (await detail.locator("tbody tr").count()) === 12);
    check(
      "[sam] capacity = 31 h / week from Workforce targets",
      ((await page.getByTestId("capacity").textContent()) ?? "").includes("31 h / week"),
    );
    check(
      "[sam] pipeline is a cross-check, not added",
      ((await page.getByTestId("pipeline").textContent()) ?? "").includes("not added"),
    );
    await shot(page, "02-forecast-12");
    await signOut();

    await persona(/Tara \(Teacher\)/);
    await page.goto(`${base}/app/operations/forecast`, { waitUntil: "networkidle" });
    check(
      "[tara] a teacher cannot open the forecast",
      (await page.getByRole("table", { name: "Forecast by horizon" }).count()) === 0,
    );
  } catch (e) {
    check(`unexpected: ${e.message.split("\n")[0]}`, false);
  } finally {
    await browser.close();
    server.close();
  }
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`${checks.length - failed}/${checks.length} forecast E2E checks passed.`);
  process.exit(failed ? 1 : 0);
}

main();
