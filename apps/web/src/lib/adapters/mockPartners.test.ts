// Partner Commissions (owner 22/11): leads go out from Admissions, partners ranked by fit for the
// learner (never by commission), staff record / Org Admin approves (never their own step), tiered
// commissions with rule snapshots, signals only suggest, append-only activity. SYNTHETIC.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commissionFor, tierRuleIssue, type TierRuleDraft } from "@ogc/contracts";
import { as } from "../../test/grants";
import { __resetPartnersForTests, mockPartners as P } from "./mockPartners";
import { __resetAdmissionsForTests, allLeads, leadById } from "./mockAdmissions";
import { __attachForTests } from "../integration/mockIiosPolicy";

const S = "demo-staff";
const A = "demo-admin";
const SAM_P = "iios-principal-staff-1";

beforeEach(() => {
  __resetAdmissionsForTests();
  __resetPartnersForTests();
});
afterEach(() => __attachForTests(SAM_P, null));

const entry = async (name: string) =>
  (await P.listEntries(as(S)))!.find((e) => e.learnerDisplayName === name)!;
const openLead = (course: string) =>
  allLeads().find(
    (l) =>
      l.courseCode === course && ["new", "assigned", "contacted", "placement"].includes(l.stage),
  )!;

describe("partners — tier arithmetic", () => {
  const tiers = [
    { minCount: 1, amountVnd: 1_000_000 },
    { minCount: 4, amountVnd: 2_000_000 },
    { minCount: 8, amountVnd: 3_000_000 },
  ];
  it("progressive: each enrolment at its own tier; retroactive: all at the tier reached", () => {
    expect(commissionFor({ mode: "progressive", tiers }, 3, 5).amountVnd).toBe(1_000_000);
    expect(commissionFor({ mode: "progressive", tiers }, 4, 5).amountVnd).toBe(2_000_000);
    expect(commissionFor({ mode: "retroactive", tiers }, 1, 5)).toEqual({
      tierIndex: 2,
      amountVnd: 2_000_000,
    });
    expect(commissionFor({ mode: "retroactive", tiers }, 1, 8).amountVnd).toBe(3_000_000);
  });
  it("rule drafts are checked", () => {
    const d: TierRuleDraft = {
      cycle: "monthly",
      mode: "progressive",
      tiers,
      attributionWindowDays: 60,
      clawbackWindowDays: 7,
    };
    expect(tierRuleIssue(d)).toBeNull();
    expect(tierRuleIssue({ ...d, tiers: [{ minCount: 2, amountVnd: 1 }] })).toMatch(/starts at 1/);
    expect(tierRuleIssue({ ...d, tiers: [tiers[1], tiers[0]] })).toBeTruthy();
    expect(tierRuleIssue({ ...d, attributionWindowDays: 3 })).toMatch(/attribution/);
  });
});

describe("partners — access", () => {
  it("staff and the Org Admin; teachers, learners, guardians and a policy without the rule: nothing", async () => {
    for (const p of ["demo-teacher", "demo-learner", "demo-guardian"])
      expect(await P.getOverview(as(p))).toBeNull();
    expect(await P.getOverview(as(A))).not.toBeNull();
    __attachForTests(SAM_P, "policy-front-desk-d1");
    expect(await P.getOverview(as(S))).toBeNull();
    expect(await P.markEnrolled(as(S), (await P.listEntries(as(A)))![0].id)).toMatchObject({
      reason: "access_policy",
    });
  });
});

describe("partners — referring a lead from Admissions", () => {
  it("suggestions are ranked by fit for the learner; the commission is information only", async () => {
    const lead = openLead("ENG-A2");
    const fits = (await P.suggestPartners(as(S), lead.id))!;
    expect(fits.filter((f) => f.fits).every((f) => f.reasons[0].startsWith("teaches"))).toBe(true);
    expect(fits.find((f) => f.partnerName.startsWith("Sao Mai"))!.fits).toBe(false); // no A2
    // Ranking uses fit only: sorted by fits, then fit score.
    const scores = fits.map((f) => [Number(f.fits), f.score]);
    expect(scores).toEqual([...scores].sort((a, b) => b[0] - a[0] || b[1] - a[1]));
    expect(fits[0].commissionInfo).toMatch(/per learner/);
  });

  it("refer: the lead closes at OGC as referred, one entry opens; only once; partner must teach the course", async () => {
    const lead = openLead("ENG-A2");
    expect(await P.referLead(as(S), lead.id, "PTN-SAOMAI")).toMatchObject({ reason: "invalid" });
    expect(await P.referLead(as(S), lead.id, "PTN-LOTUS")).toEqual({ ok: true });
    const l = leadById(lead.id)!;
    expect(l.stage).toBe("lost");
    expect(l.lostReason).toBe("Referred to partner: Lotus English — Binh Thanh");
    const e = await entry(lead.learnerName);
    expect(e).toMatchObject({ status: "referred", courseCode: "ENG-A2" });
    expect(e.leadRefCode).toMatch(/^LR-\d+$/);
    expect(await P.referLead(as(S), lead.id, "PTN-BRIDGE")).toMatchObject({ ok: false });
    const log = (await P.listActivity(as(S)))!;
    expect(log[0]).toMatchObject({ action: "referred", by: "Sam (Org Staff)" });
  });
});

describe("partners — ledger lifecycle (maker-checker)", () => {
  it("staff record the enrolment with the rule in force; the 4th of the month earns tier 2", async () => {
    // Lotus: 3 enrolments this month at 1,000,000; Mai L. becomes the 4th.
    const mai = await entry("Mai L.");
    expect(await P.markEnrolled(as(S), mai.id)).toEqual({ ok: true });
    const e = await entry("Mai L.");
    expect(e).toMatchObject({
      status: "enrolled",
      appliedRuleVersion: 1,
      appliedTierIndex: 2,
      amountVnd: 2_000_000,
    });
    expect(e.approvableFrom).not.toBeNull(); // 7-day clawback
  });

  it("approve: Org Admin only, never their own step, not before the clawback window", async () => {
    const quan = await entry("Quan B.");
    expect(await P.approve(as(S), quan.id)).toMatchObject({ reason: "not_org_admin" });
    const fresh = await entry("Mai L.");
    await P.markEnrolled(as(A), fresh.id); // Olivia records it herself …
    expect(await P.approve(as(A), fresh.id)).toMatchObject({ reason: "own_step" }); // … so she cannot approve
    const now = Date.now();
    const ready = quan.approvableFrom && Date.parse(quan.approvableFrom) <= now;
    const r = await P.approve(as(A), quan.id);
    if (ready) {
      expect(r).toEqual({ ok: true });
      const q = await entry("Quan B.");
      expect(q.status).toBe("approved");
      expect(q.dueDate).not.toBeNull();
    } else expect(r).toMatchObject({ reason: "invalid_step" });
  });

  it("retroactive: provisional until the cycle ends, cannot be approved before", async () => {
    const k = await entry("Khanh D.");
    expect(k.provisional).toBe(true);
    expect(await P.approve(as(A), k.id)).toMatchObject({ reason: "invalid_step" });
  });

  it("reject needs a reason; an expired attribution window cannot be marked enrolled", async () => {
    const son = await entry("Son K.");
    expect(await P.reject(as(S), son.id, "")).toMatchObject({ reason: "invalid" });
    expect(await P.reject(as(S), son.id, "learner chose another school")).toEqual({ ok: true });
    expect((await entry("Son K.")).rejectReason).toBe("learner chose another school");
    expect(await P.markEnrolled(as(S), son.id)).toMatchObject({ reason: "invalid_step" });
  });

  it("an approved amount is locked; a new rule version applies only to later enrolments", async () => {
    const trang = await entry("Trang N.");
    expect(trang).toMatchObject({ status: "approved", amountVnd: 1_000_000 });
    const draft: TierRuleDraft = {
      cycle: "monthly",
      mode: "progressive",
      tiers: [{ minCount: 1, amountVnd: 1_200_000 }],
      attributionWindowDays: 60,
      clawbackWindowDays: 7,
    };
    expect(await P.proposeRule(as(S), "PTN-LOTUS", draft)).toEqual({ ok: true });
    const pending = (await P.listPartners(as(S)))!.find((p) => p.id === "PTN-LOTUS")!.pendingRule!;
    expect(await P.decideRule(as(S), pending.id, "activate")).toMatchObject({
      reason: "not_org_admin",
    });
    expect(await P.decideRule(as(A), pending.id, "activate")).toEqual({ ok: true });
    expect((await entry("Trang N.")).amountVnd).toBe(1_000_000);
    expect((await entry("Quan B.")).appliedRuleVersion).toBe(1); // enrolled under v1
    await P.markEnrolled(as(S), (await entry("Mai L.")).id);
    expect(await entry("Mai L.")).toMatchObject({ appliedRuleVersion: 2, amountVnd: 1_200_000 });
  });

  it("an Org Admin cannot activate a version they proposed", async () => {
    await P.proposeRule(as(A), "PTN-BRIDGE", {
      cycle: "monthly",
      mode: "progressive",
      tiers: [{ minCount: 1, amountVnd: 900_000 }],
      attributionWindowDays: 30,
      clawbackWindowDays: 7,
    });
    const r = (await P.listPartners(as(A)))!.find((p) => p.id === "PTN-BRIDGE")!.pendingRule!;
    expect(r.mine).toBe(true);
    expect(await P.decideRule(as(A), r.id, "activate")).toMatchObject({ reason: "own_step" });
  });
});

describe("partners — decision signals only suggest", () => {
  it("seeded situations raise the four signals, with evidence", async () => {
    const o = (await P.getOverview(as(S)))!;
    const rules = new Set(o.signals.map((s) => s.rule));
    expect(rules).toEqual(
      new Set(["near_next_tier", "stale_referral", "high_rejection_rate", "overdue_settlement"]),
    );
    const near = o.signals.find((s) => s.rule === "near_next_tier")!;
    expect(near.partnerName).toMatch(/Lotus/);
    expect(near.message).toMatch(/1\.000\.000 ₫ to 2\.000\.000 ₫/);
    expect(o.signals.every((s) => s.evidence.length > 0)).toBe(true);
  });

  it("follow / snooze / dismiss (with a reason) change nothing in the ledger and are logged", async () => {
    const before = JSON.stringify(await P.listEntries(as(S)));
    const sig = (await P.getOverview(as(S)))!.signals.find((s) => s.rule === "overdue_settlement")!;
    expect(await P.actOnSignal(as(S), sig.id, "dismiss")).toMatchObject({ reason: "invalid" });
    expect(
      await P.actOnSignal(as(S), sig.id, "dismiss", "partner paid in cash, recorded later"),
    ).toEqual({
      ok: true,
    });
    const after = (await P.getOverview(as(S)))!.signals.find((s) => s.id === sig.id)!;
    expect(after).toMatchObject({
      state: "dismissed",
      note: "partner paid in cash, recorded later",
    });
    expect(JSON.stringify(await P.listEntries(as(S)))).toBe(before);
    expect((await P.listActivity(as(S)))![0].action).toBe("signal dismissed");
  });

  it("KPIs add up from the ledger", async () => {
    const o = (await P.getOverview(as(S)))!;
    const list = (await P.listEntries(as(S)))!;
    const sum = (st: string) =>
      list.filter((e) => e.status === st).reduce((t, e) => t + (e.amountVnd ?? 0), 0);
    expect(o.kpis.receivedVnd).toBe(sum("paid"));
    expect(o.kpis.awaitingPaymentVnd).toBe(sum("approved"));
    expect(o.kpis.awaitingEnrolment).toBe(list.filter((e) => e.status === "referred").length);
  });
});

describe("partners — seed data is consistent (22/11, live d3ba226)", () => {
  it("every enrolment comes after its referral and inside the attribution window", async () => {
    // Live showed Quan B. / Nhi P. / Dat H. enrolled before they were referred.
    for (const e of (await P.listEntries(as(S)))!)
      if (e.enrolledAt) {
        expect(Date.parse(e.enrolledAt)).toBeGreaterThanOrEqual(Date.parse(e.referredAt));
        expect(Date.parse(e.enrolledAt)).toBeLessThanOrEqual(Date.parse(e.expiresAt));
      }
  });

  it("holds on any day of the month (failed just after midnight on 23/11)", async () => {
    // Center time is UTC+7: these are 00:03 on the 23rd, 00:03 on the 1st, 23:59 on the 31st.
    for (const at of ["2026-11-22T17:03:00Z", "2026-10-31T17:03:00Z", "2026-12-31T16:59:00Z"]) {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(at));
      try {
        __resetPartnersForTests();
        for (const e of (await P.listEntries(as(S)))!) {
          if (!e.enrolledAt) continue;
          const enrolled = Date.parse(e.enrolledAt);
          expect(enrolled, `${at} ${e.learnerDisplayName}`).toBeGreaterThanOrEqual(
            Date.parse(e.referredAt),
          );
          expect(enrolled).toBeLessThanOrEqual(Date.parse(e.expiresAt));
          expect(enrolled).toBeLessThanOrEqual(Date.now());
          if (e.dueDate) expect(Date.parse(e.dueDate)).toBeGreaterThan(enrolled);
        }
      } finally {
        vi.useRealTimers();
      }
    }
  });
});

describe("partners slice 2 — settlement batches", () => {
  it("seed: paid batches for the paid entries; Trang N. (approved) is ready to batch", async () => {
    const list = (await P.listBatches(as(S)))!;
    expect(list.map((b) => [b.id, b.status])).toEqual(
      expect.arrayContaining([
        ["ST-LOTUS-01", "paid"],
        ["ST-BRIDGE-01", "paid"],
      ]),
    );
    const c = (await P.batchCandidates(as(S)))!;
    expect(c).toEqual([
      expect.objectContaining({ partnerId: "PTN-LOTUS", entries: 1, totalVnd: 1_000_000 }),
    ]);
  });

  it("staff draft, an Org Admin who did not draft it sends (locked), the partner pays the whole batch", async () => {
    const [c] = (await P.batchCandidates(as(S)))!;
    expect(await P.draftBatch(as(S), c.partnerId, c.cycleLabel)).toEqual({ ok: true });
    expect(await P.batchCandidates(as(S))).toEqual([]);
    const draft = (await P.listBatches(as(S)))!.find((b) => b.status === "draft")!;
    expect(draft).toMatchObject({ id: "ST-LOTUS-02", totalVnd: 1_000_000, mine: true });
    expect(await P.sendBatch(as(S), draft.id)).toMatchObject({ reason: "not_org_admin" });
    expect(await P.markBatchPaid(as(S), draft.id, "BANK-1")).toMatchObject({
      reason: "invalid_step",
    });
    expect(await P.sendBatch(as(A), draft.id)).toEqual({ ok: true });
    const sent = (await P.listBatches(as(S)))!.find((b) => b.id === draft.id)!;
    expect(sent.status).toBe("sent");
    expect(sent.dueDate).not.toBeNull();
    expect(await P.sendBatch(as(A), draft.id)).toMatchObject({ reason: "invalid_step" });
    expect(await P.markBatchPaid(as(S), draft.id, "BANK-7731")).toEqual({ ok: true });
    const trang = await entry("Trang N.");
    expect(trang).toMatchObject({ status: "paid", settledBatchId: "ST-LOTUS-02" });
    expect((await P.getOverview(as(S)))!.signals.some((s) => s.rule === "overdue_settlement")).toBe(
      false,
    );
  });

  it("an Org Admin cannot send a batch they drafted; a cancelled batch releases its entries", async () => {
    const [c] = (await P.batchCandidates(as(A)))!;
    await P.draftBatch(as(A), c.partnerId, c.cycleLabel);
    const b = (await P.listBatches(as(A)))!.find((x) => x.status === "draft")!;
    expect(await P.sendBatch(as(A), b.id)).toMatchObject({ reason: "own_step" });
    expect(await P.cancelBatch(as(S), b.id, "")).toMatchObject({ reason: "invalid" });
    expect(await P.cancelBatch(as(S), b.id, "wrong cycle")).toEqual({ ok: true });
    expect((await entry("Trang N.")).batchId).toBeNull();
    expect((await P.batchCandidates(as(S)))!).toHaveLength(1);
  });
});

describe("partners slice 2 — partner reports (preview, a person applies each row)", () => {
  const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
  it("preview classifies rows and changes nothing", async () => {
    const before = JSON.stringify(await P.listEntries(as(S)));
    const mai = await entry("Mai L.");
    const quan = await entry("Quan B.");
    const csv = [
      "lead,status,date,reason",
      `${mai.leadRefCode},enrolled,${today}`,
      `${quan.leadRefCode},enrolled,${today}`,
      "LR-9999,enrolled,2026-11-01",
      `${mai.leadRefCode},enrolled,2001-01-01`,
      `${(await entry("Son K.")).leadRefCode},rejected,,`,
      "hello",
    ].join("\n");
    const rows = (await P.previewReport(as(S), "PTN-LOTUS", csv))!;
    expect(rows.map((r) => r.match)).toEqual([
      "applicable",
      "already",
      "not_found",
      "conflict",
      "invalid",
      "invalid",
    ]);
    expect(rows[3].explanation).toMatch(/before the referral/);
    expect(JSON.stringify(await P.listEntries(as(S)))).toBe(before);
  });

  it("apply: one row at a time, re-checked, with the partner's date; logged", async () => {
    const mai = await entry("Mai L.");
    const row = {
      leadRefCode: mai.leadRefCode,
      reported: "enrolled" as const,
      date: today,
      reason: null,
    };
    expect(await P.applyReportRow(as(S), "PTN-LOTUS", row)).toEqual({ ok: true });
    const e = await entry("Mai L.");
    expect(e.status).toBe("enrolled");
    expect(e.enrolledAt!.slice(0, 10) <= today).toBe(true);
    expect(await P.applyReportRow(as(S), "PTN-LOTUS", row)).toMatchObject({ ok: false }); // already
    expect((await P.listActivity(as(S)))![0].action).toBe("report applied: enrolled");
    expect(await P.applyReportRow(as("demo-teacher"), "PTN-LOTUS", row)).toMatchObject({
      reason: "not_staff",
    });
  });
});

describe("partners slice 2 — trends", () => {
  it("six referral months per partner; conversion shows its counts and never exceeds 100%", async () => {
    const t = (await P.getTrends(as(S)))!;
    expect(t).toHaveLength(3);
    for (const p of t) {
      expect(p.months).toHaveLength(6);
      for (const m of p.months) {
        expect(m.referred).toBe(m.enrolled + m.rejected + m.open);
        expect(m.conversion.d).toBe(m.enrolled + m.rejected);
        if (m.conversion.pct !== null) expect(m.conversion.pct).toBeLessThanOrEqual(100);
      }
    }
    const sao = t.find((p) => p.partnerId === "PTN-SAOMAI")!;
    expect(sao.months.reduce((x, m) => x + m.rejected, 0)).toBe(2);
  });
});

describe("partners slice 2 — seed batches are consistent", () => {
  it("drafted → sent → paid in order, none in the future", async () => {
    for (const b of (await P.listBatches(as(S)))!.filter((x) => x.status === "paid")) {
      expect(Date.parse(b.createdAt)).toBeLessThanOrEqual(Date.parse(b.sentAt!));
      expect(Date.parse(b.sentAt!)).toBeLessThanOrEqual(Date.parse(b.paidAt!));
      expect(Date.parse(b.paidAt!)).toBeLessThanOrEqual(Date.now());
    }
  });
});
