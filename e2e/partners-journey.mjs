/*
 * Partner Commissions — Playwright E2E (NON-PRODUCTION, MOCK; owner decisions 22/11). Sam refers a
 * lead from Admissions (partners ranked by fit for the learner), records an enrolment at the next
 * tier, sees a refused dismissal without a reason; Olivia activates a pending tier rule proposed by
 * Sam and cannot approve a provisional (retroactive) entry; the activity log keeps every step; a
 * teacher cannot open the page.
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
    const partnersPage = async () => {
      await page.getByRole("link", { name: "Center operations" }).first().click();
      await page.getByRole("link", { name: "Partner commissions" }).click();
      await page.getByRole("heading", { name: /Decision signals/ }).waitFor();
    };
    await page.goto(`${base}/login`, { waitUntil: "networkidle" });
    await persona(/Sam \(Org Staff\)/);

    // Refer from Admissions — ranked by fit for the learner.
    await page.getByRole("link", { name: "Center operations" }).first().click();
    await page.getByRole("link", { name: "Admissions" }).click();
    await page.getByRole("tab", { name: "Pipeline" }).click();
    await page.getByRole("button", { name: "Open Duc A." }).click();
    await page.getByRole("button", { name: "Refer to partner · Duc A." }).click();
    const fit = page.getByRole("list", { name: "Partners for Duc A." });
    await fit.locator("li").first().waitFor();
    const items = await fit.locator("li").allTextContents();
    check(
      "[sam] partners ranked by fit: Hanoi Bridge (near, teaches A2) first; Sao Mai (no A2) last",
      /^Hanoi Bridge/.test(items[0]) && /does not teach ENG-A2/.test(items[items.length - 1]),
    );
    await shot(page, "01-refer");
    await fit.getByRole("button", { name: /Refer to Hanoi Bridge/ }).click();
    await page.getByText("Lost: Referred to partner: Hanoi Bridge English — Dong Da").waitFor();
    check("[sam] the lead closes at OGC as referred to partner", true);

    await partnersPage();
    check(
      "[sam] signals with evidence (near next tier, stale, rejection rate, overdue)",
      (await page.getByTestId("signal-near_next_tier").count()) > 0 &&
        (await page.getByTestId("signal-stale_referral").count()) > 0 &&
        (await page.getByTestId("signal-high_rejection_rate").count()) > 0 &&
        (await page.getByTestId("signal-overdue_settlement").count()) > 0,
    );
    const overdue = page.getByTestId("signal-overdue_settlement");
    await overdue.getByRole("button", { name: "Dismiss" }).click();
    check(
      "[sam] dismissing a signal needs a reason",
      /say why/.test((await overdue.getByRole("alert").textContent()) ?? ""),
    );
    await shot(page, "02-reconciliation");

    await page.getByRole("tab", { name: "Ledger" }).click();
    check(
      "[sam] the referral is in the ledger with a reference code",
      /LR-\d+ · ENG-A2 → Hanoi Bridge/.test(
        (await page.getByTestId("entry-Duc A.").textContent()) ?? "",
      ),
    );
    await page.getByRole("button", { name: "Partner confirmed enrolment · Mai L." }).click();
    await page.getByTestId("entry-Mai L.").filter({ hasText: "tier 2" }).waitFor();
    check(
      "[sam] 4th enrolment of the month → tier 2 · 2.000.000 ₫",
      /rule v1, tier 2 · 2\.000\.000 ₫/.test(
        (await page.getByTestId("entry-Mai L.").textContent()) ?? "",
      ),
    );
    check(
      "[sam] staff have no Approve button",
      (await page.getByRole("button", { name: /^Approve/ }).count()) === 0,
    );
    await shot(page, "03-ledger");
    await signOut();

    await persona(/Olivia \(Org Admin\)/);
    await partnersPage();
    await page.getByRole("tab", { name: "Tiers & policy" }).click();
    await page.getByRole("button", { name: /Activate v2 · Sao Mai/ }).click();
    await page.getByTestId("rule-PTN-SAOMAI").filter({ hasText: "Active v2" }).waitFor();
    check("[olivia] activates Sao Mai v2 proposed by Sam", true);
    await page.getByRole("tab", { name: "Ledger" }).click();
    await page.getByRole("button", { name: "Approve · Khanh D." }).click();
    check(
      "[olivia] a retroactive entry cannot be approved before its cycle ends",
      /Not at this step/.test(
        (await page.getByTestId("entry-Khanh D.").getByRole("alert").textContent()) ?? "",
      ),
    );
    await page.getByRole("tab", { name: "Activity" }).click();
    await page
      .getByRole("list", { name: "Activity log" })
      .filter({ hasText: "rule activated" })
      .waitFor();
    const log = (await page.getByRole("list", { name: "Activity log" }).textContent()) ?? "";
    check(
      "[olivia] activity log keeps every step",
      /rule activated/.test(log) && /enrolment recorded/.test(log) && /referred/.test(log),
    );
    await shot(page, "04-activity");
    await signOut();

    await persona(/Tara \(Teacher\)/);
    await page.goto(`${base}/app/operations/partners`, { waitUntil: "networkidle" });
    check(
      "[tara] a teacher cannot open partner commissions",
      (await page.getByRole("heading", { name: /Decision signals/ }).count()) === 0,
    );
  } catch (e) {
    check(`unexpected: ${e.message.split("\n")[0]}`, false);
  } finally {
    await browser.close();
    server.close();
  }
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`${checks.length - failed}/${checks.length} partner-commissions E2E checks passed.`);
  process.exit(failed ? 1 : 0);
}

main();
