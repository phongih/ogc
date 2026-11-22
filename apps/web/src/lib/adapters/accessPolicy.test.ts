// Access policy (HealthcareOS HCOS-F2 pattern): role ∩ policy, narrow-only, fail-closed, Org Admin
// only and never on their own access. Enforced in the adapters, not just hidden in the UI.
// OGC-ADR-039 step 2: the policies live in the MOCK IIOS; the admin calls IiosPolicyAdminPort with
// their granted context, and the narrowing reaches OGC inside each grant.
import { as } from "../../test/grants";
import { beforeEach, describe, expect, it } from "vitest";
import type { PolicyRule } from "@ogc/contracts";
import type { IiosGrantedContext } from "@ogc/contracts";
import { allows, mockMyAccess } from "./accessPolicy";
import {
  __attachForTests,
  __policiesForTests,
  mockIiosPolicyAdmin as iios,
} from "../integration/mockIiosPolicy";
import { mockIiosContext } from "../integration/mockIiosContext";
import { presentedGrantFor } from "../../app/iiosGate";
import { organizations } from "../../fixtures/directory";
import { mockSchedule } from "./mockSchedule";
import { mockMakeup } from "./mockMakeup";
import { mockCenterSetup } from "./mockCenterSetup";
import { mockDecisionEngine } from "./mockDecisionEngine";
import { __resetAttendanceForTests, mockAttendance } from "./mockAttendance";
import { centers } from "../../fixtures/directory";
import { classes } from "../../fixtures/teaching";
import { TEACHER_BEN } from "../../fixtures/personas";
import { seedSessions } from "../../fixtures/attendance";

const ADMIN = "demo-admin";
const SAM = "demo-staff";
const BEN = "demo-teacher-2";
const SAM_P = "iios-principal-staff-1";
const BEN_P = "iios-principal-teacher-2";
const ADMIN_P = "iios-principal-admin-1";
const FRONT_DESK = "policy-front-desk-d1";
const OWN_CLASSES = "policy-own-classes";
const D1 = centers[0].id;
const A2 = classes[0].id; // District 1
const DAY = 86_400_000;
// n days from now at 13:00 center time (06:00Z): no seeded session starts within 90 minutes of
// that, so a move / extra session there never clashes, whatever time the suite runs (22/11).
const inDays = (n: number) =>
  `${new Date(Date.now() + n * DAY).toISOString().slice(0, 10)}T06:00:00.000Z`;
const a2ToMark = () =>
  seedSessions.filter(
    (s) => s.classId === A2 && !s.seededMarks && Date.parse(s.at) <= Date.now(),
  )[0].id;

beforeEach(() => {
  __resetAttendanceForTests();
}); // resets the schedule, and with it access policies

/** The granted context the mock IIOS issues for a persona right now. */
async function grantOf(persona: string): Promise<IiosGrantedContext> {
  const r = await mockIiosContext.resolveContext(
    presentedGrantFor(persona, "valid"),
    organizations[0].id,
  );
  expect(r.state).toBe("valid");
  return r.context!;
}
const PRINCIPAL: Record<string, string> = { [SAM]: SAM_P, [BEN]: BEN_P, [ADMIN]: ADMIN_P };
async function attach(member: string, policyId: string | null) {
  const r = await iios.attachPolicy(await grantOf(ADMIN), PRINCIPAL[member] ?? member, policyId);
  expect(r.ok).toBe(true);
}
const access = {
  getAdminView: async (p: string) => iios.getAdminView(await grantOf(p)),
  createPolicy: async (p: string, input: Parameters<typeof iios.createPolicy>[1]) =>
    iios.createPolicy(await grantOf(p), input),
  revisePolicy: async (
    p: string,
    ref: string,
    v: number,
    patch: Parameters<typeof iios.revisePolicy>[3],
  ) => iios.revisePolicy(await grantOf(p), ref, v, patch),
  retirePolicy: async (p: string, ref: string, v: number) =>
    iios.retirePolicy(await grantOf(p), ref, v),
  setMembershipPolicy: async (p: string, member: string, ref: string | null) =>
    iios.attachPolicy(await grantOf(p), PRINCIPAL[member] ?? member, ref),
  myAccess: (p: string) => mockMyAccess.myAccess(as(p)),
};

describe("access — admin view", () => {
  it("lists the organization's memberships read-only, with the EduOS-style counts", async () => {
    const v = (await access.getAdminView(ADMIN))!;
    expect(v.stats).toEqual({
      members: 8,
      staffAndTeachers: 4,
      privileged: 1,
      restricted: 0,
      noRole: 1,
    });
    expect(v.policies.map((p) => p.name)).toEqual([
      "Front desk — District 1 only",
      "Teacher — own classes only",
    ]);
    expect(v.memberships.find((m) => m.principalId === ADMIN_P)!.isYou).toBe(true);
    expect(
      v.memberships.find((m) => m.principalId === "iios-principal-learner-1")!.canHavePolicy,
    ).toBe(false);
    expect(v.memberships.some((m) => m.principalId === "iios-principal-staff-org2")).toBe(false);
  });

  it("only the Org Admin manages policies (fail-closed for everyone else)", async () => {
    for (const other of [SAM, "demo-teacher", "demo-learner", "demo-guardian"]) {
      expect(await access.getAdminView(other)).toBeNull();
      expect(await access.setMembershipPolicy(other, BEN, OWN_CLASSES)).toEqual({
        ok: false,
        reason: "not_admin",
      });
    }
  });

  it("IIOS re-checks admin from its own data — a grant claiming orgAdmin is not enough", async () => {
    const forged = { ...(await grantOf(SAM)), orgAdmin: true };
    expect(await iios.getAdminView(forged)).toBeNull();
    expect(await iios.attachPolicy(forged, BEN_P, OWN_CLASSES)).toEqual({
      ok: false,
      reason: "not_admin",
    });
  });
});

describe("access — the narrowing travels in the grant (ADR-039 step 2)", () => {
  it("IIOS puts orgAdmin and the current narrowing into each resolved grant", async () => {
    expect((await grantOf(ADMIN)).orgAdmin).toBe(true);
    expect((await grantOf(SAM)).orgAdmin).toBe(false);
    expect((await grantOf(SAM)).narrowing).toEqual({ state: "none" });
    await attach(SAM, FRONT_DESK);
    expect((await grantOf(SAM)).narrowing).toMatchObject({
      state: "policy",
      policyRef: FRONT_DESK,
      version: 1,
      name: "Front desk — District 1 only",
    });
    __attachForTests(SAM_P, "policy-that-does-not-exist");
    expect((await grantOf(SAM)).narrowing).toEqual({ state: "unavailable" });
  });
});

describe("access — a policy only narrows", () => {
  it("no policy: the role's normal access is unchanged", async () => {
    expect((await mockSchedule.getOverview(as(SAM)))!.classes).toHaveLength(3);
    expect((await access.myAccess(SAM)).policyName).toBeNull();
    // A policy never grants: a teacher holding a staff rule still cannot manage the schedule.
    await access.createPolicy(ADMIN, { name: "Wide", rules: [{ action: "schedule:manage" }] });
    const wide = (await access.getAdminView(ADMIN))!.policies.find((p) => p.name === "Wide")!;
    await attach(BEN, wide.id);
    expect(allows(as(BEN), "schedule:manage")).toBe(false);
    expect(await mockSchedule.getOverview(as(BEN))).toBeNull();
  });

  it("front desk: District 1 only, and class teacher / substitute are read-only", async () => {
    await attach(SAM, FRONT_DESK);
    const o = (await mockSchedule.getOverview(as(SAM)))!;
    expect(o.classes.map((c) => c.className)).toEqual([
      "A2 Morning — Mon/Wed",
      "A2 Evening — Tue/Thu",
    ]);
    expect(o.classes.every((c) => c.centerId === D1)).toBe(true);
    // Thu Duc: refused even though Sam is staff.
    expect(await mockSchedule.reschedule(as(SAM), "SES-002", inDays(4))).toEqual({
      ok: false,
      reason: "access_policy",
    });
    // District 1: rescheduling is fine…
    expect((await mockSchedule.reschedule(as(SAM), "SES-001", inDays(4))).ok).toBe(true);
    // …but teacher and substitute are read-only.
    expect(await mockSchedule.assignTeacher(as(SAM), A2, TEACHER_BEN)).toEqual({
      ok: false,
      reason: "access_policy",
    });
    expect(await mockSchedule.setSubstitute(as(SAM), "SES-001", TEACHER_BEN)).toEqual({
      ok: false,
      reason: "access_policy",
    });
    // Make-ups: only District 1 items, and no center setup (not in the policy).
    const board = (await mockMakeup.getBoard(as(SAM)))!;
    const d1 = new Set(classes.filter((c) => c.centerId === D1).map((c) => c.id));
    expect(board.items.every((i) => d1.has(i.classId))).toBe(true);
    expect(await mockCenterSetup.getSetupContext(as(SAM))).toBeNull();
    const me = await access.myAccess(SAM);
    expect(me.policyName).toBe("Front desk — District 1 only");
    expect(me.allowed["center:setup"]).toBe(false);
    expect(me.centers["schedule:manage"]).toEqual([D1]);
    expect(me.readonly["schedule:manage"]).toEqual(["classTeacher", "substitute"]);
  });

  it("own classes only: the teacher can no longer mark as a substitute", async () => {
    const sid = a2ToMark();
    expect((await mockSchedule.setSubstitute(as(SAM), sid, TEACHER_BEN)).ok).toBe(true);
    expect((await mockAttendance.listToMark(as(BEN))).some((s) => s.id === sid)).toBe(true);
    await attach(BEN, OWN_CLASSES);
    expect((await mockAttendance.listToMark(as(BEN))).some((s) => s.id === sid)).toBe(false);
    expect(await mockAttendance.getSessionAttendance(as(BEN), sid)).toBeNull();
    await attach(BEN, null);
    expect((await mockAttendance.listToMark(as(BEN))).some((s) => s.id === sid)).toBe(true);
  });

  it("engine: thresholds can be tuned while rule actions stay read-only", async () => {
    const r = await access.createPolicy(ADMIN, {
      name: "Engine tuner",
      rules: [{ action: "engine:manage", readonlyFields: ["actions"] }],
    });
    expect(r.ok).toBe(true);
    const id = (await access.getAdminView(ADMIN))!.policies.find(
      (p) => p.name === "Engine tuner",
    )!.id;
    await attach(SAM, id);
    const rule = (await mockDecisionEngine.listRules(as(SAM)))!.find(
      (x) => x.kind === "skill_low",
    )!;
    expect(
      (await mockDecisionEngine.updateRule(as(SAM), rule.id, { params: { threshold: 53 } })).ok,
    ).toBe(true);
    expect(
      await mockDecisionEngine.updateRule(as(SAM), rule.id, { actions: ["notify_staff"] }),
    ).toMatchObject({ ok: false, reason: "access_policy" });
    // Same actions in another order is not a change.
    expect(
      (
        await mockDecisionEngine.updateRule(as(SAM), rule.id, {
          actions: [...rule.actions].reverse(),
        })
      ).ok,
    ).toBe(true);
  });

  it("fail-closed: a membership pointing at a missing or retired policy can do nothing", async () => {
    __attachForTests(SAM_P, "policy-that-does-not-exist");
    expect((await mockSchedule.getOverview(as(SAM)))!.classes).toEqual([]);
    expect(await mockSchedule.reschedule(as(SAM), "SES-001", inDays(4))).toEqual({
      ok: false,
      reason: "access_policy",
    });
    expect((await access.myAccess(SAM)).failedClosed).toBe(true);
    // A retired policy (tampered state — the admin path refuses this) is the same.
    __policiesForTests.get(FRONT_DESK)!.status = "retired";
    __attachForTests(SAM_P, FRONT_DESK);
    expect(allows(as(SAM), "schedule:manage", { centerId: D1 })).toBe(false);
  });
});

describe("access — admin rules", () => {
  it("the admin never changes their own access", async () => {
    expect(await access.setMembershipPolicy(ADMIN, ADMIN, FRONT_DESK)).toEqual({
      ok: false,
      reason: "self",
    });
    __attachForTests(ADMIN_P, FRONT_DESK); // another admin restricted Olivia
    const p = (await access.getAdminView(ADMIN))!.policies.find((x) => x.id === FRONT_DESK)!;
    expect(p.restrictsYou).toBe(true);
    expect(
      await access.revisePolicy(ADMIN, FRONT_DESK, p.version, {
        rules: [{ action: "center:setup" }],
      }),
    ).toEqual({
      ok: false,
      reason: "self",
    });
    expect(await access.retirePolicy(ADMIN, FRONT_DESK, p.version)).toEqual({
      ok: false,
      reason: "self",
    });
  });

  it("learners, guardians and no-role members take no policy", async () => {
    for (const m of [
      "iios-principal-learner-1",
      "iios-principal-guardian-1",
      "iios-principal-pending-1",
    ])
      expect(await access.setMembershipPolicy(ADMIN, m, FRONT_DESK)).toEqual({
        ok: false,
        reason: "not_applicable",
      });
  });

  it("revise needs the current version; retire waits until nobody uses it; history is kept", async () => {
    await attach(SAM, FRONT_DESK);
    expect(await access.retirePolicy(ADMIN, FRONT_DESK, 1)).toEqual({
      ok: false,
      reason: "in_use",
    });
    const r = await access.revisePolicy(ADMIN, FRONT_DESK, 1, { description: "v2" });
    expect(r.ok).toBe(true);
    expect(await access.revisePolicy(ADMIN, FRONT_DESK, 1, { description: "late" })).toEqual({
      ok: false,
      reason: "stale",
    });
    await attach(SAM, null);
    expect((await access.retirePolicy(ADMIN, FRONT_DESK, 2)).ok).toBe(true);
    expect(await access.setMembershipPolicy(ADMIN, SAM, FRONT_DESK)).toEqual({
      ok: false,
      reason: "retired",
    });
    expect(await access.revisePolicy(ADMIN, FRONT_DESK, 3, { description: "x" })).toEqual({
      ok: false,
      reason: "retired",
    });
    const p = (await access.getAdminView(ADMIN))!.policies.find((x) => x.id === FRONT_DESK)!;
    expect(p.history.map((h) => `${h.version}:${h.change}`)).toEqual([
      "3:retired",
      "2:revised",
      "1:created",
    ]);
    expect(p.history[0].changedBy).toBe("Olivia (Org Admin)");
  });

  it("the catalog is closed: unknown actions, conditions, fields and centers are refused", async () => {
    const bad = async (rules: unknown[]) =>
      access.createPolicy(ADMIN, { name: "Bad one", rules: rules as PolicyRule[] });
    expect(await bad([{ action: "learner:delete" }])).toMatchObject({
      ok: false,
      reason: "invalid",
      path: "rules[0].action",
    });
    expect(
      await bad([
        { action: "schedule:manage" },
        { action: "schedule:manage", criteria: { sessionRole: ["owner"] } },
      ]),
    ).toMatchObject({ ok: false, reason: "invalid", path: "rules[1].criteria.sessionRole" });
    expect(await bad([{ action: "makeup:manage", readonlyFields: ["actions"] }])).toMatchObject({
      ok: false,
      reason: "invalid",
      path: "rules[0].readonlyFields[0]",
    });
    expect(
      await bad([{ action: "makeup:manage", criteria: { centerId: [centers[3].id] } }]), // other org
    ).toMatchObject({ ok: false, reason: "invalid", path: "rules[0].criteria.centerId[0]" });
    expect(await bad([])).toMatchObject({ ok: false, reason: "invalid", path: "rules" });
    expect(
      await access.createPolicy(ADMIN, {
        name: "front desk — district 1 only",
        rules: [{ action: "center:setup" }],
      }),
    ).toEqual({ ok: false, reason: "name_taken" });
  });
});

describe("access — ports take the IIOS-granted context (ADR-039 step 3b)", () => {
  it("the role comes from the grant, not from OGC fixtures", async () => {
    const samAsTeacher = { ...as(SAM), role: "teacher" as const };
    expect(allows(samAsTeacher, "schedule:manage", { centerId: D1 })).toBe(false);
    expect(await mockSchedule.getOverview(samAsTeacher)).toBeNull();
    // Olivia: IIOS grants "staff" (+ orgAdmin) — she manages the schedule as staff.
    expect(as(ADMIN).role).toBe("staff");
    expect(as(ADMIN).orgAdmin).toBe(true);
    expect(allows(as(ADMIN), "schedule:manage", { centerId: D1 })).toBe(true);
  });

  it("a grant is a snapshot: the narrowing in force is the one the caller presents", async () => {
    const before = as(SAM);
    await attach(SAM, FRONT_DESK);
    expect(allows(before, "schedule:manage", { centerId: centers[1].id })).toBe(true);
    expect(allows(as(SAM), "schedule:manage", { centerId: centers[1].id })).toBe(false);
  });

  it("another tenant's resource is refused by the contract", () => {
    expect(allows(as(SAM), "schedule:manage", { centerId: centers[3].id })).toBe(false); // Lumen
  });

  it("IIOS active center (AZ7) narrows what the ports return", async () => {
    const atD1 = { ...as(SAM), activeCenter: D1 };
    const o = (await mockSchedule.getOverview(atD1))!;
    expect(o.classes.every((c) => c.centerId === D1)).toBe(true);
    expect(o.classes.length).toBe(2);
    expect(await mockSchedule.reschedule(atD1, "SES-002", inDays(4))).toEqual({
      ok: false,
      reason: "access_policy",
    });
    // Organization-level action under an active center: refused (ADR-039 §4.4, pending IIOS).
    expect(await mockCenterSetup.getSetupContext(atD1)).toBeNull();
  });

  it("a principal OGC has no record for gets nothing, whatever role the grant claims", async () => {
    const stranger = { ...as("demo-teacher"), principalId: "iios-principal-unknown" };
    expect(await mockAttendance.listToMark(stranger)).toEqual([]);
    expect(await mockMakeup.listToConfirm(stranger)).toEqual([]);
    const strangerLearner = { ...as("demo-learner"), principalId: "iios-principal-unknown" };
    expect(await mockMakeup.listMine(strangerLearner)).toEqual([]);
  });

  it("an unavailable narrowing (policy missing / retired in IIOS) allows nothing", async () => {
    const g = { ...as(SAM), narrowing: { state: "unavailable" as const } };
    expect((await mockSchedule.getOverview(g))!.classes).toEqual([]);
    expect((await mockMakeup.getBoard(g))!.items).toEqual([]);
  });
});
