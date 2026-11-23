/*
 * OGC Platform E2E — Partner Commissions (core) on the real API (owner, 22/11 + 23/11): the
 * reconciliation adds up; Sam refers Duc A. from Admissions to the best-fitting partner (the lead
 * closes) and records the partner's confirmation; Olivia approves an enrolment Sam recorded (not
 * before the clawback, never her own step) and activates Sao Mai v2; signals only suggest — a
 * dismissal needs a reason; a teacher has no Partners. Settlements, report import and trends are
 * not on the Platform yet. Stack: platform-stack.mjs. Needs OGC_TEST_PG_ADMIN_URL and Playwright.
 */
import { apiAs, runPlatformJourney } from "./platform-stack.mjs";

runPlatformJourney("platform partners E2E", async ({ browser, base, check }) => {
  const page = await browser.newPage();
  const signIn = async (name, heading) => {
    await page.goto(`${base}/login`);
    if (await page.getByRole("button", { name: "Sign out" }).count())
      await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByRole("button", { name }).click();
    await page.getByRole("heading", { name: heading }).waitFor();
  };
  const nav = () => page.getByRole("navigation", { name: "Platform" });
  const vnd = (n) => `${new Intl.NumberFormat("vi-VN").format(n)} ₫`;
  const sam = await apiAs("iios-principal-staff-1");

  // 1) Sam → Partners: reconciliation
  await signIn("Sam (Org Staff)", "Schedule");
  await nav().getByRole("link", { name: "Partners" }).click();
  await page.getByRole("heading", { name: "Partner commissions" }).waitFor();
  await page.getByTestId("kpi-received").waitFor();
  check(
    "[sam] received 2.800.000 ₫ · awaiting 1.000.000 ₫",
    (await page.getByTestId("kpi-received").textContent()) === vnd(2_800_000) &&
      (await page.getByTestId("kpi-awaiting").textContent()) === vnd(1_000_000),
  );
  check(
    "[sam] six open signals, each with its evidence",
    (await page
      .getByRole("list", { name: "Open signals" })
      .locator("[data-testid^=signal-]")
      .count()) === 6,
  );
  check(
    "[sam] no Settlements / Import report / Trends on the Platform yet",
    (await page.getByRole("tab", { name: /Settlements|Import report|Trends/ }).count()) === 0,
  );

  // 2) A dismissal needs a reason
  const near = page.getByTestId("signal-high_rejection_rate");
  await near.getByRole("button", { name: "Dismiss" }).click();
  await near.getByRole("alert").filter({ hasText: "say why" }).waitFor();
  check("[sam] dismissing a signal without a reason is refused", true);

  // 3) Admissions → Duc A. → refer to the best-fitting partner
  await nav().getByRole("link", { name: "Admissions" }).click();
  await page.getByRole("tab", { name: "Pipeline" }).click();
  await page.getByRole("button", { name: "Open Duc A." }).click();
  await page.getByRole("button", { name: "Refer to partner · Duc A." }).click();
  const list = page.getByRole("list", { name: "Partners for Duc A." });
  await list.locator("li").first().waitFor();
  const first = (await list.locator("li").first().textContent()) ?? "";
  check(
    "[sam] Hanoi Bridge first (teaches ENG-A2, near Cau Giay); commission for information only",
    first.startsWith("Hanoi Bridge English — Dong Da") && first.includes("commission (info)"),
  );
  check(
    "[sam] Sao Mai (does not teach ENG-A2) cannot be chosen",
    (await list.getByRole("button", { name: /Refer to Sao Mai/ }).count()) === 0,
  );
  await list.getByRole("button", { name: "Refer to Hanoi Bridge English — Dong Da" }).click();
  await page
    .getByRole("region", { name: "Lost" })
    .getByRole("button", { name: "Open Duc A." })
    .waitFor();
  const duc = (await sam("/v1/admissions/leads")).find((l) => l.learnerName === "Duc A.");
  check(
    "[sam] Duc A. closes as referred to partner",
    duc?.lostReason === "Referred to partner: Hanoi Bridge English — Dong Da",
  );

  // 4) Ledger: the partner confirms Duc A.'s enrolment (Sam records it)
  await nav().getByRole("link", { name: "Partners" }).click();
  await page.getByRole("tab", { name: "Ledger" }).click();
  const ducRow = page.getByTestId("entry-Duc A.");
  await ducRow.waitFor();
  check(
    "[sam] Duc A. is in the ledger with a reference code",
    /LR-1016 · ENG-A2 → Hanoi Bridge/.test((await ducRow.textContent()) ?? ""),
  );
  await ducRow.getByRole("button", { name: "Partner confirmed enrolment · Duc A." }).click();
  await ducRow.getByText(/rule v1, tier 1/).waitFor();
  check(
    "[sam] enrolment recorded: rule v1, tier 1 (800.000 ₫)",
    ((await ducRow.textContent()) ?? "").includes(vnd(800_000)),
  );
  check(
    "[sam] staff cannot approve",
    (await page.getByRole("button", { name: /^Approve · / }).count()) === 0,
  );

  // 5) Olivia approves Quan B. (recorded by Sam); Duc A. waits for the clawback window
  await signIn("Olivia (Org Admin)", "Schedule");
  await nav().getByRole("link", { name: "Partners" }).click();
  await page.getByRole("tab", { name: "Ledger" }).click();
  const quan = page.getByTestId("entry-Quan B.");
  await quan.getByRole("button", { name: "Approve · Quan B." }).click();
  await quan.getByText("Approved · awaiting payment").waitFor();
  check(
    "[olivia] approves Quan B. (1.000.000 ₫, locked)",
    ((await quan.textContent()) ?? "").includes(vnd(1_000_000)),
  );
  const ducO = page.getByTestId("entry-Duc A.");
  await ducO.getByRole("button", { name: "Approve · Duc A." }).click();
  await ducO.getByRole("alert").filter({ hasText: "clawback window" }).waitFor();
  check("[olivia] Duc A. cannot be approved before the clawback window ends", true);

  // 6) Olivia activates Sao Mai v2 (proposed by Sam)
  await page.getByRole("tab", { name: "Tiers & policy" }).click();
  await page
    .getByRole("button", { name: "Activate v2 · Sao Mai IELTS Academy — District 3" })
    .click();
  await page.getByTestId("rule-PTN-SAOMAI").filter({ hasText: "Active v2" }).waitFor();
  check("[olivia] Sao Mai v2 active", true);
  await page.getByRole("tab", { name: "Activity" }).click();
  const log = page.getByRole("list", { name: "Activity log" });
  await log.getByText("rule activated").waitFor();
  const logText = (await log.textContent()) ?? "";
  check(
    "[olivia] the activity log records every step (referred, enrolment, approved, rule activated)",
    ["referred", "enrolment recorded", "approved", "rule activated"].every((a) =>
      logText.includes(a),
    ),
  );

  // 7) A teacher has no Partners
  await signIn("Tara (Teacher)", "Teaching");
  check(
    "[tara] no Partners link",
    (await nav().getByRole("link", { name: "Partners" }).count()) === 0,
  );
});
