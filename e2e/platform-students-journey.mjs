/*
 * OGC Platform E2E — skill profile + Current Students (owner, 22/11 + 23/11) on the real API: Sam
 * sees seven learners with a care level and the evidence behind it (placement-only levels named as
 * such; overdue tuition shown for information, never changing the level); Tara sees her own
 * classes' learners without tuition; Linh sees her skills ("placement test only"); Minh's 100% quiz
 * in his class course lifts Use of English and takes him to OK; Tara marks An absent a second time
 * in a row and An needs support. Stack: platform-stack.mjs. Needs OGC_TEST_PG_ADMIN_URL and
 * Playwright.
 */
import { runPlatformJourney } from "./platform-stack.mjs";

runPlatformJourney("platform students E2E", async ({ browser, base, check }) => {
  const page = await browser.newPage();
  const signIn = async (name, heading) => {
    await page.goto(`${base}/login`);
    if (await page.getByRole("button", { name: "Sign out" }).count())
      await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByRole("button", { name }).click();
    await page.getByRole("heading", { name: heading }).waitFor();
  };
  const nav = () => page.getByRole("navigation", { name: "Platform" });
  const students = async () => {
    await nav().getByRole("link", { name: "Students" }).click();
    await page.getByRole("heading", { name: "Current students" }).waitFor();
    await page.getByRole("list", { name: "Students" }).waitFor();
  };
  const level = (name) => page.getByTestId(`care-${name}`).textContent();
  const evidence = async (name) =>
    (await page.getByRole("list", { name: `Evidence for ${name}` }).textContent()) ?? "";

  // 1) Sam: seven learners, three to watch — each with its evidence
  await signIn("Sam (Org Staff)", "Schedule");
  await students();
  check(
    "[sam] Needs support 0 · Watch 3 · OK 4",
    (await page.getByTestId("count-support").textContent()) === "0" &&
      (await page.getByTestId("count-watch").textContent()) === "3" &&
      (await page.getByTestId("count-ok").textContent()) === "4",
  );
  check(
    "[sam] An P. — Reading 58, below 60 (placement test only)",
    (await level("An P.")) === "Watch" &&
      (await evidence("An P.")).includes("Reading is 58, below 60 (placement test only)"),
  );
  await page.getByRole("button", { name: "Show suggestions and tuition · Vy H." }).click();
  check(
    "[sam] Vy H. is OK though her tuition is overdue (information only)",
    (await level("Vy H.")) === "OK" &&
      ((await page.getByTestId("tuition-Vy H.").textContent()) ?? "").includes("overdue"),
  );

  // 2) Tara: her own classes' learners, no tuition
  await signIn("Tara (Teacher)", "Teaching");
  await students();
  const names = await page
    .getByRole("list", { name: "Students" })
    .getByRole("heading")
    .allTextContents();
  check(
    "[tara] An, Linh, Minh, Huy, Thao — not Ben's Khoa and Vy",
    names.join(",") === "An P.,Linh N.,Minh T.,Huy D.,Thao V.",
  );
  check(
    "[tara] no tuition for a teacher",
    (await page.getByRole("button", { name: /and tuition/ }).count()) === 0,
  );

  // 3) Linh: her skills from the placement test
  await signIn("Linh (Learner)", "My make-ups");
  await nav().getByRole("link", { name: "My courses" }).click();
  await page.getByRole("region", { name: "My skills" }).waitFor();
  check(
    "[linh] Speaking 55 · placement test only; no Students link",
    ((await page.getByTestId("skill-speaking").textContent()) ?? "").includes(
      "55 · placement test only",
    ) && (await nav().getByRole("link", { name: "Students" }).count()) === 0,
  );

  // 4) Minh's 100% quiz lifts Use of English (52 → 71) and takes him to OK
  await signIn("Minh (Adult learner)", "My make-ups");
  await nav().getByRole("link", { name: "My courses" }).click();
  await page
    .getByRole("region", { name: "Class courses" })
    .getByRole("link", { name: "1. At the market" })
    .click();
  await page.getByRole("radio", { name: "Can I have some rice, please?" }).check();
  await page.getByRole("button", { name: "Complete lesson" }).click();
  await page.getByTestId("lesson-done").waitFor();
  await page.getByRole("link", { name: "← My courses" }).click();
  await page
    .getByTestId("skill-use_of_english")
    .filter({ hasText: "71 · 1 quiz" })
    .waitFor({ timeout: 10_000 })
    .catch(() => {});
  check(
    "[minh] Use of English 71 · 1 quiz",
    ((await page.getByTestId("skill-use_of_english").textContent()) ?? "").includes("71 · 1 quiz"),
  );
  await signIn("Sam (Org Staff)", "Schedule");
  await students();
  check("[sam] Minh T. is now OK", (await level("Minh T.")) === "OK");

  // 5) Tara marks An absent again: two in a row → needs support
  await signIn("Tara (Teacher)", "Teaching");
  await page
    .getByRole("link", { name: /A2 — Unit 6/ })
    .first()
    .click();
  await page.getByLabel("An P. absent").check();
  await page.getByLabel("Linh N. present").check();
  await page.getByLabel("Minh T. present").check();
  await page.getByRole("button", { name: "Save attendance" }).click();
  await page.getByRole("status").getByText("Saved.").waitFor();
  await students();
  check(
    "[tara] An P. needs support — absent from the last 2 marked sessions; 1 of 3 attended",
    (await level("An P.")) === "Needs support" &&
      (await evidence("An P.")).includes("Absent from the last 2 marked sessions (attendance)") &&
      (await evidence("An P.")).includes("Attended 1 of 3 marked sessions (33.3%, below 80%)"),
  );
});
