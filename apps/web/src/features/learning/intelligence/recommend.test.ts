import { describe, expect, it } from "vitest";
import type { LearningActivity, PlacementResult, SkillEvidence } from "@ogc/contracts";
import { buildPath, recommend } from "./recommend";
import { seedProfile, updateMastery } from "./mastery";

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

// Constant availability across the whole suite — three skills, one activity each.
const ACTIVITIES: LearningActivity[] = [act("R1", "reading"), act("U1", "quiz"), act("S1", "speaking")];

const seed: PlacementResult = {
  learnerId: "L1",
  orgId: "O1",
  cefrBand: "A2",
  skillSeed: { reading: 70, use_of_english: 70, speaking: 70 },
};

const evidence = (skill: SkillEvidence["skill"], score: number): SkillEvidence[] => [
  { attemptId: "e1", skill, score, at: "2026-01-01T00:00:00.000Z" },
];

describe("recommendation engine — targeting & explainability (A4)", () => {
  it("targets the weakest skill and cites skill + mastery in the reason", () => {
    const profile = updateMastery(seedProfile(seed), evidence("speaking", 0)); // speaking → 42
    const rec = recommend(profile, ACTIVITIES, []);
    expect(rec).not.toBeNull();
    expect(rec!.skill).toBe("speaking");
    expect(rec!.activityId).toBe("S1");
    expect(rec!.masteryLevel).toBe(42);
    expect(rec!.reason).toContain("Speaking");
    expect(rec!.reason).toContain("42");
  });

  it("returns null when no activity is available", () => {
    const profile = seedProfile(seed);
    expect(recommend(profile, ACTIVITIES, ["R1", "U1", "S1"])).toBeNull();
  });
});

describe("recommendation engine — CAUSAL adaptation with constant availability (A3)", () => {
  it("changes the recommendation because mastery evidence changed, not availability", () => {
    // SAME activities, SAME completed set — only the evidence differs.
    const readingWeak = updateMastery(seedProfile(seed), evidence("reading", 0)); // reading → 42
    const speakingWeak = updateMastery(seedProfile(seed), evidence("speaking", 0)); // speaking → 42

    const recA = recommend(readingWeak, ACTIVITIES, []);
    const recB = recommend(speakingWeak, ACTIVITIES, []);

    expect(recA!.skill).toBe("reading");
    expect(recA!.activityId).toBe("R1");
    expect(recB!.skill).toBe("speaking");
    expect(recB!.activityId).toBe("S1");
    // The adaptation is observable: different evidence → different next step.
    expect(recA!.activityId).not.toBe(recB!.activityId);
  });

  it("is deterministic: same inputs → identical recommendation", () => {
    const profile = updateMastery(seedProfile(seed), evidence("use_of_english", 10));
    expect(recommend(profile, ACTIVITIES, [])).toEqual(recommend(profile, ACTIVITIES, []));
  });
});

describe("recommendation engine — path ordering", () => {
  it("orders the path weakest skill first", () => {
    // reading 42 < use_of_english 54 < speaking 70
    const profile = updateMastery(seedProfile(seed), [
      { attemptId: "a", skill: "reading", score: 0, at: "2026-01-01T00:00:00.000Z" },
      { attemptId: "b", skill: "use_of_english", score: 30, at: "2026-01-01T00:00:00.000Z" },
    ]);
    const path = buildPath(profile, ACTIVITIES, []);
    expect(path.map((s) => s.skill)).toEqual(["reading", "use_of_english", "speaking"]);
  });
});
