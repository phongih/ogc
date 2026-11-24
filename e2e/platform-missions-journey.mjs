/*
 * OGC Platform E2E — Course Studio blocks, part B (owner 24/11): Mission Box on the real API.
 * Tara adds a lesson with a mission; Sam approves v3; Minh cannot complete it without confirming
 * the mission, then ticks it with a note → waiting for the class teacher. Sam sees the queue
 * read-only; Tara returns it with a note; Minh sends it again with a new note; Tara approves →
 * Rewards "+20 XP · Mission: … approved by your teacher" and the Explorer badge (XP only — no
 * skill evidence). SYNTHETIC data. Stack: platform-stack.mjs. Needs OGC_TEST_PG_ADMIN_URL and
 * Playwright.
 */
import { apiAs, runPlatformJourney } from "./platform-stack.mjs";

runPlatformJourney("platform missions E2E", async ({ browser, base, check }) => {
  const page = await browser.newPage();
  const signIn = async (name, heading) => {
    await page.goto(`${base}/login`);
    if (await page.getByRole("button", { name: "Sign out" }).count())
      await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByRole("button", { name }).click();
    await page.getByRole("heading", { name: heading }).waitFor();
  };
  const nav = () => page.getByRole("navigation", { name: "Platform" });
  const COURSE = "A2 Everyday English — Units 6–8";
  const TITLE = "Seed & Stem Explorer";
  const queue = () => page.getByRole("region", { name: "Missions to review" });
  const item = () => queue().getByRole("listitem", { name: `Minh T. — ${TITLE}` });

  // 1) Tara writes a lesson with a mission; Sam publishes v3
  await signIn("Tara (Teacher)", "Teaching");
  await nav().getByRole("link", { name: "Courses", exact: true }).click();
  await page.getByRole("link", { name: COURSE }).click();
  const editor = page.getByRole("region", { name: "Editor" });
  await editor.waitFor();
  await editor.getByRole("button", { name: "Add lesson" }).click();
  await editor.getByLabel("Lesson title").fill("Plants around us");
  await editor.getByLabel("Block type").selectOption("mission_box");
  await editor.getByRole("button", { name: "Add block" }).click();
  const f = (label) => editor.getByLabel(label, { exact: true });
  await f("Mission title · block 1").fill(TITLE);
  await f("Mission task · block 1").fill("Find 1 leaf and 1 seed around your house.");
  await f("Why it matters · block 1").fill("Plants use seeds to grow new life.");
  await editor.getByRole("button", { name: "Save draft" }).click();
  await page.getByText(/^Saved · revision/).waitFor();
  await page.getByRole("button", { name: "Submit for review" }).click();
  await page.getByRole("button", { name: "Withdraw from review" }).waitFor();
  await signIn("Sam (Org Staff)", "Schedule");
  await nav().getByRole("link", { name: "Courses", exact: true }).click();
  await page.getByRole("link", { name: COURSE }).click();
  await page
    .getByRole("region", { name: "Review" })
    .getByRole("button", { name: "Approve and publish v3" })
    .click();
  await page.getByText(/^Published · learners get v3/).waitFor();
  check("[tara → sam] a lesson with a Mission Box — v3 published", true);

  // 2) Minh confirms the mission
  const openLesson = async () => {
    await nav().getByRole("link", { name: "My courses" }).click();
    await page
      .getByRole("region", { name: "Class courses" })
      .getByRole("link", { name: "4. Plants around us" })
      .click();
    await page.getByRole("region", { name: `Mission: ${TITLE}` }).waitFor();
  };
  const status = async () =>
    (await page.locator('[data-testid^="mission-status-"]').textContent()) ?? "";
  await signIn("Minh (Adult learner)", "My make-ups");
  await openLesson();
  check(
    "[minh] the task and why it matters",
    ((await page.getByRole("region", { name: `Mission: ${TITLE}` }).textContent()) ?? "").includes(
      "Why it matters: Plants use seeds to grow new life.",
    ),
  );
  await page.getByRole("button", { name: "Complete lesson" }).click();
  await page.getByRole("alert").filter({ hasText: "confirm every mission you did" }).waitFor();
  check("[minh] completing without confirming the mission is refused", true);
  await page.getByRole("checkbox", { name: `I did this mission: ${TITLE}` }).check();
  await page.getByLabel(`What did you notice? ${TITLE}`).fill("A round seed and a green leaf.");
  await page.getByRole("button", { name: "Complete lesson" }).click();
  await page.getByTestId("lesson-done").waitFor();
  check(
    "[minh] done · Waiting for your teacher — XP once approved",
    (await status()).includes("Waiting for your teacher — XP once approved"),
  );

  // 3) Sam sees the queue read-only; Tara returns it with a note
  await signIn("Sam (Org Staff)", "Schedule");
  await nav().getByRole("link", { name: "Students" }).click();
  await item().waitFor();
  check(
    "[sam] the mission queue is read-only for staff",
    ((await queue().textContent()) ?? "").includes("The class teacher reviews these") &&
      (await queue()
        .getByRole("button", { name: /^Approve/ })
        .count()) === 0,
  );
  await signIn("Tara (Teacher)", "Teaching");
  await item().waitFor();
  check(
    "[tara] the learner's note in the queue",
    ((await item().textContent()) ?? "").includes("“A round seed and a green leaf.”"),
  );
  const ret = page.getByRole("button", { name: `Return Minh T. — ${TITLE}` });
  check("[tara] Return is disabled without a note", await ret.isDisabled());
  await item()
    .getByLabel("Note for the learner (needed to return)")
    .fill("What colour is the seed?");
  await ret.click();
  await queue().getByText("No mission waiting.").waitFor();
  check("[tara] the queue is empty after the return", true);

  // 4) Minh reads the note and sends it again
  await signIn("Minh (Adult learner)", "My make-ups");
  await openLesson();
  check(
    "[minh] Returned · “What colour is the seed?”",
    (await status()).includes("Returned by your teacher") &&
      (await status()).includes("“What colour is the seed?”"),
  );
  await page.getByLabel(`What did you notice? ${TITLE}`).fill("The seed is brown.");
  await page.getByRole("button", { name: /^Send the mission again/ }).click();
  await page
    .locator('[data-testid^="mission-status-"]')
    .filter({ hasText: "try 2" })
    .waitFor({ timeout: 10_000 })
    .catch(() => {});
  check(
    "[minh] Waiting for your teacher · try 2",
    (await status()).includes("Waiting for your teacher") && (await status()).includes("try 2"),
  );

  // 5) Tara approves → XP and the Explorer badge, no skill evidence
  await signIn("Tara (Teacher)", "Teaching");
  await item().waitFor();
  check(
    "[tara] try 2 · “The seed is brown.”",
    ((await item().textContent()) ?? "").includes("try 2") &&
      ((await item().textContent()) ?? "").includes("“The seed is brown.”"),
  );
  await page.getByRole("button", { name: `Approve Minh T. — ${TITLE}` }).click();
  await queue().getByText("No mission waiting.").waitFor();
  await signIn("Minh (Adult learner)", "My make-ups");
  await nav().getByRole("link", { name: "Rewards" }).click();
  await page.getByRole("list", { name: "Recent rewards" }).waitFor();
  const recent = (await page.getByRole("list", { name: "Recent rewards" }).textContent()) ?? "";
  check(
    "[minh] Rewards: +20 XP · Mission: … approved by your teacher; Explorer earned",
    recent.includes(`+20 XP · Mission: ${TITLE} · approved by your teacher`) &&
      (await page.getByRole("list", { name: "Badges" }).getByLabel("Explorer (earned)").count()) ===
        1,
  );
  const minhApi = await apiAs("iios-principal-learner-2");
  const skills = await minhApi("/v1/me/skills");
  check(
    "[api] no skill evidence from the mission",
    Object.values(skills.skills).every((s) => s.evidenceCount === 0),
  );
});
