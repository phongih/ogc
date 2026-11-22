/*
 * Learning Studio links — Playwright E2E (NON-PRODUCTION, MOCK; owner decisions 22/11). Tara
 * proposes a Learning Studio course for her class (a draft course cannot be proposed); Sam links
 * the waiting proposal with prep hours, sees completion of the linked class, the prep hours in
 * Workforce and the completion on Current Students; a learner cannot open the page.
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

    // Tara proposes for her own class.
    await persona(/Tara \(Teacher\)/);
    await page.getByRole("link", { name: "Learning Studio courses" }).click();
    const b1 = page.getByRole("region", { name: "Class B1 Evening — Tue/Thu" });
    await b1.waitFor();
    await b1.getByRole("button", { name: /Propose a course/ }).click();
    const results = b1.getByRole("list", { name: /Learning Studio results/ });
    await results.getByText("A2 Pronunciation Lab").waitFor();
    check(
      "[tara] a draft course cannot be proposed",
      /cannot be linked/.test(
        (await results.locator("li").filter({ hasText: "A2 Pronunciation Lab" }).textContent()) ??
          "",
      ),
    );
    await results.getByRole("button", { name: "Propose LS-IELTS-W1" }).click();
    await b1.getByTestId("proposal-LS-IELTS-W1").waitFor();
    check(
      "[tara] proposal waits for center staff",
      /waiting for center staff/.test(
        (await b1.getByTestId("proposal-LS-IELTS-W1").textContent()) ?? "",
      ),
    );
    await shot(page, "01-tara-propose");
    await signOut();

    // Sam links Tara's earlier proposal with 1 h prep.
    await persona(/Sam \(Org Staff\)/);
    await page.getByRole("link", { name: "Center operations" }).first().click();
    await page.getByRole("link", { name: "Learning Studio courses" }).click();
    const sb1 = page.getByRole("region", { name: "Class B1 Evening — Tue/Thu" });
    await sb1.waitFor();
    await sb1.getByLabel("Prep hours for LS-B1-SPEAK").fill("1");
    await sb1.getByRole("button", { name: "Link · LS-B1-SPEAK" }).click();
    await sb1.getByTestId("linked-B1 Evening — Tue/Thu").waitFor();
    check(
      "[sam] links the proposal — prep 1 h counts in Workforce",
      /prep 1 h \/ week \(counts in Workforce\)/.test(
        (await sb1.getByTestId("linked-B1 Evening — Tue/Thu").textContent()) ?? "",
      ),
    );
    const a2 = page.getByRole("region", { name: "Class A2 Morning — Mon/Wed" });
    await a2.getByRole("button", { name: /Show completion/ }).click();
    const table = a2.getByRole("table", { name: /Completion/ });
    await table.waitFor();
    check(
      "[sam] completion of the linked class: 3 learners",
      (await table.locator("tbody tr").count()) === 3,
    );
    await shot(page, "02-sam-courses");

    await page.getByRole("link", { name: "← Center operations" }).click();
    await page.getByRole("link", { name: "Workforce" }).click();
    await page.getByTestId("load-Tara").waitFor();
    check(
      "[sam] Workforce: Tara 3 + 1 h prep = 4 of 2.5 h",
      ((await page.getByTestId("load-Tara").textContent()) ?? "").includes("4 of 2.5 h"),
    );
    await page.getByRole("link", { name: "← Center operations" }).click();
    await page.getByRole("link", { name: "Current students" }).click();
    await page.getByTestId("studio-Linh N.").waitFor();
    check(
      "[sam] Current Students: Linh's Learning Studio completion",
      /A2 Everyday English — Units 6–8: \d of 6 lessons/.test(
        (await page.getByTestId("studio-Linh N.").textContent()) ?? "",
      ),
    );
    await shot(page, "03-students");
    await signOut();

    await persona(/Linh \(Learner\)/);
    await page.goto(`${base}/app/operations/courses`, { waitUntil: "networkidle" });
    check(
      "[linh] a learner cannot open Learning Studio links",
      (await page.getByRole("region", { name: /^Class / }).count()) === 0,
    );
  } catch (e) {
    check(`unexpected: ${e.message.split("\n")[0]}`, false);
  } finally {
    await browser.close();
    server.close();
  }
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`${checks.length - failed}/${checks.length} learning-studio E2E checks passed.`);
  process.exit(failed ? 1 : 0);
}

main();
