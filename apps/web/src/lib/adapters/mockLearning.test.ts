import { as } from "../../test/grants";
import { describe, expect, it } from "vitest";
import { mockLearning } from "./mockLearning";
import { courses } from "../../fixtures/catalog";
import { practiceFor } from "../../fixtures/practice";
import { mockPractice } from "./mockPractice";
import { enrollmentStore } from "./store";

const LINH = "demo-learner"; // enrolled in courses[0] & [1]; ACT-A2-1/2 pre-completed
const MINH = "demo-learner-2"; // enrolled in nothing initially
const LEARNER_ORG2 = "demo-learner-org2"; // a learner in a different tenant root
const STAFF_ORG2 = "demo-staff-org2"; // staff with no learnerId
const A2 = courses[0].id;

describe("mock learning — activities, completion, progress", () => {
  it("lists org-scoped activities for a course", async () => {
    const list = await mockLearning.listActivities(as(LINH), A2);
    expect(list.length).toBe(4);
    expect(list.every((a) => a.courseId === A2)).toBe(true);
  });

  it("computes deterministic baseline progress for the primary learner", async () => {
    const snap = await mockLearning.getProgress(as(LINH), A2);
    // ACT-A2-1 (w1) + ACT-A2-2 (w1) completed of total weight 6 → 33%.
    expect(snap).not.toBeNull();
    expect(snap!.completedActivities).toBe(2);
    expect(snap!.progressPct).toBe(33);
  });

  it("a quiz with a practice set cannot be self-marked complete — it must be practised", async () => {
    expect(await mockLearning.completeActivity(as(LINH), "ACT-A2-3")).toEqual({
      completed: false,
      reason: "practice_required",
    });
    expect(await mockLearning.getAttempt(as(LINH), "ACT-A2-3")).toBeNull();
  });

  it("practising the quiz records a score from the learner's answers; completion and score are distinct", async () => {
    const before = await mockLearning.getProgress(as(LINH), A2);
    const quiz = practiceFor("ACT-A2-3")!;
    const res = await mockPractice.submitPractice(as(LINH), "ACT-A2-3", {
      attemptId: "ATT-ML-1",
      responses: quiz.items.map((i) => ({ itemId: i.id, optionId: i.correctOptionId })),
    });
    expect(res.ok).toBe(true);

    const attempt = await mockLearning.getAttempt(as(LINH), "ACT-A2-3");
    expect(attempt!.state).toBe("completed");
    expect(attempt!.score).toBe(100); // from the answers, not a hash

    const after = await mockLearning.getProgress(as(LINH), A2);
    expect(after!.completedActivities).toBe(before!.completedActivities + 1);
    expect(after!.assessedCount).toBe(1);

    // The structured practice result is EVIDENCE, separate from the score.
    const evidence = await mockLearning.getEvidence(as(LINH), "ACT-A2-3");
    expect(evidence.some((e) => e.kind === "practice_result")).toBe(true);
  });

  it("a completed non-assessed activity has no score", async () => {
    const reading = await mockLearning.getAttempt(as(LINH), "ACT-A2-1"); // pre-completed reading (not assessed)
    expect(reading!.state).toBe("completed");
    expect(reading!.score).toBeNull();
  });

  it("assessment score is deterministic (repeatable, no randomness)", async () => {
    const a = await mockLearning.getAttempt(as(LINH), "ACT-A2-3");
    const b = await mockLearning.getAttempt(as(LINH), "ACT-A2-3");
    expect(a!.score).toBe(b!.score);
  });

  // NEGATIVE: duplicate completion is rejected and does not double-count.
  it("prevents duplicate activity completion", async () => {
    const dup = await mockLearning.completeActivity(as(LINH), "ACT-A2-3"); // already completed above
    expect(dup.completed).toBe(false);
    expect(dup.reason).toBe("already_completed");
  });

  // NEGATIVE: a persona not enrolled in the course cannot complete its activities.
  it("denies completing an activity when not enrolled", async () => {
    const res = await mockLearning.completeActivity(as(MINH), "ACT-A2-1");
    expect(res.completed).toBe(false);
    expect(res.reason).toBe("not_enrolled");
  });

  // NEGATIVE: cross-org completion — a learner in another org cannot complete this org's activity.
  it("denies completing an activity in another organization", async () => {
    const res = await mockLearning.completeActivity(as(LEARNER_ORG2), "ACT-A2-1");
    expect(res.completed).toBe(false);
    expect(res.reason).toBe("cross_org_denied");
  });

  // NEGATIVE: a persona with no learner identity cannot complete activities.
  it("denies completion for a non-learner persona", async () => {
    const res = await mockLearning.completeActivity(as(STAFF_ORG2), "ACT-A2-1");
    expect(res.completed).toBe(false);
    expect(res.reason).toBe("not_a_learner");
  });

  it("denies completing an unknown activity", async () => {
    const res = await mockLearning.completeActivity(as(LINH), "ACT-DOES-NOT-EXIST");
    expect(res.completed).toBe(false);
    expect(res.reason).toBe("unknown_activity");
  });

  it("an activity WITHOUT a practice set can still be marked complete (no score if not assessed)", async () => {
    enrollmentStore.enroll(MINH, A2);
    const res = await mockLearning.completeActivity(as(MINH), "ACT-A2-2"); // exercise; prereq ACT-A2-1 seeded
    expect(res).toEqual({ completed: true });
    expect((await mockLearning.getAttempt(as(MINH), "ACT-A2-2"))!.score).toBeNull();
  });
});
