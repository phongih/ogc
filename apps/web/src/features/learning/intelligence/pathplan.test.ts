import { describe, expect, it } from "vitest";
import type { ActivityPrerequisite, LearningActivity, PlacementResult, Skill } from "@ogc/contracts";
import { buildLearningPath } from "./pathplan";
import { computeConfidence } from "./confidence";
import { seedProfile } from "./mastery";

const act = (id: string, kind: LearningActivity["kind"]): LearningActivity => ({
  id,
  orgId: "O1",
  courseId: "C1",
  lessonId: null,
  title: id,
  kind,
  weight: 1,
  assessed: kind !== "reading",
});
const edge = (activityId: string, ...requiresActivityIds: string[]): ActivityPrerequisite => ({
  activityId,
  orgId: "O1",
  requiresActivityIds,
});

// Chain: R(reading) → E(exercise/ue) → Q(quiz/ue) → S(speaking). Speaking is weakest mastery.
const ACTS = [act("R", "reading"), act("E", "exercise"), act("Q", "quiz"), act("S", "speaking")];
const EDGES = [edge("E", "R"), edge("Q", "E"), edge("S", "Q")];

const placement: PlacementResult = {
  learnerId: "L1",
  orgId: "O1",
  cefrBand: "A2",
  skillSeed: { reading: 70, use_of_english: 60, speaking: 40 },
};
const noEvidenceConfidence = () =>
  computeConfidence([], { reading: 0, use_of_english: 0, speaking: 0 } as Record<Skill, number>);

const plan = (completedIds: string[]) =>
  buildLearningPath({
    profile: seedProfile(placement),
    confidence: noEvidenceConfidence(),
    activities: ACTS,
    edges: EDGES,
    completedIds,
    foreignActivityIds: new Set(),
  });

const stateById = (p: ReturnType<typeof plan>) =>
  Object.fromEntries(p.steps.map((s) => [s.activityId, s.state]));

describe("pathplan — states & ordering (P1)", () => {
  it("computes completed / available / blocked from prerequisites", () => {
    const p = plan(["R"]);
    expect(p.graph.valid).toBe(true);
    expect(stateById(p)).toEqual({ R: "completed", E: "available", Q: "blocked", S: "blocked" });
    expect(p.steps.map((s) => s.activityId)).toEqual(["R", "E", "Q", "S"]); // topological
    expect(p.steps.find((s) => s.activityId === "Q")!.blockedBy).toEqual(["E"]);
  });
});

describe("pathplan — prerequisite does not get bypassed by mastery (P5)", () => {
  it("recommends the weakest AVAILABLE skill, never the blocked weakest skill", () => {
    const p = plan(["R"]);
    // Speaking (40) is the weakest skill overall, but S is blocked → must NOT be recommended.
    expect(p.nextStep.recommendation).not.toBeNull();
    expect(p.nextStep.recommendation!.activityId).toBe("E"); // the available ue activity
    expect(p.nextStep.recommendation!.skill).toBe("use_of_english");
  });
});

describe("pathplan — completing a prerequisite unlocks dependents (P2)", () => {
  it("S stays blocked until its chain is complete, then becomes available and recommendable", () => {
    expect(stateById(plan(["R"])).S).toBe("blocked");
    expect(stateById(plan(["R", "E"])).S).toBe("blocked");
    const unlocked = plan(["R", "E", "Q"]);
    expect(stateById(unlocked).S).toBe("available");
    // Now speaking (weakest) is available → it becomes the recommended next step.
    expect(unlocked.nextStep.recommendation!.activityId).toBe("S");
    expect(unlocked.nextStep.recommendation!.skill).toBe("speaking");
  });
});

describe("pathplan — invalid graph fails closed", () => {
  it("cyclic activities never become available or recommended", () => {
    const p = buildLearningPath({
      profile: seedProfile(placement),
      confidence: noEvidenceConfidence(),
      activities: [act("R", "reading"), act("E", "exercise"), act("Q", "quiz")],
      edges: [edge("E", "Q"), edge("Q", "E")], // E↔Q cycle
      completedIds: [],
      foreignActivityIds: new Set(),
    });
    expect(p.graph.valid).toBe(false);
    const states = stateById(p);
    expect(states.E).toBe("blocked");
    expect(states.Q).toBe("blocked");
    // Only R is available → the recommendation stays on the safe, available node.
    expect(p.nextStep.recommendation!.activityId).toBe("R");
  });
});
