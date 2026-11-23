/*
 * OGC Platform E2E — Workforce on the real API (owner, 22/11 + 23/11): teaching hours in the next
 * 7 days vs each teacher's target; staff change a target and the band follows; "Who has room?"
 * next to a class teacher and a substitute ranks candidates (a clash goes last) and assigns
 * nobody. With the seed's weekly slots any 7-day window holds Tara's 4 sessions (6 h of 2.5 h) and
 * Ben's 2 (3 h of 4 h). Stack: platform-stack.mjs. Needs OGC_TEST_PG_ADMIN_URL and Playwright.
 */
import { runPlatformJourney } from "./platform-stack.mjs";

runPlatformJourney("platform workforce E2E", async ({ browser, base, check }) => {
  const page = await browser.newPage();
  await page.goto(`${base}/login`);
  await page.getByRole("button", { name: "Sam (Org Staff)" }).click();
  await page.getByRole("heading", { name: "Schedule" }).waitFor();
  const nav = page.getByRole("navigation", { name: "Platform" });

  await nav.getByRole("link", { name: "Workforce" }).click();
  await page.getByRole("heading", { name: "Workforce" }).waitFor();
  await page.getByTestId("load-Tara").waitFor();
  check(
    "[sam] Tara 6 of 2.5 h · 240% (over)",
    (await page.getByTestId("load-Tara").textContent()) === "6 of 2.5 h · 240%",
  );
  check(
    "[sam] Ben 3 of 4 h · 75% (on target)",
    (await page.getByTestId("load-Ben").textContent()) === "3 of 4 h · 75%",
  );
  check(
    "[sam] bands: 1 over · 1 on target · 2 have room",
    (await page.getByTestId("band-over").textContent()) === "1" &&
      (await page.getByTestId("band-meet").textContent()) === "1" &&
      (await page.getByTestId("band-under").textContent()) === "2",
  );

  const tara = page.getByRole("region", { name: "Load of Tara" });
  await tara.getByRole("button", { name: "Details · Tara" }).click();
  await tara.getByLabel("Employment of Tara").selectOption("full_time");
  await tara.getByLabel("Target hours of Tara").fill("8");
  await tara.getByRole("button", { name: "Save target · Tara" }).click();
  await page.getByTestId("load-Tara").filter({ hasText: "6 of 8 h · 75%" }).waitFor();
  check(
    "[sam] Tara's target saved (8 h full-time) → 75%, 0 over",
    (await page.getByTestId("band-over").textContent()) === "0",
  );

  // Who has room? — on the Schedule, next to the class teacher and a substitute
  await nav.getByRole("link", { name: "Schedule" }).click();
  await page.getByRole("heading", { name: "Schedule" }).waitFor();
  await page.getByRole("button", { name: "Who has room? · B1 Evening — Tue/Thu" }).click();
  const forClass = page.getByRole("list", { name: "Load suggestions for B1 Evening — Tue/Thu" });
  await forClass.getByText("Suggestions only — choose the teacher yourself.").waitFor();
  const firstName =
    (await forClass.locator("li").first().locator("span.font-medium").textContent()) ?? "";
  check(
    "[sam] class-teacher suggestions exclude Tara, best fit first (Mia)",
    firstName === "Mia" && (await forClass.getByText("Tara", { exact: true }).count()) === 0,
  );

  // B1 Evening's next session is at Ben's A2 Evening time: Ben clashes and is listed last
  const b1 = page.getByRole("button", { name: /^Who has room\? · B1 — Unit 3$/ });
  await b1.click();
  const forSession = page.getByRole("list", { name: "Load suggestions for B1 — Unit 3" });
  await forSession.getByText("Suggestions only — choose the teacher yourself.").waitFor();
  const items = forSession.locator("li");
  const lastCandidate = (await items.nth((await items.count()) - 2).textContent()) ?? "";
  check(
    "[sam] substitute suggestions: Ben clashes and comes last",
    /^Ben .*Schedule clash: Ben already teaches A2 Evening/.test(lastCandidate),
  );
  check(
    "[sam] nothing was assigned (B1 Evening still Tara's)",
    (await page.getByLabel("Teacher of B1 Evening — Tue/Thu").inputValue()) !== "" &&
      (await page
        .getByLabel("Teacher of B1 Evening — Tue/Thu")
        .locator("option:checked")
        .textContent()) === "Tara",
  );
});
