/*
 * Growth Engine — Playwright E2E (NON-PRODUCTION, MOCK). Mai shares her link; a friend sends a
 * synthetic enquiry; Sam: placement → first invoice → payment in Billing → confirm; Mai sees the
 * credit; Linh (minor) has no link.
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
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    const page = await ctx.newPage();
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
    await persona(/Mai \(Guardian\)/);
    await page.getByRole("link", { name: "Refer a friend" }).first().click();
    const code = ((await page.getByTestId("Referral code").textContent()) ?? "").trim();
    check("[mai] has a referral code", /^OGC[0-9A-Z]{6}$/.test(code));
    await shot(page, "01-mai-share");
    await signOut();

    // A friend opens the shared link (public page, no sign-in).
    await page.goto(`${base}/join?ref=${code}&c=camp-tet-2027`, { waitUntil: "networkidle" });
    await page.getByLabel("Learner name").fill("Bao T.");
    await page.getByRole("button", { name: "Send enquiry" }).click();
    await page.getByText(/the center will be in touch/).waitFor();
    check("[friend] synthetic enquiry sent from the public link", true);

    await page.goto(`${base}/login`, { waitUntil: "networkidle" });
    await persona(/Sam \(Org Staff\)/);
    await page.getByRole("link", { name: "Center operations" }).first().click();
    await page.getByRole("link", { name: "Growth Engine" }).click();
    await page.getByRole("tab", { name: "Funnel" }).click();
    await page.getByText(/Admissions stage: new/).waitFor();
    check("[sam] referral lead shows its Admissions stage in the funnel", true);
    // One pipeline (22/11): placement and the first invoice are done in Admissions.
    await page.getByRole("link", { name: "Admissions", exact: true }).click();
    await page.getByRole("tab", { name: "Pipeline" }).click();
    await page.getByRole("button", { name: "Open Bao T." }).click();
    const panel = page.getByRole("region", { name: "Lead Bao T." });
    await panel.getByLabel("Stage for Bao T.").selectOption("placement");
    await panel.getByRole("button", { name: "Move · Bao T." }).click();
    await page.getByRole("region", { name: "Lead Bao T." }).getByRole("button", { name: "Issue first invoice · Bao T." }).click();
    await page.getByRole("region", { name: "Lead Bao T." }).getByText(/First invoice INV-\d{4}-\d{4} · waiting for payment/).waitFor();
    check("[sam] first invoice issued from Admissions", true);
    await page.getByRole("region", { name: "Lead Bao T." }).getByRole("link", { name: "Billing" }).click();
    await page.getByRole("tab", { name: "Invoices" }).click();
    const bao = page.locator("li", { hasText: "Bao T." });
    const no = ((await bao.locator("[data-invoice]").getAttribute("data-invoice")) ?? "").trim();
    await bao.getByRole("button", { name: `Record payment · ${no}` }).click();
    await page.locator("li", { hasText: "Bao T." }).waitFor({ state: "detached" }); // paid → leaves "Open"
    await page.getByRole("link", { name: "← Center operations" }).click();
    await page.getByRole("link", { name: "Growth Engine" }).click();
    await page.getByRole("tab", { name: "Funnel" }).click();
    await page.getByText(/paid: 6\.900\.000 ₫/).waitFor();
    check("[sam] invoice paid → lead enrolled with the invoice amount (6,900,000)", true);
    await page.getByRole("button", { name: "Confirm reward · Bao T." }).click();
    await page.getByText(/credit 483\.000 ₫ to Mai/).waitFor();
    check("[sam] confirmed: 5% + 2% campaign of 6,900,000 = 483,000 ₫", true);
    await page.getByRole("tab", { name: "Dashboard" }).click();
    check("[sam] K-factor 0.50 (1 confirmed / 2 referrers)", ((await page.getByTestId("k-factor").textContent()) ?? "") === "0.50");
    await shot(page, "02-sam-growth");
    await signOut();

    await persona(/Mai \(Guardian\)/);
    await page.getByRole("link", { name: "Refer a friend" }).first().click();
    await page.getByRole("tab", { name: "Wallet" }).click();
    check("[mai] wallet shows the credit", /483\.000/.test((await page.getByTestId("wallet-balance").textContent()) ?? ""));
    await shot(page, "03-mai-wallet");
    await signOut();

    await persona(/Linh \(Learner\)/);
    await page.getByRole("link", { name: "Refer a friend" }).first().click();
    await page.getByText("Referrals are for guardians and adult learners").waitFor();
    check("[linh] a minor has no referral link", true);
    await signOut();

    // Two tabs of one browser (owner 22/11): Sam's Funnel is already open when a friend sends an
    // enquiry from /join in another tab — it must show up without a reload, and survive one.
    const samTab = await ctx.newPage();
    await samTab.goto(`${base}/login`, { waitUntil: "networkidle" });
    const samFunnel = async () => {
      await samTab.getByRole("button", { name: /Sam \(Org Staff\)/ }).click();
      await samTab.waitForURL("**/app**");
      await samTab.getByRole("link", { name: "Center operations" }).first().click();
      await samTab.getByRole("link", { name: "Growth Engine" }).click();
      await samTab.getByRole("tab", { name: "Funnel" }).click();
    };
    await samFunnel();
    await page.goto(`${base}/join?ref=${code}`, { waitUntil: "networkidle" });
    await page.getByLabel("Learner name").fill("Cuong V.");
    await page.getByRole("button", { name: "Send enquiry" }).click();
    await page.getByText(/the center will be in touch/).waitFor();
    await samTab.locator("[data-lead=\"Cuong V.\"]").waitFor({ timeout: 5000 });
    check("[sam, other tab] the new lead appears without a reload", true);
    await page.close();
    await samTab.goto(`${base}/login`, { waitUntil: "networkidle" }); // sign-in is per tab load
    await samFunnel();
    await samTab.getByText("Cuong V.").first().waitFor({ timeout: 5000 }).catch(() => {});
    check("[sam, other tab] still there after the friend's tab closed and a reload", (await samTab.getByText("Cuong V.").count()) > 0);
  } catch (e) {
    check(`unexpected: ${e.message.split("\n")[0]}`, false);
  } finally {
    await browser.close();
    server.close();
  }
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`${checks.length - failed}/${checks.length} growth E2E checks passed.`);
  process.exit(failed ? 1 : 0);
}

main();
