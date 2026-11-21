/*
 * P2 · Make-up (self-study) — Playwright E2E across all four roles (NON-PRODUCTION, MOCK).
 * Tara marks Linh absent → Sam arranges self-study → Linh submits → Mai sees it (read-only) →
 * Tara confirms → Sam's board shows it made up. Sign out between roles; no reload.
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
    const persona = async (name) => {
      await page.getByText("Choose a demo persona").waitFor();
      await page.getByRole("button", { name }).click();
      await page.waitForURL("**/app**");
    };
    const signOut = async () => {
      await page.getByRole("button", { name: "Sign out" }).first().click();
      await page.waitForURL("**/login");
    };

    // 1. Tara marks A2 Unit 6 — Linh absent.
    await page.goto(`${base}/login`, { waitUntil: "networkidle" });
    await persona(/Tara \(Teacher\)/);
    await page.getByRole("link", { name: /^Take attendance · A2 — Unit 6$/ }).click();
    await page.getByRole("button", { name: "Mark all present" }).click();
    await page.getByRole("group", { name: "Attendance for Linh N." }).getByLabel("Absent").check();
    await page.getByRole("button", { name: "Save attendance" }).click();
    await page.getByText("Attendance saved.").waitFor();
    check("[tara] Linh marked absent at A2 — Unit 6", true);
    await signOut();

    // 2. Sam: the absence is on the make-up board → assign self-study.
    await persona(/Sam \(Org Staff\)/);
    await page.getByRole("link", { name: "Center operations" }).first().click();
    const board = page.getByRole("region", { name: "Make-up lessons" });
    await board.getByRole("button", { name: "Assign self-study · Linh N. · A2 — Unit 6" }).click();
    await board.getByText("self-study · Tara confirms").waitFor();
    check("[sam] Linh's missed Unit 6 arranged as self-study", true);
    await signOut();

    // 3. Linh sees it and sends what she studied.
    await persona(/Linh \(Learner\)/);
    const mine = page.getByRole("region", { name: "Make-up lessons" });
    await mine.getByText("A2 — Unit 6", { exact: true }).waitFor();
    await mine.getByRole("textbox").fill("Read Unit 6 — making plans — and did both exercises");
    await mine.getByRole("button", { name: "Send to my teacher" }).click();
    await mine.getByText("self-study · submitted, waiting for Tara").waitFor();
    check("[linh] self-study submitted", true);
    await shot(page, "01-learner-makeup");
    await signOut();

    // 4. Mai (guardian) sees it, read-only.
    await persona(/Mai \(Guardian\)/);
    const g = page.getByRole("region", { name: "Make-up lessons" });
    await g.getByText("Waiting for teacher").waitFor();
    check("[mai] guardian sees the make-up, read-only", (await g.getByRole("button").count()) === 0);
    await shot(page, "02-guardian-makeup");
    await signOut();

    // 5. Tara confirms → Sam sees it made up.
    await persona(/Tara \(Teacher\)/);
    const c = page.getByRole("region", { name: "Self-study to confirm" });
    await c.getByText(/did both exercises/).waitFor();
    await shot(page, "03-teacher-confirm");
    await c.getByRole("button", { name: "Confirm make-up · Linh N." }).click();
    await c.waitFor({ state: "detached" });
    check("[tara] self-study confirmed", true);
    await signOut();
    await persona(/Sam \(Org Staff\)/);
    await page.getByRole("link", { name: "Center operations" }).first().click();
    await page.getByTestId("makeup-counts").filter({ hasText: "1 made up" }).waitFor();
    check("[sam] board shows Linh's Unit 6 made up", true);
    await shot(page, "04-board-done");
  } catch (e) {
    check(`unexpected: ${e.message.split("\n")[0]}`, false);
  } finally {
    await browser.close();
    server.close();
  }
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`${checks.length - failed}/${checks.length} make-up E2E checks passed.`);
  process.exit(failed ? 1 : 0);
}

main();
