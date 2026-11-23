/*
 * OGC Platform E2E — Course Studio (slice 3 part A) on the real API (owner, 22/11 + 23/11): Tara
 * sees her own courses and published ones (never Ben's unpublished draft), adds a block to B1
 * Speaking Confidence, saves (revision 5) and submits it; she cannot approve. Sam approves and
 * publishes v2 — v1 stays in the history unchanged; Olivia sees Ben's course waiting for review and
 * returns it with a note; a learner has no Course Studio. Stack: platform-stack.mjs. Needs
 * OGC_TEST_PG_ADMIN_URL and Playwright.
 */
import { apiAs, runPlatformJourney } from "./platform-stack.mjs";

runPlatformJourney("platform course studio E2E", async ({ browser, base, check }) => {
  const page = await browser.newPage();
  const signIn = async (name, heading) => {
    await page.goto(`${base}/login`);
    if (await page.getByRole("button", { name: "Sign out" }).count())
      await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByRole("button", { name }).click();
    await page.getByRole("heading", { name: heading }).waitFor();
  };
  const nav = () => page.getByRole("navigation", { name: "Platform" });
  const rows = async () =>
    (
      await page.getByRole("table", { name: "Course list" }).locator("tbody tr").allTextContents()
    ).map((t) => t.trim());

  // 1) Tara → Courses: her own and the published ones
  await signIn("Tara (Teacher)", "Teaching");
  await nav().getByRole("link", { name: "Courses", exact: true }).click();
  await page.getByRole("heading", { name: "Course Studio" }).waitFor();
  await page.getByRole("table", { name: "Course list" }).waitFor();
  const tara = await rows();
  check(
    "[tara] three courses: A2 Everyday, B1 Speaking, IELTS (published) — not Ben's draft",
    tara.length === 3 && !tara.some((r) => r.includes("A2 Pronunciation Lab")),
  );

  // 2) Edit B1, save, submit; a teacher never approves
  await page.getByRole("link", { name: "B1 Speaking Confidence" }).click();
  const editor = page.getByRole("region", { name: "Editor" });
  await editor.waitFor();
  check(
    "[tara] unpublished changes on top of v1",
    /unpublished changes/.test((await page.getByTestId("course-status").textContent()) ?? ""),
  );
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
    "[tara] in review; the editor closes; no Approve for a teacher",
    /^In review/.test((await page.getByTestId("course-status").textContent()) ?? "") &&
      (await page.getByRole("region", { name: "Editor" }).count()) === 0 &&
      (await page.getByRole("button", { name: /Approve and publish/ }).count()) === 0,
  );
  const taraApi = await apiAs("iios-principal-teacher-1");
  const b1 = await taraApi("/v1/courses/CS-B1-SPEAK");
  check(
    "[api] the saved draft is stored on the API (3 lessons, the new block in lesson 3)",
    b1.draft.lessons.length === 3 &&
      b1.draft.lessons[2].blocks.some((b) => b.text === "Each side speaks for two minutes."),
  );

  // 3) Sam approves → v2; v1 unchanged
  await signIn("Sam (Org Staff)", "Schedule");
  await nav().getByRole("link", { name: "Courses", exact: true }).click();
  await page.getByTestId("to-review").waitFor();
  check(
    "[sam] B1 Speaking Confidence and A2 Pronunciation Lab wait for review",
    /B1 Speaking Confidence.*A2 Pronunciation Lab|A2 Pronunciation Lab.*B1 Speaking Confidence/.test(
      (await page.getByTestId("to-review").textContent()) ?? "",
    ),
  );
  await page.getByRole("link", { name: "B1 Speaking Confidence" }).click();
  const review = page.getByRole("region", { name: "Review" });
  await review.getByLabel("Review note").fill("Good structure");
  await review.getByRole("button", { name: "Approve and publish v2" }).click();
  await page.getByText(/^Published · learners get v2/).waitFor();
  const history = (await page.getByRole("region", { name: "History" }).textContent()) ?? "";
  check("[sam] published v2; the history keeps v1", /v2/.test(history) && /v1/.test(history));
  const samApi = await apiAs("iios-principal-staff-1");
  const after = await samApi("/v1/courses/CS-B1-SPEAK");
  check(
    "[api] v2 has 3 lessons, v1 still 2; editors cleared",
    after.versions[0].version === 2 &&
      after.versions[0].content.lessons.length === 3 &&
      after.versions[1].content.lessons.length === 2 &&
      after.editorsSinceLastPublication.length === 0,
  );

  // 4) Olivia returns Ben's course with a note
  await signIn("Olivia (Org Admin)", "Schedule");
  await nav().getByRole("link", { name: "Courses", exact: true }).click();
  await page.getByRole("link", { name: "A2 Pronunciation Lab" }).click();
  const r2 = page.getByRole("region", { name: "Review" });
  await r2.getByLabel("Review note").fill("Add a second lesson");
  await r2.getByRole("button", { name: /Return for changes/ }).click();
  await page.getByText(/^Draft — never published/).waitFor();
  check("[olivia] returns Ben's course to draft with a note", true);

  // 5) A learner has no Course Studio
  await signIn("Linh (Learner)", "My make-ups");
  check(
    "[linh] no Courses link",
    (await nav().getByRole("link", { name: "Courses", exact: true }).count()) === 0,
  );
  await page.goto(`${base}/courses`);
  await page.getByText("Course Studio is for staff and class teachers").waitFor();
  check("[linh] /courses says it is for staff and class teachers", true);
});
