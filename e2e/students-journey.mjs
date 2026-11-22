/*
 * Current Students — Playwright E2E (NON-PRODUCTION, MOCK; owner decision 22/11). Sam sees three
 * care levels with evidence (no psychological labels), tuition as information only; pausing the
 * engine's absence rule removes that evidence; Tara sees only her own learners, without tuition;
 * a learner cannot open the page.
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
    await page.getByRole("link", { name: "Current students" }).click();
    await page.getByTestId("count-support").waitFor();
    check(
      "[sam] 1 needs support · 3 watch · 3 OK",
      (await page.getByTestId("count-support").textContent()) === "1" &&
        (await page.getByTestId("count-watch").textContent()) === "3" &&
        (await page.getByTestId("count-ok").textContent()) === "3",
    );
    const huy = page.getByRole("region", { name: "Student Huy D." });
    check(
      "[sam] Huy D.: needs support, with the evidence",
      (await huy.getByText("Absent from the last 2 marked sessions (attendance)").count()) === 1,
    );
    const body = ((await page.locator("main").textContent()) ?? "").toLowerCase();
    check(
      "[sam] no psychological labels",
      !["overwhelmed", "struggling", "flourishing", "under pressure"].some((w) => body.includes(w)),
    );
    await page.getByRole("button", { name: /suggestions and tuition · Vy H\./ }).click();
    check(
      "[sam] Vy H. is OK although her tuition is overdue",
      (await page.getByTestId("care-Vy H.").textContent()) === "OK" &&
        /overdue/.test((await page.getByTestId("tuition-Vy H.").textContent()) ?? ""),
    );
    await shot(page, "01-students");

    // Thresholds follow the Decision Engine.
    await page.getByRole("link", { name: "← Center operations" }).click();
    await page.getByRole("link", { name: "Decision Engine" }).click();
    await page.getByRole("button", { name: "Pause Absent several sessions in a row" }).click();
    await page.getByRole("link", { name: "← Center operations" }).click();
    await page.getByRole("link", { name: "Current students" }).click();
    await page.getByTestId("care-Huy D.").filter({ hasNotText: "Needs support" }).waitFor();
    check("[sam] absence rule paused → Huy's absence evidence is gone", true);
    await signOut();

    await persona(/Tara \(Teacher\)/);
    await page.getByRole("link", { name: "My students · care" }).click();
    await page.getByRole("region", { name: "Student An P." }).waitFor();
    check(
      "[tara] own learners only (no Vy H.)",
      (await page.getByRole("region", { name: "Student Vy H." }).count()) === 0,
    );
    check("[tara] no tuition", (await page.getByText(/and tuition/).count()) === 0);
    await signOut();

    await persona(/Linh \(Learner\)/);
    await page.goto(`${base}/app/operations/students`, { waitUntil: "networkidle" });
    check(
      "[linh] a learner cannot open Current students",
      (await page.getByRole("region", { name: /Student / }).count()) === 0,
    );
  } catch (e) {
    check(`unexpected: ${e.message.split("\n")[0]}`, false);
  } finally {
    await browser.close();
    server.close();
  }
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`${checks.length - failed}/${checks.length} current-students E2E checks passed.`);
  process.exit(failed ? 1 : 0);
}

main();
