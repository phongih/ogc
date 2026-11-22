// Admissions Intelligence (owner 22/11): one pipeline for every lead, an explainable lead score,
// funnel rates that never exceed 100%, a minimal synthetic profile. SYNTHETIC, mock only.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LeadDraft } from "@ogc/contracts";
import { as } from "../../test/grants";
import { __resetAdmissionsForTests, DEFAULT_SETTINGS, mockAdmissions as A } from "./mockAdmissions";
import { __resetGrowthForTests, mockGrowth as G } from "./mockGrowth";
import { __resetBillingForTests, mockBilling as B } from "./mockBilling";
import { __attachForTests } from "../integration/mockIiosPolicy";
import { centers } from "../../fixtures/directory";

const S = "demo-staff";
const D1 = centers[0];
const SAM_P = "iios-principal-staff-1";

beforeEach(() => {
  __resetGrowthForTests();
  __resetAdmissionsForTests();
  __resetBillingForTests();
});
afterEach(() => __attachForTests(SAM_P, null));

const draft = (over: Partial<LeadDraft> = {}): LeadDraft => ({
  learnerName: "Thao N.",
  courseCode: "ENG-A2",
  centerId: D1.id,
  source: "walk_in",
  channel: "zalo",
  needs: ["speaking_confidence"],
  note: "Wants weekend classes",
  ...over,
});
const find = async (name: string) =>
  (await A.listLeads(as(S)))!.find((l) => l.learnerName === name)!;

describe("admissions — who sees what", () => {
  it("staff of the organization; a Front desk policy narrows to its center; others see nothing", async () => {
    expect((await A.listLeads(as(S)))!.length).toBe(14);
    for (const p of ["demo-teacher", "demo-learner", "demo-guardian"])
      expect(await A.listLeads(as(p))).toBeNull();
    expect(await A.listLeads(as("demo-staff-org2"))).toEqual([]);
    __attachForTests(SAM_P, "policy-front-desk-d1");
    const d1 = (await A.listLeads(as(S)))!;
    expect(d1.length).toBe(8);
    expect(d1.every((l) => l.centerId === D1.id)).toBe(true);
    const td = (await A.listLeads(as("demo-admin")))!.find((l) => l.centerId !== D1.id)!;
    expect(await A.logActivity(as(S), td.id, "call", "hello")).toMatchObject({
      reason: "access_policy",
    });
  });
});

describe("admissions — minimal, synthetic profile", () => {
  it("creates a lead; refuses contact details, unknown values and the referral source", async () => {
    expect(await A.createLead(as(S), draft())).toMatchObject({ ok: true });
    const l = await find("Thao N.");
    expect(l).toMatchObject({
      stage: "new",
      source: "walk_in",
      assignedTo: null,
      referredBy: null,
    });
    const bad: Partial<LeadDraft>[] = [
      { learnerName: "0912345678" },
      { note: "call 0912345678" },
      { note: "mail me a@b.vn" },
      { courseCode: "NOPE" },
      { needs: ["visa" as never] },
      { source: "referral" as never }, // referral leads come only through a referral link
      { note: "x".repeat(281) },
    ];
    for (const b of bad)
      expect(await A.createLead(as(S), draft(b))).toMatchObject({ ok: false, reason: "invalid" });
    expect(await A.createLead(as(S), draft({ centerId: centers[3].id }))).toMatchObject({
      reason: "invalid",
    });
    expect(await A.createLead(as("demo-teacher"), draft())).toMatchObject({ reason: "not_staff" });
  });
});

describe("admissions — stages", () => {
  it("assign → contacted → placement; offer / enrolled only via Billing; lost needs a reason and can reopen", async () => {
    await A.createLead(as(S), draft());
    const { id } = await find("Thao N.");
    expect(await A.moveStage(as(S), id, "assigned")).toMatchObject({ reason: "invalid" }); // nobody yet
    expect(await A.assign(as(S), id, "iios-principal-student-1")).toMatchObject({
      reason: "invalid",
    });
    expect(await A.assign(as(S), id, SAM_P)).toEqual({ ok: true });
    expect((await find("Thao N.")).stage).toBe("assigned");
    expect(await A.moveStage(as(S), id, "contacted")).toEqual({ ok: true });
    for (const st of ["offer", "enrolled"] as const)
      expect(await A.moveStage(as(S), id, st)).toMatchObject({ reason: "invalid_step" });
    expect(await A.moveStage(as(S), id, "lost", "no")).toMatchObject({ reason: "invalid" });
    expect(await A.moveStage(as(S), id, "lost", "Moved abroad")).toEqual({ ok: true });
    expect((await find("Thao N.")).lostReason).toBe("Moved abroad");
    expect(await A.assign(as(S), id, SAM_P)).toMatchObject({ reason: "invalid_step" }); // closed
    expect(await A.moveStage(as(S), id, "contacted")).toEqual({ ok: true }); // reopened
    const l = await find("Thao N.");
    expect(l.lostReason).toBeNull();
    expect(l.stageHistory.map((h) => h.stage)).toEqual([
      "new",
      "assigned",
      "contacted",
      "lost",
      "contacted",
    ]);
  });
});

describe("admissions — explainable score", () => {
  it("parts add up to the total, each with a reason; staff tune parts and bands", async () => {
    const all = (await A.listLeads(as(S)))!;
    for (const l of all) {
      expect(l.score.parts.reduce((t, p) => t + p.points, 0)).toBe(l.score.total);
      expect(l.score.parts.every((p) => p.points <= p.max && p.why.length > 0)).toBe(true);
    }
    const son = await find("Son V.");
    expect(son.score.parts.find((p) => p.key === "course_fit")!.why).toBe("No IELTS-B2 class yet"); // no IELTS class anywhere → 0 points
    expect(
      await A.updateSettings(as(S), {
        ...DEFAULT_SETTINGS,
        max: { ...DEFAULT_SETTINGS.max, source: 30 },
      }),
    ).toMatchObject({ reason: "invalid", detail: expect.stringMatching(/add up to 100/) });
    expect(await A.updateSettings(as(S), { ...DEFAULT_SETTINGS, warmAt: 80 })).toMatchObject({
      reason: "invalid",
    });
    const before = (await A.getDashboard(as(S)))!.bands;
    expect(await A.updateSettings(as(S), { ...DEFAULT_SETTINGS, hotAt: 99, warmAt: 98 })).toEqual({
      ok: true,
    });
    const after = (await A.getDashboard(as(S)))!.bands;
    expect(after.cold).toBeGreaterThan(before.cold);
    __attachForTests(SAM_P, "policy-front-desk-d1"); // center-limited → cannot tune the org's score
    expect(await A.updateSettings(as(S), DEFAULT_SETTINGS)).toMatchObject({
      reason: "access_policy",
    });
  });
});

describe("admissions — dashboard", () => {
  it("every rate has numerator and denominator and never exceeds 100%", async () => {
    const d = (await A.getDashboard(as(S)))!;
    expect(d).toMatchObject({ total: 14, enrolled: 2, lost: 2, open: 10, stale: 4, staleDays: 7 });
    for (const c of d.conversions) {
      expect(c.reached).toBeLessThanOrEqual(c.of);
      expect(c.pct === null || (c.pct >= 0 && c.pct <= 100)).toBe(true);
    }
    expect(d.leadToEnrolled).toEqual({ reached: 2, of: 14, pct: 14.3 });
    // A lost lead still counts for the stages it reached before it was lost (Nhi C., Vinh S.).
    expect(d.conversions[0]).toMatchObject({ from: "new", to: "assigned", reached: 12, of: 14 });
    expect(d.firstResponse.measured).toBeLessThanOrEqual(d.firstResponse.of);
    expect(d.byStage.reduce((t, s) => t + s.count, 0)).toBe(14);
    expect(d.bands.hot + d.bands.warm + d.bands.cold).toBe(d.open);
    const sam = d.counselors.find((c) => c.name === "Sam (Org Staff)")!;
    expect(sam.conversion.reached).toBe(sam.enrolled);
    expect(sam.conversion.of).toBe(sam.assigned);
  });
});

describe("admissions — one pipeline with Growth and Billing", () => {
  it("a referral lead appears here; Billing moves it to offer / enrolled; a void goes back", async () => {
    const code = (await G.getMine(as("demo-guardian")))!.code;
    await G.submitLead(code, { learnerName: "Bao T.", courseCode: "ENG-A2", centerName: D1.name });
    const bao = await find("Bao T.");
    expect(bao).toMatchObject({ source: "referral", referredBy: "Mai (Guardian)", stage: "new" });
    expect(bao.score.parts.find((p) => p.key === "source")!.points).toBe(25);
    expect(await B.issueFirstInvoice(as(S), bao.id)).toMatchObject({ reason: "invalid_step" });
    await A.moveStage(as(S), bao.id, "placement");
    const issued = await B.issueFirstInvoice(as(S), bao.id);
    expect((await find("Bao T.")).stage).toBe("offer");
    expect(await A.moveStage(as(S), bao.id, "contacted")).toMatchObject({ reason: "invalid_step" });
    const inv = (await B.listInvoices(as(S)))!.find((i) => i.learnerName === "Bao T.")!;
    expect(await B.voidInvoice(as(S), inv.id, "wrong course")).toEqual({ ok: true });
    expect((await find("Bao T.")).stage).toBe("placement");
    await B.issueFirstInvoice(as(S), bao.id);
    const inv2 = (await B.listInvoices(as(S)))!.find(
      (i) => i.learnerName === "Bao T." && i.status !== "void",
    )!;
    await B.recordPayment(as(S), inv2.id, inv2.totalVnd, "cash");
    expect((await find("Bao T.")).stage).toBe("enrolled");
    expect((await G.listLeads(as(S)))![0]).toMatchObject({ status: "enrolled", stage: "enrolled" });
    expect(issued).toMatchObject({ ok: true });
  });
});
