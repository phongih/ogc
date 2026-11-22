/*
 * Admissions — Playwright E2E (NON-PRODUCTION, MOCK; owner decisions 22/11). Sam reads the funnel
 * (rates never above 100%), adds a synthetic lead (a phone number is refused), sees why it scored,
 * assigns it, logs a call, records the placement test and issues the first invoice; the score's
 * parts must add up to 100; Mai's referral arrives in the same pipeline.
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
    const admissionsTab = async (tab) => {
      await page.getByRole("link", { name: "Center operations" }).first().click();
      await page.getByRole("link", { name: "Admissions", exact: true }).click();
      await page.getByRole("tab", { name: tab }).click();
    };
    await page.goto(`${base}/login`, { waitUntil: "networkidle" });
    await persona(/Sam \(Org Staff\)/);

    // Dashboard: every rate with what it is counted from, never above 100%.
    await admissionsTab("Dashboard");
    check(
      "[sam] lead → enrolled 14.3% (2 of 14)",
      ((await page.getByTestId("lead-to-enrolled").textContent()) ?? "") === "14.3%" &&
        (await page.getByText("2 of 14 leads").count()) === 1,
    );
    const rates = await page
      .getByRole("table", { name: "Funnel" })
      .locator("td:nth-child(3)")
      .allTextContents();
    check(
      "[sam] no funnel rate above 100%",
      rates.every((r) => r === "—" || Number(r.replace("%", "")) <= 100),
    );
    check("[sam] 4 stale leads", ((await page.getByTestId("stale").textContent()) ?? "") === "4");
    await shot(page, "01-admissions-dashboard");

    // New lead: contact details refused, a synthetic one added.
    await page.getByRole("tab", { name: "Pipeline" }).click();
    await page.getByRole("button", { name: "+ New lead" }).click();
    await page.getByLabel("Lead name").fill("Anh 0912345678");
    await page.getByRole("button", { name: "Add lead" }).click();
    await page.getByRole("alert").filter({ hasText: "no phone numbers" }).waitFor();
    check("[sam] a phone number in a lead is refused", true);
    await page.getByLabel("Lead name").fill("Anh Q.");
    await page.getByRole("button", { name: "Add lead" }).click();
    await page.getByRole("button", { name: "Open Anh Q." }).click();
    const panel = () => page.getByRole("region", { name: "Lead Anh Q." });
    check(
      "[sam] the score explains itself",
      (await panel().getByText("Came from a walk-in").count()) === 1,
    );
    await panel().getByLabel("Counselor for Anh Q.").selectOption({ label: "Sam (Org Staff)" });
    await panel().getByRole("button", { name: "Assign · Anh Q." }).click();
    await page
      .getByRole("region", { name: "Assigned" })
      .getByRole("button", { name: "Open Anh Q." })
      .waitFor();
    check("[sam] assigned → moves to Assigned", true);
    await panel().getByLabel("Activity for Anh Q.").fill("Called, booked a placement test");
    await panel().getByRole("button", { name: "Log · Anh Q." }).click();
    await panel().getByText("Called, booked a placement test").waitFor();
    await panel().getByLabel("Stage for Anh Q.").selectOption("placement");
    await panel().getByRole("button", { name: "Move · Anh Q." }).click();
    await panel().getByRole("button", { name: "Issue first invoice · Anh Q." }).click();
    await page
      .getByRole("region", { name: "First invoice issued" })
      .getByRole("button", { name: "Open Anh Q." })
      .waitFor();
    check("[sam] placement → first invoice → stage 'First invoice issued'", true);
    await shot(page, "02-admissions-pipeline");

    // Scoring: parts must add up to 100.
    await page.getByRole("tab", { name: "Scoring" }).click();
    await page.getByLabel("Points for Lead source").fill("30");
    await page.getByRole("button", { name: "Save scoring" }).click();
    await page.getByRole("alert").filter({ hasText: "add up to 100" }).waitFor();
    check("[sam] scoring parts must add up to 100", true);
    await signOut();

    // One pipeline: Mai's referral shows up in Admissions as a referral lead.
    await persona(/Mai \(Guardian\)/);
    await page.getByRole("link", { name: "Refer a friend" }).first().click();
    const code = ((await page.getByTestId("Referral code").textContent()) ?? "").trim();
    await signOut();
    await page.goto(`${base}/join?ref=${code}`, { waitUntil: "networkidle" });
    await page.getByLabel("Learner name").fill("Bao T.");
    await page.getByRole("button", { name: "Send enquiry" }).click();
    await page.getByText(/the center will be in touch/).waitFor();
    await page.goto(`${base}/login`, { waitUntil: "networkidle" });
    await persona(/Sam \(Org Staff\)/);
    await admissionsTab("Pipeline");
    await page.getByRole("button", { name: "Open Bao T." }).click();
    check(
      "[sam] referral lead in Admissions, from Mai",
      (await page
        .getByRole("region", { name: "Lead Bao T." })
        .getByText(/Referral from Mai \(Guardian\)/)
        .count()) === 1,
    );
  } catch (e) {
    check(`unexpected: ${e.message.split("\n")[0]}`, false);
  } finally {
    await browser.close();
    server.close();
  }
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`${checks.length - failed}/${checks.length} admissions E2E checks passed.`);
  process.exit(failed ? 1 : 0);
}

main();
