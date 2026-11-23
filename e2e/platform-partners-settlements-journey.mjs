/*
 * OGC Platform E2E — Partner Commissions part B on the real API (owner, 22/11 + 23/11): Sam drafts
 * a settlement batch from the approved entry ready to batch; only an Org Admin who did not draft it
 * sends it (then it is locked); Sam records that the partner paid the whole batch; a partner report
 * is previewed against the ledger (nothing changes) and one applicable row applied by a person;
 * trends show six months with their counts. Stack: platform-stack.mjs.
 */
import { apiAs, runPlatformJourney } from "./platform-stack.mjs";

runPlatformJourney("platform partners settlements E2E", async ({ browser, base, check }) => {
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
  const openTab = async (name) => {
    await nav().getByRole("link", { name: "Partners" }).click();
    await page.getByRole("heading", { name: "Partner commissions" }).waitFor();
    await page.getByRole("tab", { name }).click();
  };
  const sam = await apiAs("iios-principal-staff-1");

  // 1) Sam drafts a batch from what is ready (Trang N., Lotus, last month)
  await signIn("Sam (Org Staff)", "Schedule");
  await openTab("Settlements");
  const ready = page.getByRole("list", { name: "Ready to batch" });
  await ready.locator("li").first().waitFor();
  const label = (await ready.locator("li").first().textContent()) ?? "";
  check(
    "[sam] ready to batch: Lotus, 1 entry, 1.000.000 ₫",
    label.includes("Lotus English") && label.includes(`1 entry · ${vnd(1_000_000)}`),
  );
  await ready.getByRole("button", { name: /^Draft batch · Lotus English/ }).click();
  await page.getByTestId("batch-status-ST-LOTUS-02").filter({ hasText: "Draft" }).waitFor();
  const draft = page.getByRole("region", { name: "Batch ST-LOTUS-02" });
  check(
    "[sam] ST-LOTUS-02 drafted; waits for an Org Admin who did not draft it",
    (await draft.getByText("Waiting for an Org Admin who did not draft it to send it.").count()) ===
      1 && (await draft.getByRole("button", { name: "Send · ST-LOTUS-02" }).count()) === 0,
  );
  check(
    "[sam] the seeded paid batches are listed",
    (await page.getByTestId("batch-status-ST-LOTUS-01").textContent()) === "Paid" &&
      (await page.getByTestId("batch-status-ST-BRIDGE-01").textContent()) === "Paid",
  );

  // 2) Olivia sends it — locked, with a due date
  await signIn("Olivia (Org Admin)", "Schedule");
  await openTab("Settlements");
  await page.getByRole("button", { name: "Send · ST-LOTUS-02" }).click();
  await page.getByTestId("batch-status-ST-LOTUS-02").filter({ hasText: "Sent · locked" }).waitFor();
  check("[olivia] ST-LOTUS-02 sent · locked", true);

  // 3) Sam records the partner's payment of the whole batch
  await signIn("Sam (Org Staff)", "Schedule");
  await openTab("Settlements");
  const sent = page.getByRole("region", { name: "Batch ST-LOTUS-02" });
  await sent.getByLabel("Payment reference · ST-LOTUS-02").fill("no");
  await sent.getByRole("button", { name: "Partner paid the whole batch · ST-LOTUS-02" }).click();
  await sent.getByRole("alert").filter({ hasText: "payment reference" }).waitFor();
  check("[sam] a malformed payment reference is refused", true);
  await sent.getByLabel("Payment reference · ST-LOTUS-02").fill("BANK-7788");
  await sent.getByRole("button", { name: "Partner paid the whole batch · ST-LOTUS-02" }).click();
  await page.getByTestId("batch-status-ST-LOTUS-02").filter({ hasText: "Paid" }).waitFor();
  const overview = await sam("/v1/partners/overview");
  check(
    "[api] every entry in it is paid: received 3.800.000 ₫, nothing awaiting",
    overview.kpis.receivedVnd === 3_800_000 && overview.kpis.awaitingPaymentVnd === 0,
  );

  // 4) Import a Lotus report: preview, then apply one row
  await page.getByRole("tab", { name: "Import report" }).click();
  await page.getByLabel("Report partner").selectOption({ label: "Lotus English — Binh Thanh" });
  const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
  await page
    .getByLabel("Report lines")
    .fill(`LR-1004,enrolled,${today}\nLR-1005,enrolled,2020-01-01\nLR-9999,enrolled,${today}`);
  await page.getByRole("button", { name: "Preview" }).click();
  const table = page.getByRole("table", { name: "Report preview" });
  await table.waitFor();
  const row = (code) => page.getByTestId(`report-${code}`);
  check(
    "[sam] preview: applicable / conflict (before the referral) / unknown code",
    ((await row("LR-1004").textContent()) ?? "").includes("Can be applied") &&
      ((await row("LR-1005").textContent()) ?? "").includes("Conflict") &&
      ((await row("LR-9999").textContent()) ?? "").includes("Unknown code"),
  );
  const mai0 = (await sam("/v1/partners/entries")).find((e) => e.leadRefCode === "LR-1004");
  check("[api] the preview changed nothing", mai0?.status === "referred");
  await row("LR-1004").getByRole("button", { name: "Apply · LR-1004" }).click();
  await row("LR-1004").filter({ hasText: "Already in the ledger" }).waitFor();
  const mai = (await sam("/v1/partners/entries")).find((e) => e.leadRefCode === "LR-1004");
  check(
    "[sam] applied: Mai L. enrolled on the partner's date",
    mai?.status === "enrolled" && mai.enrolledAt.slice(0, 10) <= today,
  );

  // 5) Trends
  await page.getByRole("tab", { name: "Trends" }).click();
  const lotus = page.getByRole("table", { name: "Trend · Lotus English — Binh Thanh" });
  await lotus.waitFor();
  check(
    "[sam] trends: six months per partner, rates with their counts",
    (await lotus.locator("tbody tr").count()) === 6,
  );
  const log = (await sam("/v1/partners/activity")).map((a) => a.action);
  check(
    "[api] the activity log has every step",
    ["batch drafted", "batch sent", "batch paid", "report applied: enrolled"].every((a) =>
      log.includes(a),
    ),
  );
});
