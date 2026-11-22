/*
 * Course Studio — Playwright E2E (NON-PRODUCTION, MOCK; owner decisions 22/11). Tara edits her
 * course and submits it; she proposes a published course for her class (another teacher's draft
 * is not offered). Olivia approves Tara's course (v2) and links the waiting proposal with prep
 * hours; Workforce counts them. Linh takes a lesson of her class course in My Learning; her
 * completion shows on Current Students. A learner cannot open Course Studio.
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

    // Tara edits her B1 course, saves, submits; proposes a published course for B1.
    await persona(/Tara \(Teacher\)/);
    await page.getByRole("link", { name: "Course Studio" }).click();
    await page.getByRole("table", { name: "Course list" }).waitFor();
    await page.getByRole("link", { name: "B1 Speaking Confidence" }).click();
    const editor = page.getByRole("region", { name: "Editor" });
    await editor.waitFor();
    await editor.getByRole("button", { name: /3\. Short debates/ }).click();
    await editor.getByLabel("Block type").selectOption("text");
    await editor.getByRole("button", { name: "Add block" }).click();
    await editor.getByLabel("Text · block 2").fill("Each side speaks for two minutes.");
    await editor.getByRole("button", { name: "Save draft" }).click();
    await page.getByText(/^Saved · revision 5/).waitFor();
    check("[tara] adds a block and saves the draft (revision 5)", true);
    await page.getByRole("button", { name: "Submit for review" }).click();
    await page.getByRole("button", { name: "Withdraw from review" }).waitFor();
    check(
      "[tara] submitted — in review, editor locked",
      /^In review/.test((await page.getByTestId("course-status").textContent()) ?? "") &&
        (await page.getByRole("region", { name: "Editor" }).count()) === 0,
    );
    await shot(page, "01-tara-submit");
    await page.getByRole("link", { name: "← Course Studio" }).click();
    const b1 = page.getByRole("region", { name: "Class B1 Evening — Tue/Thu" });
    await b1.waitFor();
    await b1.getByRole("button", { name: /Propose a course/ }).click();
    const results = b1.getByRole("list", { name: /Course results/ });
    await results.getByText("IELTS Writing Task 1 — Charts").waitFor();
    check(
      "[tara] another teacher's unpublished course is not offered",
      (await results.getByText("A2 Pronunciation Lab").count()) === 0,
    );
    await results.getByRole("button", { name: "Propose CS-IELTS-W1" }).click();
    await b1.getByTestId("proposal-CS-IELTS-W1").waitFor();
    check(
      "[tara] proposal waits for center staff",
      /waiting for center staff/.test(
        (await b1.getByTestId("proposal-CS-IELTS-W1").textContent()) ?? "",
      ),
    );
    await signOut();

    // Olivia approves Tara's course and links the earlier proposal with 1 h prep.
    await persona(/Olivia \(Org Admin\)/);
    await page.getByRole("link", { name: "Center operations" }).first().click();
    await page.getByRole("link", { name: "Course Studio" }).click();
    await page.getByTestId("to-review").waitFor();
    check(
      "[olivia] sees what waits for review",
      /B1 Speaking Confidence/.test((await page.getByTestId("to-review").textContent()) ?? ""),
    );
    await page.getByRole("link", { name: "B1 Speaking Confidence" }).click();
    const review = page.getByRole("region", { name: "Review" });
    await review.getByLabel("Review note").fill("Good structure");
    await review.getByRole("button", { name: "Approve and publish v2" }).click();
    await page.getByText(/^Published · learners get v2/).waitFor();
    check(
      "[olivia] approved — v2 in the publication history",
      /approved by Olivia \(Org Admin\)/.test(
        (await page.getByRole("region", { name: "History" }).textContent()) ?? "",
      ),
    );
    await shot(page, "02-olivia-approve");
    await page.getByRole("link", { name: "← Course Studio" }).click();
    const sb1 = page.getByRole("region", { name: "Class B1 Evening — Tue/Thu" });
    await sb1.waitFor();
    await sb1.getByLabel("Prep hours for CS-B1-SPEAK").fill("1");
    await sb1.getByRole("button", { name: "Link · CS-B1-SPEAK" }).click();
    await sb1.getByTestId("linked-B1 Evening — Tue/Thu").waitFor();
    check(
      "[olivia] links the proposal (v2) — prep 1 h counts in Workforce",
      /v2.*prep 1 h \/ week \(counts in Workforce\)/s.test(
        (await sb1.getByTestId("linked-B1 Evening — Tue/Thu").textContent()) ?? "",
      ),
    );
    await page.getByRole("link", { name: "← Center operations" }).click();
    await page.getByRole("link", { name: "Workforce" }).click();
    await page.getByTestId("load-Tara").waitFor();
    check(
      "[olivia] Workforce: Tara 3 + 1 h prep = 4 of 2.5 h",
      ((await page.getByTestId("load-Tara").textContent()) ?? "").includes("4 of 2.5 h"),
    );
    await signOut();

    // Linh takes lesson 1 of her class course in My Learning.
    await persona(/Linh \(Learner\)/);
    const mine = page.getByRole("region", { name: "Class courses" });
    await mine.waitFor();
    await mine.getByRole("link", { name: "1. At the market" }).click();
    await page.getByRole("radio", { name: "Can I have some rice, please?" }).check();
    await page.getByRole("button", { name: "Complete lesson" }).click();
    await page.getByTestId("lesson-done").waitFor();
    check(
      "[linh] lesson completed — quiz 100% counts in the skill profile",
      /quiz 100% \(counts in your skill profile\)/.test(
        (await page.getByTestId("lesson-done").textContent()) ?? "",
      ),
    );
    await shot(page, "03-linh-lesson");
    await page.goto(`${base}/app/operations/courses`, { waitUntil: "networkidle" });
    check(
      "[linh] a learner cannot open Course Studio",
      (await page.getByRole("region", { name: /^Class / }).count()) === 0,
    );
    // A full page load signs the demo session out; the demo data stays (saved in the browser).
    await page.goto(`${base}/login`, { waitUntil: "networkidle" });

    // Sam sees Linh's completion on Current Students.
    await persona(/Sam \(Org Staff\)/);
    await page.getByRole("link", { name: "Center operations" }).first().click();
    await page.getByRole("link", { name: "Current students" }).click();
    await page.getByTestId("studio-Linh N.").waitFor();
    check(
      "[sam] Current Students: Linh 1 of 3 lessons",
      /A2 Everyday English — Units 6–8: 1 of 3 lessons/.test(
        (await page.getByTestId("studio-Linh N.").textContent()) ?? "",
      ),
    );
  } catch (e) {
    check(`unexpected: ${e.message.split("\n")[0]}`, false);
  } finally {
    await browser.close();
    server.close();
  }
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`${checks.length - failed}/${checks.length} course-studio E2E checks passed.`);
  process.exit(failed ? 1 : 0);
}

main();
