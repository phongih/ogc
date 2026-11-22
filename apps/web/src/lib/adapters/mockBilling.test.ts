// Billing & payments (owner 22/11): fee plans with maker-checker, invoices (idempotent), recorded
// payments, receivables; a referral's first paid invoice moves the lead; wallet credit is applied
// to the referrer's next invoice; overdue never blocks learning. SYNTHETIC, mock only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeeLineDraft } from "@ogc/contracts";
import { as } from "../../test/grants";
import { __resetBillingForTests, mockBilling as B, overdueInvoicesOf } from "./mockBilling";
import { __resetGrowthForTests, mockGrowth as G } from "./mockGrowth";
import { __attachForTests } from "../integration/mockIiosPolicy";
import { centers, organizations } from "../../fixtures/directory";

const S = "demo-staff";
const ADMIN = "demo-admin";
const MAI = "demo-guardian";
const D1 = centers[0];
const THU_DUC = centers[1];
const NOVA = organizations[0].id;

beforeEach(() => {
  // Only the clock is fixed (22/11/2026, during Term 1); timers stay real for the mock latency.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-22T05:00:00Z"));
  __resetGrowthForTests();
  __resetBillingForTests();
});
afterEach(() => {
  __attachForTests("iios-principal-staff-1", null);
  vi.useRealTimers();
});

const draft = (over: Partial<FeeLineDraft> = {}): FeeLineDraft => ({
  year: "2026-2027",
  courseCode: "ENG-B1",
  centerId: null,
  kind: "materials",
  period: "Term 2",
  from: "2026-12-01",
  to: "2027-02-28",
  dueDate: "2026-12-10",
  amountVnd: 500_000,
  ...over,
});
const lineId = async (pred: (l: { kind: string; courseCode: string; status: string }) => boolean) =>
  (await B.listFeeLines(as(S), "2026-2027"))!.find(pred)!.id;

describe("billing — who sees what", () => {
  it("staff of the organization only; teachers, learners and another org see nothing of Nova", async () => {
    expect((await B.listInvoices(as(S)))!.length).toBe(7); // Term 1, seeded
    expect((await B.listFeeLines(as(S), "2026-2027"))!.length).toBe(13); // 3 courses × 4 periods + 1
    for (const p of ["demo-teacher", "demo-learner", MAI])
      expect(await B.listInvoices(as(p))).toBeNull();
    expect(await B.listInvoices(as("demo-staff-org2"))).toEqual([]);
    expect(await B.listFeeLines(as("demo-staff-org2"), "2026-2027")).toEqual([]);
  });

  it("a guardian sees their child's invoices; an adult learner their own; a minor none", async () => {
    const mai = (await B.getMine(as(MAI)))!;
    expect(mai.invoices.map((i) => i.learnerName)).toEqual(["Linh N."]);
    expect(mai.invoices[0].status).toBe("paid");
    expect((await B.getMine(as("demo-learner-2")))!.invoices[0].learnerName).toBe("Minh T.");
    expect(await B.getMine(as("demo-learner"))).toBeNull(); // Linh is a minor
    expect(await B.getMine(as("demo-teacher"))).toBeNull();
  });
});

describe("billing — fee plans (maker-checker)", () => {
  it("staff propose; only an Org Admin approves, and never their own proposal", async () => {
    expect(await B.proposeFeeLine(as(S), draft())).toEqual({ ok: true });
    const id = await lineId((l) => l.courseCode === "ENG-B1" && l.status === "pending");
    expect(await B.approveFeeLine(as(S), id)).toMatchObject({ ok: false, reason: "not_org_admin" });
    expect(await B.approveFeeLine(as(ADMIN), id)).toEqual({ ok: true });
    expect(await B.approveFeeLine(as(ADMIN), id)).toMatchObject({ reason: "invalid_step" });

    expect(await B.proposeFeeLine(as(ADMIN), draft({ courseCode: "IELTS-B2" }))).toEqual({
      ok: true,
    });
    const own = await lineId((l) => l.courseCode === "IELTS-B2" && l.status === "pending");
    expect(await B.approveFeeLine(as(ADMIN), own)).toMatchObject({
      ok: false,
      reason: "own_proposal",
    });
    expect(await B.rejectFeeLine(as(ADMIN), own, "no")).toMatchObject({ reason: "invalid" });
    expect(await B.rejectFeeLine(as(ADMIN), own, "wrong amount")).toEqual({ ok: true });
  });

  it("a closed catalog: bad dates, amounts, courses and duplicates are refused", async () => {
    const bad: Partial<FeeLineDraft>[] = [
      { year: "2026-2028" },
      { courseCode: "NOPE" },
      { from: "2027-03-01" },
      { dueDate: "2027-03-30" },
      { amountVnd: 10 },
      { kind: "tuition", courseCode: "ENG-A2" }, // Term 2 A2 tuition is approved already
    ];
    for (const b of bad)
      expect(await B.proposeFeeLine(as(S), draft(b))).toMatchObject({
        ok: false,
        reason: "invalid",
      });
    // Another organization's center: refused by the tenant check before validation.
    expect(await B.proposeFeeLine(as(S), draft({ centerId: centers[3].id }))).toMatchObject({
      ok: false,
      reason: "access_policy",
    });
    expect(await B.proposeFeeLine(as("demo-teacher"), draft())).toMatchObject({
      reason: "not_staff",
    });
    // The seeded plan follows the clock: a period is running whatever the date.
    vi.setSystemTime(new Date("2031-04-02T05:00:00Z"));
    __resetBillingForTests();
    expect((await B.periods(as(S)))!.map((p) => `${p.period} ${p.year}`)).toContain(
      "Term 3 2030-2031",
    );
  });
});

describe("billing — invoices and payments", () => {
  it("generating is idempotent; a newly approved fee adds only what is missing", async () => {
    const r1 = await B.generateInvoices(as(S), "2026-2027", "Term 2");
    expect(r1).toMatchObject({ ok: true, created: 7, existing: 0 });
    expect(await B.generateInvoices(as(S), "2026-2027", "Term 2")).toMatchObject({
      created: 0,
      existing: 7,
    });
    // The seeded, pending A2 materials fee: approved → only the 5 A2 learners get a new invoice.
    const mat = await lineId((l) => l.kind === "materials" && l.courseCode === "ENG-A2");
    expect(await B.approveFeeLine(as(ADMIN), mat)).toEqual({ ok: true });
    expect(await B.generateInvoices(as(S), "2026-2027", "Term 2")).toMatchObject({
      created: 5,
      existing: 2,
    });
    expect((await B.listInvoices(as(S)))!.length).toBe(7 + 7 + 5);
  });

  it("payments: partial, no overpaying, paid; a paid invoice cannot be voided, an unpaid one can", async () => {
    await B.generateInvoices(as(S), "2026-2027", "Term 2");
    const huy = (await B.listInvoices(as(S)))!.find(
      (i) => i.learnerName === "Huy D." && i.lines[0].description.includes("Term 2"),
    )!;
    expect(huy.totalVnd).toBe(8_400_000);
    expect(await B.recordPayment(as(S), huy.id, 9_000_000, "cash")).toMatchObject({
      reason: "invalid",
    });
    const p1 = await B.recordPayment(as(S), huy.id, 4_000_000, "cash");
    expect(p1).toMatchObject({ ok: true, receiptNo: expect.stringMatching(/^RC-2026-\d{4}$/) });
    expect((await B.listInvoices(as(S)))!.find((i) => i.id === huy.id)!.status).toBe(
      "partially_paid",
    );
    expect(await B.recordPayment(as(S), huy.id, 4_400_000, "bank_transfer")).toMatchObject({
      ok: true,
    });
    expect((await B.listInvoices(as(S)))!.find((i) => i.id === huy.id)).toMatchObject({
      status: "paid",
      balanceVnd: 0,
    });
    expect(await B.voidInvoice(as(S), huy.id, "mistake")).toMatchObject({ reason: "invalid_step" });

    const thao = (await B.listInvoices(as(S)))!.find(
      (i) => i.learnerName === "Thao V." && i.status === "issued",
    )!;
    expect(await B.voidInvoice(as(S), thao.id, "left the course")).toEqual({ ok: true });
    expect(await B.recordPayment(as(S), thao.id, 1_000, "cash")).toMatchObject({
      reason: "invalid_step",
    });
    expect((await B.listPayments(as(S)))!.length).toBe(5 + 2); // seeded Term 1 + Huy's two
  });

  it("receivables: aging by center; overdue invoices feed the Decision Engine, learning is untouched", async () => {
    const r = (await B.getReceivables(as(S)))!;
    // Seeded Term 1 (due 15/09): Huy D. 8.4M and Vy H. 6.9M unpaid, An P. 3.9M left.
    expect(r.overdue.map((i) => i.learnerName).sort()).toEqual(["An P.", "Huy D.", "Vy H."]);
    expect(r.overdueVnd).toBe(8_400_000 + 6_900_000 + 3_900_000);
    expect(r.overdue[0].daysOverdue).toBe(68); // 15/09 → 22/11
    const d1 = r.byCenter.find((c) => c.centerId === D1.id)!;
    expect(d1.over60Vnd).toBe(6_900_000 + 3_900_000);
    expect(overdueInvoicesOf(NOVA, 7).length).toBe(3);
    expect(overdueInvoicesOf(NOVA, 90).length).toBe(0);
  });
});

describe("billing — referrals and wallet credit", () => {
  it("first invoice paid → lead enrolled with the invoice amount → reward → applied to the next invoice", async () => {
    const code = (await G.getMine(as(MAI)))!.code;
    expect(
      await G.submitLead(code, {
        learnerName: "Bao T.",
        courseCode: "ENG-A2",
        centerName: D1.name,
      }),
    ).toEqual({ ok: true });
    const leadId = (await G.listLeads(as(S)))![0].id;
    expect(await B.issueFirstInvoice(as(S), leadId)).toMatchObject({ reason: "invalid_step" });
    await G.markPlaced(as(S), leadId);
    const issued = await B.issueFirstInvoice(as(S), leadId);
    expect(issued).toMatchObject({ ok: true, invoiceNo: expect.stringMatching(/^INV-2026-/) });
    expect(await B.issueFirstInvoice(as(S), leadId)).toMatchObject({ reason: "invalid_step" });
    const inv = (await B.listInvoices(as(S)))!.find((i) => i.learnerName === "Bao T.")!;
    expect(inv).toMatchObject({ totalVnd: 6_900_000, payerName: null }); // Term 1 is running

    await B.recordPayment(as(S), inv.id, 1_000_000, "cash");
    expect((await G.listLeads(as(S)))![0].status).toBe("placed"); // not paid in full yet
    await B.recordPayment(as(S), inv.id, 5_900_000, "cash");
    expect((await G.listLeads(as(S)))![0]).toMatchObject({
      status: "enrolled",
      firstPaymentVnd: 6_900_000,
      invoiceNo: inv.no,
    });
    expect(await G.confirm(as(S), leadId)).toEqual({ ok: true });
    expect((await B.getMine(as(MAI)))!.walletVnd).toBe(345_000); // 5%

    await B.generateInvoices(as(S), "2026-2027", "Term 2");
    const mai = (await B.getMine(as(MAI)))!;
    const linhT2 = mai.invoices.find((i) => i.lines[0].description.includes("Term 2"))!;
    expect(linhT2).toMatchObject({
      subtotalVnd: 6_900_000,
      creditAppliedVnd: 345_000,
      totalVnd: 6_555_000,
    });
    expect(mai.walletVnd).toBe(0);
    // Voided → the credit goes back to the wallet.
    expect(await B.voidInvoice(as(S), linhT2.id, "issued by mistake")).toEqual({ ok: true });
    expect((await B.getMine(as(MAI)))!.walletVnd).toBe(345_000);
  });

  it("no approved fee line → the first invoice is refused, nothing changes", async () => {
    const code = (await G.getMine(as(MAI)))!.code;
    await G.submitLead(code, {
      learnerName: "Cuong V.",
      courseCode: "ENG-A2",
      centerName: D1.name,
    });
    const leadId = (await G.listLeads(as(S)))![0].id;
    await G.markPlaced(as(S), leadId);
    // An Org Admin retires every A2 tuition line → nothing approved left to invoice.
    for (const l of (await B.listFeeLines(as(ADMIN), "2026-2027"))!)
      if (l.courseCode === "ENG-A2" && l.kind === "tuition" && l.status === "approved")
        expect(await B.retireFeeLine(as(ADMIN), l.id, "new price list")).toEqual({ ok: true });
    expect(await B.issueFirstInvoice(as(S), leadId)).toMatchObject({ reason: "no_fee_line" });
    expect((await G.listLeads(as(S)))![0].invoiceNo).toBeNull();
  });
});

describe("billing — access policy (IIOS-decided)", () => {
  it("Front desk — District 1 only: sees and acts on District 1 invoices only", async () => {
    __attachForTests("iios-principal-staff-1", "policy-front-desk-d1");
    const list = (await B.listInvoices(as(S)))!;
    expect(new Set(list.map((i) => i.centerId))).toEqual(new Set([D1.id]));
    expect(await B.generateInvoices(as(S), "2026-2027", "Term 2")).toMatchObject({ created: 5 });
    expect(await B.proposeFeeLine(as(S), draft())).toMatchObject({ reason: "access_policy" }); // all centers
    expect(await B.proposeFeeLine(as(S), draft({ centerId: D1.id }))).toEqual({ ok: true });
    __attachForTests("iios-principal-staff-1", null);
    const td = (await B.listInvoices(as(S)))!.find(
      (i) => i.centerId === THU_DUC.id && i.balanceVnd > 0,
    )!;
    __attachForTests("iios-principal-staff-1", "policy-own-classes"); // no billing:manage at all
    expect(await B.recordPayment(as(S), td.id, 1_000, "cash")).toMatchObject({
      reason: "access_policy",
    });
    expect(await B.listInvoices(as(S))).toEqual([]);
  });
});
