// OGC-ADR-039 §5 — the authorization contract (design-level tests, SYNTHETIC). Proves the decision
// order and that OGC only applies what IIOS handed over: tenant, role, active center, narrowing.
// Proves nothing about production IIOS.
import { describe, expect, it } from "vitest";
import {
  GrantNarrowing,
  IiosGrantedContext,
  authorize,
  authorizeField,
  type PolicyRule,
} from "@ogc/contracts";

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const D1 = "00000000-0000-4000-8000-000000000c01";
const TD = "00000000-0000-4000-8000-000000000c02";

const ctx = (over: Partial<IiosGrantedContext> = {}): IiosGrantedContext => ({
  clientId: "eduos",
  orgId: ORG,
  principalId: "iios-principal-staff-1",
  role: "staff",
  purpose: "learning.read",
  requestId: "req-synth-test",
  grantRef: "iios-grant-ref-test",
  expiresAt: "2099-01-01T00:00:00.000Z",
  ...over,
});
const policy = (rules: PolicyRule[]): IiosGrantedContext["narrowing"] => ({
  state: "policy",
  policyRef: "iios-policy-1",
  version: 1,
  name: "Front desk",
  rules,
});
const FRONT_DESK = policy([
  { action: "schedule:manage", criteria: { centerId: [D1] }, readonlyFields: ["classTeacher"] },
]);

describe("authorize — order and fail-closed", () => {
  it("no narrowing: the role decides (backward compatible with today's grants)", () => {
    expect(authorize(ctx(), "schedule:manage", { orgId: ORG, centerId: TD })).toEqual({
      allow: true,
      readonly: [],
    });
    expect(authorize(ctx({ role: "teacher" }), "schedule:manage", { orgId: ORG })).toEqual({
      allow: false,
      reason: "role",
    });
    for (const role of ["learner", "guardian", "service"] as const)
      expect(authorize(ctx({ role }), "attendance:mark", { orgId: ORG }).allow).toBe(false);
  });

  it("another organization is refused first, whatever else the grant says", () => {
    expect(
      authorize(ctx({ narrowing: { state: "none" } }), "schedule:manage", {
        orgId: OTHER,
        centerId: D1,
      }),
    ).toEqual({ allow: false, reason: "cross_tenant" });
  });

  it("active center (AZ7) narrows; a resource without a center is refused under it", () => {
    const c = ctx({ activeCenter: D1 });
    expect(authorize(c, "schedule:manage", { orgId: ORG, centerId: D1 }).allow).toBe(true);
    expect(authorize(c, "schedule:manage", { orgId: ORG, centerId: TD })).toEqual({
      allow: false,
      reason: "center",
    });
    expect(authorize(c, "center:setup", { orgId: ORG })).toEqual({
      allow: false,
      reason: "center",
    });
  });

  it("policy narrowing: only matching rules; read-only fields come with the decision", () => {
    const c = ctx({ narrowing: FRONT_DESK });
    expect(authorize(c, "schedule:manage", { orgId: ORG, centerId: D1 })).toEqual({
      allow: true,
      readonly: ["classTeacher"],
    });
    expect(authorize(c, "schedule:manage", { orgId: ORG, centerId: TD })).toEqual({
      allow: false,
      reason: "narrowing",
    });
    expect(authorize(c, "makeup:manage", { orgId: ORG, centerId: D1 })).toEqual({
      allow: false,
      reason: "narrowing",
    });
    expect(authorizeField(c, "schedule:manage", { orgId: ORG, centerId: D1 }, "classTeacher")).toBe(
      false,
    );
    expect(authorizeField(c, "schedule:manage", { orgId: ORG, centerId: D1 }, "substitute")).toBe(
      true,
    );
  });

  it("a condition needing a fact the operation does not carry does not match", () => {
    const c = ctx({ narrowing: FRONT_DESK });
    expect(authorize(c, "schedule:manage", { orgId: ORG })).toEqual({
      allow: false,
      reason: "narrowing",
    });
    const own = ctx({
      role: "teacher",
      narrowing: policy([{ action: "attendance:mark", criteria: { sessionRole: ["owner"] } }]),
    });
    expect(authorize(own, "attendance:mark", { orgId: ORG, sessionRole: "owner" }).allow).toBe(
      true,
    );
    expect(authorize(own, "attendance:mark", { orgId: ORG, sessionRole: "substitute" }).allow).toBe(
      false,
    );
    expect(authorize(own, "attendance:mark", { orgId: ORG }).allow).toBe(false);
  });

  it("a policy never grants beyond the role", () => {
    const c = ctx({ role: "teacher", narrowing: policy([{ action: "schedule:manage" }]) });
    expect(authorize(c, "schedule:manage", { orgId: ORG, centerId: D1 })).toEqual({
      allow: false,
      reason: "role",
    });
  });

  it("IIOS could not resolve the policy → nothing is allowed", () => {
    const c = ctx({ narrowing: { state: "unavailable" } });
    for (const a of ["schedule:manage", "makeup:manage", "center:setup", "engine:manage"] as const)
      expect(authorize(c, a, { orgId: ORG, centerId: D1 })).toEqual({
        allow: false,
        reason: "unavailable",
      });
  });

  it("several matching rules: read-only fields intersect (the widest path wins)", () => {
    const c = ctx({
      narrowing: policy([
        { action: "schedule:manage", readonlyFields: ["classTeacher", "substitute"] },
        { action: "schedule:manage", criteria: { centerId: [D1] }, readonlyFields: ["substitute"] },
      ]),
    });
    expect(authorize(c, "schedule:manage", { orgId: ORG, centerId: D1 })).toEqual({
      allow: true,
      readonly: ["substitute"],
    });
    expect(authorize(c, "schedule:manage", { orgId: ORG, centerId: TD })).toEqual({
      allow: true,
      readonly: ["classTeacher", "substitute"],
    });
  });
});

describe("grant shape (proposed OGC-IIOS-001 change) stays strict", () => {
  it("accepts orgAdmin + narrowing, rejects unknown fields and malformed narrowing", () => {
    expect(
      IiosGrantedContext.safeParse(ctx({ orgAdmin: true, narrowing: FRONT_DESK })).success,
    ).toBe(true);
    expect(IiosGrantedContext.safeParse({ ...ctx(), hmac: "x" }).success).toBe(false); // no verification material
    expect(
      GrantNarrowing.safeParse({
        state: "policy",
        policyRef: "p",
        version: 1,
        name: "x",
        rules: [],
      }).success,
    ).toBe(false);
    expect(
      GrantNarrowing.safeParse({
        state: "policy",
        policyRef: "p",
        version: 1,
        name: "x",
        rules: [{ action: "learner:delete" }],
      }).success,
    ).toBe(false);
  });
});
