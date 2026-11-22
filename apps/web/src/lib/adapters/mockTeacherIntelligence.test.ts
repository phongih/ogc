import { as } from "../../test/grants";
import { describe, expect, it } from "vitest";
import { mockTeacherIntelligence as ti } from "./mockProfile";
import { LEARNER_LINH, LEARNER_ORG2 } from "../../fixtures/personas";

const TEACHER = "demo-teacher"; // Tara — owns the class whose roster includes Linh

const INTERVENTION_EPOCH = Date.parse("2026-02-01T00:00:00.000Z");

describe("LI-4 teacher view — explainability (T1)", () => {
  it("an authorized teacher sees mastery, confidence, prerequisite status and the system recommendation", async () => {
    const view = await ti.getLearnerView(as(TEACHER), LEARNER_LINH);
    expect(view).not.toBeNull();
    expect(view!.learnerId).toBe(LEARNER_LINH);
    // Mastery + confidence present for every skill.
    for (const s of ["reading", "use_of_english", "speaking"] as const) {
      expect(typeof view!.profile.skills[s].level).toBe("number");
      expect(["low", "medium", "high"]).toContain(view!.confidence.skills[s].band);
    }
    // Prerequisite status: speaking activity is blocked for Linh.
    const a24 = view!.path.steps.find((s) => s.activityId === "ACT-A2-4");
    expect(a24!.state).toBe("blocked");
    expect(a24!.blockedBy).toEqual(["ACT-A2-3"]);
    // System recommendation carries a structured reason code.
    expect(view!.path.nextStep.reasonCode).toBeTruthy();
  });
});

describe("LI-4 intervention — eligibility, reason, preservation, audit (T2, T3, T4, T6)", () => {
  it("rejects a prerequisite-blocked activity (T3)", async () => {
    const res = await ti.intervene(as(TEACHER), LEARNER_LINH, {
      selectedActivityId: "ACT-A2-4", // blocked (speaking)
      reasonCode: "pacing",
      note: "try speaking",
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("activity_not_eligible:blocked");
  });

  it("rejects an out-of-scope activity (T3)", async () => {
    const res = await ti.intervene(as(TEACHER), LEARNER_LINH, {
      selectedActivityId: "ACT-B2-1", // not in Linh's scope
      reasonCode: "pacing",
      note: "x",
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("activity_out_of_scope");
  });

  it("requires a reason note (T2)", async () => {
    const res = await ti.intervene(as(TEACHER), LEARNER_LINH, {
      selectedActivityId: "ACT-B1-2",
      reasonCode: "pacing",
      note: "   ",
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("reason_required");
  });

  it("accepts an available alternative, preserves the system recommendation, and records a deterministic audit event (T2, T4, T6)", async () => {
    const before = await ti.getLearnerView(as(TEACHER), LEARNER_LINH);
    const systemBefore = before!.path.nextStep.recommendation!.activityId; // ACT-A2-3

    const res = await ti.intervene(as(TEACHER), LEARNER_LINH, {
      selectedActivityId: "ACT-B1-2", // an available ue activity, different from the system pick
      reasonCode: "remediation",
      note: "focus on opinion phrases",
    });
    expect(res.ok).toBe(true);
    const ev = res.intervention!;
    // Audit event shape (T6).
    expect(ev.id).toMatch(/^INT-\d+$/);
    expect(ev.actorPersonaId).toBe(TEACHER);
    expect(ev.learnerId).toBe(LEARNER_LINH);
    expect(ev.selectedActivityId).toBe("ACT-B1-2");
    expect(ev.reasonCode).toBe("remediation");
    expect(ev.note).toBe("focus on opinion phrases");
    // System recommendation is PRESERVED on the event (T4).
    expect(ev.systemActivityId).toBe(systemBefore);
    // Deterministic timestamp derived from the event index.
    const n = Number(ev.id.slice("INT-".length));
    expect(ev.at).toBe(new Date(INTERVENTION_EPOCH + n * 3600000).toISOString());

    // The system recommendation is NOT overwritten by the intervention (T4).
    const after = await ti.getLearnerView(as(TEACHER), LEARNER_LINH);
    expect(after!.path.nextStep.recommendation!.activityId).toBe(systemBefore);

    // The intervention is in the audit trail.
    const audit = await ti.listInterventions(as(TEACHER), LEARNER_LINH);
    expect(audit.some((a) => a.id === ev.id && a.selectedActivityId === "ACT-B1-2")).toBe(true);
  });
});

describe("LI-4 authorization — fail-closed (T5)", () => {
  it("denies guardian, learner and staff personas", async () => {
    for (const persona of ["demo-guardian", "demo-learner", "demo-staff"]) {
      expect(await ti.getLearnerView(as(persona), LEARNER_LINH)).toBeNull();
      const res = await ti.intervene(as(persona), LEARNER_LINH, {
        selectedActivityId: "ACT-A2-3",
        reasonCode: "pacing",
        note: "x",
      });
      expect(res.ok).toBe(false);
      expect(res.reason).toBe("not_authorized");
      expect(await ti.listInterventions(as(persona), LEARNER_LINH)).toEqual([]);
    }
  });

  it("denies a teacher for a learner not on their roster / cross-tenant", async () => {
    // Tara does not teach the org2 learner.
    expect(await ti.getLearnerView(as(TEACHER), LEARNER_ORG2)).toBeNull();
    const res = await ti.intervene(as(TEACHER), LEARNER_ORG2, {
      selectedActivityId: "ACT-A2-3",
      reasonCode: "pacing",
      note: "x",
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("not_authorized");
  });
});
