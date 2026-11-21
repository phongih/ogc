// P1 · Needs-support signals — pure, deterministic, evidence-labelled.
import { describe, expect, it } from "vitest";
import type { PlacementResult, SkillEvidence } from "@ogc/contracts";
import { seedProfile } from "./mastery";
import { SUPPORT_DROP, SUPPORT_LOW_SKILL, focusSkill, supportSignals } from "./support";

const P: PlacementResult = {
  learnerId: "00000000-0000-4000-8000-00000000L001",
  orgId: "00000000-0000-4000-8000-000000000001",
  cefrBand: "A2",
  skillSeed: { reading: 70, use_of_english: 65, speaking: 55 },
};
const ev = (
  attemptId: string,
  skill: SkillEvidence["skill"],
  score: number,
  at: string,
): SkillEvidence => ({
  attemptId,
  skill,
  score,
  at,
});

describe("supportSignals", () => {
  it("placement only: a low skill is flagged and labelled as placement", () => {
    const s = supportSignals(seedProfile(P), []);
    expect(s).toEqual([
      { kind: "low_skill", source: "placement", skill: "speaking", level: 55, evidenceCount: 0 },
    ]);
  });

  it("a practice result that lowers a skill by ≥ the drop threshold is flagged as practice evidence", () => {
    // 0.4 × 50 + 0.6 × 65 = 59 → drop of 6, and now below 60
    const s = supportSignals(seedProfile(P), [
      ev("a1", "use_of_english", 50, "2026-10-21T09:00:00.000Z"),
    ]);
    expect(s).toContainEqual({
      kind: "skill_drop",
      source: "practice",
      skill: "use_of_english",
      level: 59,
      delta: -6,
      evidenceCount: 1,
    });
    expect(s).toContainEqual({
      kind: "low_skill",
      source: "practice",
      skill: "use_of_english",
      level: 59,
      evidenceCount: 1,
    });
  });

  it("a small dip (below the drop threshold) is not a drop", () => {
    // 0.4 × 55 + 0.6 × 65 = 61 → −4
    const s = supportSignals(seedProfile(P), [
      ev("a1", "use_of_english", 55, "2026-10-21T09:00:00.000Z"),
    ]);
    expect(s.some((x) => x.kind === "skill_drop")).toBe(false);
    expect(SUPPORT_DROP).toBe(5);
    expect(SUPPORT_LOW_SKILL).toBe(60);
  });

  it("only the LATEST evidence on a skill counts as a drop (a recovery clears it)", () => {
    const s = supportSignals(seedProfile(P), [
      ev("a1", "use_of_english", 30, "2026-10-21T09:00:00.000Z"),
      ev("a2", "use_of_english", 100, "2026-10-21T10:00:00.000Z"),
    ]);
    expect(s.some((x) => x.kind === "skill_drop")).toBe(false);
  });

  it("good speaking evidence lifts the skill out of the low band", () => {
    const s = supportSignals(seedProfile(P), [
      ev("s1", "speaking", 100, "2026-10-21T09:00:00.000Z"),
    ]);
    expect(s).toEqual([]); // 0.4 × 100 + 0.6 × 55 = 73
  });

  it("a returned speaking rehearsal is a teacher-review signal", () => {
    expect(supportSignals(seedProfile(P), [], 1)).toContainEqual({
      kind: "speaking_returned",
      source: "teacher_review",
      skill: "speaking",
    });
  });

  it("focus: drop > returned > low; practice before placement; then the lowest level", () => {
    expect(
      focusSkill([
        { kind: "low_skill", source: "placement", skill: "speaking", level: 40 },
        { kind: "skill_drop", source: "practice", skill: "use_of_english", level: 59, delta: -6 },
      ]),
    ).toBe("use_of_english");
    expect(
      focusSkill([
        { kind: "low_skill", source: "placement", skill: "speaking", level: 40 },
        { kind: "low_skill", source: "practice", skill: "reading", level: 58 },
      ]),
    ).toBe("reading");
    expect(focusSkill([])).toBeNull();
  });
});
