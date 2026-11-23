/*
 * OGC Platform E2E — Growth · referrals (owner 23/11, slice 6 part A) on the real API: Mai (guardian)
 * sees her link, clicks and two referrals; a friend opens the public /join page (no sign-in) and
 * sends an enquiry; Sam sees it in the funnel, Mai's own child flagged (same household, duplicate),
 * and confirms Bao T.'s reward (first invoice paid in full) → 483.000 ₫ credit (5% + Tết 2027 2%);
 * Sam issues Term 2 invoices and the credit lands on Linh's invoice (payer Mai); Mai's Tuition and
 * wallet show it. Stack: platform-stack.mjs. Needs OGC_TEST_PG_ADMIN_URL and Playwright.
 */
import { apiAs, runPlatformJourney } from "./platform-stack.mjs";

runPlatformJourney("platform growth E2E", async ({ browser, base, check }) => {
  const page = await browser.newPage();
  const signIn = async (name, heading) => {
    await page.goto(`${base}/login`);
    if (await page.getByRole("button", { name: "Sign out" }).count())
      await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByRole("button", { name }).click();
    await page.getByRole("heading", { name: heading }).waitFor();
  };
  const nav = () => page.getByRole("navigation", { name: "Platform" });
  const tab = (name) => page.getByRole("tab", { name }).click();

  // 1) Mai: her link, five clicks, two referrals, an empty wallet
  await signIn("Mai (Guardian)", "Make-ups · your child");
  await nav().getByRole("link", { name: "Refer a friend" }).click();
  await page.getByRole("heading", { name: "Refer a friend" }).waitFor();
  const code = ((await page.getByTestId("Referral code").textContent()) ?? "").trim();
  const link = ((await page.getByTestId("Your link").textContent()) ?? "").trim();
  check(
    "[mai] code + link on this site; 5 clicks · 2 leads",
    /^OGC[0-9A-Z]{6}$/.test(code) &&
      link === `${base}/join?ref=${code}` &&
      (await (await apiAs("iios-principal-guardian-1"))("/v1/me/referrals")).performance.clicks ===
        5,
  );
  await tab("My referrals");
  const mine = (await page.getByRole("list", { name: "My referrals" }).textContent()) ?? "";
  check(
    "[mai] Linh N. (new lead) and Bao T. (enrolled and paid · waiting for staff)",
    mine.includes("Linh N.") && mine.includes("Bao T.") && mine.includes("waiting for staff"),
  );

  // 2) A friend opens the shared link — no sign-in — and sends an enquiry
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.goto(`${base}/join?ref=${code}&c=camp-tet-2027`);
  await page.getByLabel("Learner name").waitFor();
  check(
    "[join] the invitation names the code; course and center to pick",
    ((await page.getByRole("region", { name: "Join" }).textContent()) ?? "").includes(code) &&
      (await page.getByLabel("Center").locator("option").count()) === 3,
  );
  await page.getByLabel("Learner name").fill("Cuong 0901234567");
  await page.getByRole("button", { name: "Send enquiry" }).click();
  await page.getByRole("alert").waitFor();
  check(
    "[join] contact details are refused",
    ((await page.getByRole("alert").textContent()) ?? "").includes("no phone numbers"),
  );
  await page.getByLabel("Learner name").fill("Cuong V.");
  await page.getByLabel("Course").selectOption("ENG-A2");
  await page.getByLabel("Center").selectOption("Nova English — District 1");
  await page.getByRole("button", { name: "Send enquiry" }).click();
  await page.getByRole("status").filter({ hasText: "Thank you" }).waitFor();
  check("[join] thank you — the center will be in touch", true);

  // 3) Sam: the funnel — Cuong V. new, Linh N. flagged; confirm Bao T.'s reward
  await signIn("Sam (Org Staff)", "Schedule");
  await nav().getByRole("link", { name: "Growth" }).click();
  await page.getByRole("list", { name: "Referral leads" }).waitFor();
  const funnel = (await page.getByRole("list", { name: "Referral leads" }).textContent()) ?? "";
  check(
    "[sam] Cuong V. from Mai; Linh N. flagged: Same household · Duplicate",
    funnel.includes("Cuong V.") &&
      funnel.includes("Anti-fraud: Same household · Duplicate (already a learner or lead here)"),
  );
  check(
    "[sam] no Confirm before the first invoice is paid (only Bao T. has one)",
    (await page.getByRole("button", { name: /^Confirm reward · / }).count()) === 1,
  );
  await page.getByRole("button", { name: "Confirm reward · Bao T." }).click();
  await page
    .getByRole("list", { name: "Referral leads" })
    .getByText("credit 483.000 ₫ to Mai (Guardian)")
    .waitFor();
  check("[sam] Bao T. confirmed → credit 483.000 ₫ (7% of 6.900.000 ₫)", true);
  const sam = await apiAs("iios-principal-staff-1");
  const cuong = (await sam("/v1/admissions/leads")).find((l) => l.learnerName === "Cuong V.");
  check(
    "[api] Cuong V. is an Admissions lead: referral, new, Tết 2027 campaign",
    cuong?.source === "referral" &&
      cuong?.stage === "new" &&
      cuong?.referredBy === "Mai (Guardian)" &&
      cuong?.campaignId === "camp-tet-2027",
  );

  // 4) Sam issues Term 2: the credit goes to Linh's invoice (payer Mai)
  await nav().getByRole("link", { name: "Billing" }).click();
  await page.getByRole("list", { name: "Fee lines" }).waitFor();
  await tab("Invoices");
  const period = page.getByLabel("Invoice period");
  await period.locator("option").first().waitFor({ state: "attached" });
  await period.selectOption(
    await period
      .locator("option")
      .filter({ hasText: /^Term 2 / })
      .getAttribute("value"),
  );
  await page.getByRole("button", { name: "Generate invoices" }).click();
  await page.getByRole("status").filter({ hasText: "7 created" }).waitFor();
  const linh2 = (await sam("/v1/billing/invoices")).find(
    (i) => i.learnerName === "Linh N." && i.lines.some((l) => l.description.includes("Term 2")),
  );
  check(
    "[api] Linh's Term 2: 6.900.000 − 483.000 credit = 6.417.000 ₫",
    linh2?.creditAppliedVnd === 483_000 && linh2?.totalVnd === 6_417_000,
  );

  // 5) Mai: Tuition shows the lower amount; the wallet shows credit then applied
  await signIn("Mai (Guardian)", "Make-ups · your child");
  await nav().getByRole("link", { name: "Tuition" }).click();
  await page.getByText("6.417.000 ₫").first().waitFor({ timeout: 10_000 });
  check("[mai] to pay: 6.417.000 ₫ (credit applied)", true);
  await nav().getByRole("link", { name: "Refer a friend" }).click();
  await tab("Wallet");
  const wallet = (await page.getByRole("list", { name: "Wallet entries" }).textContent()) ?? "";
  check(
    "[mai] wallet 0 ₫: −483.000 applied to Linh's invoice, +483.000 for Bao T.",
    ((await page.getByTestId("wallet-balance").textContent()) ?? "").startsWith("0") &&
      wallet.includes(`Applied to ${linh2?.no} (Linh N.)`) &&
      wallet.includes("−483.000") &&
      wallet.includes("+483.000"),
  );

  // 6) Linh (a minor) has no link
  await signIn("Linh (Learner)", "My make-ups");
  await nav().getByRole("link", { name: "Refer a friend" }).click();
  await page.getByText("Referrals are for guardians and adult learners").waitFor();
  check("[linh] under 18: no referral link", true);
});
