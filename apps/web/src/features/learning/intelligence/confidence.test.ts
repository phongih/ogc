import { describe, expect, it } from "vitest";
import type { QualityEvidence, Skill } from "@ogc/contracts";
import { bandFor, computeConfidence } from "./confidence";

const qe = (over: Partial<QualityEvidence>): QualityEvidence => ({
  attemptId: "a1",
  skill: "use_of_english",
  assessmentType: "objective",
  valid: true,
  at: "2026-01-02T00:00:00.000Z",
  ...over,
});

const asmap = (over: Partial<Record<Skill, number>>): Record<Skill, number> => ({
  reading: 0,
  use_of_english: 0,
  speaking: 0,
  ...over,
});

describe("confidence engine — dimensions (B2)", () => {
  it("computes validity/coverage/recency/typeReliability deterministically", () => {
    const ev = [
      qe({ attemptId: "a1", at: "2026-01-02T00:00:00.000Z" }),
      qe({ attemptId: "a2", at: "2026-01-01T00:00:00.000Z" }),
    ];
    const c = computeConfidence(ev, asmap({ use_of_english: 4 }));
    const ue = c.use_of_english;
    expect(ue.quality.validity).toBe(100); // 2 valid / 2 raw
    expect(ue.quality.coverage).toBe(50); // 2 valid / 4 assessable
    expect(ue.quality.typeReliability).toBe(100); // both objective
    expect(ue.quality.recency).toBe(100); // newest evidence is the learner's newest
    expect(ue.level).toBe(80); // .2*100 + .4*50 + .2*100 + .2*100
    expect(ue.band).toBe("high");
    expect(ue.evidenceCount).toBe(2);
  });
});

describe("confidence engine — mastery vs evidence strength (B1)", () => {
  it("a skill with no evidence has zero confidence regardless of mastery", () => {
    const c = computeConfidence([], asmap({ speaking: 1 }));
    expect(c.speaking).toEqual({
      level: 0,
      band: "low",
      evidenceCount: 0,
      quality: { validity: 0, coverage: 0, recency: 0, typeReliability: 0 },
    });
  });
});

describe("confidence engine — quality effects (B3–B6)", () => {
  it("coverage: more evidence of a skill raises confidence (B3)", () => {
    const one = computeConfidence([qe({ attemptId: "a1" })], asmap({ use_of_english: 2 }));
    const two = computeConfidence(
      [qe({ attemptId: "a1" }), qe({ attemptId: "a2", at: "2026-01-01T00:00:00.000Z" })],
      asmap({ use_of_english: 2 }),
    );
    expect(two.use_of_english.quality.coverage).toBeGreaterThan(one.use_of_english.quality.coverage);
    expect(two.use_of_english.level).toBeGreaterThan(one.use_of_english.level);
  });

  it("validity: invalid evidence lowers the validity dimension and confidence (B4)", () => {
    const clean = computeConfidence([qe({ attemptId: "a1" })], asmap({ use_of_english: 1 }));
    const withInvalid = computeConfidence(
      [qe({ attemptId: "a1" }), qe({ attemptId: "bad", valid: false })],
      asmap({ use_of_english: 1 }),
    );
    expect(withInvalid.use_of_english.quality.validity).toBeLessThan(
      clean.use_of_english.quality.validity,
    );
    expect(withInvalid.use_of_english.level).toBeLessThan(clean.use_of_english.level);
  });

  it("assessment type: objective evidence is more reliable than subjective (B5)", () => {
    const objective = computeConfidence(
      [qe({ attemptId: "a1", skill: "reading", assessmentType: "objective" })],
      asmap({ reading: 1 }),
    );
    const subjective = computeConfidence(
      [qe({ attemptId: "a1", skill: "speaking", assessmentType: "subjective" })],
      asmap({ speaking: 1 }),
    );
    expect(objective.reading.quality.typeReliability).toBeGreaterThan(
      subjective.speaking.quality.typeReliability,
    );
    expect(objective.reading.level).toBeGreaterThan(subjective.speaking.level);
  });

  it("recency: newer evidence ranks higher than older (B6)", () => {
    const c = computeConfidence(
      [
        qe({ attemptId: "new", skill: "reading", assessmentType: "objective", at: "2026-02-01T00:00:00.000Z" }),
        qe({ attemptId: "old", skill: "speaking", assessmentType: "objective", at: "2026-01-01T00:00:00.000Z" }),
      ],
      asmap({ reading: 1, speaking: 1 }),
    );
    expect(c.reading.quality.recency).toBeGreaterThan(c.speaking.quality.recency);
  });
});

describe("confidence engine — determinism (B8)", () => {
  it("is deterministic and order-independent", () => {
    const ev = [
      qe({ attemptId: "a1", at: "2026-01-02T00:00:00.000Z" }),
      qe({ attemptId: "a2", at: "2026-01-01T00:00:00.000Z" }),
    ];
    const forward = computeConfidence(ev, asmap({ use_of_english: 3 }));
    const reversed = computeConfidence([...ev].reverse(), asmap({ use_of_english: 3 }));
    expect(reversed).toEqual(forward);
  });

  it("bandFor thresholds", () => {
    expect(bandFor(0)).toBe("low");
    expect(bandFor(33)).toBe("low");
    expect(bandFor(34)).toBe("medium");
    expect(bandFor(66)).toBe("medium");
    expect(bandFor(67)).toBe("high");
    expect(bandFor(100)).toBe("high");
  });
});
