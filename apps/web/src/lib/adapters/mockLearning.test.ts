import { describe, expect, it } from "vitest";
import { mockLearning } from "./mockLearning";
import { courses } from "../../fixtures/catalog";

const LINH = "demo-learner"; // enrolled in courses[0] & [1]; ACT-A2-1/2 pre-completed
const MINH = "demo-learner-2"; // enrolled in nothing initially
const STAFF_ORG2 = "demo-staff-org2";
const A2 = courses[0].id;

describe("mock learning — activities, completion, progress", () => {
  it("lists org-scoped activities for a course", async () => {
    const list = await mockLearning.listActivities(LINH, A2);
    expect(list.length).toBe(4);
    expect(list.every((a) => a.courseId === A2)).toBe(true);
  });

  it("computes deterministic baseline progress for the primary learner", async () => {
    const snap = await mockLearning.getProgress(LINH, A2);
    // ACT-A2-1 (w1) + ACT-A2-2 (w1) completed of total weight 6 → 33%.
    expect(snap).not.toBeNull();
    expect(snap!.completedActivities).toBe(2);
    expect(snap!.progressPct).toBe(33);
  });

  it("completing an assessed activity records a score; completion and score are distinct", async () => {
    const before = await mockLearning.getProgress(LINH, A2);
    const res = await mockLearning.completeActivity(LINH, "ACT-A2-3"); // assessed quiz
    expect(res.completed).toBe(true);

    const attempt = await mockLearning.getAttempt(LINH, "ACT-A2-3");
    expect(attempt!.state).toBe("completed");
    expect(attempt!.score).not.toBeNull(); // assessed → score present

    const after = await mockLearning.getProgress(LINH, A2);
    expect(after!.completedActivities).toBe(before!.completedActivities + 1);
    expect(after!.assessedCount).toBe(1);

    // AI feedback is EVIDENCE, not the score.
    const evidence = await mockLearning.getEvidence(LINH, "ACT-A2-3");
    expect(evidence.some((e) => e.kind === "ai_feedback")).toBe(true);
  });

  it("a completed non-assessed activity has no score", async () => {
    const reading = await mockLearning.getAttempt(LINH, "ACT-A2-1"); // pre-completed reading (not assessed)
    expect(reading!.state).toBe("completed");
    expect(reading!.score).toBeNull();
  });

  it("assessment score is deterministic (repeatable, no randomness)", async () => {
    const a = await mockLearning.getAttempt(LINH, "ACT-A2-3");
    const b = await mockLearning.getAttempt(LINH, "ACT-A2-3");
    expect(a!.score).toBe(b!.score);
  });

  // NEGATIVE: duplicate completion is rejected and does not double-count.
  it("prevents duplicate activity completion", async () => {
    const dup = await mockLearning.completeActivity(LINH, "ACT-A2-3"); // already completed above
    expect(dup.completed).toBe(false);
    expect(dup.reason).toBe("already_completed");
  });

  // NEGATIVE: a persona not enrolled in the course cannot complete its activities.
  it("denies completing an activity when not enrolled", async () => {
    const res = await mockLearning.completeActivity(MINH, "ACT-A2-1");
    expect(res.completed).toBe(false);
    expect(res.reason).toBe("not_enrolled");
  });

  // NEGATIVE: cross-org completion is denied before enrollment is even considered.
  it("denies completing an activity in another organization", async () => {
    const res = await mockLearning.completeActivity(STAFF_ORG2, "ACT-A2-1");
    expect(res.completed).toBe(false);
    expect(res.reason).toBe("cross_org_denied");
  });

  it("denies completing an unknown activity", async () => {
    const res = await mockLearning.completeActivity(LINH, "ACT-DOES-NOT-EXIST");
    expect(res.completed).toBe(false);
    expect(res.reason).toBe("unknown_activity");
  });
});
