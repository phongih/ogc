// Growth Engine · referrals (owner 22/11): guardians + adult learners refer; tuition credit in a
// wallet (mock); counts only after enrolment + first payment + staff confirmation, with anti-fraud.
import { beforeEach, describe, expect, it } from "vitest";
import { as } from "../../test/grants";
import { __resetGrowthForTests, markLeadPaid, mockGrowth as G } from "./mockGrowth";
import { __attachForTests } from "../integration/mockIiosPolicy";
import { centers } from "../../fixtures/directory";

const D1 = centers[0].name; // Nova English — District 1
const MAI = "demo-guardian";
const MINH = "demo-learner-2"; // adult learner
const S = "demo-staff";

beforeEach(() => __resetGrowthForTests());

const codeOf = async (p: string) => (await G.getMine(as(p)))!.code;
async function lead(referrer: string, learnerName: string, opts: { campaignId?: string } = {}) {
  const code = await codeOf(referrer);
  const r = await G.submitLead(code, {
    learnerName,
    courseCode: "ENG-A2",
    centerName: D1,
    ...opts,
  });
  expect(r).toEqual({ ok: true });
  return (await G.listLeads(as(S)))!.find((l) => l.learnerName === learnerName)!.id;
}
// Billing moves a placed lead to "enrolled and paid" when its first invoice is paid (see
// mockBilling.test.ts for that path); here the hook is called directly with any amount.
async function enrol(id: string, vnd: number) {
  expect(await G.markPlaced(as(S), id)).toEqual({ ok: true });
  markLeadPaid(id, vnd);
}

describe("growth — who may refer", () => {
  it("guardians and adult learners get a link; minors, teachers and staff do not", async () => {
    expect((await G.getMine(as(MAI)))!.code).toMatch(/^OGC[0-9A-Z]{6}$/);
    expect((await G.getMine(as(MINH)))!.link).toMatch(/^\/join\?ref=OGC/);
    for (const p of ["demo-learner", "demo-teacher", S, "demo-admin"])
      expect(await G.getMine(as(p))).toBeNull();
  });

  it("a click on a valid link counts; an unknown code does not", async () => {
    const code = await codeOf(MAI);
    expect((await G.recordClick(code)).valid).toBe(true);
    expect((await G.recordClick("OGCNOPE00")).valid).toBe(false);
    expect((await G.getMine(as(MAI)))!.performance.clicks).toBe(1);
  });
});

describe("growth — funnel and reward", () => {
  it("lead → placement → enrolled + paid → staff confirm → tuition credit (5%)", async () => {
    const id = await lead(MAI, "Bao T.");
    expect(await G.confirm(as(S), id)).toMatchObject({ ok: false, reason: "invalid_step" });
    markLeadPaid(id, 10_000_000); // not placed yet → ignored
    expect((await G.listLeads(as(S)))![0].status).toBe("lead");
    await enrol(id, 10_000_000);
    expect(await G.confirm(as(S), id)).toEqual({ ok: true });
    const me = (await G.getMine(as(MAI)))!;
    expect(me.wallet.balanceVnd).toBe(500_000);
    expect(me.wallet.entries[0].note).toMatch(/Bao T\. enrolled in ENG-A2/);
    expect(me.performance).toMatchObject({ leads: 1, conversions: 1, convRatePct: 100 });
    expect(me.myLeads[0].status).toBe("confirmed");
  });

  it("a campaign adds its bonus; the cap holds", async () => {
    const a = await lead(MAI, "Chi V.", { campaignId: "camp-tet-2027" });
    await enrol(a, 10_000_000);
    await G.confirm(as(S), a);
    const b = await lead(MINH, "Dung K.");
    await enrol(b, 100_000_000);
    await G.confirm(as(S), b);
    expect((await G.getMine(as(MAI)))!.wallet.balanceVnd).toBe(700_000); // 5% + 2%
    expect((await G.getMine(as(MINH)))!.wallet.balanceVnd).toBe(2_000_000); // capped
  });

  it("the public form takes synthetic name + course + center only and checks them", async () => {
    const code = await codeOf(MAI);
    expect(
      await G.submitLead(code, { learnerName: "X", courseCode: "ENG-A2", centerName: D1 }),
    ).toMatchObject({ reason: "invalid" });
    expect(
      await G.submitLead(code, { learnerName: "Bao T.", courseCode: "NOPE", centerName: D1 }),
    ).toMatchObject({ reason: "invalid" });
    expect(
      await G.submitLead("OGCNOPE00", {
        learnerName: "Bao T.",
        courseCode: "ENG-A2",
        centerName: D1,
      }),
    ).toMatchObject({ reason: "not_found" });
  });
});

describe("growth — anti-fraud blocks the reward", () => {
  it("own household, self-referral and duplicates are flagged and cannot be confirmed", async () => {
    const household = await lead(MAI, "Linh N."); // Mai's own child
    const self = await lead(MINH, "Minh T."); // Minh himself
    const dup = await lead(MAI, "An P."); // already a learner at District 1
    const leads = (await G.listLeads(as(S)))!;
    expect(leads.find((l) => l.id === household)!.flags).toContain("same_household");
    expect(leads.find((l) => l.id === self)!.flags).toContain("self_referral");
    expect(leads.find((l) => l.id === dup)!.flags).toContain("duplicate");
    await enrol(household, 10_000_000);
    expect(await G.confirm(as(S), household)).toMatchObject({ ok: false, reason: "flagged" });
    expect((await G.getMine(as(MAI)))!.wallet.balanceVnd).toBe(0);
    expect(await G.reject(as(S), household, "own child")).toEqual({ ok: true });
  });

  it("one reward per new learner", async () => {
    const a = await lead(MAI, "Em H.");
    await enrol(a, 10_000_000);
    await G.confirm(as(S), a);
    const b = await lead(MINH, "Em H.");
    const flags = (await G.listLeads(as(S)))!.find((l) => l.id === b)!.flags;
    expect(flags).toEqual(expect.arrayContaining(["already_rewarded"]));
  });
});

describe("growth — staff, access and metrics", () => {
  it("only staff run the funnel; an access policy without growth:manage blocks writes", async () => {
    const id = await lead(MAI, "Bao T.");
    expect(await G.listLeads(as("demo-teacher"))).toBeNull();
    expect(await G.markPlaced(as("demo-teacher"), id)).toEqual({ ok: false, reason: "not_staff" });
    __attachForTests("iios-principal-staff-1", "policy-front-desk-d1");
    expect(await G.markPlaced(as(S), id)).toEqual({ ok: false, reason: "access_policy" });
    __attachForTests("iios-principal-staff-1", null);
    expect(await G.markPlaced(as("demo-staff-org2"), id)).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("metrics: K-factor, conversion, cohorts, campaigns; referrers stay anonymous to each other", async () => {
    const a = await lead(MAI, "Bao T.", { campaignId: "camp-tet-2027" });
    await lead(MAI, "Chi V.");
    await enrol(a, 10_000_000);
    await G.confirm(as(S), a);
    const m = (await G.getMetrics(as(S)))!;
    expect(m.referrers).toBe(2); // Mai + Minh (Linh is a minor)
    expect(m.leads).toBe(2);
    expect(m.confirmed).toBe(1);
    expect(m.kFactor).toBe(0.5);
    expect(m.conversionPct).toBe(50);
    expect(m.cohorts).toHaveLength(1);
    expect(m.campaigns[0]).toMatchObject({ leads: 1, confirmed: 1 });
    expect(m.topReferrers[0]).toMatchObject({
      name: "Mai (Guardian)",
      confirmed: 1,
      rewardVnd: 700_000,
    });
    expect(m.ltvUpliftPct).toBeNull(); // no fee schedule yet
    const board = (await G.getMine(as(MINH)))!.leaderboard;
    expect(board.map((r) => r.label)).toEqual(["Ambassador #1", "You"]);
    expect(await G.getMetrics(as("demo-teacher"))).toBeNull();
  });

  it("program: staff tune it within limits; paused → links stop working", async () => {
    expect(await G.updateProgram(as(S), { rewardPct: 50 })).toMatchObject({ reason: "invalid" });
    expect(await G.updateProgram(as(MAI), { enabled: false })).toEqual({
      ok: false,
      reason: "not_staff",
    });
    expect(await G.updateProgram(as(S), { enabled: false })).toEqual({ ok: true });
    const code = await codeOf(MAI);
    expect((await G.recordClick(code)).valid).toBe(false);
    expect(
      await G.submitLead(code, { learnerName: "Bao T.", courseCode: "ENG-A2", centerName: D1 }),
    ).toMatchObject({ reason: "not_found" });
  });
});
