/*
 * OGC Platform E2E — public course showcase (owner 23/11) on the real API: a visitor (not signed in)
 * opens the public courses, chooses B1 · English for work · Thu Duc and gets B1 Speaking Confidence
 * first with its reasons; opens A2 Everyday English (free trial lesson, then from 6.900.000 ₫ /
 * term), sees the learning path (lesson titles only) and books a trial lesson — contact details are
 * refused; Sam finds the lead in Admissions with its origin; Sam hides the IELTS course and the
 * public page shows two courses. Stack: platform-stack.mjs. Needs OGC_TEST_PG_ADMIN_URL and
 * Playwright.
 */
import { apiAs, runPlatformJourney } from "./platform-stack.mjs";

runPlatformJourney("platform showcase E2E", async ({ browser, base, check }) => {
  const page = await browser.newPage();
  const courses = () => page.getByRole("list", { name: "Courses" });
  const titles = async () =>
    (await courses().getByRole("link").allTextContents()).map((t) => t.trim());

  // 1) A visitor: from the sign-in page to the public courses
  await page.goto(`${base}/login`);
  await page.getByRole("link", { name: "Browse public courses" }).click();
  await page.getByRole("link", { name: "Nova Learning" }).click();
  await courses().waitFor();
  check(
    "[public] Nova Learning: three courses on show, alphabetical before any choice",
    (await titles()).join(" | ") ===
      "A2 Everyday English — Units 6–8 | B1 Speaking Confidence | IELTS Writing Task 1 — Charts",
  );
  await page.getByLabel("Level").selectOption("B1");
  await page.getByLabel("Center").selectOption("Nova English — Thu Duc");
  await page.getByLabel("English for work").check();
  await courses().getByRole("list", { name: "Why B1 Speaking Confidence fits" }).waitFor();
  const why =
    (await courses()
      .getByRole("list", { name: "Why B1 Speaking Confidence fits" })
      .textContent()) ?? "";
  check(
    "[public] B1 first: level, English for work, a class at Thu Duc — never price",
    (await titles())[0] === "B1 Speaking Confidence" &&
      why.includes("Level B1, as you chose") &&
      why.includes("A class runs at Nova English — Thu Duc"),
  );
  check(
    "[public] B1 is Paid · from 8.400.000 ₫ / term",
    ((await courses().locator("li").first().textContent()) ?? "").includes(
      "Paid · from 8.400.000 ₫ / term",
    ),
  );

  // 2) The A2 course page: learning path and a trial lesson
  await courses().getByRole("link", { name: "A2 Everyday English — Units 6–8" }).click();
  await page.getByRole("list", { name: "Learning path" }).waitFor();
  const path = await page
    .getByRole("list", { name: "Learning path" })
    .locator("li")
    .allTextContents();
  check(
    "[public] A2: free trial lesson, then from 6.900.000 ₫ / term; 3 lesson titles",
    ((await page.locator("main").textContent()) ?? "").includes(
      "Free trial lesson · then from 6.900.000 ₫ / term",
    ) && path.join(",") === "At the market,Asking the way,Making plans",
  );
  const form = page.getByRole("region", { name: "Ask about this course" });
  await form.getByLabel("Learner's name (synthetic)").fill("Hien 0912345678");
  await form.getByRole("button", { name: "Send" }).click();
  await form.getByRole("alert").waitFor();
  check(
    "[public] contact details are refused",
    ((await form.getByRole("alert").textContent()) ?? "").includes("no phone numbers"),
  );
  await form.getByLabel("Learner's name (synthetic)").fill("Hien D.");
  await form.getByLabel("Travel").check();
  await form.getByRole("button", { name: "Send" }).click();
  await page.getByRole("status").filter({ hasText: "Thank you" }).waitFor();
  check("[public] trial lesson requested — thank you", true);

  // 3) Sam: the lead in Admissions, with its origin
  const sam = await apiAs("iios-principal-staff-1");
  const lead = (await sam("/v1/admissions/leads")).find((l) => l.learnerName === "Hien D.");
  check(
    "[api] Admissions lead: website · ENG-A2 · District 1 · travel · origin Showcase … trial lesson",
    lead?.source === "website" &&
      lead?.courseCode === "ENG-A2" &&
      lead?.centerName === "Nova English — District 1" &&
      lead?.needs.join() === "travel" &&
      lead?.origin === "Showcase · CS-A2-EVERYDAY v2 · Trial · trial lesson",
  );
  await page.goto(`${base}/login`);
  await page.getByRole("button", { name: "Sam (Org Staff)" }).click();
  await page.getByRole("heading", { name: "Schedule" }).waitFor();
  await page
    .getByRole("navigation", { name: "Platform" })
    .getByRole("link", { name: "Admissions" })
    .click();
  await page.getByRole("tab", { name: "Pipeline" }).click();
  await page.getByText("Hien D.").first().click();
  await page
    .getByTestId("origin-Hien D.")
    .waitFor({ timeout: 10_000 })
    .catch(() => {});
  check(
    "[sam] Admissions shows the origin",
    (await page.getByTestId("origin-Hien D.").count()) === 1,
  );

  // 4) Sam hides the IELTS course
  await page.goto(`${base}/courses/CS-IELTS-W1`);
  const card = page.getByRole("region", { name: "Public showcase" });
  await card.waitFor();
  await card.getByLabel("Show on the public page").uncheck();
  await card.getByRole("button", { name: "Save showcase" }).click();
  await card.getByLabel("Show on the public page").waitFor();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.goto(`${base}/showcase/nova-learning`);
  await courses().waitFor();
  check(
    "[public] IELTS hidden: two courses left",
    (await titles()).join(" | ") === "A2 Everyday English — Units 6–8 | B1 Speaking Confidence",
  );
});
