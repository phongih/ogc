// P1 · Speaking studio (MOCK) — rehearsal → teacher review → only then mastery. SYNTHETIC.
import { describe, expect, it } from "vitest";
import { mockSpeaking as sp } from "./mockSpeaking";
import { mockPractice } from "./mockPractice";
import { mockProfile } from "./mockProfile";
import { enrollmentStore, learningStore } from "./store";
import { LEARNER_LINH, LEARNER_MINH } from "../../fixtures/personas";
import { activities } from "../../fixtures/activities";

const L = "demo-learner"; // Linh
const T = "demo-teacher"; // Tara — owns Linh's class
const A = "ACT-A2-4"; // Speaking: Describe your weekend
const ALL_NATURAL = [
  { itemId: "SPK-A2-4-1", optionId: "a" },
  { itemId: "SPK-A2-4-2", optionId: "b" },
  { itemId: "SPK-A2-4-3", optionId: "c" },
  { itemId: "SPK-A2-4-4", optionId: "a" },
];
const speakingLevel = async (persona: string) =>
  (await mockProfile.getProfile(persona))!.skills.speaking.level;

describe("Hard prerequisite gate (before the quiz)", () => {
  it("speaking is locked until its prerequisite quiz is done: no studio, no rehearsal, no completion", async () => {
    expect(await sp.getStudio(L, A)).toBeNull();
    expect(
      (await sp.submitRehearsal(L, A, { attemptId: "EARLY", responses: ALL_NATURAL })).reason,
    ).toBe("prerequisite_required");
    // A blocked NON-speaking activity is refused too (Minh: ACT-A2-3 needs ACT-A2-2).
    const { mockLearning } = await import("./mockLearning");
    expect((await mockLearning.completeActivity("demo-learner-2", "ACT-A2-3")).reason).toBe(
      "not_enrolled",
    );
    enrollmentStore.enroll("demo-learner-2", activities.find((a) => a.id === "ACT-A2-3")!.courseId);
    expect(await mockLearning.completeActivity("demo-learner-2", "ACT-A2-3")).toEqual({
      completed: false,
      reason: "prerequisite_required",
    });
    expect(await sp.listPendingReviews(T)).toEqual([]);
  });

  it("finishing the prerequisite opens it", async () => {
    expect(
      (
        await mockPractice.submitPractice(L, "ACT-A2-3", {
          attemptId: "QUIZ-1",
          responses: [{ itemId: "A2-3-Q1", optionId: "a" }],
        })
      ).ok,
    ).toBe(true);
    expect(await sp.getStudio(L, A)).not.toBeNull();
  });
});

describe("Speaking studio — learner side", () => {
  it("studio view is answer-free and only for the learner's own enrolled activity", async () => {
    const v = await sp.getStudio(L, A);
    expect(v!.skill).toBe("speaking");
    expect(v!.items).toHaveLength(4);
    expect(JSON.stringify(v)).not.toMatch(/correctOptionId/);
    expect(await sp.getStudio(T, A)).toBeNull(); // teacher is not the learner
    expect(await sp.getStudio("demo-guardian", A)).toBeNull();
    expect(await sp.getStudio("demo-learner-org2", A)).toBeNull(); // cross-org
    expect(await sp.getStudio(L, "ACT-A2-3")).toBeNull(); // a quiz, not a speaking script
    expect(await sp.getStudio(L, "ACT-NOPE")).toBeNull();
  });

  it("the immediate practice path can NEVER score speaking (review is mandatory)", async () => {
    const r = await mockPractice.submitPractice(L, A, { attemptId: "x", responses: ALL_NATURAL });
    expect(r.ok).toBe(false);
    expect(learningStore.getAttempt(LEARNER_LINH, A)).toBeNull();
  });

  it("a rehearsal is scored + coached but stays PENDING: no attempt, mastery unchanged", async () => {
    const before = await speakingLevel(L);
    const r = await sp.submitRehearsal(L, A, {
      attemptId: "ATT-1",
      responses: ALL_NATURAL.slice(0, 3),
    });
    expect(r.ok).toBe(true);
    expect(r.feedback!.review.status).toBe("pending");
    expect(r.feedback!.result.correct).toBe(3);
    expect(r.feedback!.result.total).toBe(4);
    expect(r.feedback!.coach.map((c) => c.itemId)).toEqual(ALL_NATURAL.map((x) => x.itemId));
    expect(r.feedback!.coach[0].tips[0].ipa).toMatch(/^\/.+\/$/);
    expect(learningStore.getAttempt(LEARNER_LINH, A)).toBeNull();
    expect(await speakingLevel(L)).toBe(before);
  });

  it("replaying the same attemptId is idempotent; a new rehearsal replaces the pending one", async () => {
    const replay = await sp.submitRehearsal(L, A, { attemptId: "ATT-1", responses: ALL_NATURAL });
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.feedback!.result.correct).toBe(3); // prior result, not re-scored
    const retry = await sp.submitRehearsal(L, A, { attemptId: "ATT-2", responses: ALL_NATURAL });
    expect(retry.feedback!.review.attemptId).toBe("ATT-2");
    expect(retry.feedback!.result.correct).toBe(4);
    expect(await sp.listPendingReviews(T)).toHaveLength(1); // still one item per learner+activity
  });
});

describe("Speaking studio — teacher review", () => {
  it("only the owning teacher sees the queue (with each turn + model line)", async () => {
    const q = await sp.listPendingReviews(T);
    expect(q).toHaveLength(1);
    expect(q[0].learnerName).toBe("Linh N.");
    expect(q[0].activityTitle).toBe(activities.find((a) => a.id === A)!.title);
    expect(q[0].turns).toHaveLength(4);
    expect(q[0].turns[0]).toMatchObject({
      chosen: "It was great, thanks! I went to the beach.",
      natural: true,
    });
    for (const other of [L, "demo-guardian", "demo-staff", "demo-staff-org2"])
      expect(await sp.listPendingReviews(other)).toEqual([]);
  });

  it("non-owners cannot approve or return", async () => {
    for (const other of [L, "demo-guardian", "demo-staff"]) {
      expect((await sp.approve(other, LEARNER_LINH, A)).reason).toBe("forbidden");
      expect((await sp.returnForRetry(other, LEARNER_LINH, A, "no")).reason).toBe("forbidden");
    }
    expect(learningStore.getAttempt(LEARNER_LINH, A)).toBeNull();
  });

  it("return needs a note; the learner sees it and can rehearse again", async () => {
    expect((await sp.returnForRetry(T, LEARNER_LINH, A, "  ")).reason).toBe("note_required");
    const r = await sp.returnForRetry(T, LEARNER_LINH, A, "Try 'went' with a clear t.");
    expect(r.review!.status).toBe("returned");
    const mine = await sp.getMyFeedback(L, A);
    expect(mine!.review.reviewerNote).toBe("Try 'went' with a clear t.");
    expect(await sp.listPendingReviews(T)).toEqual([]);
    expect((await sp.approve(T, LEARNER_LINH, A)).reason).toBe("not_pending:returned");
    const again = await sp.submitRehearsal(L, A, { attemptId: "ATT-3", responses: ALL_NATURAL });
    expect(again.feedback!.review.status).toBe("pending");
  });

  it("approval writes the completed attempt + evidence and moves Speaking mastery", async () => {
    const before = await speakingLevel(L);
    const r = await sp.approve(T, LEARNER_LINH, A);
    expect(r.ok).toBe(true);
    expect(r.review!.status).toBe("approved");
    const att = learningStore.getAttempt(LEARNER_LINH, A)!;
    expect(att).toMatchObject({ state: "completed", id: "ATT-3", score: 100 });
    expect(
      learningStore.getEvidence(LEARNER_LINH, A).some((e) => /approved by teacher/.test(e.text)),
    ).toBe(true);
    expect(await speakingLevel(L)).not.toBe(before);
    // closed: no second approval, no new rehearsal
    expect((await sp.approve(T, LEARNER_LINH, A)).reason).toBe("not_pending:approved");
    expect(
      (await sp.submitRehearsal(L, A, { attemptId: "ATT-4", responses: ALL_NATURAL })).reason,
    ).toBe("already_completed");
  });

  it("learners are isolated: another learner's rehearsal is a separate review", async () => {
    const course = activities.find((a) => a.id === A)!.courseId;
    enrollmentStore.enroll("demo-learner-2", course);
    learningStore.complete("demo-learner-2", "ACT-A2-3"); // satisfy the prerequisite (store shortcut)
    const r = await sp.submitRehearsal("demo-learner-2", A, {
      attemptId: "M-1",
      responses: ALL_NATURAL,
    });
    expect(r.feedback!.review.learnerId).toBe(LEARNER_MINH);
    const q = await sp.listPendingReviews(T);
    expect(q.map((i) => i.learnerName)).toEqual(["Minh T."]);
    expect((await sp.getMyFeedback(L, A))!.review.status).toBe("approved"); // Linh's unaffected
  });
});

describe("Speaking studio — no self-declared completion", () => {
  it("the learner port refuses 'Mark complete' for an activity with a Speaking studio", async () => {
    const { mockLearning } = await import("./mockLearning");
    const r = await mockLearning.completeActivity("demo-learner-2", "ACT-A2-4");
    expect(r).toEqual({ completed: false, reason: "speaking_requires_review" });
  });
});
