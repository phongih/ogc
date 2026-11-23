/*
 * OGC Platform E2E — Admissions on the real API (owner, 22/11 + 23/11): one pipeline with an
 * explainable score; staff add a synthetic lead, assign it, log an activity and lose it with a
 * reason; contact details and a hand-set "first invoice issued" are refused; the score's parts
 * must add up to 100. "Offer"/"enrolled" follow Billing only, which is not on the Platform yet.
 * Stack: platform-stack.mjs. Needs OGC_TEST_PG_ADMIN_URL and Playwright.
 */
import { apiAs, runPlatformJourney } from "./platform-stack.mjs";

runPlatformJourney("platform admissions E2E", async ({ browser, base, check }) => {
  const page = await browser.newPage();
  await page.goto(`${base}/login`);
  await page.getByRole("button", { name: "Sam (Org Staff)" }).click();
  await page.getByRole("heading", { name: "Schedule" }).waitFor();
  const nav = page.getByRole("navigation", { name: "Platform" });

  await nav.getByRole("link", { name: "Admissions" }).click();
  await page.getByRole("heading", { name: "Admissions" }).waitFor();
  await page.getByRole("table", { name: "Funnel" }).waitFor();
  const funnel = await page.getByRole("table", { name: "Funnel" }).textContent();
  check(
    "[sam] dashboard: every step counted from 14 leads",
    /New → Assigned\d+ of 14/.test(funnel ?? ""),
  );
  const sam = await apiAs("iios-principal-staff-1");
  const dash = await sam("/v1/admissions/dashboard");
  check(
    "[sam] lead → enrolled shows its numerator and denominator",
    (await page.getByTestId("lead-to-enrolled").textContent()) ===
      (dash.leadToEnrolled.pct === null ? "—" : `${dash.leadToEnrolled.pct}%`) &&
      (await page.getByText(`${dash.leadToEnrolled.reached} of 14 leads`).count()) === 1,
  );

  // Pipeline: add a synthetic lead
  await page.getByRole("tab", { name: "Pipeline" }).click();
  await page.getByRole("region", { name: "New" }).waitFor();
  await page.getByRole("button", { name: "+ New lead" }).click();
  await page.getByLabel("Lead course").waitFor();
  check(
    "[sam] new-lead options come from the API (3 courses, 3 centers)",
    (await page.getByLabel("Lead course").locator("option").count()) === 3 &&
      (await page.getByLabel("Lead center").locator("option").count()) === 3,
  );
  await page.getByLabel("Lead name").fill("Mai 0903123456");
  await page.getByRole("button", { name: "Add lead" }).click();
  await page.getByRole("alert").filter({ hasText: "no phone numbers" }).waitFor();
  check("[sam] a phone number in the name is refused", true);
  await page.getByLabel("Lead name").fill("Mai Q.");
  await page.getByLabel("Lead course").selectOption("IELTS-B2");
  await page.getByRole("checkbox", { name: "Exam preparation" }).check();
  await page.getByRole("button", { name: "Add lead" }).click();
  const card = page
    .getByRole("region", { name: "New" })
    .getByRole("button", { name: "Open Mai Q." });
  await card.waitFor();
  check("[sam] Mai Q. is in New", true);

  await card.click();
  const lead = page.getByRole("region", { name: "Lead Mai Q." });
  await lead.getByRole("table", { name: "Score of Mai Q." }).waitFor();
  const parts = await lead.getByRole("table", { name: "Score of Mai Q." }).locator("tr").count();
  check("[sam] the score shows its five parts with reasons", parts === 5);

  // Assign → Assigned
  await lead.getByLabel("Counselor for Mai Q.").selectOption({ label: "Olivia (Org Admin)" });
  await lead.getByRole("button", { name: "Assign · Mai Q." }).click();
  await page
    .getByRole("region", { name: "Assigned" })
    .getByRole("button", { name: "Open Mai Q." })
    .waitFor();
  check("[sam] assigning moves Mai to Assigned", true);

  // Activities
  const relead = page.getByRole("region", { name: "Lead Mai Q." });
  await relead.getByLabel("Activity for Mai Q.").fill("Called 0903123456");
  await relead.getByRole("button", { name: "Log · Mai Q." }).click();
  await relead.getByRole("alert").filter({ hasText: "no phone numbers" }).waitFor();
  check("[sam] a phone number in an activity is refused", true);
  await relead.getByLabel("Activity for Mai Q.").fill("First call, wants a trial");
  await relead.getByRole("button", { name: "Log · Mai Q." }).click();
  await relead
    .getByRole("list", { name: "Activities of Mai Q." })
    .getByText("First call, wants a trial")
    .waitFor();
  check(
    "[sam] the activity is logged by Sam",
    (await relead.getByText("Sam (Org Staff)").count()) > 0,
  );

  // No hand-set "first invoice issued"; lost needs a reason
  check(
    "[sam] the stage list offers no 'First invoice issued' / 'Enrolled'",
    (await relead.getByLabel("Stage for Mai Q.").locator("option").allTextContents()).every(
      (t) => t !== "First invoice issued" && t !== "Enrolled",
    ),
  );
  await relead.getByLabel("Stage for Mai Q.").selectOption("lost");
  await relead.getByRole("button", { name: "Move · Mai Q." }).click();
  await relead.getByRole("alert").filter({ hasText: "give a reason" }).waitFor();
  check("[sam] lost without a reason is refused", true);
  await relead.getByLabel("Reason lost for Mai Q.").fill("Chose another center");
  await relead.getByRole("button", { name: "Move · Mai Q." }).click();
  await page
    .getByRole("region", { name: "Lost" })
    .getByRole("button", { name: "Open Mai Q." })
    .waitFor();
  await page.getByText("Lost: Chose another center").waitFor();
  check("[sam] Mai is lost with her reason", true);
  const after = (await sam("/v1/admissions/leads")).find((l) => l.learnerName === "Mai Q.");
  check(
    "[api] Mai's history: new → assigned → lost",
    after?.stageHistory.map((h) => h.stage).join(">") === "new>assigned>lost",
  );

  // Scoring: the parts must add up to 100
  await page.getByRole("tab", { name: "Scoring" }).click();
  await page.getByLabel("Points for Lead source").fill("30");
  await page.getByText("Total 105 / 100").waitFor();
  await page.getByRole("button", { name: "Save scoring" }).click();
  await page.getByRole("alert").filter({ hasText: "add up to 100" }).waitFor();
  check("[sam] a score that adds up to 105 is refused", true);
  await page.getByLabel("Points for Course fit").fill("15");
  await page.getByRole("button", { name: "Save scoring" }).click();
  await page.getByRole("status").filter({ hasText: "Saved" }).waitFor();
  check(
    "[api] settings saved (source 30, course fit 15)",
    (await sam("/v1/admissions/settings")).max.source === 30,
  );

  // A teacher has no Admissions
  const t = await browser.newPage();
  await t.goto(`${base}/login`);
  await t.getByRole("button", { name: "Tara (Teacher)" }).click();
  await t.getByRole("heading", { name: "Teaching" }).waitFor();
  check(
    "[tara] no Admissions link for a teacher",
    (await t
      .getByRole("navigation", { name: "Platform" })
      .getByRole("link", { name: "Admissions" })
      .count()) === 0,
  );
});
