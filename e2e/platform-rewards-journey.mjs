/*
 * OGC Platform E2E — gamification (owner 24/11) on the real API: Linh sees Level 1 · 30 XP from
 * yesterday's lesson ("Making plans", quiz 100%), a 1-day streak, First step + Perfect score and
 * the A2 Morning leaderboard; Tara approves her speaking rehearsal → +25 XP and "Heard you"; Mai
 * sees Linh's rank without classmates' names; Sam (rewards:manage) gives 50 XP for a scored
 * practice and turns the leaderboard off → Linh's XP and card follow at once; Tara has no Rewards.
 * SYNTHETIC data. Stack: platform-stack.mjs. Needs OGC_TEST_PG_ADMIN_URL and Playwright.
 */
import { runPlatformJourney } from "./platform-stack.mjs";

runPlatformJourney("platform rewards E2E", async ({ browser, base, check }) => {
  const page = await browser.newPage();
  const signIn = async (name, heading) => {
    await page.goto(`${base}/login`);
    if (await page.getByRole("button", { name: "Sign out" }).count())
      await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByRole("button", { name }).click();
    await page.getByRole("heading", { name: heading }).waitFor();
  };
  const nav = () => page.getByRole("navigation", { name: "Platform" });
  const card = () => page.getByRole("region", { name: "Streak & rewards" });
  const text = async (loc) => (await loc.textContent()) ?? "";

  // 1) Linh: rewards from yesterday's lesson
  await signIn("Linh (Learner)", "My make-ups");
  await nav().getByRole("link", { name: "Rewards" }).click();
  await card().waitFor();
  check(
    "[linh] Level 1 · 30 XP, a 1-day streak (learn today to keep it)",
    (await text(page.getByTestId("level"))) === "Level 1" &&
      (await text(page.getByTestId("xp"))) === "30 XP" &&
      (await text(page.getByTestId("streak"))).includes(
        "1-day learning streak · learn today to keep it",
      ),
  );
  const recent = await text(card().getByRole("list", { name: "Recent rewards" }));
  check(
    "[linh] every reward names its evidence",
    recent.includes("+10 XP · Making plans · completed") &&
      recent.includes("+20 XP · Making plans · scored 100%"),
  );
  check(
    "[linh] badges: First step + Perfect score earned, Heard you locked",
    (await card().getByLabel("First step (earned)").count()) === 1 &&
      (await card().getByLabel("Perfect score (earned)").count()) === 1 &&
      (await card()
        .getByLabel(/^Heard you \(locked/)
        .count()) === 1,
  );
  const board = await text(card().getByRole("list", { name: "Class leaderboard" }));
  check(
    "[linh] A2 Morning this week: #1 Linh (you) 30 XP; An and Minh share #2",
    (await text(card())).includes("This week in A2 Morning — Mon/Wed") &&
      board.includes("#1 Linh N. (you)30 XP") &&
      board.includes("#2 An P.0 XP") &&
      board.includes("#2 Minh T.0 XP"),
  );

  // 2) Tara approves the rehearsal → +25 XP, "Heard you"
  await signIn("Tara (Teacher)", "Teaching");
  check(
    "[tara] teachers have no Rewards link",
    (await nav().getByRole("link", { name: "Rewards" }).count()) === 0,
  );
  await page.getByRole("button", { name: "Approve Linh N. — Describe your weekend" }).click();
  await page
    .getByRole("region", { name: "Speaking rehearsals to review" })
    .getByText("No rehearsal waiting.")
    .waitFor();
  await signIn("Linh (Learner)", "My make-ups");
  await page.goto(`${base}/my-rewards`);
  await card().waitFor();
  check(
    "[linh] 55 XP, active today, Heard you earned",
    (await text(page.getByTestId("xp"))) === "55 XP" &&
      !(await text(page.getByTestId("streak"))).includes("learn today") &&
      (await card().getByLabel("Heard you (earned)").count()) === 1 &&
      (await text(card().getByRole("list", { name: "Recent rewards" }))).includes(
        "+25 XP · Speaking · Making plans · approved by your teacher",
      ),
  );

  // 3) Mai: Linh's rank only
  await signIn("Mai (Guardian)", "Make-ups · your child");
  await nav().getByRole("link", { name: "Rewards" }).click();
  const child = page.getByRole("region", { name: "Rewards · Linh N." });
  await child.waitFor();
  check(
    "[mai] Linh N. is #1 of 3 this week (55 XP) — no classmates' names",
    (await text(page.getByTestId("rank"))).includes("Linh N. is #1 of 3 this week (55 XP)") &&
      !(await text(child)).includes("An P.") &&
      !(await text(child)).includes("Minh T."),
  );

  // 4) Sam tunes the catalog
  await signIn("Sam (Org Staff)", "Schedule");
  await nav().getByRole("link", { name: "Engine" }).click();
  await page.getByRole("link", { name: /Rewards \(gamification\) settings/ }).click();
  await page.getByLabel("Practice scored: XP").waitFor();
  await page.getByLabel("Practice scored: XP").fill("50");
  await page.getByLabel("Weekly class leaderboard").uncheck();
  await page.getByRole("button", { name: "Save rewards" }).click();
  await page.getByRole("status").filter({ hasText: "Saved." }).waitFor();
  check("[sam] saved — practice 50 XP, leaderboard off", true);
  await page.getByLabel("XP per level").fill("5");
  await page.getByRole("button", { name: "Save rewards" }).click();
  await page.getByRole("alert").waitFor();
  check(
    "[sam] out-of-range value refused",
    (await text(page.getByRole("alert"))).includes("XP per level must be 10–1000"),
  );

  await signIn("Linh (Learner)", "My make-ups");
  await page.goto(`${base}/my-rewards`);
  await card().waitFor();
  check(
    "[linh] 85 XP (10 + 50 + 25), no leaderboard",
    (await text(page.getByTestId("xp"))) === "85 XP" &&
      (await card().getByRole("list", { name: "Class leaderboard" }).count()) === 0,
  );

  // 5) Tara: the settings page is for staff
  await signIn("Tara (Teacher)", "Teaching");
  await page.goto(`${base}/rewards`);
  await page.getByText("Rewards are set by center staff").waitFor();
  check("[tara] the settings page is staff only", true);
});
