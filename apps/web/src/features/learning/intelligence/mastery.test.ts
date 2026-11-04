import { describe, expect, it } from "vitest";
import type { PlacementResult, SkillEvidence } from "@ogc/contracts";
import { computeProfile, normalizeEvidence, seedProfile, updateMastery, MASTERY_ALPHA } from "./mastery";

const placement: PlacementResult = {
  learnerId: "L1",
  orgId: "O1",
  cefrBand: "A2",
  skillSeed: { reading: 70, use_of_english: 65, speaking: 55 },
};

const ev = (over: Partial<SkillEvidence>): SkillEvidence => ({
  attemptId: "ATT-1",
  skill: "speaking",
  score: 100,
  at: "2026-01-01T00:00:00.000Z",
  ...over,
});

describe("mastery engine — seeding (A1)", () => {
  it("seeds every skill from placement with no evidence", () => {
    const p = seedProfile(placement);
    expect(p.skills.reading).toEqual({ level: 70, evidenceCount: 0, lastUpdatedAt: null });
    expect(p.skills.use_of_english).toEqual({ level: 65, evidenceCount: 0, lastUpdatedAt: null });
    expect(p.skills.speaking).toEqual({ level: 55, evidenceCount: 0, lastUpdatedAt: null });
    expect(p.cefrBand).toBe("A2");
  });
});

describe("mastery engine — update (A2)", () => {
  it("assessed evidence updates ONLY the relevant skill via EWMA", () => {
    const p = updateMastery(seedProfile(placement), [ev({ skill: "speaking", score: 100 })]);
    // 0.4*100 + 0.6*55 = 73
    expect(p.skills.speaking.level).toBe(Math.round(MASTERY_ALPHA * 100 + (1 - MASTERY_ALPHA) * 55));
    expect(p.skills.speaking.level).toBe(73);
    expect(p.skills.speaking.evidenceCount).toBe(1);
    expect(p.skills.speaking.lastUpdatedAt).toBe("2026-01-01T00:00:00.000Z");
    // Other skills untouched.
    expect(p.skills.reading).toEqual({ level: 70, evidenceCount: 0, lastUpdatedAt: null });
    expect(p.skills.use_of_english).toEqual({ level: 65, evidenceCount: 0, lastUpdatedAt: null });
  });

  it("does not mutate the input profile", () => {
    const base = seedProfile(placement);
    updateMastery(base, [ev({ score: 0 })]);
    expect(base.skills.speaking.level).toBe(55);
  });
});

describe("mastery engine — determinism & idempotency (A6)", () => {
  it("is idempotent on duplicate attemptId (never counts twice)", () => {
    const once = updateMastery(seedProfile(placement), [ev({})]);
    const twice = updateMastery(seedProfile(placement), [ev({}), ev({})]);
    expect(twice).toEqual(once);
    expect(twice.skills.speaking.evidenceCount).toBe(1);
  });

  it("is order-independent (sorts by (at, attemptId))", () => {
    const a = ev({ attemptId: "A", score: 100, at: "2026-01-01T00:00:00.000Z" });
    const b = ev({ attemptId: "B", score: 0, at: "2026-01-02T00:00:00.000Z" });
    const forward = updateMastery(seedProfile(placement), [a, b]);
    const reversed = updateMastery(seedProfile(placement), [b, a]);
    expect(reversed).toEqual(forward);
    // 55 →(A,100)→ 73 →(B,0)→ round(0.4*0+0.6*73)=44
    expect(forward.skills.speaking.level).toBe(44);
    expect(forward.skills.speaking.lastUpdatedAt).toBe("2026-01-02T00:00:00.000Z");
  });

  it("drops invalid evidence (bad score / empty attemptId) without modifying mastery", () => {
    const p = updateMastery(seedProfile(placement), [
      ev({ attemptId: "x", score: 150 }),
      ev({ attemptId: "", score: 90 }),
      ev({ attemptId: "y", score: Number.NaN }),
    ]);
    expect(p.skills.speaking).toEqual({ level: 55, evidenceCount: 0, lastUpdatedAt: null });
  });

  it("recompute from the same evidence yields identical output", () => {
    const set = [ev({ attemptId: "A", skill: "reading", score: 80, at: "2026-01-03T00:00:00.000Z" }), ev({})];
    expect(computeProfile(placement, set)).toEqual(computeProfile(placement, set));
  });

  it("normalizeEvidence is pure (input array untouched)", () => {
    const input = [ev({ attemptId: "B", at: "2026-01-02T00:00:00.000Z" }), ev({ attemptId: "A", at: "2026-01-01T00:00:00.000Z" })];
    const snapshot = JSON.stringify(input);
    normalizeEvidence(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
