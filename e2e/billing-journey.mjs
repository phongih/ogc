/*
 * Billing & payments — Playwright E2E (NON-PRODUCTION, MOCK; owner decisions 22/11). Olivia
 * approves Sam's fee proposal; Sam generates Term 2 invoices (idempotent), records a payment,
 * sees receivables and the engine's overdue event; Mai sees Linh's invoice; Linh still learns.
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
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const persona = async (name) => {
      await page.getByText("Choose a demo persona").waitFor();
      await page.getByRole("button", { name }).click();
      await page.waitForURL("**/app**");
    };
    const signOut = async () => {
      await page.getByRole("button", { name: "Sign out" }).first().click();
      await page.waitForURL("**/login");
    };
    const billingTab = async (tab) => {
      await page.getByRole("link", { name: "Center operations" }).first().click();
      await page.getByRole("link", { name: "Billing & payments" }).click();
      await page.getByRole("tab", { name: tab }).click();
    };
    await page.goto(`${base}/login`, { waitUntil: "networkidle" });

    // Maker-checker: Sam proposed the A2 materials fee; Sam cannot approve, Olivia can.
    await persona(/Sam \(Org Staff\)/);
    await billingTab("Fee plans");
    await page.getByText(/ENG-A2 · Materials · Term 2/).waitFor();
    check(
      "[sam] sees the pending fee line, no Approve button",
      (await page.getByRole("button", { name: /^Approve/ }).count()) === 0,
    );
    await signOut();
    await persona(/Olivia \(Org Admin\)/);
    await billingTab("Fee plans");
    await page.getByRole("button", { name: "Approve · ENG-A2 materials Term 2" }).click();
    await page.getByRole("button", { name: "Retire · ENG-A2 materials Term 2" }).waitFor();
    check("[olivia] approves staff's proposal", true);
    await signOut();

    // Sam generates Term 2 invoices — twice: the second run creates nothing.
    await persona(/Sam \(Org Staff\)/);
    await billingTab("Invoices");
    const select = page.getByLabel("Invoice period");
    const t2 = await select.locator("option", { hasText: "Term 2" }).first().getAttribute("value");
    await select.selectOption(t2);
    await page.getByRole("button", { name: "Generate invoices" }).click();
    await page.getByRole("status").filter({ hasText: "7 created · 0 already invoiced" }).waitFor();
    check("[sam] Term 2: 7 invoices created", true);
    await page.getByRole("button", { name: "Generate invoices" }).click();
    await page.getByRole("status").filter({ hasText: "0 created · 7 already invoiced" }).waitFor();
    check("[sam] generating again creates nothing (idempotent)", true);

    // Receivables: overdue Term 1 invoices; Huy D. pays → overdue drops.
    await page.getByRole("tab", { name: "Receivables" }).click();
    const vndOf = async () =>
      Number(((await page.getByTestId("overdue").textContent()) ?? "").replace(/\D/g, ""));
    const before = await vndOf();
    // Seeded Term 1 (due 15/09): Huy 8.4M + Vy 6.9M + An's 3.9M left. Later in the school year
    // more terms fall due, so the check is "at least".
    check("[sam] overdue ≥ 19.200.000 ₫ (Huy, Vy, An part-paid)", before >= 19_200_000);
    await shot(page, "01-receivables");
    await page.getByRole("tab", { name: "Invoices" }).click();
    const huy = page
      .locator("li", { hasText: "Huy D." })
      .filter({ hasText: "days overdue" })
      .first();
    const no = ((await huy.locator("[data-invoice]").getAttribute("data-invoice")) ?? "").trim();
    await huy.getByRole("button", { name: `Record payment · ${no}` }).click();
    await page.locator(`[data-invoice="${no}"]`).waitFor({ state: "detached" });
    await page.getByRole("tab", { name: "Receivables" }).click();
    // The tab may paint cached numbers first; wait for the refetch.
    let after = await vndOf();
    for (let i = 0; i < 25 && after === before; i++) {
      await page.waitForTimeout(200);
      after = await vndOf();
    }
    check(
      `[sam] Huy's payment recorded → overdue down by his balance (${before} → ${after})`,
      after < before,
    );
    await page.getByRole("tab", { name: "Payments" }).click();
    await page
      .getByRole("cell", { name: no, exact: true })
      .first()
      .waitFor({ timeout: 5000 })
      .catch(() => {});
    check(
      "[sam] receipt listed",
      (await page.getByRole("cell", { name: no, exact: true }).count()) > 0,
    );

    // The Decision Engine tells staff about overdue invoices; nothing blocks learning.
    await page.getByRole("link", { name: "← Center operations" }).click();
    await page.getByRole("link", { name: "Decision Engine" }).click();
    await page.getByRole("tab", { name: "Events" }).click();
    await page
      .getByText(/Invoice overdue/)
      .first()
      .waitFor();
    check("[sam] engine event: Invoice overdue", true);
    await signOut();

    // Mai sees Linh's Term 2 invoice (read-only); Linh, a minor, sees a note; she still learns.
    await persona(/Mai \(Guardian\)/);
    await page.getByRole("link", { name: "Tuition" }).first().click();
    await page.getByText(/ENG-A2 · Tuition · Term 2/).waitFor();
    check(
      "[mai] Linh's Term 2 invoice: tuition + materials",
      (await page.getByText(/ENG-A2 · Materials · Term 2/).count()) > 0,
    );
    check(
      "[mai] no payment buttons",
      (await page.getByRole("button", { name: /Record payment/ }).count()) === 0,
    );
    await shot(page, "02-mai-tuition");
    await signOut();
    await persona(/Linh \(Learner\)/);
    await page.getByRole("link", { name: "Tuition" }).first().click();
    await page.getByText("Tuition is handled by your guardian").waitFor();
    check("[linh] minor: tuition is her guardian's", true);
    await page.getByRole("link", { name: "My Learning" }).first().click();
    await page
      .getByRole("heading", { name: /My Learning/ })
      .first()
      .waitFor();
    check("[linh] learning is not blocked", true);
  } catch (e) {
    check(`unexpected: ${e.message.split("\n")[0]}`, false);
  } finally {
    await browser.close();
    server.close();
  }
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`${checks.length - failed}/${checks.length} billing E2E checks passed.`);
  process.exit(failed ? 1 : 0);
}

main();
