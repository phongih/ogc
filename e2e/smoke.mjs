/*
 * OGC v2 — lightweight Playwright E2E smoke (NON-PRODUCTION).
 * Serves the built apps/web/dist with SPA fallback on localhost and drives it with the
 * PRE-INSTALLED Playwright chromium (no browser download, no external network).
 *
 * Run after `pnpm --filter @ogc/web build`:
 *   node e2e/smoke.mjs
 * Exit code 0 = all checks passed.
 */
import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// Playwright is pre-installed globally (not a project dependency, by design: no browser
// download, no added lockfile entry). Resolve it via require from the global tools dir.
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
      if (!filePath.startsWith(DIST)) {
        res.writeHead(403).end();
        return;
      }
      if (urlPath === "/" || !existsSync(filePath) || extname(filePath) === "") {
        filePath = join(DIST, "index.html"); // SPA fallback for history router deep links
      }
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
function check(name, ok) {
  checks.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
}

async function main() {
  if (!existsSync(join(DIST, "index.html"))) {
    console.error("dist/index.html not found — run `pnpm --filter @ogc/web build` first.");
    process.exit(2);
  }
  const server = await startServer();
  const { port } = server.address();
  const base = `http://${HOST}:${port}`;

  const browser = await chromium.launch();
  // Each scenario signs in fresh: a full reload resets the in-memory session AND store,
  // so scenarios are independent and progress is the deterministic seeded baseline.
  async function signIn(page, personaRe) {
    await page.goto(`${base}/login`, { waitUntil: "networkidle" });
    await page.getByText("Choose a demo persona").waitFor();
    await page.getByRole("button", { name: personaRe }).click();
    await page.getByRole("link", { name: "OGC Learning" }).waitFor();
    await page.waitForURL("**/app/**");
  }

  try {
    const page = await browser.newPage();

    // 0) Public landing renders.
    await page.goto(`${base}/`, { waitUntil: "networkidle" });
    check("landing shows an h1", (await page.locator("h1").count()) > 0);

    // ── Scenario A — ADMIN (org staff): directory navigation + route continuity ──
    await signIn(page, /Sam \(Org Staff\)/);
    // Keyboard a11y on the authenticated shell (DOM order == tab order; skip-link first).
    const firstTabbable = await page.evaluate(() => {
      const sel = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';
      return (document.querySelector(sel)?.textContent ?? "").trim();
    });
    check("[admin] skip-to-content link is first in tab order", /skip to content/i.test(firstTabbable));
    await page.getByRole("link", { name: "Directory" }).click();
    await page.getByRole("heading", { name: /Organizations/i }).waitFor();
    await page.getByRole("link", { name: /Nova Learning Group/ }).first().click();
    await page.waitForURL("**/app/orgs/**");
    check("[admin] directory → organization detail route continuity", page.url().includes("/app/orgs/"));

    // ── Scenario B — TEACHER: class roster + progress + lesson plan save ──
    await signIn(page, /Tara \(Teacher\)/);
    await page.getByRole("heading", { name: "Teaching" }).waitFor();
    await page.getByRole("link", { name: "Learner overview" }).first().click();
    await page.getByRole("heading", { name: "Learner overview" }).waitFor();
    await page.getByText("Linh N.").first().waitFor(); // roster loads async
    check("[teacher] sees an assigned-class roster", true);
    await page.getByRole("link", { name: /Open lesson plan editor/ }).click();
    await page.getByLabel("Lesson plan title").fill("Smoke plan");
    await page.getByRole("button", { name: /Save plan/ }).click();
    await page.getByText(/Lesson plan saved/).waitFor();
    check("[teacher] can save a lesson plan draft", true);

    // ── Scenario C — LEARNER: enroll → learn → complete → tutor ──
    await signIn(page, /Linh \(Learner\)/);
    await page.getByRole("heading", { name: "My Learning" }).waitFor();
    await page.getByRole("link", { name: "Resume learning" }).first().click();
    await page.getByRole("progressbar").first().waitFor(); // course-progress panel
    // A quiz with a practice set is completed by PRACTISING it (no self-declared "Mark complete").
    check("[learner] quiz offers no 'Mark complete'", (await page.getByRole("button", { name: /Complete .*Quiz: At the market/ }).count()) === 0);
    await page.getByRole("link", { name: "Practice now" }).first().click();
    await page.getByRole("heading", { name: "At the market" }).waitFor();
    for (const t of ["How much are the apples?", "No thanks, I'm fine.", "Can I have half a kilo of tomatoes, please?", "Can I pay by card?"])
      await page.getByText(t).click();
    await page.getByRole("button", { name: "Submit answers" }).click();
    await page.getByText(/You scored 100%/).waitFor();
    check("[learner] completes an activity by practising it (scored from answers)", true);
    // Empty-state: a brand-new tutor conversation shows the start prompt.
    await page.getByRole("link", { name: "AI Tutor" }).click();
    await page.getByRole("button", { name: /New conversation/ }).click();
    await page.getByText(/Start by asking a question below/).waitFor();
    check("[learner] empty-state renders for a new tutor conversation", true);
    const input = page.getByLabel("Message the tutor");
    await input.fill("How do I order food?");
    await page.getByRole("button", { name: "Send" }).click();
    await page.getByText(/In English we usually say|simple rule|Let's practise|tense first|clearer way/).first().waitFor();
    check("[learner] tutor returns a deterministic reply", true);

    // ── Scenario D — GUARDIAN: linked learner progress + D-14 notice ──
    await signIn(page, /Mai \(Guardian\)/);
    await page.getByRole("heading", { name: "Guardian workspace" }).waitFor();
    check("[guardian] sees a linked learner", (await page.getByText("Linh N.").count()) > 0);
    check(
      "[guardian] D-14 self-verification notice present",
      (await page.getByText(/cannot add or verify a learner link/i).count()) > 0,
    );

    // ── Responsive: guardian workspace still renders its heading at phone width ──
    await page.setViewportSize({ width: 375, height: 720 });
    await page.getByRole("heading", { name: "Guardian workspace" }).waitFor();
    check("[responsive] view renders its heading at 375px width", (await page.locator("h1").count()) > 0);

    // ── Scenario E — MOBILE NAV: drawer at 375px (real media queries apply) ──
    await signIn(page, /Linh \(Learner\)/); // reloads at the 375px viewport
    // Desktop primary nav is hidden at phone width; the toggle is visible.
    const toggle = page.getByRole("button", { name: "Open menu" });
    await toggle.waitFor({ state: "visible" });
    check("[mobile] hamburger toggle visible at 375px", await toggle.isVisible());
    await toggle.click();
    const drawer = page.getByRole("dialog", { name: "Menu" });
    await drawer.waitFor();
    await drawer.getByRole("link", { name: "AI Tutor" }).click();
    await page.getByRole("heading", { name: "AI Tutor" }).waitFor();
    // Drawer closes on selection (route change).
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
    check("[mobile] drawer navigates and closes on route selection", true);

    // ── Scenario F — Track A: catalog URL filters, tutor rename/delete, keyboard help ──
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page, /Linh \(Learner\)/); // fresh reload resets the in-memory store

    // Catalog filter is reflected in the shareable URL query string (no reload: the
    // in-memory session would be lost, so filter via the live UI and read the URL).
    await page.getByRole("link", { name: "Catalog" }).click();
    await page.getByRole("heading", { name: /Course catalog/ }).waitFor();
    await page.getByLabel("Search courses").fill("ielts");
    await page.getByText("IELTS Foundation B2").waitFor();
    check("[catalog] typing a filter narrows results", (await page.getByText("Everyday English A2").count()) === 0);
    check("[catalog] filter is reflected in the shareable URL", page.url().includes("q=ielts"));
    await page.getByRole("button", { name: "Clear filters" }).first().click();
    await page.getByText("Everyday English A2").waitFor();
    check("[catalog] clear filters restores the full catalog", true);

    // Tutor conversation rename + delete (in-memory).
    await page.getByRole("link", { name: "AI Tutor" }).click();
    await page.getByText("Practising A2 plans").waitFor();
    await page.getByRole("button", { name: "Rename Practising A2 plans" }).click();
    const renameInput = page.getByRole("textbox", { name: "Rename Practising A2 plans" });
    await renameInput.fill("Smoke renamed");
    await renameInput.press("Enter");
    await page.getByText("Smoke renamed").waitFor();
    check("[tutor] rename a conversation in place", true);
    await page.getByRole("button", { name: "Delete B1 opinions warm-up" }).click();
    await page.waitForFunction(() => !document.body.textContent.includes("B1 opinions warm-up"));
    check("[tutor] delete a conversation", true);

    // Keyboard shortcut help: "?" opens the dialog, Esc closes it.
    await page.keyboard.press("Shift+Slash");
    await page.getByRole("dialog", { name: "Keyboard shortcuts" }).waitFor();
    check("[a11y] '?' opens the keyboard shortcuts help", true);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
    check("[a11y] Esc closes the keyboard shortcuts help", true);

    // ── Scenario G — LI-1: learner intelligence (evidence-driven next step + mastery) ──
    await signIn(page, /Linh \(Learner\)/); // fresh reload → seeded baseline (speaking weakest = 55)
    await page.getByRole("heading", { name: "My Learning" }).waitFor();
    await page.getByRole("heading", { name: "Learning intelligence" }).waitFor();
    const reason = page.getByTestId("li-recommendation-reason");
    await reason.waitFor();
    const reasonText = (await reason.textContent()) ?? "";
    // Speaking (55) is weakest but prerequisite-blocked → next step targets available Use of
    // English, in learner-friendly language with NO internal activity ids.
    check(
      "[li] next step is learner-friendly (Use of English, title, no ids)",
      /Use of English/.test(reasonText) && /Quiz: At the market/.test(reasonText) && !/ACT-/.test(reasonText),
    );
    check(
      "[li] default next-step source is 'Suggested for you' (system)",
      (await page.locator('[data-source="system"]').count()) >= 1,
    );
    const masteryList = page.getByRole("list", { name: "Skill mastery" });
    await masteryList.waitFor();
    check(
      "[li] mastery strip shows all three skills",
      (await masteryList.getByRole("progressbar").count()) === 3,
    );
    // Learning path renders completed / available / blocked states.
    await page.getByRole("heading", { name: "Learning path" }).waitFor();
    const pathList = page.getByRole("list", { name: "Path steps" });
    await pathList.waitFor();
    check("[li3] path has a completed step", (await pathList.locator('[data-state="completed"]').count()) >= 1);
    check("[li3] path has an available step", (await pathList.locator('[data-state="available"]').count()) >= 1);
    check("[li3] path has a prerequisite-blocked step", (await pathList.locator('[data-state="blocked"]').count()) >= 1);
    // P1 Today's mission: the recommended activity is practice-enabled, so the ONE primary action is
    // "Practice now"; the recommended course stays one quiet link away ("Open the course").
    check("[p1] today's mission shows exactly one primary action", (await page.getByRole("link", { name: "Practice now" }).count()) === 1);
    await page.getByRole("link", { name: "Open the course" }).first().click();
    await page.waitForURL("**/app/learning/courses/**");
    check("[li] mission deep-links to the recommended course", page.url().includes("/app/learning/courses/"));

    // ── Scenario H — Teacher oversight + APPLIED recommendation reaching the learner (LI-4 + AUTH-026) ──
    await signIn(page, /Tara \(Teacher\)/); // fresh reload → seeded baseline, applied-state cleared
    await page.getByRole("heading", { name: "Teaching" }).waitFor();
    await page.getByRole("link", { name: "Learner overview" }).first().click();
    await page.getByRole("heading", { name: "Learner overview" }).waitFor();
    await page.getByText("Linh N.").first().waitFor();
    await page.getByRole("button", { name: "View intelligence for Linh N." }).click();

    const sysRec = page.getByTestId("ti-system-rec");
    await sysRec.waitFor();
    check("[li4] teacher sees the system suggestion by title", (await sysRec.textContent())?.includes("Quiz: At the market") ?? false);
    const prereq = page.getByRole("list", { name: "Prerequisite status" });
    await prereq.waitFor();
    check("[li4] teacher sees a prerequisite-blocked step", (await prereq.locator('[data-state="blocked"]').count()) >= 1);

    // The blocked speaking activity must NOT be selectable; an available one must be.
    const altSelect = page.getByLabel("Alternative activity", { exact: true });
    const optionValues = await altSelect.locator("option").evaluateAll((os) => os.map((o) => o.value));
    check("[li4] blocked activity is not an apply option", !optionValues.includes("ACT-A2-4"));
    check("[li4] an available activity is an apply option", optionValues.includes("ACT-B1-2"));

    // Apply an eligible alternative — this reaches the learner.
    await altSelect.selectOption("ACT-B1-2");
    await page.getByLabel("Reason code").selectOption("remediation");
    await page.getByLabel("Intervention note").fill("Focus on opinion phrases first");
    await page.getByRole("button", { name: "Apply for learner" }).click();
    const teacherActive = page.getByTestId("ti-teacher-active");
    await teacherActive.waitFor();
    check("[li5] applied recommendation is active (shown by title)", /Quiz: Opinion phrases/.test((await teacherActive.textContent()) ?? ""));
    check("[li5] system suggestion preserved alongside the applied one", (await sysRec.textContent())?.includes("Quiz: At the market") ?? false);

    // Switch to the learner WITHOUT a reload (SPA sign-out keeps the in-memory applied state).
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByText("Choose a demo persona").waitFor();
    await page.getByRole("button", { name: /Linh \(Learner\)/ }).click();
    await page.waitForURL("**/app/**");
    await page.getByRole("heading", { name: "My Learning" }).waitFor();
    const lReason = page.getByTestId("li-recommendation-reason");
    await lReason.waitFor();
    const lText = (await lReason.textContent()) ?? "";
    check("[li5] learner now sees a TEACHER-recommended next step", (await page.locator('[data-source="teacher"]').count()) >= 1);
    check("[li5] teacher recommendation reaches the learner by title, no ids", /Quiz: Opinion phrases/.test(lText) && !/ACT-/.test(lText));
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
