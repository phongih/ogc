// P1 · Learners needing support — owning-teacher scope, evidence first, acts through AUTH-026.
import { describe, expect, it } from "vitest";
import { mockSupport, mockAppliedRecommendation, mockLearnerNextAction } from "./mockProfile";
import { mockPractice } from "./mockPractice";
import { LEARNER_LINH } from "../../fixtures/personas";

const T = "demo-teacher";

describe("needs-support queue", () => {
  it("baseline: placement-only flags, clearly labelled; only Huy rests on a record (attendance)", async () => {
    const q = await mockSupport.listNeedsSupport(T);
    expect(q.map((i) => i.learnerName).sort()).toEqual(["An P.", "Huy D.", "Linh N.", "Minh T."]);
    const placementOnly = q.filter((i) => i.learnerName !== "Huy D.");
    expect(placementOnly.every((i) => !i.evidenceBacked)).toBe(true);
    expect(placementOnly.every((i) => i.signals.every((s) => s.source === "placement"))).toBe(true);
    // P2 attendance-v1: Huy was absent from both marked B1 sessions — flagged by attendance alone,
    // no skill, so nothing to assign; evidence-backed, so listed first.
    const huy = q.find((i) => i.learnerName === "Huy D.")!;
    expect(huy.signals).toEqual([{ kind: "absences", source: "attendance", sessions: 2 }]);
    expect(huy.evidenceBacked).toBe(true);
    expect(huy.focusSkill).toBeNull();
    expect(huy.suggestedActivityId).toBeNull();
    expect(q[0].learnerName).toBe("Huy D.");
    const linh = q.find((i) => i.learnerName === "Linh N.")!;
    expect(linh.signals).toEqual([
      { kind: "low_skill", source: "placement", skill: "speaking", level: 55, evidenceCount: 0 },
    ]);
    expect(linh.className).toBe("A2 Morning — Mon/Wed");
    // Speaking's own activity is locked → suggest the nearest open prerequisite that unlocks it.
    expect(linh.suggestedActivityId).toBe("ACT-A2-3");
    expect(linh.suggestionUnlocksTitle).toBe("Speaking: Describe your weekend");
    // An: no reading activity open or locked → nothing to suggest (honest "no open activity").
    const an = q.find((i) => i.learnerName === "An P.")!;
    expect(an.suggestedActivityId).toBeNull();
    expect(an.suggestionUnlocksTitle).toBeNull();
  });

  it("is scoped to the owning teacher (others see nothing)", async () => {
    for (const other of ["demo-learner", "demo-guardian", "demo-staff", "demo-staff-org2"])
      expect(await mockSupport.listNeedsSupport(other)).toEqual([]);
  });

  it("a weak practice result puts the learner FIRST with practice evidence and a drop", async () => {
    // Linh answers 2 of 4 correctly → Use of English 65 → 59
    const r = await mockPractice.submitPractice("demo-learner", "ACT-A2-3", {
      attemptId: "SUP-1",
      responses: [
        { itemId: "A2-3-Q1", optionId: "a" },
        { itemId: "A2-3-Q2", optionId: "b" },
        { itemId: "A2-3-Q3", optionId: "x" },
        { itemId: "A2-3-Q4", optionId: "x" },
      ],
    });
    expect(r.result!.score).toBe(50);
    const q = await mockSupport.listNeedsSupport(T);
    expect(q[0].learnerName).toBe("Linh N.");
    expect(q[0].evidenceBacked).toBe(true);
    expect(q[0].signals).toContainEqual({
      kind: "skill_drop",
      source: "practice",
      skill: "use_of_english",
      level: 59,
      delta: -6,
      evidenceCount: 1,
    });
    expect(q[0].focusSkill).toBe("use_of_english");
  });

  it("suggests only an AVAILABLE activity on the focus skill, and assigning reaches the learner", async () => {
    const linh = (await mockSupport.listNeedsSupport(T)).find((i) => i.learnerId === LEARNER_LINH)!;
    expect(linh.suggestedActivityId).toBe("ACT-B1-2");
    expect(linh.suggestedTitle).toBe("Quiz: Opinion phrases");
    expect(linh.suggestionUnlocksTitle).toBeNull(); // a direct suggestion on the focus skill
    const res = await mockAppliedRecommendation.applyRecommendation(T, LEARNER_LINH, {
      selectedActivityId: linh.suggestedActivityId!,
      reasonCode: "remediation",
      note: "Targeted practice for Use of English",
    });
    expect(res.ok).toBe(true);
    const after = (await mockSupport.listNeedsSupport(T)).find(
      (i) => i.learnerId === LEARNER_LINH,
    )!;
    expect(after.activeAssignmentTitle).toBe("Quiz: Opinion phrases");
    const next = await mockLearnerNextAction.getNextAction("demo-learner");
    expect(next).toMatchObject({ source: "teacher", activityId: "ACT-B1-2" });
  });
});
