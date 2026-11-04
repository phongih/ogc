import { describe, expect, it } from "vitest";
import type { ClientContext, ClientRegistration } from "@ogc/contracts";
import { organizations } from "../../fixtures/directory";
import { LEARNER_LINH, LEARNER_MINH, LEARNER_ORG2 } from "../../fixtures/personas";
import { createIntegrationService } from "./integrationService";

/*
 * AUTH-027 / B2 — SYNTHETIC multi-client contract tests.
 *
 * These exercise TWO INDEPENDENT clients sharing ONE integration service instance — an
 * EduOS-like institutional client and an unrelated independent client — NOT two SPA views over a
 * single in-memory SPA store. They demonstrate, through the shared service boundary:
 *   - client + tenant authorization fail-closed (unregistered client, wrong tenant, cross-tenant),
 *   - tenant-scoped identity mapping with NO cross-tenant merge and deterministic conflict,
 *   - a teacher recommendation applied by one client and read by another client,
 *   - preservation of the system suggestion and AUTH-026 apply/revert/supersede semantics,
 *   - role-gated intervention (teacher/staff only) carried forward from AUTH-026.
 * This is NOT persistence, NOT real identity/authz, NOT a production audit system.
 */

const ORG = organizations[0].id; // Nova — tenant A
const ORG2 = organizations[1].id; // Lumen — tenant B (isolation subject)

// Two independent clients, both authorized for tenant ORG, plus one authorized only for ORG2.
const REGISTRY: ClientRegistration[] = [
  { clientId: "eduos", name: "EduOS (institutional client)", authorizedOrgIds: [ORG] },
  { clientId: "partner-b", name: "Independent partner client", authorizedOrgIds: [ORG] },
  { clientId: "org2-client", name: "Other-tenant client", authorizedOrgIds: [ORG2] },
];

const ctx = (clientId: string, orgId: string, role: ClientContext["role"], persona = "P-actor"): ClientContext => ({
  clientId,
  orgId,
  actorPersonaId: persona,
  role,
});

// EduOS teacher acting in ORG; independent partner teacher acting in ORG; a learner-role read.
const EDUOS_T = ctx("eduos", ORG, "teacher", "P-eduos-teacher");
const PARTNER_T = ctx("partner-b", ORG, "teacher", "P-partner-teacher");
const PARTNER_L = ctx("partner-b", ORG, "learner", "P-partner-learner");

describe("AUTH-027/B2 — client + tenant authorization is fail-closed", () => {
  it("rejects an unregistered client, a client acting outside its authorized tenant, and cross-tenant learner access", async () => {
    const svc = createIntegrationService(REGISTRY);

    // Unregistered client.
    const stranger = ctx("not-registered", ORG, "teacher");
    expect((await svc.applied.apply(stranger, LEARNER_LINH, { selectedActivityId: "ACT-B1-2", reasonCode: "pacing", note: "x" })).reason).toBe("not_authorized");
    expect(await svc.identity.resolveLearner(stranger, "ext-1")).toBeNull();

    // Registered client, but acting in a tenant it is NOT authorized for.
    const wrongTenant = ctx("eduos", ORG2, "teacher");
    expect((await svc.applied.apply(wrongTenant, LEARNER_ORG2, { selectedActivityId: "ACT-B1-2", reasonCode: "pacing", note: "x" })).reason).toBe("not_authorized");

    // Authorized for ORG2 only — cannot touch an ORG learner even while claiming orgId=ORG.
    const org2Client = ctx("org2-client", ORG, "teacher");
    expect((await svc.applied.apply(org2Client, LEARNER_LINH, { selectedActivityId: "ACT-B1-2", reasonCode: "pacing", note: "x" })).reason).toBe("not_authorized");

    // Authorized ORG client, but a learner from a DIFFERENT tenant → fail-closed.
    expect((await svc.applied.apply(EDUOS_T, LEARNER_ORG2, { selectedActivityId: "ACT-B1-2", reasonCode: "pacing", note: "x" })).reason).toBe("not_authorized");
  });

  it("rejects intervention by a non-teacher/staff role (AUTH-026 role gate preserved), but allows learner-role reads", async () => {
    const svc = createIntegrationService(REGISTRY);
    for (const role of ["learner", "guardian", "service"] as const) {
      const c = ctx("eduos", ORG, role);
      expect((await svc.applied.apply(c, LEARNER_LINH, { selectedActivityId: "ACT-B1-2", reasonCode: "pacing", note: "x" })).reason).toBe("not_authorized");
      expect((await svc.applied.revert(c, LEARNER_LINH)).reason).toBe("not_authorized");
      expect(await svc.applied.getActive(c, LEARNER_LINH)).toBeNull();
    }
    // A learner-role actor can still READ the learner-facing next action (its own surface).
    const na = await svc.applied.getNextAction(PARTNER_L, LEARNER_LINH);
    expect(na).not.toBeNull();
    expect(na!.source).toBe("system");
  });
});

describe("AUTH-027/B2 — tenant-scoped identity mapping, no cross-tenant merge", () => {
  it("maps a client subject to a learner, scoped to (clientId, orgId); other clients/tenants never see it", async () => {
    const svc = createIntegrationService(REGISTRY);

    const m = await svc.identity.mapSubject(EDUOS_T, "subj-100", LEARNER_LINH, "client_asserted");
    expect(m.ok).toBe(true);
    expect(m.mapping?.learnerId).toBe(LEARNER_LINH);
    expect(await svc.identity.resolveLearner(EDUOS_T, "subj-100")).toBe(LEARNER_LINH);

    // The INDEPENDENT client's identity namespace is separate — same external id resolves to nothing.
    expect(await svc.identity.resolveLearner(PARTNER_T, "subj-100")).toBeNull();

    // Mapping a learner that is not in the context tenant fails closed.
    expect((await svc.identity.mapSubject(EDUOS_T, "subj-x", LEARNER_ORG2, "client_asserted")).reason).toBe("learner_out_of_tenant");

    // Deterministic conflict: the same key cannot be re-pointed at a different learner.
    expect((await svc.identity.mapSubject(EDUOS_T, "subj-100", LEARNER_MINH, "client_asserted")).reason).toBe("mapping_conflict");
    // Re-asserting the SAME mapping is idempotent (ok).
    expect((await svc.identity.mapSubject(EDUOS_T, "subj-100", LEARNER_LINH, "client_asserted")).ok).toBe(true);
  });

  it("no implicit cross-tenant identity merge: one external id used in two tenants maps independently", async () => {
    const svc = createIntegrationService(REGISTRY);
    const org2T = ctx("org2-client", ORG2, "teacher");
    expect((await svc.identity.mapSubject(EDUOS_T, "shared", LEARNER_LINH, "client_asserted")).ok).toBe(true);
    expect((await svc.identity.mapSubject(org2T, "shared", LEARNER_ORG2, "client_asserted")).ok).toBe(true);
    expect(await svc.identity.resolveLearner(EDUOS_T, "shared")).toBe(LEARNER_LINH);
    expect(await svc.identity.resolveLearner(org2T, "shared")).toBe(LEARNER_ORG2);
  });
});

describe("AUTH-027/B2 — a recommendation applied by one client is read by another; system preserved", () => {
  it("EduOS applies a teacher recommendation; the INDEPENDENT partner client reads it through the shared boundary", async () => {
    const svc = createIntegrationService(REGISTRY);

    // Baseline: the learner-facing next action is the SYSTEM suggestion, friendly, no internal ids.
    const sysBefore = await svc.applied.getNextAction(PARTNER_L, LEARNER_LINH);
    expect(sysBefore!.source).toBe("system");
    const systemActivity = sysBefore!.activityId;
    expect(sysBefore!.friendlyReason).not.toMatch(/ACT-/);

    // EduOS (client A) applies an eligible alternative.
    const res = await svc.applied.apply(EDUOS_T, LEARNER_LINH, {
      selectedActivityId: "ACT-B1-2",
      reasonCode: "remediation",
      note: "Focus on opinion phrases",
    });
    expect(res.ok).toBe(true);
    expect(res.applied!.id).toBe("IAP-1"); // deterministic id
    expect(res.applied!.status).toBe("active");
    expect(res.applied!.systemActivityIdAtApply).toBe(systemActivity); // system suggestion preserved on the record

    // The INDEPENDENT partner client (client B), on the SAME service instance, reads the applied state.
    const activeFromB = await svc.applied.getActive(PARTNER_T, LEARNER_LINH);
    expect(activeFromB!.id).toBe("IAP-1");
    expect(activeFromB!.activityId).toBe("ACT-B1-2");

    // And the learner surface, read by client B, is now Teacher-sourced, friendly, no internal ids.
    const naFromB = await svc.applied.getNextAction(PARTNER_L, LEARNER_LINH);
    expect(naFromB!.source).toBe("teacher");
    expect(naFromB!.activityId).toBe("ACT-B1-2");
    expect(naFromB!.teacherNote).toBe("Focus on opinion phrases");
    expect(naFromB!.friendlyReason).not.toMatch(/ACT-/);

    // Cross-tenant read stays closed: an ORG2-only client sees nothing for an ORG learner.
    expect(await svc.applied.getActive(ctx("org2-client", ORG, "teacher"), LEARNER_LINH)).toBeNull();
  });

  it("the partner client can revert a recommendation the EduOS client applied; the learner reverts to the SYSTEM suggestion", async () => {
    const svc = createIntegrationService(REGISTRY);
    const sysBefore = await svc.applied.getNextAction(PARTNER_L, LEARNER_LINH);
    const systemActivity = sysBefore!.activityId;

    await svc.applied.apply(EDUOS_T, LEARNER_LINH, { selectedActivityId: "ACT-B1-2", reasonCode: "remediation", note: "temp" });
    expect((await svc.applied.getNextAction(PARTNER_L, LEARNER_LINH))!.source).toBe("teacher");

    const rev = await svc.applied.revert(PARTNER_T, LEARNER_LINH);
    expect(rev.ok).toBe(true);
    expect(rev.applied!.status).toBe("reverted");

    const after = await svc.applied.getNextAction(PARTNER_L, LEARNER_LINH);
    expect(after!.source).toBe("system");
    expect(after!.activityId).toBe(systemActivity); // system suggestion unchanged throughout
    expect(await svc.applied.getActive(EDUOS_T, LEARNER_LINH)).toBeNull();
  });
});

describe("AUTH-027/B2 — apply eligibility and one-active invariant (deterministic)", () => {
  it("fails closed on note-less, out-of-scope and blocked selections", async () => {
    const svc = createIntegrationService(REGISTRY);
    expect((await svc.applied.apply(EDUOS_T, LEARNER_LINH, { selectedActivityId: "ACT-B1-2", reasonCode: "pacing", note: "   " })).reason).toBe("reason_required");
    expect((await svc.applied.apply(EDUOS_T, LEARNER_LINH, { selectedActivityId: "ACT-B2-1", reasonCode: "pacing", note: "x" })).reason).toBe("activity_out_of_scope");
    expect((await svc.applied.apply(EDUOS_T, LEARNER_LINH, { selectedActivityId: "ACT-A2-4", reasonCode: "pacing", note: "x" })).reason).toBe("activity_not_eligible:blocked");
  });

  it("applying twice supersedes the first; only one active; ids are deterministic and sequential", async () => {
    const svc = createIntegrationService(REGISTRY);
    const r1 = await svc.applied.apply(EDUOS_T, LEARNER_LINH, { selectedActivityId: "ACT-B1-2", reasonCode: "pacing", note: "first" });
    const r2 = await svc.applied.apply(PARTNER_T, LEARNER_LINH, { selectedActivityId: "ACT-B1-2", reasonCode: "remediation", note: "second" });
    expect(r1.applied!.id).toBe("IAP-1");
    expect(r2.applied!.id).toBe("IAP-2");
    const active = await svc.applied.getActive(EDUOS_T, LEARNER_LINH);
    expect(active!.id).toBe("IAP-2");
    expect(active!.note).toBe("second");
  });
});
