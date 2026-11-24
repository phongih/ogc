/*
 * OGC Platform E2E — Course Studio blocks, part A (owner 24/11) on the real API: Tara adds a lesson
 * to A2 Everyday English with an image, an Eagle Flight Match, a Time Detective and a practice
 * question; Sam approves v3; Minh (not pinned yet) gets v3 — answers hidden, the match shows the
 * right-hand side reordered, the events mixed up; he plays them and completes: practice 83%
 * (XP only, not the skill profile); the answers show; Rewards has "+17 XP · … practice 83%".
 * SYNTHETIC data. Stack: platform-stack.mjs. Needs OGC_TEST_PG_ADMIN_URL and Playwright.
 */
import { apiAs, runPlatformJourney } from "./platform-stack.mjs";

runPlatformJourney("platform blocks E2E", async ({ browser, base, check }) => {
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

  // 1) Tara writes the lesson
  await signIn("Tara (Teacher)", "Teaching");
  await nav().getByRole("link", { name: "Courses", exact: true }).click();
  await page.getByRole("link", { name: COURSE }).click();
  const editor = page.getByRole("region", { name: "Editor" });
  await editor.waitFor();
  await editor.getByRole("button", { name: "Add lesson" }).click();
  await editor.getByLabel("Lesson title").fill("Plants around us");
  const add = async (kind) => {
    await editor.getByLabel("Block type").selectOption(kind);
    await editor.getByRole("button", { name: "Add block" }).click();
  };
  const f = (label) => editor.getByLabel(label, { exact: true });
  await add("image");
  await f("Image link (https) · block 1").fill("https://images.example.org/plants.jpg");
  await f("Caption · block 1").fill("Plants by a window");
  await f("Credit · block 1").fill("Synthetic photo");
  await add("eagle_match");
  await f("Match instructions · block 2").fill("Match the plant part to its job");
  await f("Left 1 · block 2").fill("root");
  await f("Right 1 · block 2").fill("drinks water");
  await f("Left 2 · block 2").fill("leaf");
  await f("Right 2 · block 2").fill("catches sunlight");
  await add("time_detective");
  await f("Order instructions · block 3").fill("From seed to plant");
  await f("Event 1 · block 3").fill("Seed planted");
  await f("Event 2 · block 3").fill("Roots grow");
  await f("Event 3 · block 3").fill("Leaves open");
  await add("practice");
  await f("Practice title · block 4").fill("Plant parts");
  await f("Practice question 1 · block 4").fill("What do leaves catch?");
  await f("Option 1 of question 1 · block 4").fill("Rocks");
  await f("Option 2 of question 1 · block 4").fill("Sunlight");
  await f("Correct option 2 of question 1 · block 4").check();
  await editor.getByRole("button", { name: "Save draft" }).click();
  await page.getByText(/^Saved · revision/).waitFor();
  await page.getByRole("button", { name: "Submit for review" }).click();
  await page.getByRole("button", { name: "Withdraw from review" }).waitFor();
  check("[tara] a lesson with image, match, detective and practice — submitted", true);

  // 2) Sam approves v3
  await signIn("Sam (Org Staff)", "Schedule");
  await nav().getByRole("link", { name: "Courses", exact: true }).click();
  await page.getByRole("link", { name: COURSE }).click();
  await page
    .getByRole("region", { name: "Review" })
    .getByRole("button", { name: "Approve and publish v3" })
    .click();
  await page.getByText(/^Published · learners get v3/).waitFor();
  check("[sam] published v3", true);

  // 3) Minh: answers hidden, order mixed up
  const minhApi = await apiAs("iios-principal-learner-2");
  const mine = await minhApi("/v1/me/class-courses");
  const course = mine.find((c) => c.ref === "CS-A2-EVERYDAY");
  const lessonId = course.lessons.at(-1).lessonId;
  const view = await minhApi(`/v1/me/class-courses/CS-A2-EVERYDAY/${lessonId}`);
  const [, match, detective, practice] = view.lesson.blocks;
  check(
    "[api] v3 for Minh; nothing gives the answers away before completion",
    view.version === 3 &&
      match.pairs.every((p) => p.right === "") &&
      match.choices.join("|") === "catches sunlight|drinks water" &&
      detective.events.join("|") ===
        "Seed planted|Roots grow|Leaves open".split("|").sort().join("|") &&
      practice.questions[0].correct === -1,
  );
  await signIn("Minh (Adult learner)", "My make-ups");
  await nav().getByRole("link", { name: "My courses" }).click();
  await page
    .getByRole("region", { name: "Class courses" })
    .getByRole("link", { name: "4. Plants around us" })
    .click();
  await page.getByRole("region", { name: "Match: Match the plant part to its job" }).waitFor();
  check(
    "[minh] the image with its caption and credit",
    ((await page.locator("figure").textContent()) ?? "").includes(
      "Plants by a window · Credit: Synthetic photo",
    ),
  );
  await page.getByLabel("Match for root").selectOption({ label: "drinks water" });
  await page.getByLabel("Match for leaf").selectOption({ label: "catches sunlight" });
  // shown: Leaves open, Roots grow, Seed planted → Seed planted, Roots grow, Leaves open
  await page.getByRole("button", { name: "Move up: Seed planted" }).click();
  await page.getByRole("button", { name: "Move up: Seed planted" }).click();
  await page.getByRole("button", { name: "Move up: Roots grow" }).click();
  const order = await page
    .getByRole("list", { name: "Order of From seed to plant" })
    .locator("li")
    .allTextContents();
  check(
    "[minh] puts the events in order with ↑ / ↓",
    order.map((t) => t.replace(/[↑↓]/g, "").trim()).join("|") ===
      "Seed planted|Roots grow|Leaves open",
  );
  await page.getByRole("button", { name: "Complete lesson" }).click();
  await page.getByRole("alert").filter({ hasText: "answer every practice question" }).waitFor();
  check("[minh] completing without the practice question is refused", true);
  await page.getByRole("radio", { name: "Question 1: Rocks" }).check(); // wrong on purpose
  await page.getByRole("button", { name: "Complete lesson" }).click();
  await page.getByTestId("lesson-done").waitFor();
  check(
    "[minh] done · practice 83% (5 of 6), XP only — not the skill profile",
    ((await page.getByTestId("lesson-done").textContent()) ?? "").includes(
      "practice 83% (XP only, not your skill profile)",
    ),
  );
  const practiceText =
    (await page.getByRole("region", { name: "Practice: Plant parts" }).textContent()) ?? "";
  check(
    "[minh] the answers show after completion",
    practiceText.includes("Sunlight ✓") && practiceText.includes("Rocks ✗"),
  );
  await nav().getByRole("link", { name: "Rewards" }).click();
  await page.getByRole("list", { name: "Recent rewards" }).waitFor();
  const recent = (await page.getByRole("list", { name: "Recent rewards" }).textContent()) ?? "";
  check(
    "[minh] Rewards: +10 completed, +17 practice 83%",
    recent.includes("+10 XP · Plants around us · completed") &&
      recent.includes("+17 XP · Plants around us · practice 83%"),
  );
});
