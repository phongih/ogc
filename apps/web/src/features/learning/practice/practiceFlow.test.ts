import { as } from "../../../test/grants";
import { describe, expect, it } from "vitest";
import { mockPractice as practice } from "../../../lib/adapters/mockPractice";
import {
  mockProfile as prof,
  mockMasteryConfidence as conf,
  mockLearningPath as pathPort,
  mockLearnerNextAction as nextPort,
  mockAppliedRecommendation as applied,
} from "../../../lib/adapters/mockProfile";
import { learningStore } from "../../../lib/adapters/store";
import { LEARNER_LINH } from "../../../fixtures/personas";

/*
 * OGC-AUTH-030 / Phase 3 — closed-loop behavioral verification on the shared in-memory store.
 * Practice → Evidence → Mastery (LI-1) → Recommendation (LI-3) → Teacher (AUTH-026) → Next.
 * Scenarios are ordered so prerequisite/eligibility states are asserted before the state that
 * changes them. One module = one fresh store (vitest isolation).
 */

const L = "demo-learner"; // persona for LEARNER_LINH
const T = "demo-teacher"; // owns Linh's class
const LINH = LEARNER_LINH;

const ueMastery = async () => (await prof.getProfile(as(L)))!.skills.use_of_english.level;
const correctA23 = {
  attemptId: "ATT-PRAC-A23",
  responses: [
    { itemId: "A2-3-Q1", optionId: "a" },
    { itemId: "A2-3-Q2", optionId: "b" },
    { itemId: "A2-3-Q3", optionId: "b" },
    { itemId: "A2-3-Q4", optionId: "a" },
  ],
};
const wrongB12 = {
  attemptId: "ATT-PRAC-B12",
  responses: [
    { itemId: "B1-2-Q1", optionId: "b" },
    { itemId: "B1-2-Q2", optionId: "a" },
    { itemId: "B1-2-Q3", optionId: "a" },
  ],
};

describe("AUTH-030 integrated practice loop", () => {
  it("baseline: ACT-A2-3 is the available system recommendation; ACT-A2-4 is prerequisite-blocked (scenario 5)", async () => {
    const path = (await pathPort.getLearningPath(as(L)))!;
    expect(path.steps.find((s) => s.activityId === "ACT-A2-3")!.state).toBe("available");
    expect(path.steps.find((s) => s.activityId === "ACT-A2-4")!.state).toBe("blocked");
    const next = (await nextPort.getNextAction(as(L)))!;
    expect(next.source).toBe("system");
    expect(next.activityId).toBe("ACT-A2-3");
    expect(next.friendlyReason).not.toMatch(/ACT-/); // no internal ids on the learner surface
  });

  it("cross-tenant / unauthorized / unenrolled practice submissions fail closed (scenario 11)", async () => {
    expect((await practice.submitPractice(as("demo-guardian"), "ACT-A2-3", correctA23)).reason).toBe("not_a_learner");
    expect((await practice.submitPractice(as("demo-learner-org2"), "ACT-A2-3", correctA23)).reason).toBe("cross_org_denied");
    expect(await practice.getPractice(as("demo-learner-org2"), "ACT-A2-3")).toBeNull();
    expect((await practice.submitPractice(as("demo-learner-2"), "ACT-A2-3", correctA23)).reason).toBe("not_enrolled");
  });

  it("correct submission creates evidence and raises mastery via LI-1 (scenario 1)", async () => {
    const before = await ueMastery();
    const res = await practice.submitPractice(as(L), "ACT-A2-3", correctA23);
    expect(res.ok).toBe(true);
    expect(res.result!.score).toBe(100);
    expect(res.result!.correct).toBe(4);
    const ev = learningStore.getEvidence(LINH, "ACT-A2-3");
    expect(ev.some((e) => e.kind === "practice_result")).toBe(true);
    expect(await ueMastery()).toBeGreaterThan(before); // EWMA pulled toward 100
  });

  it("confidence is reported distinctly from mastery (scenario 4)", async () => {
    const c = (await conf.getConfidence(as(L)))!;
    const band = c.skills.use_of_english.band;
    expect(["low", "medium", "high"]).toContain(band);
    // Mastery and confidence are separate numbers from separate engines.
    expect(typeof (await prof.getProfile(as(L)))!.skills.use_of_english.level).toBe("number");
    expect(typeof c.skills.use_of_english.level).toBe("number");
  });

  it("recommendation responds to the new evidence; prerequisite is now unblocked (scenario 6 + closed loop)", async () => {
    const path = (await pathPort.getLearningPath(as(L)))!;
    expect(path.steps.find((s) => s.activityId === "ACT-A2-3")!.state).toBe("completed");
    expect(path.steps.find((s) => s.activityId === "ACT-A2-4")!.state).toBe("available"); // unblocked by the practice
    const next = (await nextPort.getNextAction(as(L)))!;
    expect(next.source).toBe("system");
    expect(next.activityId).not.toBe("ACT-A2-3"); // derived from updated evidence, not a hardcoded transition
  });

  it("duplicate submission does not double-count (scenario 3)", async () => {
    const before = await ueMastery();
    const replay = await practice.submitPractice(as(L), "ACT-A2-3", correctA23); // same attemptId
    expect(replay.ok).toBe(true);
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.result!.score).toBe(100);
    const other = await practice.submitPractice(as(L), "ACT-A2-3", { ...correctA23, attemptId: "ATT-DIFFERENT" });
    expect(other.reason).toBe("already_completed");
    expect(await ueMastery()).toBe(before); // mastery unchanged by the replay
  });

  it("incorrect submission lowers mastery appropriately (scenario 2)", async () => {
    const before = await ueMastery();
    const res = await practice.submitPractice(as(L), "ACT-B1-2", wrongB12);
    expect(res.ok).toBe(true);
    expect(res.result!.score).toBe(0);
    expect(await ueMastery()).toBeLessThan(before); // EWMA pulled toward 0
  });

  it("teacher applies an eligible alternative; learner sees it; system suggestion preserved (scenarios 7 + 8)", async () => {
    const apply = await applied.applyRecommendation(as(T), LINH, {
      selectedActivityId: "ACT-A2-4",
      reasonCode: "remediation",
      note: "Let's focus on speaking next",
    });
    expect(apply.ok).toBe(true);
    expect(apply.applied!.systemActivityIdAtApply).not.toBeNull(); // system recommendation preserved on record
    const next = (await nextPort.getNextAction(as(L)))!;
    expect(next.source).toBe("teacher");
    expect(next.activityId).toBe("ACT-A2-4");
    expect(next.teacherNote).toBe("Let's focus on speaking next");
    expect(next.friendlyReason).not.toMatch(/ACT-/);
  });

  it("teacher reverts; learner returns to the system suggestion (scenario 9)", async () => {
    const rev = await applied.revertApplied(as(T), LINH);
    expect(rev.ok).toBe(true);
    const next = (await nextPort.getNextAction(as(L)))!;
    expect(next.source).toBe("system");
  });

  it("completion revalidates applied state to fulfilled (scenario 10)", async () => {
    const reapply = await applied.applyRecommendation(as(T), LINH, {
      selectedActivityId: "ACT-A2-4",
      reasonCode: "pacing",
      note: "Do this one",
    });
    expect(reapply.ok).toBe(true);
    expect((await applied.getActiveApplied(as(T), LINH))!.activityId).toBe("ACT-A2-4");
    // Completing the applied activity revalidates the applied record (fulfilled → not active).
    expect(learningStore.complete(L, "ACT-A2-4").completed).toBe(true);
    expect(await applied.getActiveApplied(as(T), LINH)).toBeNull(); // no longer active (revalidated)
    // The learner no longer sees a teacher-sourced action; with every scoped activity now done
    // the next action is "all caught up" (null), which is never the teacher recommendation.
    const next = await nextPort.getNextAction(as(L));
    expect(next?.source ?? "system").not.toBe("teacher");
  });
});
