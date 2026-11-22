/*
 * Gamification — Playwright E2E (NON-PRODUCTION, MOCK). Linh has no streak until she learns; a
 * scored quiz starts it and earns XP + a badge; Mai sees the rank; Sam turns the leaderboard off.
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
    await page.goto(`${base}/login`, { waitUntil: "networkidle" });
    await persona(/Linh \(Learner\)/);
    const rewards = page.getByRole("region", { name: "Streak & rewards" });
    await rewards.waitFor();
    check("[linh] no fake streak before any learning today", /No streak yet/.test((await rewards.getByTestId("streak").textContent()) ?? ""));
    const xpBefore = Number(((await rewards.getByTestId("xp").textContent()) ?? "0").replace(/\D/g, ""));

    await page.getByRole("link", { name: "Practice now" }).click();
    await page.getByRole("heading", { name: "At the market" }).waitFor();
    await page.getByText("How much are the apples?").click();
    await page.getByText("No thanks, I'm fine.").click();
    await page.getByText("Can I have half a kilo of tomatoes, please?").click();
    await page.getByText("Can I pay by card?").click();
    await page.getByRole("button", { name: "Submit answers" }).click();
    await page.getByText(/You scored 100%/).waitFor();
    await page.getByRole("link", { name: "← Back to My Learning" }).click();
    await rewards.getByTestId("streak").filter({ hasText: "1-day" }).waitFor();
    check("[linh] a scored quiz today starts a 1-day streak", true);
    const xpAfter = Number(((await rewards.getByTestId("xp").textContent()) ?? "0").replace(/\D/g, ""));
    check("[linh] +30 XP (10 completed + 20 for 100%)", xpAfter - xpBefore === 30);
    check("[linh] the reward names its evidence", (await rewards.getByText(/Quiz: At the market · scored 100%/).count()) === 1);
    check("[linh] perfect-score badge earned", (await rewards.getByLabel(/Perfect score \(earned\)/).count()) === 1);
    check("[linh] tops the class board this week", (await rewards.getByRole("list", { name: "Class leaderboard" }).getByText(/#1 Linh N\. \(you\)/).count()) === 1);
    await shot(page, "01-linh-rewards");
    await signOut();

    await persona(/Mai \(Guardian\)/);
    const mai = page.getByRole("region", { name: "Rewards · Linh N." });
    await mai.waitFor();
    check("[mai] sees Linh's rank, no classmates' names", /#1 of/.test((await mai.getByTestId("rank").textContent()) ?? "") && (await mai.getByRole("list", { name: "Class leaderboard" }).count()) === 0);
    await shot(page, "02-mai-rewards");
    await signOut();

    await persona(/Sam \(Org Staff\)/);
    await page.getByRole("link", { name: "Center operations" }).first().click();
    await page.getByRole("link", { name: "Rewards" }).click();
    await page.getByLabel("Weekly class leaderboard").uncheck();
    await page.getByRole("button", { name: "Save rewards" }).click();
    await page.getByRole("button", { name: "Save rewards" }).waitFor({ state: "detached" });
    await shot(page, "03-sam-rewards");
    await signOut();
    await persona(/Linh \(Learner\)/);
    await page.getByRole("region", { name: "Streak & rewards" }).waitFor();
    // Cached data may paint first; the refetch follows at once.
    await page.getByRole("list", { name: "Class leaderboard" }).waitFor({ state: "detached", timeout: 5000 });
    check("[linh] leaderboard gone after staff turned it off", true);
  } catch (e) {
    check(`unexpected: ${e.message.split("\n")[0]}`, false);
  } finally {
    await browser.close();
    server.close();
  }
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`${checks.length - failed}/${checks.length} gamification E2E checks passed.`);
  process.exit(failed ? 1 : 0);
}

main();
