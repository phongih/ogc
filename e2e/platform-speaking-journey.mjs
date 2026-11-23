/*
 * OGC Platform E2E — speaking review (owner 23/11, slice 5) on the real API: Linh's rehearsal
 * "Describe your weekend" (seed) waits for Tara, her class teacher; it is not Speaking evidence
 * yet. Tara returns it with a note → Sam (staff) sees "returned" evidence in Current Students and
 * the queue read-only; Linh sees the note, picks the replies again and resends (try 2); Tara
 * approves → Linh's Speaking counts one approved rehearsal. Stack: platform-stack.mjs. Needs
 * OGC_TEST_PG_ADMIN_URL and Playwright.
 */
import { runPlatformJourney } from "./platform-stack.mjs";

runPlatformJourney("platform speaking E2E", async ({ browser, base, check }) => {
  const page = await browser.newPage();
  const signIn = async (name, heading) => {
    await page.goto(`${base}/login`);
    if (await page.getByRole("button", { name: "Sign out" }).count())
      await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByRole("button", { name }).click();
    await page.getByRole("heading", { name: heading }).waitFor();
  };
  const nav = () => page.getByRole("navigation", { name: "Platform" });
  const queue = () => page.getByRole("region", { name: "Speaking rehearsals to review" });
  const item = () => queue().getByRole("listitem", { name: "Linh N. — Describe your weekend" });
  const skill = async (k) => (await page.getByTestId(`skill-${k}`).textContent()) ?? "";
  const openLesson = async () => {
    await nav().getByRole("link", { name: "My courses" }).click();
    await page
      .getByRole("region", { name: "Class courses" })
      .getByRole("link", { name: "3. Making plans" })
      .click();
    await page.getByRole("region", { name: "Speaking: Describe your weekend" }).waitFor();
  };
  const status = async () =>
    (await page.getByTestId("speaking-status-a2-l3-b5").textContent()) ?? "";

  // 1) Linh: the rehearsal waits for her teacher; Speaking still from the placement test
  await signIn("Linh (Learner)", "My make-ups");
  await nav().getByRole("link", { name: "My courses" }).click();
  await page.getByRole("region", { name: "My skills" }).waitFor();
  check(
    "[linh] Speaking 55 · placement test only (not approved yet)",
    (await skill("speaking")).includes("55 · placement test only"),
  );
  await openLesson();
  check(
    "[linh] Waiting for your teacher · natural replies 75%",
    (await status()).includes("Waiting for your teacher") && (await status()).includes("75%"),
  );

  // 2) Tara: the queue on Teaching — turn 3 is not natural; return needs a note
  await signIn("Tara (Teacher)", "Teaching");
  await item().waitFor();
  const text = (await item().textContent()) ?? "";
  check(
    "[tara] Linh N. · A2 Morning — Making plans · natural replies 75%",
    text.includes("A2 Morning — Mon/Wed") &&
      text.includes("Making plans") &&
      text.includes("natural replies 75%"),
  );
  check(
    "[tara] ✗ “We swim and eat seafood tomorrow.” · natural: “We swam …”",
    text.includes("✗ “We swim and eat seafood tomorrow.”") &&
      text.includes("natural: “We swam in the morning and had seafood for lunch.”"),
  );
  const ret = page.getByRole("button", { name: "Return Linh N. — Describe your weekend" });
  check("[tara] Return is disabled without a note", await ret.isDisabled());
  await item()
    .getByLabel("Note for the learner (needed to return)")
    .fill("Use the past tense in turn 3.");
  await ret.click();
  await queue().getByText("No rehearsal waiting.").waitFor();
  check("[tara] the queue is empty after the return", (await item().count()) === 0);

  // 3) Sam: returned evidence in Current Students; no review buttons for staff
  await signIn("Sam (Org Staff)", "Schedule");
  await nav().getByRole("link", { name: "Students" }).click();
  await page.getByRole("list", { name: "Students" }).waitFor();
  check(
    "[sam] Linh N. — A speaking rehearsal was returned by the teacher",
    ((await page.getByRole("list", { name: "Evidence for Linh N." }).textContent()) ?? "").includes(
      "A speaking rehearsal was returned by the teacher for another try",
    ),
  );
  check(
    "[sam] the queue is read-only for staff",
    ((await queue().textContent()) ?? "").includes("The class teacher reviews these") &&
      (await queue()
        .getByRole("button", { name: /^Approve/ })
        .count()) === 0,
  );

  // 4) Linh: the note, then try again
  await signIn("Linh (Learner)", "My make-ups");
  await openLesson();
  check(
    "[linh] Returned · “Use the past tense in turn 3.”",
    (await status()).includes("“Use the past tense in turn 3.”"),
  );
  await page
    .getByRole("radio", { name: "Turn 1: It was great, thanks! I went to the beach." })
    .check();
  await page.getByRole("radio", { name: "Turn 2: I went with my cousin and her friends." }).check();
  await page
    .getByRole("radio", { name: "Turn 3: We swam in the morning and had seafood for lunch." })
    .check();
  await page.getByRole("radio", { name: "Turn 4: Definitely — maybe next month." }).check();
  await page.getByRole("button", { name: "Send the rehearsal again (a2-l3-b5)" }).click();
  await page
    .getByTestId("speaking-status-a2-l3-b5")
    .filter({ hasText: "try 2" })
    .waitFor({ timeout: 10_000 })
    .catch(() => {});
  check(
    "[linh] Waiting for your teacher · 100% · try 2",
    (await status()).includes("Waiting for your teacher") &&
      (await status()).includes("100%") &&
      (await status()).includes("try 2"),
  );

  // 5) Tara approves try 2 → Linh's Speaking counts one approved rehearsal
  await signIn("Tara (Teacher)", "Teaching");
  await item().waitFor();
  check("[tara] try 2 · 100%", ((await item().textContent()) ?? "").includes("try 2"));
  await page.getByRole("button", { name: "Approve Linh N. — Describe your weekend" }).click();
  await queue().getByText("No rehearsal waiting.").waitFor();
  await signIn("Linh (Learner)", "My make-ups");
  await nav().getByRole("link", { name: "My courses" }).click();
  await page.getByRole("region", { name: "My skills" }).waitFor();
  check(
    "[linh] Speaking · 1 approved rehearsal (above 55)",
    (await skill("speaking")).includes("1 approved rehearsal") &&
      Number((await skill("speaking")).match(/(\d+) ·/)?.[1]) > 55,
  );
  await openLesson();
  check(
    "[linh] Approved by your teacher — counts for Speaking",
    (await status()).includes("Approved by your teacher"),
  );
});
