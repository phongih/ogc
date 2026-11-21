/*
 * P2 · Session attendance — Playwright E2E (NON-PRODUCTION, MOCK). Tara takes attendance for the
 * started A2 session, marks An absent (her second in a row), and sees it in the class summary and
 * the support queue. No reload: the mock store lives in memory.
 * Optional: SHOTS_DIR=/path → saves screenshots. Run after `pnpm --filter @ogc/web build`.
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
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    await page.goto(`${base}/login`, { waitUntil: "networkidle" });
    await page.getByText("Choose a demo persona").waitFor();
    await page.getByRole("button", { name: /Tara \(Teacher\)/ }).click();
    await page.waitForURL("**/app**");

    await page.getByRole("heading", { name: "Attendance to take (1)" }).waitFor();
    check("[home] one started session waits to be marked", true);
    const huy = page.getByRole("list", { name: "Why Huy D. is flagged" });
    check("[queue] Huy flagged by attendance alone", /Absent from the last 2 sessions/.test(await huy.textContent()));
    await shot(page, "01-teacher-home");

    await page.getByRole("link", { name: /^Take attendance · A2 — Unit 6$/ }).click();
    await page.getByRole("heading", { name: "Attendance · A2 — Unit 6" }).waitFor();
    check("[take] Save is disabled until everyone is marked", await page.getByRole("button", { name: "Save attendance" }).isDisabled());
    await page.getByRole("button", { name: "Mark all present" }).click();
    await page.getByRole("group", { name: "Attendance for An P." }).getByLabel("Absent").check();
    await shot(page, "02-take-attendance");
    await page.getByRole("button", { name: "Save attendance" }).click();
    await page.getByText("Attendance saved.").waitFor();
    check("[take] attendance saved", true);

    await page.getByRole("link", { name: "← Back to the class" }).click();
    await page.getByText("last 2 in a row").waitFor();
    check("[class] summary shows An absent twice in a row", true);
    await shot(page, "03-class-attendance");

    await page.getByRole("link", { name: "← Back to teaching" }).click();
    await page.getByText("Every session that has started is marked.").waitFor();
    const an = page.getByRole("list", { name: "Why An P. is flagged" });
    await an.getByText(/Absent from the last 2 sessions/).waitFor();
    check("[queue] An's second absence reaches the support queue", true);
    await shot(page, "04-support-queue");
  } catch (e) {
    check(`unexpected: ${e.message.split("\n")[0]}`, false);
  } finally {
    await browser.close();
    server.close();
  }
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`${checks.length - failed}/${checks.length} attendance E2E checks passed.`);
  process.exit(failed ? 1 : 0);
}

main();
