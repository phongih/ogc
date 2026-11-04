import { describe, expect, it } from "vitest";
import type { ClientContext, ClientRegistration } from "@ogc/contracts";
import { createIntegrationService } from "../../../lib/integration/integrationService";
import { mockPractice as practice } from "../../../lib/adapters/mockPractice";
import { organizations } from "../../../fixtures/directory";
import { LEARNER_LINH } from "../../../fixtures/personas";

/*
 * OGC-AUTH-030 / Phase 3 — synthetic multi-client check over the AUTH-027 boundary.
 * A practice submission updates the shared learning state; a teacher recommendation applied by
 * one client (EduOS) is read by an independent client through the same service, and the
 * practice-unblocked activity is the one being applied. NOT a persistence/cross-device claim.
 */

const ORG = organizations[0].id;
const ORG2 = organizations[1].id;
const REGISTRY: ClientRegistration[] = [
  { clientId: "eduos", name: "EduOS", authorizedOrgIds: [ORG] },
  { clientId: "partner-b", name: "Independent partner", authorizedOrgIds: [ORG] },
  { clientId: "org2-client", name: "Other tenant", authorizedOrgIds: [ORG2] },
];
const ctx = (clientId: string, orgId: string, role: ClientContext["role"]): ClientContext => ({
  clientId,
  orgId,
  actorPersonaId: `P-${clientId}`,
  role,
});

const correctA23 = {
  attemptId: "ATT-INT-A23",
  responses: [
    { itemId: "A2-3-Q1", optionId: "a" },
    { itemId: "A2-3-Q2", optionId: "b" },
    { itemId: "A2-3-Q3", optionId: "b" },
    { itemId: "A2-3-Q4", optionId: "a" },
  ],
};

describe("AUTH-030 × AUTH-027 — practice-updated state across the multi-client boundary", () => {
  it("one client applies the practice-unblocked activity; an independent client reads it; cross-tenant stays closed", async () => {
    const svc = createIntegrationService(REGISTRY);

    // Practice ACT-A2-3 (shared store) → unblocks ACT-A2-4 for the learner.
    const res = await practice.submitPractice("demo-learner", "ACT-A2-3", correctA23);
    expect(res.ok).toBe(true);

    // EduOS (client A) applies the now-available ACT-A2-4.
    const apply = await svc.applied.apply(ctx("eduos", ORG, "teacher"), LEARNER_LINH, {
      selectedActivityId: "ACT-A2-4",
      reasonCode: "remediation",
      note: "Focus on speaking",
    });
    expect(apply.ok).toBe(true);

    // Independent partner (client B) reads the applied state + the learner next action.
    const activeFromB = await svc.applied.getActive(ctx("partner-b", ORG, "teacher"), LEARNER_LINH);
    expect(activeFromB!.activityId).toBe("ACT-A2-4");
    const naFromB = await svc.applied.getNextAction(ctx("partner-b", ORG, "learner"), LEARNER_LINH);
    expect(naFromB!.source).toBe("teacher");
    expect(naFromB!.activityId).toBe("ACT-A2-4");
    expect(naFromB!.friendlyReason).not.toMatch(/ACT-/);

    // Cross-tenant read stays closed.
    expect(await svc.applied.getActive(ctx("org2-client", ORG, "teacher"), LEARNER_LINH)).toBeNull();
  });
});
