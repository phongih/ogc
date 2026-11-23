/*
 * OGC Platform E2E — class courses + My Learning (slice 3 part B) on the real API (owner, 22/11 +
 * 23/11): Tara sees her two classes (A2 Morning follows the A2 course; her B1 proposal waits) and
 * proposes the IELTS course for B1 Evening; Sam links B1 Speaking Confidence to B1 Evening with
 * 1 h of prep a week, which shows in Workforce as "Course prep" for Tara; Sam sees A2 Morning's
 * completion (An P. stays on v1); Linh takes lesson 1 in My courses — the answer shows only after
 * she completes it — and her progress reaches the class view; Ben sees only his class. Stack:
 * platform-stack.mjs. Needs OGC_TEST_PG_ADMIN_URL and Playwright.
 */
import { apiAs, runPlatformJourney } from "./platform-stack.mjs";

runPlatformJourney("platform class courses E2E", async ({ browser, base, check }) => {
  const page = await browser.newPage();
  const signIn = async (name, heading) => {
    await page.goto(`${base}/login`);
    if (await page.getByRole("button", { name: "Sign out" }).count())
      await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByRole("button", { name }).click();
    await page.getByRole("heading", { name: heading }).waitFor();
  };
  const nav = () => page.getByRole("navigation", { name: "Platform" });
  const courses = async () => {
    await nav().getByRole("link", { name: "Courses", exact: true }).click();
    await page.getByRole("heading", { name: "Course Studio" }).waitFor();
  };
  const A2 = "A2 Morning — Mon/Wed";
  const B1 = "B1 Evening — Tue/Thu";
  const card = (name) => page.getByRole("region", { name: `Class ${name}` });

  // 1) Tara: her two classes; she proposes the IELTS course for B1 Evening
  await signIn("Tara (Teacher)", "Teaching");
  await courses();
  await card(B1).getByTestId("proposal-CS-B1-SPEAK").waitFor();
  check(
    "[tara] A2 Morning follows the A2 course; her B1 proposal waits; no Link button for a teacher",
    (await card(A2).getByTestId(`linked-${A2}`).count()) === 1 &&
      (await card(B1).getByRole("button", { name: "Link · CS-B1-SPEAK" }).count()) === 0,
  );
  await card(B1)
    .getByRole("button", { name: `Propose a course · ${B1}` })
    .click();
  const results = card(B1).getByRole("list", { name: `Course results · ${B1}` });
  await results.getByText("IELTS Writing Task 1 — Charts").waitFor();
  check(
    "[tara] finds published courses only — not Ben's unpublished A2 Pronunciation Lab",
    (await results.getByText("A2 Pronunciation Lab").count()) === 0,
  );
  await results.getByRole("button", { name: "Propose CS-IELTS-W1" }).click();
  await card(B1).getByTestId("proposal-CS-IELTS-W1").waitFor();
  check("[tara] proposes IELTS Writing Task 1 for B1 Evening", true);

  // 2) Sam links B1 Speaking Confidence with 1 h prep / week → Workforce
  await signIn("Sam (Org Staff)", "Schedule");
  const samApi = await apiAs("iios-principal-staff-1");
  const before = (await samApi("/v1/workforce")).teachers.find((t) => t.name === "Tara");
  await courses();
  await card(B1).getByLabel("Prep hours for CS-B1-SPEAK").fill("1");
  await card(B1).getByRole("button", { name: "Link · CS-B1-SPEAK" }).click();
  await card(B1).getByTestId(`linked-${B1}`).waitFor();
  check(
    "[sam] B1 Evening follows B1 Speaking Confidence · prep 1 h / week (counts in Workforce)",
    ((await card(B1).getByTestId(`linked-${B1}`).textContent()) ?? "").includes(
      "prep 1 h / week (counts in Workforce)",
    ),
  );
  const after = (await samApi("/v1/workforce")).teachers.find((t) => t.name === "Tara");
  check(
    "[api] Tara's load grows by 1 h of course prep, no new session",
    Math.abs(after.hours - before.hours - 1) < 1e-9 &&
      after.sessions === before.sessions &&
      after.breakdown.some((b) => b.kind === "prep" && b.label === B1 && b.hours === 1),
  );
  await nav().getByRole("link", { name: "Workforce" }).click();
  await page.getByTestId("load-Tara").waitFor();
  await page.getByRole("button", { name: "Details · Tara" }).click();
  const taraRows = page.getByRole("list", { name: "Sessions of Tara" });
  await taraRows.waitFor();
  check(
    "[sam] Workforce shows Tara's course prep: B1 Evening · Course prep · 1 h / week",
    ((await taraRows.textContent()) ?? "").includes(`${B1} · Course prep · 1 h / week`),
  );

  // 3) Completion of A2 Morning: An stays on v1
  await courses();
  await card(A2)
    .getByRole("button", { name: `Show completion · ${A2}` })
    .click();
  const table = card(A2).getByRole("table", { name: `Completion · ${A2}` });
  await table.waitFor();
  const rows = (await table.locator("tbody tr").allTextContents()).map((t) => t.trim());
  check(
    "[sam] An P. v1 · 1 of 2; Linh N. 1 of 3 (Making plans, seed); Minh T. 0 of 3",
    rows.some((r) => r.startsWith("An P.v11 of 2")) &&
      rows.some((r) => r.startsWith("Linh N.v21 of 3")) &&
      rows.some((r) => r.startsWith("Minh T.v20 of 3")),
  );

  // 4) Linh takes lesson 1 in My courses
  await signIn("Linh (Learner)", "My make-ups");
  await nav().getByRole("link", { name: "My courses" }).click();
  await page.getByRole("heading", { name: "My courses" }).waitFor();
  const mine = page.getByRole("region", { name: "Class courses" });
  await mine.getByText("A2 Everyday English — Units 6–8").waitFor();
  check(
    "[linh] the A2 course of her class, version 2, 1 of 3 lessons",
    ((await mine.textContent()) ?? "").includes("version 2") &&
      ((await mine.textContent()) ?? "").includes("1 of 3 lessons done"),
  );
  await mine.getByRole("link", { name: "1. At the market" }).click();
  await page.getByRole("radio", { name: "Can I have some rice, please?" }).waitFor();
  const linhApi = await apiAs("iios-principal-learner-1");
  const l1 = await linhApi("/v1/me/class-courses/CS-A2-EVERYDAY/a2-l1");
  check(
    "[api] the answer is hidden before the lesson is completed",
    l1.lesson.blocks.find((b) => b.kind === "quiz").correct === -1,
  );
  await page.getByRole("button", { name: "Complete lesson" }).click();
  await page.getByRole("alert").filter({ hasText: "answer every question" }).waitFor();
  check("[linh] completing without answering is refused", true);
  await page.getByRole("radio", { name: "Can I have some rice, please?" }).check();
  await page.getByRole("button", { name: "Complete lesson" }).click();
  await page.getByTestId("lesson-done").waitFor();
  const done = (await page.getByTestId("lesson-done").textContent()) ?? "";
  check(
    "[linh] lesson completed · quiz 100% (no skill-profile claim on the Platform)",
    done.includes("quiz 100%") && !done.includes("skill profile"),
  );
  await page.getByRole("link", { name: "Next lesson →" }).waitFor();
  const prog = await samApi("/v1/class-courses/SL-1/progress");
  check(
    "[api] Linh's progress reaches the class view: 2 of 3 on v2",
    prog.some((r) => r.name === "Linh N." && r.completedLessons === 2 && r.version === 2),
  );

  // 5) Ben sees only his class
  await signIn("Ben (Teacher)", "Teaching");
  await courses();
  await card("A2 Evening — Tue/Thu").waitFor();
  check(
    "[ben] only A2 Evening — Tue/Thu",
    (await page.getByRole("region", { name: /^Class / }).count()) === 1,
  );
});
