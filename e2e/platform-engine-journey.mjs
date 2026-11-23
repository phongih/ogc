/*
 * OGC Platform E2E — Decision Engine (owner 21/11 + 23/11) on the real API: opening the Engine
 * runs it once (it runs when a page asks); Sam sees 13 rules (11 active) and six events with
 * their evidence — overdue invoices notify staff, placement-only skill levels go to the support
 * list; Sam lowers "Skill below threshold" to 56 and Current Students follows (An is no longer
 * watched); Tara marks An absent a second time and, after "Run now", Tara gets a P1 notification
 * on Teaching and marks it read; a teacher has no Engine page; the engine changed no attendance.
 * Stack: platform-stack.mjs. Needs OGC_TEST_PG_ADMIN_URL and Playwright.
 */
import { apiAs, runPlatformJourney } from "./platform-stack.mjs";

runPlatformJourney("platform engine E2E", async ({ browser, base, check }) => {
  const page = await browser.newPage();
  const signIn = async (name, heading) => {
    await page.goto(`${base}/login`);
    if (await page.getByRole("button", { name: "Sign out" }).count())
      await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByRole("button", { name }).click();
    await page.getByRole("heading", { name: heading }).waitFor();
  };
  const nav = () => page.getByRole("navigation", { name: "Platform" });
  const engine = async () => {
    await nav().getByRole("link", { name: "Engine" }).click();
    await page.getByRole("heading", { name: "Decision Engine" }).waitFor();
  };
  const tab = (name) => page.getByRole("tab", { name }).click();
  const sam = await apiAs("iios-principal-staff-1");

  // 1) Sam opens the Engine: it runs once; rules and events
  await signIn("Sam (Org Staff)", "Schedule");
  await engine();
  await page.getByText("13 rules · 11 active").waitFor();
  check("[sam] 13 rules · 11 active (No practice and class-course activity off)", true);
  await tab("Events");
  const events = page.getByRole("list", { name: "Engine events" });
  await events.waitFor();
  const ev = await events.locator("li").allTextContents();
  check(
    "[sam] six events: three overdue invoices, three placement-only skill levels",
    ev.length === 6 &&
      ev.filter((t) => t.includes("Invoice overdue")).length === 3 &&
      ev.some((t) =>
        t.includes("An P. · A2 Morning — Mon/Wed — Reading is 58, below 60 (placement test only)"),
      ),
  );
  await tab("Action Log");
  const log = (await page.getByRole("table", { name: "Action log" }).textContent()) ?? "";
  check(
    "[sam] actions: notify staff, learners needing support — nothing else",
    log.includes("notify staff") &&
      log.includes("learners needing support") &&
      !log.includes("notify teacher"),
  );
  check(
    "[sam] staff notifications show the overdue invoices",
    ((await page.getByRole("region", { name: "Notifications" }).textContent()) ?? "").includes(
      "Notifications (3)",
    ),
  );

  // 2) Sam lowers "Skill below threshold" to 56 → Current Students follows
  await tab("Rules");
  await page.getByLabel("Skill below threshold: skill below").fill("56");
  await page.getByRole("button", { name: "Save Skill below threshold" }).click();
  await page
    .getByRole("button", { name: "Save Skill below threshold" })
    .waitFor({ state: "detached" });
  const rules = await sam("/v1/engine/rules");
  check(
    "[api] skill_low threshold is 56",
    rules.find((r) => r.kind === "skill_low").params.threshold === 56,
  );
  await nav().getByRole("link", { name: "Students" }).click();
  await page.getByRole("list", { name: "Students" }).waitFor();
  check(
    "[sam] Current Students follows the rule: An P. is OK, Linh and Minh still watched",
    (await page.getByTestId("care-An P.").textContent()) === "OK" &&
      (await page.getByTestId("care-Linh N.").textContent()) === "Watch" &&
      (await page.getByTestId("care-Minh T.").textContent()) === "Watch",
  );

  // 3) Tara marks An absent a second time; "Run now" → a P1 notification for Tara
  const before = (await sam("/v1/students")).find((c) => c.name === "An P.").attendance.marked;
  await signIn("Tara (Teacher)", "Teaching");
  check(
    "[tara] no Engine link for a teacher",
    (await nav().getByRole("link", { name: "Engine" }).count()) === 0,
  );
  await page
    .getByRole("link", { name: /A2 — Unit 6/ })
    .first()
    .click();
  await page.getByLabel("An P. absent").check();
  await page.getByLabel("Linh N. present").check();
  await page.getByLabel("Minh T. present").check();
  await page.getByRole("button", { name: "Save attendance" }).click();
  await page.getByRole("status").getByText("Saved.").waitFor();
  await signIn("Sam (Org Staff)", "Schedule");
  await engine();
  await tab("Job Status");
  await page.getByRole("button", { name: "Run now" }).click();
  await page.getByText(/1 new events/).waitFor();
  check("[sam] Run now: one new event", true);
  await signIn("Tara (Teacher)", "Teaching");
  const inbox = page.getByRole("region", { name: "Notifications" });
  await inbox.waitFor();
  const text = (await inbox.textContent()) ?? "";
  check(
    "[tara] P1 · Absent several sessions in a row: An P. — Absent from the last 2 marked sessions",
    text.includes("P1") &&
      text.includes(
        "Absent several sessions in a row: An P. · A2 Morning — Mon/Wed — Absent from the last 2 marked sessions",
      ),
  );
  await inbox.getByRole("button", { name: "Mark all read" }).click();
  await inbox.waitFor({ state: "detached" });
  check("[tara] marked read: the notifications section goes away", true);
  const after = (await sam("/v1/students")).find((c) => c.name === "An P.");
  check(
    "[api] the engine changed no attendance; An now needs support (Current Students)",
    after.attendance.marked === before + 1 && after.care.level === "support",
  );
});
