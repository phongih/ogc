/*
 * P2 · Center operations — Playwright E2E (NON-PRODUCTION, MOCK). Sam (staff) puts Ben on the
 * started A2 session as substitute and cancels the next A2 session with a replacement time; Ben
 * marks that session; Tara sees nothing left to mark and the lesson at its new time.
 * Roles switch with Sign out (no reload). Optional: SHOTS_DIR=/path → screenshots.
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

    await page.goto(`${base}/login`, { waitUntil: "networkidle" });
    await persona(/Sam \(Org Staff\)/);
    await page.getByRole("link", { name: "Center operations" }).first().click();
    const a2 = page.getByRole("region", { name: "A2 Morning — Mon/Wed" });
    await a2.waitFor();
    check("[ops] staff open Center operations", true);

    // Ben substitutes the started, unmarked A2 session.
    await a2.getByLabel("Teacher for A2 — Unit 6").selectOption({ label: "Ben (substitute)" });
    await page.waitForTimeout(300);
    check("[ops] Ben set as substitute for A2 — Unit 6", (await a2.getByLabel("Teacher for A2 — Unit 6").inputValue()) !== "");

    // Cancelling Unit 7 requires a replacement time; the class keeps the lesson.
    await a2.getByRole("button", { name: "Cancel A2 — Unit 7" }).click();
    await a2.getByRole("button", { name: "Cancel and replace" }).click();
    await a2.getByText(/^Cancelled → moved to /).waitFor();
    check("[ops] Unit 7 cancelled with a replacement", (await a2.getByText("Upcoming · replacement").count()) === 1);
    await shot(page, "01-operations");

    // Make-up ledger: An missed A2 Unit 5 → join A2 Evening's Unit 5 (Ben); Huy missed B1 Unit 1 →
    // no other class teaches it → open a make-up session.
    const board = page.getByRole("region", { name: "Make-up lessons" });
    check("[makeup] every absence is listed", /3 to arrange/.test(await board.getByTestId("makeup-counts").textContent()));
    await board.getByRole("button", { name: "Find a session · An P. · A2 — Unit 5" }).click();
    const pick = board.getByLabel("Make-up session for An P. · A2 — Unit 5");
    await pick.locator("option").nth(1).waitFor({ state: "attached" });
    await pick.selectOption({ index: 1 });
    await board.getByRole("button", { name: "Book" }).click();
    await board.getByText(/joins A2 Evening — Tue\/Thu/).waitFor();
    check("[makeup] An booked into A2 Evening (same unit)", true);
    await board.getByRole("button", { name: "Open a make-up session · Huy D. · B1 — Unit 1" }).click();
    await board.getByLabel("Make-up teacher for Huy D. · B1 — Unit 1").selectOption({ label: "Ben" });
    await board.getByRole("button", { name: "Open and book everyone missing B1 — Unit 1" }).click();
    await board.getByTestId("makeup-counts").filter({ hasText: "1 to arrange · 2 booked" }).waitFor();
    check("[makeup] Huy booked into a make-up session", true);
    await shot(page, "01b-makeup-board");

    await signOut();
    await persona(/Ben \(Teacher\)/);
    await page.getByRole("heading", { name: "Attendance to take (1)" }).waitFor();
    check("[ben] the substitute session is Ben's to mark", true);
    await page.getByRole("link", { name: /^Take attendance · A2 — Unit 6$/ }).click();
    await page.getByRole("button", { name: "Mark all present" }).click();
    await page.getByRole("button", { name: "Save attendance" }).click();
    await page.getByText("Attendance saved.").waitFor();
    check("[ben] substitute saved attendance", true);
    await shot(page, "02-ben-attendance");

    await signOut();
    await persona(/Tara \(Teacher\)/);
    await page.getByText("Every session that has started is marked.").waitFor();
    check("[tara] nothing left to mark (Ben marked Unit 6)", true);
    const upcoming = await page.getByText("A2 — Unit 7").first().locator("xpath=ancestor::li[1]").textContent();
    check("[tara] Unit 7 shows at its replacement time", !/Mon, 23\/11\/2026, 09:00/.test(upcoming ?? ""));
    await shot(page, "03-tara-home");
  } catch (e) {
    check(`unexpected: ${e.message.split("\n")[0]}`, false);
  } finally {
    await browser.close();
    server.close();
  }
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`${checks.length - failed}/${checks.length} operations E2E checks passed.`);
  process.exit(failed ? 1 : 0);
}

main();
