/*
 * P1 · Speaking studio — Playwright E2E for the speaking loop across roles (NON-PRODUCTION, MOCK).
 *   Linh: quiz (unlocks speaking) → mission "Start speaking" → role-play rehearsal → pending review
 *   Tara: Teaching → "Speaking to review" → Approve
 *   Linh: studio shows "Approved"; Speaking mastery has moved.
 * Roles are switched with Sign out (no page reload) so the in-memory mock store is shared.
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
    const persona = async (name) => {
      await page.getByText("Choose a demo persona").waitFor();
      await page.getByRole("button", { name }).click();
      await page.waitForURL("**/app**");
    };
    const signOut = async () => {
      // In-app sign-out (no reload): the Shell redirects to /login and the mock store survives.
      await page.getByRole("button", { name: "Sign out" }).first().click();
      await page.waitForURL("**/login");
    };
    const speakingLevel = async () => {
      const label = await page.getByLabel(/^Speaking mastery \d+$/).getAttribute("aria-label");
      return Number(label.match(/\d+/)[0]);
    };

    await page.goto(`${base}/login`, { waitUntil: "networkidle" });
    await persona(/Linh \(Learner\)/);
    await page.getByRole("heading", { name: "My Learning" }).waitFor();
    const before = await speakingLevel();

    // Unlock the speaking activity with the prerequisite quiz.
    await page.getByRole("link", { name: "Practice now" }).click();
    await page.getByRole("heading", { name: "At the market" }).waitFor();
    for (const t of ["How much are the apples?", "No thanks, I'm fine.", "Can I have half a kilo of tomatoes, please?", "Can I pay by card?"])
      await page.getByText(t).click();
    await page.getByRole("button", { name: "Submit answers" }).click();
    await page.getByText(/You scored 100%/).waitFor();
    await page.getByRole("link", { name: "← Back to My Learning" }).click();

    // Mission is now the speaking role-play.
    await page.getByTestId("mission-title").filter({ hasText: "Speaking: Describe your weekend" }).waitFor();
    check("[spk] mission becomes the speaking role-play after the quiz", true);
    check("[spk] mission shows 4 turns", (await page.getByText(/4 turns · role-play/).count()) === 1);
    await shot(page, "spk-1-mission");
    await page.getByRole("link", { name: "Start speaking" }).click();
    await page.getByTestId("speaking-disclosure").waitFor();
    check("[spk] studio states no microphone / recording / AI", /no microphone, no recording, no AI/.test(await page.getByTestId("speaking-disclosure").textContent()));
    await page.getByRole("button", { name: "Start rehearsal" }).click();
    const replies = [
      "It was great, thanks! I went to the beach.",
      "I went with my cousin and her friends.",
      "We swim and eat seafood tomorrow.", // one deliberate slip
      "Definitely — maybe next month.",
    ];
    for (let i = 0; i < replies.length; i++) {
      await page.getByText(`Turn ${i + 1} of 4`).waitFor();
      if (i === 0) await shot(page, "spk-2-turn");
      await page.getByLabel(replies[i]).check();
      await page.getByRole("button", { name: i === 3 ? "I said it — finish" : "I said it — next" }).click();
    }
    await page.getByText("Waiting for your teacher's review").waitFor();
    check("[spk] rehearsal ends in a pending teacher review", true);
    check("[spk] honest score: 3 of 4 natural", (await page.getByText(/replies were the most natural choice/).textContent()).includes("3 of 4"));
    check("[spk] pronunciation tips shown", (await page.getByText("/ˌwiːkˈend/").count()) === 1);
    await shot(page, "spk-3-feedback");
    await page.getByRole("link", { name: "← Back to My Learning" }).click();
    await page.getByRole("heading", { name: "My Learning" }).waitFor();
    check("[spk] mastery unchanged while pending", (await speakingLevel()) === before);

    // Teacher approves.
    await signOut();
    await persona(/Tara \(Teacher\)/);
    await page.getByRole("heading", { name: "Speaking to review (1)" }).waitFor();
    check("[spk] teacher sees the rehearsal in the review queue", true);
    check("[spk] teacher sees the slipped turn with the natural model line", (await page.getByText(/natural: We swam in the morning/).count()) === 1);
    await shot(page, "spk-4-teacher");
    await page.getByRole("button", { name: "Approve for Linh N." }).click();
    await page.getByText("Nothing to review").waitFor();
    check("[spk] approved rehearsal leaves the queue", true);

    // Learner sees the outcome.
    await signOut();
    await persona(/Linh \(Learner\)/);
    await page.getByRole("heading", { name: "My Learning" }).waitFor();
    // The home first paints cached data, then refetches; wait (≤5 s) for the refreshed level.
    let after = await speakingLevel();
    for (let i = 0; i < 25 && after === before; i++) {
      await page.waitForTimeout(200);
      after = await speakingLevel();
    }
    check(`[spk] Speaking mastery moved after approval (${before} → ${after})`, after !== before);
    await shot(page, "spk-5-learner-after");
  } finally {
    await browser.close();
    server.close();
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} E2E checks passed.`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
