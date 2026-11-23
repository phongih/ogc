/*
 * OGC Platform E2E — Billing on the real API (owner, 22/11 + 23/11): an Org Admin approves the
 * fee line Sam proposed; Sam generates Term 2 invoices (twice — nothing new the second time) and
 * records a payment; a lead's first invoice moves it to "First invoice issued", paid in full →
 * "Enrolled"; Mai sees her child's invoices, Linh (a minor) is told her guardian pays; a teacher has
 * no Billing. SYNTHETIC: nothing is charged. Stack: platform-stack.mjs. Needs OGC_TEST_PG_ADMIN_URL.
 */
import { apiAs, runPlatformJourney } from "./platform-stack.mjs";

runPlatformJourney("platform billing E2E", async ({ browser, base, check }) => {
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

  // 1) Olivia approves the materials fee Sam proposed
  await signIn("Olivia (Org Admin)", "Schedule");
  await nav().getByRole("link", { name: "Billing" }).click();
  await page.getByRole("heading", { name: "Billing & payments" }).waitFor();
  await page.getByRole("button", { name: "Approve · ENG-A2 materials Term 2" }).click();
  await page.getByRole("button", { name: "Retire · ENG-A2 materials Term 2" }).waitFor();
  check("[olivia] approves Sam's materials fee (maker-checker)", true);

  // 2) Sam: no Approve buttons; generate Term 2 twice
  await signIn("Sam (Org Staff)", "Schedule");
  await nav().getByRole("link", { name: "Billing" }).click();
  await page.getByRole("list", { name: "Fee lines" }).waitFor();
  check(
    "[sam] staff cannot approve or retire fee lines",
    (await page.getByRole("button", { name: /^(Approve|Retire) · / }).count()) === 0,
  );
  await page.getByRole("tab", { name: "Invoices" }).click();
  const period = page.getByLabel("Invoice period");
  await period.locator("option").first().waitFor({ state: "attached" });
  const term2 = await period
    .locator("option")
    .filter({ hasText: /^Term 2 / })
    .getAttribute("value");
  await period.selectOption(term2);
  await page.getByRole("button", { name: "Generate invoices" }).click();
  await page.getByRole("status").filter({ hasText: "7 created · 0 already invoiced" }).waitFor();
  await page.getByRole("button", { name: "Generate invoices" }).click();
  await page.getByRole("status").filter({ hasText: "0 created · 7 already invoiced" }).waitFor();
  check("[sam] Term 2: 7 invoices, then none new (one per learner per fee line)", true);

  const sam = await apiAs("iios-principal-staff-1");
  const linh2 = (await sam("/v1/billing/invoices")).find(
    (i) => i.learnerName === "Linh N." && i.lines.some((l) => l.description.includes("Term 2")),
  );
  check(
    "[api] Linh's Term 2 = tuition + approved materials, payer Mai",
    linh2?.subtotalVnd === 7_350_000 && linh2?.payerName === "Mai (Guardian)",
  );

  // Huy's overdue Term 1 invoice: part payment
  const huy = (await sam("/v1/billing/invoices")).find(
    (i) => i.learnerName === "Huy D." && i.lines.some((l) => l.description.includes("Term 1")),
  );
  const card = page.locator(`[data-invoice="${huy.no}"]`).locator("xpath=..");
  await page.getByLabel(`Amount for ${huy.no}`).fill("9000000");
  await page.getByRole("button", { name: `Record payment · ${huy.no}` }).click();
  await card.getByRole("alert").filter({ hasText: "amount must be" }).waitFor();
  check("[sam] paying more than the balance is refused", true);
  await page.getByLabel(`Amount for ${huy.no}`).fill("4000000");
  await page.getByRole("button", { name: `Record payment · ${huy.no}` }).click();
  await page
    .getByRole("status")
    .filter({ hasText: /Receipt RC-\d{4}-0007/ })
    .waitFor();
  check(
    "[sam] part payment recorded: balance 4.400.000 ₫",
    (await page.getByTestId(`balance-${huy.no}`).textContent()) ===
      `${vnd(4_000_000)} · ${vnd(4_400_000)}`,
  );

  // 3) Admissions → Yen T. (placement) → first invoice → paid → enrolled
  await nav().getByRole("link", { name: "Admissions" }).click();
  await page.getByRole("tab", { name: "Pipeline" }).click();
  await page.getByRole("button", { name: "Open Yen T." }).click();
  await page.getByRole("button", { name: "Issue first invoice · Yen T." }).click();
  await page
    .getByRole("region", { name: "First invoice issued" })
    .getByRole("button", { name: "Open Yen T." })
    .waitFor();
  const yenLead = (await sam("/v1/admissions/leads")).find((l) => l.learnerName === "Yen T.");
  check(
    "[sam] Yen T. → First invoice issued",
    yenLead?.stage === "offer" && /^INV-/.test(yenLead.invoiceNo),
  );
  await nav().getByRole("link", { name: "Billing" }).click();
  await page.getByRole("tab", { name: "Invoices" }).click();
  const yenNo = yenLead.invoiceNo;
  await page.getByLabel(`Amount for ${yenNo}`).waitFor();
  check(
    "[sam] the first invoice is the lead's (referral, first invoice)",
    ((await page.locator(`[data-invoice="${yenNo}"]`).textContent()) ?? "").includes(
      "first invoice",
    ),
  );
  await page.getByRole("button", { name: `Record payment · ${yenNo}` }).click(); // balance by default
  // paid in full → it leaves the "Open" list
  await page.locator(`[data-invoice="${yenNo}"]`).waitFor({ state: "detached" });
  const yenAfter = (await sam("/v1/admissions/leads")).find((l) => l.learnerName === "Yen T.");
  check(
    "[api] paid in full → Yen T. enrolled with the invoice amount (A2 Term 2 tuition + materials)",
    yenAfter?.stage === "enrolled" && yenAfter?.firstPaymentVnd === 7_350_000,
  );

  // Receivables reflect the payments
  await page.getByRole("tab", { name: "Receivables" }).click();
  const rec = await sam("/v1/billing/receivables");
  check(
    "[sam] receivables: Huy's remaining 4.400.000 ₫ still overdue",
    rec.overdue.some((i) => i.learnerName === "Huy D." && i.balanceVnd === 4_400_000),
  );

  // 4) Mai sees Linh's invoices; Linh is told her guardian pays
  await signIn("Mai (Guardian)", "Make-ups · your child");
  await nav().getByRole("link", { name: "Tuition" }).click();
  await page.getByRole("heading", { name: "Tuition" }).waitFor();
  await page.getByTestId("to-pay").waitFor();
  check(
    "[mai] to pay = Linh's Term 2 (7.350.000 ₫)",
    (await page.getByTestId("to-pay").textContent()) === vnd(7_350_000),
  );
  check(
    "[mai] two invoices, both Linh's; no referral credit waiting (no reward confirmed yet)",
    (await page.getByRole("list", { name: "My invoices" }).locator("li").count()) === 2 &&
      (
        (await page.getByText("Referral credit waiting").locator("..").textContent()) ?? ""
      ).includes("0 ₫"),
  );
  await signIn("Linh (Learner)", "My make-ups");
  await nav().getByRole("link", { name: "Tuition" }).click();
  await page.getByText("Tuition is handled by your guardian").waitFor();
  check("[linh] a minor sees: tuition is handled by your guardian", true);

  // 5) A teacher has no Billing
  await signIn("Tara (Teacher)", "Teaching");
  check(
    "[tara] no Billing link",
    (await nav().getByRole("link", { name: "Billing" }).count()) === 0,
  );
});
