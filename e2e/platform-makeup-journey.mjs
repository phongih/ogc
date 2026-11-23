/*
 * OGC Platform E2E — make-ups across all four roles, on the real API (owner, 23/11):
 *   Tara marks Linh absent → Sam sees the item (with An's and Huy's from the seed), books An into
 *   another A2 class, opens a make-up session for Huy, assigns self-study to Linh → Mai sees it
 *   read-only → Linh submits → Tara confirms → Sam's board counts it made up. The make-up session is
 *   on the schedule; guests appear on the session they joined.
 * Stack: platform-stack.mjs. Needs OGC_TEST_PG_ADMIN_URL and Playwright.
 */
import { runPlatformJourney } from "./platform-stack.mjs";

runPlatformJourney("platform make-up E2E", async ({ browser, base, check }) => {
  const page = await browser.newPage();
  const signIn = async (name, heading) => {
    await page.goto(`${base}/login`);
    if (await page.getByRole("button", { name: "Sign out" }).count())
      await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByRole("button", { name }).click();
    await page.getByRole("heading", { name: heading }).waitFor();
  };

  // Tara: Linh absent this morning (the A2 Morning session waiting for attendance)
  await signIn("Tara (Teacher)", "Teaching");
  await page
    .getByRole("link", { name: /A2 — Unit 6/ })
    .first()
    .click();
  await page.getByLabel("An P. present").check();
  await page.getByLabel("Linh N. absent").check();
  await page.getByLabel("Minh T. present").check();
  await page.getByRole("button", { name: "Save attendance" }).click();
  await page.getByRole("status").getByText("Saved.").waitFor();
  check("[tara] Linh marked absent", true);

  // Sam: the board
  await signIn("Sam (Org Staff)", "Schedule");
  await page
    .getByRole("navigation", { name: "Platform" })
    .getByRole("link", { name: "Make-ups" })
    .click();
  const board = page.getByRole("region", { name: "Make-up lessons" });
  await board.waitFor();
  const counts = page.getByTestId("makeup-counts");
  check(
    "[sam] three missed lessons to arrange (An, Huy from the seed; Linh today)",
    ((await counts.textContent()) ?? "").includes("0 overdue · 3 to arrange"),
  );

  await board.getByRole("button", { name: "Find a session · An P. · A2 — Unit 5" }).click();
  const pick = board.getByLabel("Make-up session for An P. · A2 — Unit 5");
  await pick.waitFor();
  const optLabel = (await pick.locator("option").nth(1).textContent()) ?? "";
  check(
    "[sam] An can join A2 Evening (same course, same unit)",
    optLabel.startsWith("Join A2 Evening — Tue/Thu"),
  );
  await pick.selectOption({ index: 1 });
  await board.getByRole("button", { name: "Book" }).click();
  await board.getByText(/joins A2 Evening — Tue\/Thu · .* · Ben/).waitFor();
  check("[sam] An booked into A2 Evening with Ben", true);

  await board
    .getByRole("button", { name: "Open a make-up session · Huy D. · B1 — Unit 2" })
    .click();
  await board.getByLabel("Make-up teacher for Huy D. · B1 — Unit 2").selectOption({ label: "Mia" });
  await board.getByRole("button", { name: "Open and book everyone missing B1 — Unit 2" }).click();
  await board.getByText(/make-up session · .* · Mia/).waitFor();
  check("[sam] a make-up session opened for Huy, taught by Mia", true);

  await board.getByRole("button", { name: "Assign self-study · Linh N. · A2 — Unit 6" }).click();
  await board.getByText("self-study · Tara confirms").waitFor();
  check("[sam] self-study assigned to Linh", true);

  // the make-up session is on the schedule
  await page
    .getByRole("navigation", { name: "Platform" })
    .getByRole("link", { name: "Schedule" })
    .click();
  await page.getByRole("heading", { name: "Schedule" }).waitFor();
  check(
    "[sam] the make-up session shows on the schedule",
    (await page.getByText("make-up", { exact: true }).count()) >= 1,
  );

  // Mai: read-only — checked while the self-study is still open to submit (a learner would see a form)
  await signIn("Mai (Guardian)", "Make-ups · your child");
  const g = page.getByRole("region", { name: "Make-up lessons" });
  await g.getByText("self-study · Tara confirms").waitFor();
  check(
    "[mai] guardian sees Linh's self-study, read-only (no form, no button)",
    (await g.getByRole("button").count()) === 0 && (await g.getByRole("textbox").count()) === 0,
  );

  // Linh: submit self-study
  await signIn("Linh (Learner)", "My make-ups");
  const mine = page.getByRole("region", { name: "Make-up lessons" });
  await mine.getByText("A2 — Unit 6", { exact: true }).waitFor();
  await mine.getByRole("textbox").fill("Read Unit 6 — making plans — and did both exercises");
  await mine.getByRole("button", { name: "Send to my teacher" }).click();
  await mine.getByText("self-study · submitted, waiting for Tara").waitFor();
  check("[linh] self-study submitted to Tara", true);

  // Tara: confirm
  await signIn("Tara (Teacher)", "Teaching");
  const c = page.getByRole("region", { name: "Self-study to confirm" });
  await c.getByText(/did both exercises/).waitFor();
  await c.getByRole("button", { name: "Confirm make-up · Linh N." }).click();
  await c.waitFor({ state: "detached" });
  check("[tara] confirmed — nothing left to confirm", true);

  // Sam: counted as made up
  await signIn("Sam (Org Staff)", "Schedule");
  await page
    .getByRole("navigation", { name: "Platform" })
    .getByRole("link", { name: "Make-ups" })
    .click();
  await page.getByTestId("makeup-counts").filter({ hasText: "1 made up" }).waitFor();
  check(
    "[sam] board: 1 made up (Linh), An + Huy booked",
    ((await page.getByTestId("makeup-counts").textContent()) ?? "").includes("2 booked"),
  );
});
