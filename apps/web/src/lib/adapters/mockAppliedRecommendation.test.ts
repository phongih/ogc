import { describe, expect, it } from "vitest";
import {
  mockAppliedRecommendation as app,
  mockLearnerNextAction as nextAction,
  mockTeacherIntelligence as ti,
} from "./mockProfile";
import { learningStore } from "./store";
import { LEARNER_LINH, LEARNER_ORG2 } from "../../fixtures/personas";

const TEACHER = "demo-teacher";
const APPLIED_EPOCH = Date.parse("2026-03-01T00:00:00.000Z");

describe("AUTH-026 applied recommendation — system baseline (no apply)", () => {
  it("the learner follows the SYSTEM suggestion, in friendly language with no internal ids", async () => {
    const na = await nextAction.getNextAction("demo-learner");
    expect(na).not.toBeNull();
    expect(na!.source).toBe("system");
    expect(na!.activityId).toBe("ACT-A2-3"); // weakest available ue
    expect(na!.teacherNote).toBeNull();
    expect(na!.friendlyReason).not.toMatch(/ACT-/); // no internal activity ids on the learner surface
    expect(na!.friendlyReason).toContain("Quiz: At the market"); // title, not id
  });
});

describe("AUTH-026 applied recommendation — eligibility & authz on apply (fail-closed)", () => {
  it("rejects a blocked, out-of-scope, note-less, or unauthorized apply", async () => {
    expect(
      (
        await app.applyRecommendation(TEACHER, LEARNER_LINH, {
          selectedActivityId: "ACT-A2-4",
          reasonCode: "pacing",
          note: "x",
        })
      ).reason,
    ).toBe("activity_not_eligible:blocked");
    expect(
      (
        await app.applyRecommendation(TEACHER, LEARNER_LINH, {
          selectedActivityId: "ACT-B2-1",
          reasonCode: "pacing",
          note: "x",
        })
      ).reason,
    ).toBe("activity_out_of_scope");
    expect(
      (
        await app.applyRecommendation(TEACHER, LEARNER_LINH, {
          selectedActivityId: "ACT-B1-2",
          reasonCode: "pacing",
          note: "  ",
        })
      ).reason,
    ).toBe("reason_required");
    for (const persona of ["demo-guardian", "demo-learner", "demo-staff"]) {
      expect(
        (
          await app.applyRecommendation(persona, LEARNER_LINH, {
            selectedActivityId: "ACT-B1-2",
            reasonCode: "pacing",
            note: "x",
          })
        ).reason,
      ).toBe("not_authorized");
    }
    // Cross-tenant: Tara does not teach the org2 learner.
    expect(
      (
        await app.applyRecommendation(TEACHER, LEARNER_ORG2, {
          selectedActivityId: "ACT-B1-2",
          reasonCode: "pacing",
          note: "x",
        })
      ).reason,
    ).toBe("not_authorized");
  });
});

describe("AUTH-026 applied recommendation — apply reaches the learner, system preserved", () => {
  it("applying an eligible alternative makes the learner's next step Teacher-sourced while the system suggestion is preserved", async () => {
    const res = await app.applyRecommendation(TEACHER, LEARNER_LINH, {
      selectedActivityId: "ACT-B1-2",
      reasonCode: "remediation",
      note: "Focus on opinion phrases",
    });
    expect(res.ok).toBe(true);
    const rec = res.applied!;
    expect(rec.status).toBe("active");
    expect(rec.systemActivityIdAtApply).toBe("ACT-A2-3"); // system preserved on the record
    // Deterministic timestamp from the id index.
    const n = Number(rec.id.slice("APP-".length));
    expect(rec.appliedAt).toBe(new Date(APPLIED_EPOCH + n * 3600000).toISOString());

    // The learner now sees the TEACHER recommendation (friendly, no ids).
    const na = await nextAction.getNextAction("demo-learner");
    expect(na!.source).toBe("teacher");
    expect(na!.activityId).toBe("ACT-B1-2");
    expect(na!.teacherNote).toBe("Focus on opinion phrases");
    expect(na!.friendlyReason).not.toMatch(/ACT-/);
    expect(na!.friendlyReason).toContain("Quiz: Opinion phrases");

    // The SYSTEM suggestion is unchanged (teacher view still shows ACT-A2-3).
    const view = await ti.getLearnerView(TEACHER, LEARNER_LINH);
    expect(view!.path.nextStep.recommendation!.activityId).toBe("ACT-A2-3");
  });
});

describe("AUTH-026 applied recommendation — supersede, revert, revalidation", () => {
  it("a second apply supersedes the first (one active per learner)", async () => {
    await app.applyRecommendation(TEACHER, LEARNER_LINH, {
      selectedActivityId: "ACT-A2-3",
      reasonCode: "pacing",
      note: "switch",
    });
    const active = await app.getActiveApplied(TEACHER, LEARNER_LINH);
    expect(active!.activityId).toBe("ACT-A2-3");
    const na = await nextAction.getNextAction("demo-learner");
    expect(na!.source).toBe("teacher");
    expect(na!.activityId).toBe("ACT-A2-3");
  });

  it("reverting restores the system suggestion", async () => {
    const res = await app.revertApplied(TEACHER, LEARNER_LINH);
    expect(res.ok).toBe(true);
    expect(await app.getActiveApplied(TEACHER, LEARNER_LINH)).toBeNull();
    const na = await nextAction.getNextAction("demo-learner");
    expect(na!.source).toBe("system");
  });

  it("an applied recommendation self-invalidates when the learner completes it (fulfilled → back to system)", async () => {
    await app.applyRecommendation(TEACHER, LEARNER_LINH, {
      selectedActivityId: "ACT-B1-2",
      reasonCode: "pacing",
      note: "do this",
    });
    expect((await nextAction.getNextAction("demo-learner"))!.source).toBe("teacher");
    // Learner completes the applied activity.
    expect(learningStore.complete("demo-learner", "ACT-B1-2").completed).toBe(true);
    // The applied recommendation is no longer active; the learner falls back to the system.
    expect(await app.getActiveApplied(TEACHER, LEARNER_LINH)).toBeNull();
    expect((await nextAction.getNextAction("demo-learner"))!.source).toBe("system");
  });
});

describe("AUTH-026 applied recommendation — tenant isolation", () => {
  it("a non-learner persona has no next action; a cross-tenant learner sees only its own", async () => {
    expect(await nextAction.getNextAction("demo-staff")).toBeNull();
    const org2 = await nextAction.getNextAction("demo-learner-org2");
    // org2 learner has no in-scope activities → no next action (fail-closed, own tenant only).
    expect(org2 === null || org2.source === "system").toBe(true);
  });
});
